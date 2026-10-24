import { SOCKET_NAME, warn } from "./constants.mjs";

/*
 * Live day: the GM shows one character's QR code on the table display (a non-GM user without a character, like the
 * Monk's display). The code may carry a password, so it travels only to that user: module socket messages with
 * `recipients` reach those sockets alone, while chat whispers are sent to every client and merely hidden.
 */

const OVERLAY_ID = "fcp-live-qr";

/** What the GM's client has on the display right now, to hide it when that character logs in. */
let shown = null;

export function showOnDisplay(displayId, { userId, name, src, note }) {
  shown = { displayId, userId };
  game.socket.emit(SOCKET_NAME, { type: "liveQr", name, src, note }, { recipients: [displayId] });
}

export function hideFromDisplay(displayId = null) {
  const target = shown?.displayId ?? displayId;
  if (!target) return;
  game.socket.emit(SOCKET_NAME, { type: "liveQrHide" }, { recipients: [target] });
  shown = null;
}

export function registerDisplayHooks() {
  Hooks.on("userConnected", (user, connected) => {
    if (connected && game.user.isGM && shown?.userId === user.id) hideFromDisplay();
  });
}

/** Display side. Only a GM may put something full screen on the table. */
export function onDisplayMessage(msg, senderId) {
  if (!game.users.get(senderId)?.isGM) return warn("QR display request from a non-GM ignored");
  document.getElementById(OVERLAY_ID)?.remove();
  if (msg.type !== "liveQr") return;
  const el = document.createElement("div");
  el.id = OVERLAY_ID;
  const title = document.createElement("h1");
  title.textContent = msg.name;
  const img = document.createElement("img");
  img.alt = "";
  // Only a data URL built by the GM's client: never load something from elsewhere.
  if (typeof msg.src === "string" && msg.src.startsWith("data:image/svg+xml")) img.src = msg.src;
  const note = document.createElement("p");
  note.textContent = msg.note ?? "";
  el.append(title, img, note);
  // Anyone at the table can clear the screen with a tap, should the GM's page lose track of it.
  el.addEventListener("click", () => el.remove());
  // Not on the body: Monk's Common Display hides every child of the body except its own list (#interface among them).
  (document.getElementById("interface") ?? document.body).append(el);
}
