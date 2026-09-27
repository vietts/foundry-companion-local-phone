import { SETTINGS, log } from "./constants.mjs";
import { getSetting } from "./settings.mjs";

/**
 * Keep the phone screen on while the companion is open. A locked phone suspends the page,
 * the socket drops, and Foundry reloads the whole client if it stayed away more than 5 seconds.
 * The browser releases the lock whenever the page is hidden, so it is asked again on return.
 */
let sentinel = null;
let active = false;

export function startWakeLock() {
  if (active) return;
  active = true;
  document.addEventListener("visibilitychange", syncWakeLock);
  syncWakeLock();
}

export async function syncWakeLock() {
  const want = active && getSetting(SETTINGS.KEEP_AWAKE) && document.visibilityState === "visible";
  if (!want) {
    await sentinel?.release().catch(() => {});
    sentinel = null;
    return;
  }
  if (sentinel && !sentinel.released) return;
  if (!("wakeLock" in navigator)) return log("wake lock not supported by this browser");
  try {
    sentinel = await navigator.wakeLock.request("screen");
  } catch (err) {
    // Some browsers only grant it after a user gesture: retry on the first touch.
    log(`wake lock refused (${err.name}), retrying on the next touch`);
    document.addEventListener("pointerdown", syncWakeLock, { once: true });
  }
}
