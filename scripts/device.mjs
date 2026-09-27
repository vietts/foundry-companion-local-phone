import { SETTINGS } from "./constants.mjs";
import { getSetting, setSetting } from "./settings.mjs";

/**
 * Heuristic: a device with a coarse pointer, touch support and a short side
 * below ~1000 CSS pixels is treated as a phone/tablet.
 */
export function looksLikeMobile() {
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  const shortSide = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999);
  const ua = navigator.userAgent ?? "";
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.platform === "MacIntel" && touch);
  return (coarse && touch && shortSide < 1000) || (uaMobile && touch);
}

/**
 * Decide whether the companion interface should replace the Foundry UI on this client.
 * Precedence: URL query (?companion=1|0) > "desktop for this tab" > client setting > heuristic.
 */
export function shouldUseCompanion() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("companion");
  if (q === "1" || q === "true") { setDesktopForSession(false); return true; }
  if (q === "0" || q === "false") return false;
  if (desktopForSession()) return false;

  const mode = getSetting(SETTINGS.MOBILE_MODE);
  if (mode === "on") return true;
  if (mode === "off") return false;
  return looksLikeMobile();
}

/**
 * The header's desktop button only lasts for this tab and this user: storing "off" in the client setting
 * left phones stuck on the desktop UI after a mistaken tap (it sits next to log out).
 */
const EXIT_KEY = "fcp-desktop-session";
export function desktopForSession() {
  try { return sessionStorage.getItem(EXIT_KEY) === game.user?.id; } catch (err) { return false; }
}
export function setDesktopForSession(on) {
  try { on ? sessionStorage.setItem(EXIT_KEY, game.user.id) : sessionStorage.removeItem(EXIT_KEY); } catch (err) { /* private mode */ }
}

/** Up to 0.4.6 the desktop button saved "off" for good: give those phones back "auto", once. */
export async function migrateStuckMobileMode() {
  const KEY = "fcp-mobile-mode-migrated";
  try {
    if (localStorage.getItem(KEY)) return;
    localStorage.setItem(KEY, "1");
  } catch (err) { return; }
  if (getSetting(SETTINGS.MOBILE_MODE) === "off") await setSetting(SETTINGS.MOBILE_MODE, "auto");
}
