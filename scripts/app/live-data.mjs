/* Pure helpers for the live day accesses: no Foundry globals, so they run under node --test. */

/** No 0/O, 1/l/I: the password is never typed, but it may be read out loud if a card gets lost. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newPassword(length = 12, random = n => crypto.getRandomValues(new Uint32Array(n))) {
  return Array.from(random(length), v => ALPHABET[v % ALPHABET.length]).join("");
}

/**
 * What the QR code opens.
 * With a login page next to Foundry: the page reads user and password from the fragment (never sent to a server).
 * Without: Foundry's join page, where the player picks the character's name (accounts have no password).
 */
export function qrTarget({ loginUrl, joinUrl, userId, password }) {
  if (!loginUrl) return joinUrl;
  const url = new URL(loginUrl, joinUrl);
  url.hash = new URLSearchParams({ u: userId, p: password ?? "" }).toString();
  return url.href;
}

/** Foundry user names are unique: "Khari" is taken → "Khari (2)". */
export function uniqueUserName(name, taken) {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}
