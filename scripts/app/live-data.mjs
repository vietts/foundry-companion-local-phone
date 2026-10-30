/* Pure helpers for the live day accesses: no Foundry globals, so they run under node --test. */

/** No 0/O, 1/l/I: the password is never typed, but it may be read out loud if a card gets lost. 16 characters ≈ 92 bits. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newPassword(length = 16, random = n => crypto.getRandomValues(new Uint32Array(n))) {
  return Array.from(random(length), v => ALPHABET[v % ALPHABET.length]).join("");
}

/**
 * What the QR code opens.
 * With a login page next to Foundry: the page reads user and password from the fragment (never sent to a server).
 * Without: Foundry's join page, where the player picks the character's name (accounts have no password).
 * Name and portrait let the login page greet the player ("Hi, you are …") while Foundry loads; the portrait only
 * when it is a file of this site (a short relative path), so the code stays small and loads nothing from elsewhere.
 */
export function qrTarget({ loginUrl, joinUrl, userId, password, name = "", img = "" }) {
  if (!loginUrl) return joinUrl;
  const url = new URL(loginUrl, joinUrl);
  const params = new URLSearchParams({ u: userId, p: password ?? "" });
  if (name) params.set("n", name);
  if (localImage(img)) params.set("i", img);
  url.hash = params.toString();
  return url.href;
}

/** A relative path to a file served by Foundry, not too long for a QR code. */
export function localImage(img) {
  return typeof img === "string" && img.length > 0 && img.length <= 120 && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(img);
}

/** Foundry user names are unique: "Khari" is taken → "Khari (2)". */
export function uniqueUserName(name, taken) {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}
