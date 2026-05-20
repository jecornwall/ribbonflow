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
 * Module singleton — SetPreview.vue and IndexPage.vue share one preview state.
 */

import { reactive } from 'vue'
import {
  deserializeFlow,
  assembleFlowSet,
  validateFlowSet,
  TRANSITION_DEFAULTS,
} from '@flow-designer/library/internals'
import { useFlowStore } from './flowStore.js'

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

/**
 * Load every flow in `setEntry` (an index `sets[]` entry: { id, title, flows[] }),
 * assemble a flow-set in the set's authored flow order, and arm the preview.
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
    const flowSet = assembleFlowSet(states, {
      id: setEntry.id,
      title: setEntry.title,
      transition: { ...TRANSITION_DEFAULTS },
    })
    state.validation = validateFlowSet(flowSet)
    state.flowSet = reactive(flowSet)
  } catch (err) {
    state.error = String(err?.message || err)
  } finally {
    state.loading = false
  }
}

/** Clear the preview (called when leaving the set-preview view). */
function clear() {
  state.setMeta = null
  state.flowSet = null
  state.error = null
}

export function useFlowSetPreview() {
  return { state, load, clear }
}
