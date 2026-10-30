import { localImage } from "./app/live-data.mjs";

/*
 * While Foundry loads, a phone shows the same waiting screen as the login page (tools/live-login): the character's
 * portrait and name, where we are, and nothing to tap. Without it the player saw Foundry's loading bar, its warnings
 * and a half-built interface, and tapped around. It goes away when the companion has drawn, or when this client turns
 * out not to use the companion.
 */

const BOOT_ID = "fcp-boot";
/* Foundry's translations are not loaded yet when this shows: the few words it needs, in Italian and English. */
const TEXT = (navigator.language ?? "").toLowerCase().startsWith("it") ? {
  hello: "Ciao, sei", table: "Al tavolo", known: "Ti abbiamo riconosciuto", connected: "Collegato",
  opening: "Apro il tavolo", first: "la prima volta ci vuole circa mezzo minuto",
  token: "Il tuo segnalino sulla mappa", sheet: "La tua scheda",
  tip: "Tieni il telefono acceso e non chiudere questa pagina. Non devi toccare niente."
} : {
  hello: "Hi, you are", table: "At the table", known: "We know who you are", connected: "Connected",
  opening: "Opening the table", first: "the first time takes about half a minute",
  token: "Your token on the map", sheet: "Your character sheet",
  tip: "Keep the phone awake and this page open. You don't need to tap anything."
};
const KEY = "fcp-boot";
let timer = null;

/** What the login page left: the character's name and portrait, for a few minutes. */
function bootInfo() {
  try {
    const info = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (info && Date.now() - (info.at ?? 0) < 10 * 60_000) return info;
  } catch (err) { /* private mode */ }
  return null;
}

export function showBoot() {
  if (document.getElementById(BOOT_ID)) return;
  const info = bootInfo();
  const name = typeof info?.name === "string" ? info.name.slice(0, 80) : "";
  const el = document.createElement("div");
  el.id = BOOT_ID;
  el.setAttribute("role", "status");
  const face = document.createElement("div");
  face.className = "fcp-boot-face";
  face.textContent = name ? name.trim().charAt(0).toUpperCase() : "";
  if (info && localImage(info.img)) {
    const probe = new Image();
    probe.onload = () => { face.textContent = ""; face.style.backgroundImage = `url("${probe.src.replace(/"/g, "%22")}")`; };
    probe.src = new URL(info.img, document.baseURI).href;
  }
  const hello = document.createElement("p");
  hello.className = "fcp-boot-hello";
  hello.textContent = name ? TEXT.hello : "";
  const title = document.createElement("h1");
  title.textContent = name || TEXT.table;
  const card = document.createElement("div");
  card.className = "fcp-boot-card";
  // Coming from the QR means a live day, where the phone opens on the map; otherwise it opens on the sheet.
  const steps = [
    ["done", name ? TEXT.known : TEXT.connected],
    ["now", TEXT.opening, TEXT.first],
    ["", info ? TEXT.token : TEXT.sheet]
  ];
  const list = document.createElement("ol");
  steps.forEach(([state, label, sub], i) => {
    const li = document.createElement("li");
    li.className = state;
    const dot = document.createElement("span");
    dot.className = "fcp-boot-dot";
    dot.textContent = state === "done" ? "✓" : state === "now" ? "" : String(i + 1);
    const text = document.createElement("span");
    text.textContent = label;
    if (sub) {
      const small = document.createElement("small");
      small.textContent = sub;
      text.append(small);
    }
    li.append(dot, text);
    list.append(li);
  });
  const bar = document.createElement("div");
  bar.className = "fcp-boot-bar";
  bar.append(document.createElement("i"));
  card.append(list, bar);
  const tip = document.createElement("p");
  tip.className = "fcp-boot-tip";
  tip.textContent = TEXT.tip;
  el.append(face, hello, title, card, tip);
  document.body.append(el);
  // Never a screen stuck forever: if something goes wrong, Foundry's own page shows through after a minute.
  timer = setTimeout(hideBoot, 60_000);
}

export function hideBoot() {
  clearTimeout(timer);
  const el = document.getElementById(BOOT_ID);
  if (!el) return;
  el.classList.add("fcp-boot-out");
  setTimeout(() => el.remove(), 250);
  try { sessionStorage.removeItem(KEY); } catch (err) { /* private mode */ }
}
