// flow/library/src/render/mountFlow.js
/**
 * mountFlow.js — the vanilla imperative renderer (single flow, Phase 2a).
 *
 * mountFlow(el, flow, opts) → { update, destroy }. The framework-free twin of
 * FlowGraph.vue: resolves the flow input (migrate+normalize), builds the
 * simulation, paints buildFlowScene's static layer into SVG DOM ONCE, runs the
 * visibility-gated requestAnimationFrame loop (ported from FlowGraph), and
 * updates only the agent circles each frame via agentsView. Scheduler + browser
 * env are injectable via opts for headless tests; in production they default to
 * the real globals.
 *
 * Phase 2a is single-flow only — a flow-set throws (Phase 2b adds that branch).
 *
 * NOTE (Task 7 of the Phase 2a plan): this increment delivers mount + the single
 * static paint ONLY. `update` is a deliberate stub and `destroy` just removes the
 * svg; the visibility-gated rAF loop (Task 8) and update/remount-on-identity
 * (Task 9) land next. The agentsView import is deferred to Task 8, which is the
 * first to use it (keeps this file free of unused imports).
 */
import { normalizeFlowInput } from '../format/index.js'
import { isFlowSetEnvelope } from '../format/flowSet.js'
import { createFlowSimulation } from '../core/useFlowSimulation.js'
import { buildFlowScene } from '../core/buildFlowScene.js'
import { applySpec } from './applySpec.js'
import { rootSpec } from './sceneSpec.js'

// A raw flow-set object (no envelope) — matches FlowEmbed.vue's isRawFlowSet:
// a `states` array with no numeric `formatVersion`.
function isRawFlowSet(input) {
  return (
    input != null && typeof input === 'object' &&
    typeof input.formatVersion !== 'number' && Array.isArray(input.states)
  )
}

/**
 * @param {Element} el — host element to mount the flow <svg> into.
 * @param {object|string} flow — a flow object / serialized flow (NOT a flow-set
 *   in Phase 2a). Same transparent single-flow union as <FlowEmbed>.
 * @param {object} [opts]
 * @param {boolean} [opts.showMetrics=false]
 * @param {Document} [opts.document] — owning document (defaults el.ownerDocument).
 * @returns {{update: Function, destroy: Function}}
 */
export function mountFlow(el, flow, opts = {}) {
  if (isFlowSetEnvelope(flow) || isRawFlowSet(flow)) {
    throw new Error('mountFlow: flow-sets are not supported in Phase 2a (single-flow only). See ribbonflow Phase 2b.')
  }
  const doc = opts.document || el.ownerDocument
  const showMetrics = !!opts.showMetrics

  // Resolve input → render-ready normalized flow (migrate+normalize, M5 fix).
  const normalized = normalizeFlowInput(flow)

  // Build the simulation + paint the static scene once.
  const sim = createFlowSimulation(normalized, { initialAgents: normalized.initialAgents ?? 8 })
  const scene = buildFlowScene(normalized, sim, { showMetrics })
  const svg = applySpec(el, rootSpec(scene), doc)

  // rootSpec paints an empty agents group (g.flow-agents); the rAF loop in
  // Task 8 looks it up and fills it per frame — nothing to do at mount.

  // (Task 8 adds the rAF loop + visibility gate here.)

  return {
    update() { /* Task 8/9 */ },
    destroy() {
      if (svg.parentNode) svg.parentNode.removeChild(svg)
    },
  }
}
