import { SOCKET_NAME, MODULE_ID } from "./constants.mjs";

/*
 * When something breaks at the table nobody looks at the console. The phone shows what failed where it failed,
 * keeps a reload button that survives a broken window, and tells the GM which phone has a problem.
 */

const RELOAD_ID = "fcp-reload";
const sent = new Map();

/** Log, then tell the active GM (at most once every 30 s for the same error). */
export function reportError(where, err, actor = null) {
  const message = String(err?.message ?? err ?? "?").split("\n")[0].slice(0, 200);
  console.error(`${MODULE_ID} | ${where}${actor ? ` (${actor.name})` : ""} | system ${game.system.id} ${game.system.version}`, err);
  if (game.user.isGM) return message;
  const key = `${where}|${message}`;
  if (Date.now() - (sent.get(key) ?? 0) < 30000) return message;
  sent.set(key, Date.now());
  const gm = game.users.activeGM;
  if (gm) {
    game.socket.emit(SOCKET_NAME, { type: "phoneError", where, message, actor: actor?.name ?? null }, { recipients: [gm.id] });
  }
  return message;
}

/** GM side. */
export function onPhoneError(msg, senderId) {
  if (!game.user.isGM) return;
  const user = game.users.get(senderId);
  if (!user) return;
  const where = game.i18n.has(`FCP.Error.Where.${msg.where}`) ? game.i18n.localize(`FCP.Error.Where.${msg.where}`) : String(msg.where);
  ui.notifications.error(game.i18n.format("FCP.Error.ToGM", {
    name: msg.actor ? `${user.name} (${msg.actor})` : user.name,
    where,
    message: String(msg.message ?? "")
  }));
}

/** Reload the page and come back to the companion, whatever the device settings say. */
export function reloadCompanion() {
  const url = new URL(window.location.href);
  url.searchParams.set("companion", "1");
  window.location.href = url.href;
}

/**
 * A small fixed button on the body, outside the companion window: it stays even when Foundry throws the window away.
 * Error cards inside the window use the same reload through `.fcp-reload-inline`.
 */
export function installRecovery() {
  if (!document.getElementById(RELOAD_ID)) {
    const btn = document.createElement("button");
    btn.id = RELOAD_ID;
    btn.type = "button";
    btn.title = game.i18n.localize("FCP.Error.Reload");
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
    document.body.append(btn);
  }
  document.addEventListener("click", event => {
    if (event.target.closest?.(`#${RELOAD_ID}, .fcp-reload-inline`)) {
      event.preventDefault();
      reloadCompanion();
    }
  });
  window.addEventListener("error", event => {
    if (String(event.filename ?? "").includes(MODULE_ID)) reportError("general", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", event => {
    if (String(event.reason?.stack ?? "").includes(MODULE_ID)) reportError("general", event.reason);
  });
}

/** What goes in place of a part that failed to render. */
export function errorPart(partId, message, active) {
  const tag = partId === "header" ? "header" : partId === "nav" ? "nav" : "section";
  const el = document.createElement(tag);
  el.className = tag === "section" ? `fcp-tab fcp-part-error${active ? " active" : ""}` : `fcp-part-error fcp-part-error-${partId}`;
  if (tag === "section") el.dataset.tab = partId;
  el.dataset.applicationPart = partId;
  const box = document.createElement("div");
  box.className = "fcp-error-card";
  const title = document.createElement("strong");
  title.textContent = game.i18n.localize("FCP.Error.PartTitle");
  const text = document.createElement("p");
  text.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fcp-btn fcp-reload-inline";
  btn.textContent = game.i18n.localize("FCP.Error.Reload");
  box.append(title, text, btn);
  el.append(box);
  return el;
}
