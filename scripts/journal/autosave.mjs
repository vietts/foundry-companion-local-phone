/**
 * Debounced saving of one text value. Pure (no Foundry globals), so it runs under `node --test`.
 * @param {object} config
 * @param {() => string} config.read                       Current value, read only when a save is due.
 * @param {(value: string) => Promise<unknown>} config.save
 * @param {string} [config.initial=""]                      The value already stored.
 * @param {number} [config.delay=1000]                      Quiet time after the last change before saving (ms).
 * @param {(state: "dirty"|"saving"|"saved"|"error", error?: unknown) => void} [config.onState]
 * @returns {{touch: () => void, flush: (value?: string) => Promise<boolean>, dispose: () => void,
 *   hasChanges: () => boolean}}
 */
export function createAutosave({ read, save, initial = "", delay = 1000, onState = () => {} }) {
  let saved = initial;
  let dirty = false;
  let timer = null;
  let inflight = null;
  let disposed = false;

  /** Something changed: save after a quiet `delay`. The value is read later, serializing costs. */
  function touch() {
    if (disposed) return;
    dirty = true;
    onState("dirty");
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delay);
  }

  /** Save now. Resolves true when nothing is left to save. */
  async function flush(value) {
    clearTimeout(timer);
    timer = null;
    // One save at a time: wait for the one in progress, then save the newest value.
    while (inflight) await inflight.catch(() => {});
    if (value === undefined) {
      if (!dirty) return true;
      value = read();
    }
    dirty = false;
    if (value === saved) {
      onState("saved");
      return true;
    }
    onState("saving");
    inflight = (async () => save(value))();
    try {
      await inflight;
      saved = value;
      onState(dirty ? "dirty" : "saved");
      return !dirty;
    } catch (err) {
      dirty = true;
      onState("error", err);
      return false;
    } finally {
      inflight = null;
    }
  }

  function dispose() {
    disposed = true;
    clearTimeout(timer);
    timer = null;
  }

  /** True while there is an unsaved change, or a save for one is in flight. */
  function hasChanges() {
    return dirty || (inflight !== null);
  }

  return { touch, flush, dispose, hasChanges };
}
