/**
 * buildFlowScene.js — the pure, framework-free render model.
 *
 * Turns a normalised flow + its simulation into a declarative Scene: a list of
 * static SVG primitive descriptors (built once) plus a per-frame agentsView.
 * It is a faithful lift of the geometry-deriving computeds in FlowGraph.vue,
 * reusing the SAME pure helpers from flowCurve.js, so the emitted geometry is
 * identical to the Vue renderer by construction. No Vue, no DOM.
 *
 * Provenance: each section cites the FlowGraph.vue block it was lifted from.
 */

import { renderRadiusForAgent } from './agentRender.js'
import {
  REJECTION_PARTICLE_COLOR,
  DEFECTIVE_PARTICLE_COLOR,
  ribbonOutlinePath,
  segmentedRibbonLayout,
  buildPinchWidthFn,
  computeNodeWidths,
  RIBBON_SCHEME_COLORS,
} from './flowCurve.js'

// FlowGraph.vue:638-655 — pinch flows use the wineglass width fn; everything
// else uses the smooth segmented layout's widthFn (shared with the engine).
function branchWidthFn(branch, flow, widths) {
  if (flow.pinchMode === 'constraint-only') return buildPinchWidthFn(branch, flow)
  return segmentedRibbonLayout(branch, flow, widths).widthFn
}

// Module-local counter for stable, collision-free ids per buildFlowScene call.
// NOT Math.random (FlowGraph used random for the same purpose) — a deterministic
// counter keeps headless tests stable and avoids the banned Math.random in
// downstream tooling.
let _sceneSeq = 0

/**
 * @param {object} flow — a normalised flow object
 * @param {object} sim  — a simulation from createFlowSimulation(flow, ...);
 *                        provides sim.branches (geometry) and, via agentsView,
 *                        sim.agents (per-frame positions).
 * @returns {{viewBox, defs, static: object[]}}
 */
export function buildFlowScene(flow, sim) {
  const seq = _sceneSeq++
  const vb = flow.viewBox || { w: 0, h: 0 }
  const viewBox = { x: vb.x ?? 0, y: vb.y ?? 0, w: vb.w ?? 0, h: vb.h ?? 0 }

  const defs = {
    clipId: `flow-clip-${seq}`,
    clipRect: { x: viewBox.x, y: viewBox.y, width: viewBox.w, height: viewBox.h },
    // FlowGraph.vue:42-45 — opt-in ink-wobble filter; constants frozen there.
    wobble: flow.inkWobble
      ? { id: `flow-wobble-${seq}`, baseFrequency: 0.012, scale: 1.6 }
      : null,
  }

  const staticPrims = []
  const widths = computeNodeWidths(flow)
  const renderBranches = sim.branches.filter((b) => b.kind !== 'rejection')
  const ribbonColor = flow.ribbonColor || RIBBON_SCHEME_COLORS.neutral

  // ── Ribbons (one per render branch) — FlowGraph.vue:108-114 ───────────────
  for (const branch of renderBranches) {
    staticPrims.push({
      kind: 'ribbon',
      d: ribbonOutlinePath(branch.centerline, branchWidthFn(branch, flow, widths)),
      fill: ribbonColor,
    })
  }

  // Further primitive families are appended below in paint order.

  return { viewBox, defs, static: staticPrims }
}

/**
 * Per-frame agents view. Pure: reads the CURRENT sim's agents each call, so a
 * visibility-gate sim rebuild (Phase 2 startFresh) is reflected without
 * recapturing. Pending agents are dropped (they pile at an off-canvas anchor —
 * FlowGraph.vue:583-588). `fill: null` means "renderer default cream".
 *
 * @param {{agents: object[]}} sim
 * @returns {{id, x, y, r, fill}[]}
 */
export function agentsView(sim) {
  return sim.agents
    .filter((a) => a.lifecycle !== 'pending')
    .map((a) => ({
      id: a.id,
      x: a.x,
      y: a.y,
      r: renderRadiusForAgent(a),
      fill: agentFill(a),
    }))
}

// FlowGraph.vue:608-612 — revising (routing state) wins over defective (work
// property); everything else is the renderer's default.
function agentFill(agent) {
  if (agent.lifecycle === 'revising') return REJECTION_PARTICLE_COLOR
  if (agent.defective) return DEFECTIVE_PARTICLE_COLOR
  return null
}
