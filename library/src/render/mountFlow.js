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
 * Phase 2b: a flow-set is detected at the entry and delegated to mountFlowSet
 * (the crossfade player); this module owns the single-flow path it composes.
 *
 * Render state that survives an update (the swappable svg + its agents group,
 * the normalized flow, the live sim and loop bookkeeping) is held in mutable
 * `let`s the closures share, so `buildStatic`/`applyAgents`/`frame`/`startFresh`
 * all read the CURRENT bindings after `update` swaps the scene. The visibility
 * observer is created ONCE over the stable host `el` (not the swappable svg) so
 * it survives the swap — re-observing on every update would leak observers.
 */
import { normalizeFlowInput } from '../format/index.js'
import { isFlowSetEnvelope } from '../format/flowSet.js'
import { createFlowSimulation } from '../core/useFlowSimulation.js'
import { buildFlowScene, agentsView } from '../core/buildFlowScene.js'
import { applySpec } from './applySpec.js'
import { rootSpec, AGENTS_GROUP_CLASS } from './sceneSpec.js'
import { observeVisibility } from './visibilityWiring.js'
import { reconcileAgents, agentCircleSpec } from './agentsLayer.js'
import { mountFlowSet } from './mountFlowSet.js'

// A raw flow-set object (no envelope) — matches FlowEmbed.vue's isRawFlowSet:
// a `states` array with no numeric `formatVersion`.
function isRawFlowSet(input) {
  return (
    input != null && typeof input === 'object' &&
    typeof input.formatVersion !== 'number' && Array.isArray(input.states)
  )
}

function isFlowSet(input) {
  return isFlowSetEnvelope(input) || isRawFlowSet(input)
}

// The single-flow handle's update() is mode-locked: a flow-set cannot be
// swapped into a single-flow renderer (different DOM + handle shape). A kind
// switch is a remount — destroy + a fresh mountFlow — mirroring how FlowEmbed
// remounts on a flow-identity change.
function assertSingleFlow(input, where) {
  if (isFlowSet(input)) {
    throw new Error(`${where}: this is a single-flow renderer handle; a flow-set cannot be swapped in via update(). Destroy and re-mount to switch modes.`)
  }
}

/**
 * @param {Element} el — host element to mount the flow <svg> into.
 * @param {object|string} flow — the transparent <FlowEmbed> union: a flow
 *   object / serialized flow (rendered here), OR a flow-set object / envelope
 *   (delegated to mountFlowSet).
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
  // Transparent union (spec §4): a flow-set delegates to the crossfade player,
  // passing mountFlow itself as the nested single-flow renderer for its slots.
  // The injection (not an import) keeps mountFlowSet free of an import cycle and
  // makes its timeline unit-testable with a spy factory.
  if (isFlowSet(flow)) {
    return mountFlowSet(el, flow, { ...opts, mountFlow })
  }
  const doc = opts.document || el.ownerDocument
  const showMetrics = !!opts.showMetrics

  // ── scheduler env (injected for tests; real globals in prod) ────────────────
  const raf = opts.raf || ((cb) => requestAnimationFrame(cb))
  const caf = opts.caf || ((id) => cancelAnimationFrame(id))

  // ── mutable render state shared by the closures below ───────────────────────
  // Swappable bindings (rebuilt by buildStatic on mount + every update):
  let normalized = null      // the migrate+normalized current flow
  let svg = null             // the current <svg.flow-graph>
  let agentsGroup = null     // the current <g.flow-agents> the loop fills
  // Loop bookkeeping (the live sim + rAF state):
  let liveSim = null
  let rafId = null
  let lastT = null
  let prevById = new Map()

  // Build a fresh sim from the CURRENT normalized flow. Seed from the NORMALIZED
  // flow (`?? 8`) — parity-faithful to FlowGraph.vue:542, which reads
  // `props.flow.initialAgents ?? 8` where props.flow is itself the normalized
  // flow (FlowEmbed.vue normalizes before binding). A flow that authors
  // initialAgents keeps its value; one that doesn't normalizes to 0 → seeds 0,
  // exactly as FlowGraph does. Reads the live `normalized` so a remount picks up
  // the swapped flow.
  function buildSim() {
    return createFlowSimulation(normalized, { initialAgents: normalized.initialAgents ?? 8 })
  }

  // (Re)build the static scene for `inputFlow`: normalize → fresh sim →
  // buildFlowScene → paint, replacing any PRIOR svg first, then rebind the
  // swappable bindings. Returns the fresh sim it built the scene against (so the
  // first frame after a build animates from a consistent state).
  function buildStatic(inputFlow) {
    const next = normalizeFlowInput(inputFlow)
    const prevSvg = svg
    normalized = next
    const freshSim = buildSim()
    const scene = buildFlowScene(next, freshSim, { showMetrics })
    const nextSvg = applySpec(el, rootSpec(scene), doc)
    // Remove the prior svg AFTER painting the new one (so the host is never
    // momentarily empty); leaves exactly ONE svg in the host.
    if (prevSvg && prevSvg.parentNode) prevSvg.parentNode.removeChild(prevSvg)
    svg = nextSvg
    agentsGroup = svg.querySelector('g.' + AGENTS_GROUP_CLASS)
    return freshSim
  }

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
    // the pile-up fix (FlowGraph.vue:1174-1180). Reads the CURRENT normalized/
    // agentsGroup, so it works correctly after an update() swap.
    stopLoop()
    liveSim = buildSim()
    prevById = new Map()
    // Clear any stale agent circles from a prior visit.
    while (agentsGroup.firstChild) agentsGroup.removeChild(agentsGroup.firstChild)
    applyAgents()
    rafId = raf(frame)
  }

  // Initial mount: paint the static scene + seed the live sim.
  liveSim = buildStatic(flow)

  // Observe the stable host `el` (NOT the swappable `svg`) so the gate survives
  // the svg swap an update() performs. Created ONCE — re-observing per update
  // would leak observers / double-fire the gate.
  const visibility = observeVisibility(el, { onShow: startFresh, onHide: stopLoop }, {
    IntersectionObserver: opts.IntersectionObserver,
    document: opts.visibilityDocument,
  })

  return {
    /**
     * Swap the rendered flow. The static scene is rebuilt from scratch (the
     * deck's click idiom swaps the whole `flow` prop — FlowEmbed.vue remounts on
     * identity change; rebuilding unconditionally is the simplest faithful match
     * and avoids stale geometry on a topology swap). If the loop was running
     * (visible), it restarts fresh on the new scene; otherwise it stays idle
     * until the next onShow.
     */
    update(nextFlow) {
      assertSingleFlow(nextFlow, 'mountFlow.update')
      const wasRunning = rafId !== null
      stopLoop()
      liveSim = buildStatic(nextFlow)   // rebuild static + rebind svg/agentsGroup
      prevById = new Map()
      if (wasRunning) startFresh()      // keep loop semantics if it was live
    },
    destroy() {
      stopLoop()
      visibility.disconnect()
      if (svg && svg.parentNode) svg.parentNode.removeChild(svg)
    },
  }
}
