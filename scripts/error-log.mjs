import { MODULE_ID, SOCKET_NAME, warn } from "./constants.mjs";

/*
 * A log of what went wrong at the table, kept on the server so it can be read after the evening:
 * one file per day in the world folder, `worlds/<world>/phone-companion-log/<yyyy-mm-dd>.txt`, one JSON object per line.
 *
 * Every client builds its entries (who, which character, which tab, device, versions, stack) and sends them to the
 * active GM, whose client alone writes the file: uploads by one client never overwrite each other, and nothing
 * travels to the other players. Without a GM connected, a phone keeps its entries and sends them when a GM arrives.
 * Never logged: passwords, QR codes, chat text.
 */

const QUEUE_KEY = "fcp-log-queue";
const QUEUE_MAX = 60;
const DAY_MAX = 3000;
const SAME_MAX = 5;
const seen = new Map();
let context = () => ({});

/** Extra context for every entry of this client (the companion adds tab and character). */
export function setLogContext(fn) {
  context = fn;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function device() {
  const ua = navigator.userAgent ?? "";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : "other";
  const browser = /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "other";
  return `${os} ${browser} ${window.innerWidth}x${window.innerHeight}`;
}

/**
 * Record one event. `level`: "error" | "warn" | "info". `where`: a short place name ("render", "hp", "move"…).
 * The same place and message is recorded at most a few times per session: a part failing on every redraw
 * would otherwise fill the day.
 */
export function logEvent(level, where, err, { actor = null } = {}) {
  try {
    const message = String(err?.message ?? err ?? "?").split("\n")[0].slice(0, 300);
    const key = `${level}|${where}|${message}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > SAME_MAX) return;
    const stack = typeof err?.stack === "string" ? err.stack.split("\n").slice(1, 7).map(l => l.trim()).join(" | ").slice(0, 900) : undefined;
    const entry = {
      t: new Date().toISOString(),
      lvl: level,
      where: String(where),
      msg: message,
      ...(stack ? { stack } : {}),
      ...(count === SAME_MAX ? { note: "repeated, not logged again this session" } : {}),
      user: game.user?.name ?? null,
      gm: !!game.user?.isGM,
      actor: actor?.name ?? null,
      sys: game.system ? `${game.system.id} ${game.system.version}` : null,
      core: game.version ?? null,
      mod: game.modules?.get(MODULE_ID)?.version ?? null,
      dev: device(),
      ...safeContext()
    };
    deliver([entry]);
  } catch (e) {
    warn("could not log an event", e);
  }
}

function safeContext() {
  try { return context() ?? {}; } catch (err) { return {}; }
}

/* ---------------- Delivery ---------------- */

function deliver(entries) {
  const gm = game.users?.activeGM;
  if (gm?.id === game.user?.id) return writer.add(entries);
  if (gm && game.socket) {
    game.socket.emit(SOCKET_NAME, { type: "logEntries", entries }, { recipients: [gm.id] });
    return;
  }
  queue(entries);
}

function queue(entries) {
  try {
    const list = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]").concat(entries).slice(-QUEUE_MAX);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch (err) { /* private mode: lost, as before */ }
}

/** Send what was kept while no GM was connected. */
export function flushLogQueue() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch (err) { list = []; }
  if (!list.length || !game.users?.activeGM) return;
  try { localStorage.removeItem(QUEUE_KEY); } catch (err) { /* nothing to remove */ }
  deliver(list);
}

/** GM side: entries from a phone. Who sent them is taken from the server, not from the message. */
export function onLogEntries(msg, senderId) {
  if (!game.user.isGM || !Array.isArray(msg?.entries)) return;
  const sender = game.users.get(senderId);
  if (!sender) return;
  const entries = msg.entries.slice(0, QUEUE_MAX).filter(e => e && typeof e === "object")
    .map(e => ({ ...e, user: sender.name, gm: sender.isGM }));
  if (game.users.activeGM?.id === game.user.id) writer.add(entries);
}

/* ---------------- Writer (active GM only) ---------------- */

const writer = {
  day: null,
  lines: [],
  loading: null,
  timer: null,

  get dir() {
    return `worlds/${game.world.id}/phone-companion-log`;
  },

  async add(entries) {
    const day = today();
    if (this.day !== day) {
      this.day = day;
      this.lines = [];
      this.loading = this.load(day);
    }
    await this.loading;
    for (const e of entries) this.lines.push(JSON.stringify(e));
    if (this.lines.length > DAY_MAX) this.lines.splice(0, this.lines.length - DAY_MAX);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 4000);
  },

  /** The day's file may already exist (an earlier session, another GM client): continue it. */
  async load(day) {
    try {
      const res = await fetch(`${foundry.utils.getRoute(`${this.dir}/${day}.txt`)}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      const previous = text.split("\n").filter(Boolean);
      if (this.day === day) this.lines = previous.concat(this.lines);
    } catch (err) { /* no file yet */ }
  },

  async save() {
    const FP = CONFIG.ux?.FilePicker ?? foundry.applications?.apps?.FilePicker?.implementation;
    if (!FP || !this.day) return;
    const file = new File([`${this.lines.join("\n")}\n`], `${this.day}.txt`, { type: "text/plain" });
    try {
      await FP.createDirectory("data", this.dir, { notify: false }).catch(() => {});
      await FP.upload("data", this.dir, file, {}, { notify: false });
    } catch (err) {
      warn("could not save the error log", err);
    }
  }
};

/** Read today's (or another day's) log from the console: `game.modules.get(id).api.errorLog("2026-10-30")`. */
export async function readLog(day = today()) {
  const res = await fetch(`${foundry.utils.getRoute(`${writer.dir}/${day}.txt`)}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  return (await res.text()).split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (err) { return { raw: l }; } });
}
