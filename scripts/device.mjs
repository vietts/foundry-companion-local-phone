import { SETTINGS } from "./constants.mjs";
import { getSetting } from "./settings.mjs";

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
 * Precedence: URL query (?companion=1|0) > client setting > heuristic.
 */
export function shouldUseCompanion() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("companion");
  if (q === "1" || q === "true") return true;
  if (q === "0" || q === "false") return false;

  const mode = getSetting(SETTINGS.MOBILE_MODE);
  if (mode === "on") return true;
  if (mode === "off") return false;
  return looksLikeMobile();
}
