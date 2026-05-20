/**
 * transitionSaver.js — debounced persistence for a flow-set's transition.
 *
 * The set-preview transition controls (SetPreview.vue) mutate
 * `flowSet.transition` live via v-model. useFlowSetPreview.js watches that
 * object and feeds every change here; this module debounces the burst of
 * slider ticks into a single saveSetMeta call so set.json is written once a
 * change settles, not on every intermediate tick.
 *
 * Extracted as a Vue-free, library-free unit (bd ai-engineer-7gea) so the
 * persistence path — the debounce window and the `{ transition }` payload
 * shape handed to saveSetMeta — is unit-testable under plain `node --test`.
 * The Vue watcher glue (the justLoaded guard, the setMeta.id check) stays in
 * useFlowSetPreview.js; the Playwright e2e drive covers their integration.
 */

/**
 * Debounce window (ms) for a transition save. Above the slider tick rate, and
 * below the 800 ms flow auto-save debounce in useFlowDoc.js, so a set save and
 * a flow save interleave cleanly rather than racing.
 */
export const TRANSITION_SAVE_DEBOUNCE_MS = 600

/**
 * Build a debounced transition saver.
 *
 * @param {(setId: string, meta: { transition: object }) => any} saveSetMeta —
 *   the persistence call (in the designer, a wrapper around
 *   store.saveSetMeta). Invoked as `saveSetMeta(setId, { transition })`.
 * @param {object} [opts]
 * @param {number} [opts.delay] — debounce window in ms (default
 *   TRANSITION_SAVE_DEBOUNCE_MS).
 * @returns {{ schedule(setId: string, transition: object): void,
 *             cancel(): void, pending(): boolean }}
 */
export function createTransitionSaver(
  saveSetMeta,
  { delay = TRANSITION_SAVE_DEBOUNCE_MS } = {},
) {
  let timer = null
  return {
    /**
     * Schedule a save for `transition`, coalescing with any save still
     * pending inside the debounce window. The transition is SNAPSHOTTED now:
     * the caller mutates `transition` in place (v-model on the live object),
     * so the value is copied at schedule time and that copy is what persists.
     */
    schedule(setId, transition) {
      if (timer) clearTimeout(timer)
      const snapshot = { ...transition }
      timer = setTimeout(() => {
        timer = null
        saveSetMeta(setId, { transition: snapshot })
      }, delay)
    },
    /** Drop any pending save (called when the preview is torn down). */
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    /** True while a save is debounced and not yet fired. */
    pending() {
      return timer !== null
    },
  }
}
