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
  RIBBON_SCHEME_COLORS_LIGHT,
  pinchZoneOutlinePath,
  junctionNodeIds,
} from './flowCurve.js'

// FlowGraph.vue:638-655 — pinch flows use the wineglass width fn; everything
// else uses the smooth segmented layout's widthFn (shared with the engine).
/**
 * @param {object} branch — a sim branch (has .nodeIds, .centerline, .kind)
 * @param {object} flow   — the normalised flow object
 * @param {{[id:string]: number}} widths — per-node widths from computeNodeWidths
 * @returns {(s: number) => number} arc-length → ribbon width
 */
function branchWidthFn(branch, flow, widths) {
  if (flow.pinchMode === 'constraint-only') return buildPinchWidthFn(branch, flow)
  return segmentedRibbonLayout(branch, flow, widths).widthFn
}

// Distribute the centerline's geometric length across nodes by latency share.
// FlowGraph.vue:629-636
function branchLatencyArc(branch, flow) {
  const latencies = branch.nodeIds.map(
    (id) => flow.nodes.find((n) => n.id === id).latency,
  )
  const sum = latencies.reduce((a, b) => a + b, 0)
  const total = branch.centerline.totalLength
  return latencies.map((l) => (l / sum) * total)
}

// Module-local counter for stable, collision-free ids per buildFlowScene call.
// NOT Math.random (FlowGraph used random for the same purpose) — a deterministic
// counter keeps headless tests stable and avoids the banned Math.random in
// downstream tooling.
let _sceneSeq = 0

/**
 * Build the static Scene for a flow.
 *
 * ── Scene primitive schema (canonical) ───────────────────────────────────────
 * `static[]` carries declarative SVG primitive descriptors, emitted in paint
 * order — ribbons → coloured-segment overlays → junction discs. Each primitive
 * uses SVG-native field names so the (Phase 2) imperative renderer maps 1:1 to
 * DOM attributes:
 *
 *   { kind: 'ribbon', d, fill }              — one per render branch; `d` is the
 *                                              full ribbon outline path.
 *   { kind: 'path',   d, fill, key }         — a coloured-segment overlay
 *                                              (pinch flat / non-pinch two-tone).
 *   { kind: 'disc',   cx, cy, r, fill, key } — a junction star-burst cap
 *                                              (one per fork/merge node).
 *
 * Field convention: `d` for path geometry, `cx`/`cy`/`r` for circles, `fill`
 * for paint on every primitive — matching SVG `<path>` / `<circle>` attributes.
 *
 * `agentsView(sim)` (below) returns the per-frame layer: `{id, x, y, r, fill}[]`,
 * where `fill: null` means "renderer default cream".
 *
 * This is the canonical schema the Phase 2 imperative renderer consumes.
 * FlowGraph.vue keeps its own internal Vue computeds and is NOT a consumer of
 * this scene; the two derive identical geometry from the same flowCurve.js
 * helpers but are otherwise independent.
 *
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

  // ── Coloured-segment overlays — FlowGraph.vue:676-724 ─────────────────────
  if (flow.pinchMode === 'constraint-only') {
    // Pinch flows: flat per-segment overlay over the latency-proportioned range.
    renderBranches.forEach((branch, bi) => {
      const segLens = branchLatencyArc(branch, flow)
      const wfn = branchWidthFn(branch, flow, widths)
      const total = branch.centerline.totalLength
      let acc = 0
      for (let i = 0; i < branch.nodeIds.length; i++) {
        const sStart = acc
        const sEnd = Math.min(acc + segLens[i], total)
        acc += segLens[i]
        const node = flow.nodes.find((n) => n.id === branch.nodeIds[i])
        const scheme = (node && node.colorScheme) || 'neutral'
        if (scheme === 'neutral') continue
        const color = RIBBON_SCHEME_COLORS[scheme]
        if (!color) continue
        const d = pinchZoneOutlinePath(branch.centerline, wfn, { sStart, sEnd })
        if (d) staticPrims.push({ kind: 'path', key: `seg-${bi}-${i}`, d, fill: color })
      }
    })
  } else {
    // Non-pinch flows: two-tone — plateau in full tone, wings in light tone.
    renderBranches.forEach((branch, bi) => {
      const { widthFn, segments } = segmentedRibbonLayout(branch, flow, widths)
      segments.forEach((seg, i) => {
        const node = flow.nodes.find((n) => n.id === seg.nodeId)
        const scheme = (node && node.colorScheme) || 'neutral'
        if (scheme === 'neutral') return
        const full = RIBBON_SCHEME_COLORS[scheme]
        const light = RIBBON_SCHEME_COLORS_LIGHT[scheme]
        if (!full) return
        const pd = pinchZoneOutlinePath(branch.centerline, widthFn, seg.plateau)
        if (pd) staticPrims.push({ kind: 'path', key: `seg-${bi}-${i}-p`, d: pd, fill: full })
        ;[['l', seg.leftWing], ['r', seg.rightWing]].forEach(([wk, wing]) => {
          if (!wing) return
          const wd = pinchZoneOutlinePath(branch.centerline, widthFn, wing)
          if (wd) staticPrims.push({ kind: 'path', key: `seg-${bi}-${i}-w${wk}`, d: wd, fill: light })
        })
      })
    })
  }

  // ── Junction discs (star-burst caps) — FlowGraph.vue:823-862 ──────────────
  const junctionIds = junctionNodeIds(flow)
  for (const id of junctionIds) {
    const node = flow.nodes.find((n) => n.id === id)
    if (!node) continue
    let maxW = 0
    for (const branch of renderBranches) {
      const idx = branch.nodeIds.indexOf(id)
      if (idx < 0) continue
      const wfn = branchWidthFn(branch, flow, widths)
      const total = branch.centerline.totalLength
      let s
      if (idx === 0) {
        s = 0
      } else if (idx === branch.nodeIds.length - 1) {
        s = total
      } else {
        const segLens = branchLatencyArc(branch, flow)
        let acc = 0
        for (let i = 0; i < idx; i++) acc += segLens[i]
        s = Math.min(acc, total)
      }
      const w = wfn(s)
      if (typeof w === 'number' && w > maxW) maxW = w
    }
    const scheme = node.colorScheme || 'neutral'
    const color =
      scheme === 'neutral'
        ? (flow.ribbonColor || RIBBON_SCHEME_COLORS.neutral)
        : (RIBBON_SCHEME_COLORS[scheme] || RIBBON_SCHEME_COLORS.neutral)
    if (maxW > 0) {
      staticPrims.push({ kind: 'disc', key: `junction-${id}`, cx: node.x, cy: node.y, r: maxW / 2, fill: color })
    }
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
