/**
 * flowHistory.js — a snapshot-based undo/redo stack for the designer doc.
 *
 * Deliberately PURE: it stores opaque snapshots (the store passes deep
 * `cloneFlow` clones of the authored flow) and knows nothing of Vue or the
 * flow format. useFlowDoc.js owns the seam — it records a snapshot on every
 * committed edit (the `bumpPreview` cadence — M3 §3.1 named the store "the
 * natural seam for undo"), suppresses recording during a load/import, and
 * mirrors `canUndo`/`canRedo` into reactive state for the toolbar.
 *
 * Model: a classic past / present / future timeline.
 *   - `record(s)` pushes the old present onto `past`, makes `s` the present,
 *     and clears `future` — a fresh edit forks the timeline.
 *   - `undo()` moves the present back one step (onto `future`).
 *   - `redo()` moves it forward one step (off `future`).
 * The `past` stack is bounded by `limit` so a long editing session cannot
 * grow memory without bound.
 *
 * See bd ai-engineer-fu5s (M3-polish).
 */

/** Default cap on retained undo steps — generous for an editing session. */
const DEFAULT_LIMIT = 100

/**
 * Create an undo/redo history.
 * @param {{ limit?: number }} [opts] — `limit` caps the undo-stack depth.
 * @returns a history with reset / record / undo / redo and canUndo/canRedo.
 */
export function createHistory({ limit = DEFAULT_LIMIT } = {}) {
  /** Snapshots strictly before `present`, oldest-first. */
  let past = []
  /** The current snapshot, or null before anything is recorded. */
  let present = null
  /** Snapshots strictly after `present` (reachable by redo), oldest-first. */
  let future = []

  return {
    /**
     * Seed the timeline with `snapshot` as the present, discarding any prior
     * history. Used on load / import / new — the opened document is the new
     * origin and is not itself undoable.
     */
    reset(snapshot) {
      past = []
      future = []
      present = snapshot ?? null
    },

    /**
     * Record `snapshot` as the new present. The prior present (if any) becomes
     * undoable; the redo stack is cleared — a new edit forks the future.
     */
    record(snapshot) {
      if (present !== null) {
        past.push(present)
        if (past.length > limit) past.shift()
      }
      present = snapshot
      future = []
    },

    /**
     * Step back one snapshot.
     * @returns the restored snapshot, or null when there is nothing to undo.
     */
    undo() {
      if (past.length === 0) return null
      future.unshift(present)
      present = past.pop()
      return present
    },

    /**
     * Step forward one snapshot.
     * @returns the restored snapshot, or null when there is nothing to redo.
     */
    redo() {
      if (future.length === 0) return null
      past.push(present)
      present = future.shift()
      return present
    },

    /** The current snapshot. */
    get present() {
      return present
    },
    /** True when `undo()` would move the timeline. */
    get canUndo() {
      return past.length > 0
    },
    /** True when `redo()` would move the timeline. */
    get canRedo() {
      return future.length > 0
    },
    /** Number of retained undo steps. */
    get undoDepth() {
      return past.length
    },
    /** Number of retained redo steps. */
    get redoDepth() {
      return future.length
    },
  }
}
