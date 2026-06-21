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
 * NOTE (Task 8 of the Phase 2a plan): this increment adds the visibility-gated
 * rAF loop + per-frame agent reconcile. `update` is still a deliberate stub
 * (Task 9 implements remount-on-identity); `destroy` now stops the loop and
 * disconnects the visibility observer before removing the svg.
 */
import { normalizeFlowInput } from '../format/index.js'
import { isFlowSetEnvelope } from '../format/flowSet.js'
import { createFlowSimulation } from '../core/useFlowSimulation.js'
import { buildFlowScene, agentsView } from '../core/buildFlowScene.js'
import { applySpec } from './applySpec.js'
import { rootSpec, AGENTS_GROUP_CLASS } from './sceneSpec.js'
import { observeVisibility } from './visibilityWiring.js'
import { reconcileAgents, agentCircleSpec } from './agentsLayer.js'

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
 * @param {Document} [opts.document] — owning document the svg is created in
 *   (defaults to `el.ownerDocument`). The render-owner document, distinct from
 *   `opts.visibilityDocument` below.
 * @param {(cb: FrameRequestCallback) => number} [opts.raf] — scheduler hook;
 *   defaults to the real `requestAnimationFrame`. Injected for headless tests.
 * @param {(id: number) => void} [opts.caf] — cancels a scheduled frame;
 *   defaults to the real `cancelAnimationFrame`.
 * @param {Function} [opts.IntersectionObserver] — the on-screen observer ctor
 *   for the visibility gate; defaults to the global `IntersectionObserver`.
 * @param {object} [opts.visibilityDocument] — the tab-visibility source (its
 *   `hidden` flag + `visibilitychange` events drive the gate). Distinct from
 *   `opts.document` (the render-owner); both default to the global `document` in
 *   production.
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

  // Build the simulation + paint the static scene once. Seed from the NORMALIZED
  // flow (`?? 8`) — parity-faithful to FlowGraph.vue:541, which reads
  // `props.flow.initialAgents ?? 8` where props.flow is itself the normalized
  // flow (FlowEmbed.vue:60/86 normalizes before binding). A flow that authors
  // initialAgents keeps its value; one that doesn't normalizes to 0 → seeds 0,
  // exactly as FlowGraph does.
  const sim = createFlowSimulation(normalized, { initialAgents: normalized.initialAgents ?? 8 })
  const scene = buildFlowScene(normalized, sim, { showMetrics })
  const svg = applySpec(el, rootSpec(scene), doc)

  // rootSpec painted an empty agents group (g.flow-agents); the rAF loop below
  // looks it up and fills it per frame.
  const agentsGroup = svg.querySelector('g.' + AGENTS_GROUP_CLASS)

  // ── scheduler + visibility env (injected for tests; real globals in prod) ──
  const raf = opts.raf || ((cb) => requestAnimationFrame(cb))
  const caf = opts.caf || ((id) => cancelAnimationFrame(id))

  let liveSim = sim
  let rafId = null
  let lastT = null
  let prevById = new Map()

  function applyAgents() {
    const view = agentsView(liveSim)
    const ops = reconcileAgents(prevById, view)
    // removes — drop circles for agents gone this frame.
    for (const id of ops.removes) {
      const node = agentsGroup.querySelector(`circle[data-agent-id="${id}"]`)
      if (node) agentsGroup.removeChild(node)
    }
    // adds — paint a fresh circle for each new agent.
    for (const a of ops.adds) applySpec(agentsGroup, agentCircleSpec(a), doc)
    // moves — update cx/cy/r/fill in place (only changed circles mutate).
    for (const a of ops.moves) {
      const node = agentsGroup.querySelector(`circle[data-agent-id="${a.id}"]`)
      if (node) {
        const spec = agentCircleSpec(a)
        node.setAttribute('cx', String(spec.attrs.cx))
        node.setAttribute('cy', String(spec.attrs.cy))
        node.setAttribute('r', String(spec.attrs.r))
        node.setAttribute('fill', String(spec.attrs.fill))
      }
    }
    prevById = new Map(view.map((a) => [a.id, a]))
  }

  function frame(t) {
    if (lastT === null) lastT = t
    const dt = Math.min((t - lastT) / 1000, 1 / 30) // clamp — FlowGraph.vue:1162
    lastT = t
    liveSim.step(dt)
    applyAgents()
    rafId = raf(frame)
  }

  function stopLoop() {
    if (rafId !== null) { caf(rafId); rafId = null }
    lastT = null
  }

  function startFresh() {
    // Rebuild the sim from a clean initial state, then (re)start the loop —
    // the pile-up fix (FlowGraph.vue:1174-1180).
    stopLoop()
    liveSim = createFlowSimulation(normalized, { initialAgents: normalized.initialAgents ?? 8 })
    prevById = new Map()
    // Clear any stale agent circles from a prior visit.
    while (agentsGroup.firstChild) agentsGroup.removeChild(agentsGroup.firstChild)
    applyAgents()
    rafId = raf(frame)
  }

  // Observe the stable host `el` (NOT the swappable `svg`) so the gate survives
  // the svg swap a Task-9 update() performs.
  const visibility = observeVisibility(el, { onShow: startFresh, onHide: stopLoop }, {
    IntersectionObserver: opts.IntersectionObserver,
    document: opts.visibilityDocument,
  })

  return {
    update() { /* Task 9: remount-on-identity */ },
    destroy() {
      stopLoop()
      visibility.disconnect()
      if (svg.parentNode) svg.parentNode.removeChild(svg)
    },
  }
}
