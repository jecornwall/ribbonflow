/**
 * useFlowSetPreview.js — the designer's flow-SET preview state (M4).
 *
 * A flow-set is an ordered list of flow states sharing topology, animated
 * between (charter §"A flow-set"; M4 spec). The designer's persistence already
 * stores a set as a directory of per-flow files (persistence spec §2.2); this
 * module loads every flow in a set, assembles a portable flow-set, and feeds it
 * to <FlowSetPlayer> for the set-preview view.
 *
 * Library access is exclusively through the `/internals` face (M3 §2.4):
 * deserializeFlow / assembleFlowSet / validateFlowSet / TRANSITION_DEFAULTS.
 *
 * Transition persistence (bd ai-engineer-qwtp): the transition controls in
 * SetPreview.vue mutate `state.flowSet.transition` in place via v-model. A
 * debounced watcher here saves the updated transition to set.json via the
 * PUT /__flows/set/<id> REST endpoint, so changes round-trip across sessions.
 *
 * Module singleton — SetPreview.vue and IndexPage.vue share one preview state.
 */

import { reactive, watch } from 'vue'
import {
  deserializeFlow,
  assembleFlowSet,
  validateFlowSet,
  TRANSITION_DEFAULTS,
} from '@ribbonflow/core'
import { useFlowStore } from './flowStore.js'
import { createTransitionSaver } from './transitionSaver.js'

const store = useFlowStore()

const state = reactive({
  /** The index set being previewed, or null. */
  setMeta: null,
  /** The assembled flow-set object handed to <FlowSetPlayer>. Its `transition`
   *  is mutated IN PLACE by the live controls so the player picks up duration /
   *  hold changes without a timeline reset (the player watches the set by
   *  reference, not deeply). */
  flowSet: null,
  /** Advisory validation of the assembled set. */
  validation: { ok: true, errors: [], warnings: [] },
  loading: false,
  error: null,
})

// ── transition persistence ────────────────────────────────────────────────────

/**
 * Guard that swallows the one watcher firing caused by a fresh load() —
 * prevents the initial load from triggering a redundant save.  Mirrors the
 * `justLoaded` pattern in useFlowDoc.js.
 */
let justLoaded = false

/** Persist a set's transition to set.json via the REST API, swallowing
 *  failures (an authoring tool keeps editing through a transient save error).
 *  Shape `{ transition }` matches the saveSetMeta partial-meta contract. */
async function saveSetMetaSafely(setId, meta) {
  try {
    await store.saveSetMeta(setId, meta)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('set-preview: transition save failed:', err)
  }
}

/** Debounced transition persistence — see transitionSaver.js. */
const transitionSaver = createTransitionSaver(saveSetMetaSafely)

// Watch the assembled flow-set's transition object deep. When the user moves a
// slider or changes the easing, the v-model mutation lands here and is handed
// to the debounced saver, which persists it to set.json. The guard skips the
// first fire on load.
watch(
  () => state.flowSet?.transition,
  (newTransition) => {
    if (justLoaded) {
      justLoaded = false
      return
    }
    if (!state.setMeta?.id || !newTransition) return
    transitionSaver.schedule(state.setMeta.id, newTransition)
  },
  { deep: true },
)

// ── load / clear ──────────────────────────────────────────────────────────────

/**
 * Load every flow in `setEntry` (an index `sets[]` entry:
 * { id, title, flows[], transition? }), assemble a flow-set in the set's
 * authored flow order, and arm the preview.
 *
 * If the index carries a persisted `transition` (written by a previous
 * set-preview session), it is used as the initial transition so the user's
 * last-tuned settings are restored. Otherwise TRANSITION_DEFAULTS apply.
 */
async function load(setEntry) {
  state.setMeta = setEntry
  state.loading = true
  state.error = null
  state.flowSet = null
  try {
    const states = []
    for (const flow of setEntry.flows) {
      const envelope = await store.loadFlow(flow.id)
      states.push({
        key: flow.slug,
        title: flow.title,
        flow: deserializeFlow(envelope),
      })
    }
    // Restore the persisted transition when the index has one; else use
    // defaults. The { ...spread } ensures we own the copy.
    const transition = setEntry.transition
      ? { ...TRANSITION_DEFAULTS, ...setEntry.transition }
      : { ...TRANSITION_DEFAULTS }
    const flowSet = assembleFlowSet(states, {
      id: setEntry.id,
      title: setEntry.title,
      transition,
    })
    state.validation = validateFlowSet(flowSet)
    // Arm the justLoaded guard BEFORE making state.flowSet reactive so the
    // watcher sees the flag before it processes the transition change.
    justLoaded = true
    state.flowSet = reactive(flowSet)
  } catch (err) {
    state.error = String(err?.message || err)
  } finally {
    state.loading = false
  }
}

/** Clear the preview (called when leaving the set-preview view). */
function clear() {
  transitionSaver.cancel()
  state.setMeta = null
  state.flowSet = null
  state.error = null
}

export function useFlowSetPreview() {
  return { state, load, clear }
}
