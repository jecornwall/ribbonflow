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
  pinchZoneArcRanges,
  junctionNodeIds,
  rejectionEdgeAnchors,
  REJECTION_COLOR,
  PINCH_ROSE,
  CONSTRAINT_ROSE,
  INK,
  CONSTRAINT_INK,
  MIN_RIBBON_WIDTH,
  MAX_RIBBON_WIDTH,
} from './flowCurve.js'
import {
  rejectionArcPath,
  rejectionArrowPointsAttr,
  REJECTION_ARC_STROKE_WIDTH,
  REJECTION_ARC_DASHARRAY,
} from './flowRejectionArc.js'
import { isConstraintNode } from './nodeKind.js'
import {
  transformGlyphsFor,
  TRANSFORM_GLYPH_STROKE,
  TRANSFORM_GLYPH_STROKE_WIDTH,
  TRANSFORM_GLYPH_OPACITY,
} from './transformGlyph.js'

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

// Isometric station-box geometry — frozen against Station.vue defaults
// (FlowGraph.vue:495-500). BOX_HALF_ISO is a module-scope constant (not inline)
// because later marker tasks (T7-T9) reuse it for the fence-post boxTopY
// (node.y − BOX_HALF_ISO).
const BOX_HALF_ISO = 70
const SKEW_ISO = 20

// Segment-marker geometry — frozen against FlowSegmentMarker.vue:200-201.
// Defined here in T7 (the marker family's first task); T8's ticks/leaders use
// them. MARKER_TICK_HALF: half the perpendicular boundary-tick length;
// MARKER_LEADER_PAD: the gap between a perpendicular leader end and the ribbon.
const MARKER_TICK_HALF = 8
const MARKER_LEADER_PAD = 14
// T9 — constraint-hatch band width (viewBox units). FlowSegmentMarker.vue:153
// prop default (hatchWidth).
const MARKER_HATCH_WIDTH = 200

// Parallelogram vertices for an isometric station box centred on a node —
// FlowGraph.vue:509-520 (mirrors Station.vue#boxPoints, top-right-bottom-left
// vertex order, rightward skew).
function isoBoxPoints(node) {
  const x = node.x
  const y = node.y
  const w = BOX_HALF_ISO
  const h = BOX_HALF_ISO
  const s = SKEW_ISO
  const top = `${x - w},${y - h}`
  const right = `${x + w + s},${y - h + s}`
  const bot = `${x + w},${y + h}`
  const left = `${x - w - s},${y + h - s}`
  return `${top} ${right} ${bot} ${left}`
}

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
 * @param {{showMetrics?: boolean}} [opts] — render options (Phase 2 mountFlow
 *        passes these through; default showMetrics:false, matching FlowGraph).
 * @returns {{viewBox, defs, static: object[]}}
 */
export function buildFlowScene(flow, sim, opts = {}) {
  const ctx = makeSceneContext(flow, sim, opts)

  // Builders run in paint order; each appends to ctx.prims. Phase 1b inserts
  // additional builders at their correct call sites (decorations FIRST, etc.).
  buildDecorations(ctx)
  buildRibbons(ctx)
  buildColoredOverlays(ctx)
  buildJunctionDiscs(ctx)
  buildPinchRoses(ctx)
  buildRejectionArcs(ctx)
  buildStationBoxes(ctx)
  buildSegmentDividers(ctx)
  buildStageAnchors(ctx)
  buildSegmentMarkers(ctx)
  buildGhostMarkers(ctx)
  buildTransformGlyphs(ctx)
  buildLegend(ctx)

  return { viewBox: ctx.viewBox, defs: ctx.defs, static: ctx.prims }
}

/**
 * Build the shared, per-call context every family builder reads from. Holds the
 * normalised viewBox, the defs (clip + optional wobble), the precomputed node
 * widths and render-branch list (rejection branches excluded — they are routing
 * artefacts with no painted ribbon), the resolved ribbon colour, and the push
 * target `prims` (paint-ordered static primitive list).
 */
function makeSceneContext(flow, sim, opts) {
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
    // T9 — set when a perpendicular constraint marker needs the firebrick hatch.
    hatch: null,
  }
  return {
    flow,
    sim,
    opts,
    seq,
    viewBox,
    defs,
    widths: computeNodeWidths(flow),
    renderBranches: sim.branches.filter((b) => b.kind !== 'rejection'),
    ribbonColor: flow.ribbonColor || RIBBON_SCHEME_COLORS.neutral,
    prims: [],
  }
}

// ── Decorations (spine) — FlowGraph.vue:64-101 ──────────────────────────────
// Author-placed static chrome, drawn FIRST so ribbons/agents render over it.
function buildDecorations(ctx) {
  const decs = ctx.flow.decorations
  if (!Array.isArray(decs) || decs.length === 0) return
  decs.forEach((dec, i) => {
    if (dec.kind !== 'spine') return
    // Spine stroke — FlowGraph.vue:77-89. Opacity is data (UnoCSS-safe inline
    // style in the SFC); dec.color (a raw hex) overrides the scheme palette.
    ctx.prims.push({
      kind: 'line',
      key: `dec-${i}`,
      x1: dec.x, y1: dec.y1,
      x2: dec.x, y2: dec.y2,
      stroke:
        dec.color
        || RIBBON_SCHEME_COLORS[dec.colorScheme || 'neutral']
        || RIBBON_SCHEME_COLORS.neutral,
      strokeWidth: dec.width ?? 14,
      opacity: dec.opacity ?? 0.9,
      linecap: 'round',
    })
    // Optional spine label — FlowGraph.vue:90-99.
    if (dec.label) {
      ctx.prims.push({
        kind: 'text',
        key: `dec-${i}-label`,
        x: dec.x + (dec.labelDx ?? 0),
        y: (dec.labelSide === 'below' ? dec.y2 : dec.y1) + (dec.labelDy ?? 0),
        text: dec.label,
        font: 'ET Book, Georgia, serif',
        fontStyle: 'italic',
        fontSize: 24,
        fill: '#555555',
        anchor: 'middle',
      })
    }
  })
}

// ── Ribbons (one per render branch) — FlowGraph.vue:108-114 ─────────────────
function buildRibbons(ctx) {
  for (const branch of ctx.renderBranches) {
    ctx.prims.push({
      kind: 'ribbon',
      d: ribbonOutlinePath(branch.centerline, branchWidthFn(branch, ctx.flow, ctx.widths)),
      fill: ctx.ribbonColor,
    })
  }
}

// ── Coloured-segment overlays — FlowGraph.vue:676-724 ───────────────────────
function buildColoredOverlays(ctx) {
  const { flow, widths, renderBranches, prims } = ctx
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
        if (d) prims.push({ kind: 'path', key: `seg-${bi}-${i}`, d, fill: color })
      }
    })
    return
  }
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
      if (pd) prims.push({ kind: 'path', key: `seg-${bi}-${i}-p`, d: pd, fill: full })
      ;[['l', seg.leftWing], ['r', seg.rightWing]].forEach(([wk, wing]) => {
        if (!wing) return
        const wd = pinchZoneOutlinePath(branch.centerline, widthFn, wing)
        if (wd) prims.push({ kind: 'path', key: `seg-${bi}-${i}-w${wk}`, d: wd, fill: light })
      })
    })
  })
}

// ── Junction discs (star-burst caps) — FlowGraph.vue:823-862 ────────────────
function buildJunctionDiscs(ctx) {
  const { flow, widths, renderBranches, prims } = ctx
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
      prims.push({ kind: 'disc', key: `junction-${id}`, cx: node.x, cy: node.y, r: maxW / 2, fill: color })
    }
  }
}

// ── Pinch-zone rose overlays — FlowGraph.vue:155-173 + :792-803 ─────────────
// One up/down/plateau triple per branch in constraint-only flows. Uses
// buildPinchWidthFn directly (the wineglass profile), matching the computed.
function buildPinchRoses(ctx) {
  const { flow, renderBranches, prims } = ctx
  if (flow.pinchMode !== 'constraint-only') return
  const roseFill = flow.pinchFillColor || PINCH_ROSE
  const plateauFill = flow.constraintFillColor || CONSTRAINT_ROSE
  renderBranches.forEach((branch, i) => {
    const wfn = buildPinchWidthFn(branch, flow)
    const ranges = pinchZoneArcRanges(branch, flow)
    const up = pinchZoneOutlinePath(branch.centerline, wfn, ranges.upstream)
    const down = pinchZoneOutlinePath(branch.centerline, wfn, ranges.downstream)
    const plat = pinchZoneOutlinePath(branch.centerline, wfn, ranges.constraintPlateau)
    if (up) prims.push({ kind: 'path', key: `pinch-${i}-up`, d: up, fill: roseFill })
    if (down) prims.push({ kind: 'path', key: `pinch-${i}-down`, d: down, fill: roseFill })
    if (plat) prims.push({ kind: 'path', key: `pinch-${i}-plat`, d: plat, fill: plateauFill })
  })
}

// ── Rejection-edge arcs — FlowGraph.vue:184-192 + :871-894 ──────────────────
// Thin dotted desaturated-red bow per rejection edge, anchored on the band
// EDGE (rejectionEdgeAnchors) so it peels off the ribbon side. Arc + arrowhead
// derive from the SAME rejectionBowCurve the engine centerline uses, so the
// visible arc and the 'revising' particles' path agree by construction. A
// dangling edge (missing node) is skipped — the renderer must not crash on a
// transient mid-edit designer state. Faithful match to FlowGraph.vue:885: the
// raw `rej.bow` is passed to rejectionEdgeAnchors, while the arc path +
// arrowhead use `bow = rej.bow || {}` (FlowRejectionArc's prop default).
function buildRejectionArcs(ctx) {
  const { flow, prims, widths } = ctx
  const rejList = flow.rejections
  if (!Array.isArray(rejList) || rejList.length === 0) return
  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  rejList.forEach((rej, i) => {
    if (rej == null) return
    const f = byId.get(rej.from)
    const t = byId.get(rej.to)
    if (!f || !t) return
    const bow = rej.bow || {}
    const { fromPt, toPt } = rejectionEdgeAnchors(f, t, rej.bow, widths)
    prims.push({
      kind: 'rejectionArc',
      key: `rej-${i}`,
      d: rejectionArcPath(fromPt, toPt, bow),
      arrowPoints: rejectionArrowPointsAttr(fromPt, toPt, bow),
      stroke: REJECTION_COLOR,
      strokeWidth: REJECTION_ARC_STROKE_WIDTH,
      dasharray: REJECTION_ARC_DASHARRAY,
    })
  })
}

// ── Station boxes (isometric, hairline outline only) — FlowGraph.vue:209-218 ─
// One hairline-outline parallelogram per node when flow.showBoxes is set; no
// fill, so the ribbon flows visibly through. Constraint nodes (isConstraintNode)
// get the firebrick accent stroke at 1.8; everything else gets the ink stroke at
// 1.2. INK/CONSTRAINT_INK are the palette's single source of truth (flowCurve.js)
// — CONSTRAINT_INK === '#E2522B', INK === '#15171A'.
function buildStationBoxes(ctx) {
  const { flow, prims } = ctx
  if (!flow.showBoxes) return
  for (const node of flow.nodes) {
    const constraint = isConstraintNode(node)
    prims.push({
      kind: 'polygon',
      key: `box-${node.id}`,
      points: isoBoxPoints(node),
      fill: 'none',
      stroke: constraint ? CONSTRAINT_INK : INK,
      strokeWidth: constraint ? 1.8 : 1.2,
    })
  }
}

// ── Segment dividers (tangent-perpendicular hairline ticks) — :244-254/:739-767
// Only for flow.segmentDividers. One hairline tick per INTERIOR node boundary on
// each render branch (the ribbon's open ends are omitted). At each boundary's arc
// position we sample the centerline point + unit tangent + width fn, then draw a
// tick PERPENDICULAR to the local tangent (unit normal = (−ty, tx)), extending
// halfH + 4 past each band edge. FlowGraph's template folds that normal-projection
// + margin into the <line> endpoints; the scene bakes the same math into x1/y1/
// x2/y2. The marginalia grey '#555555' has no named export in flowCurve.js, so it
// stays inline — faithful to FlowGraph.
function buildSegmentDividers(ctx) {
  const { flow, widths, renderBranches, prims } = ctx
  if (!flow.segmentDividers) return
  renderBranches.forEach((branch, bi) => {
    const segLens = branchLatencyArc(branch, flow)
    const wfn = branchWidthFn(branch, flow, widths)
    let acc = 0
    // Interior boundaries only: i in [0, segLens.length − 1).
    for (let i = 0; i < segLens.length - 1; i++) {
      acc += segLens[i]
      const sBoundary = Math.min(acc, branch.centerline.totalLength)
      const pt = branch.centerline.pointAtArcLength(sBoundary)
      const tan = branch.centerline.tangentAtArcLength(sBoundary)
      const halfH = wfn(sBoundary) / 2
      // Unit normal = tangent rotated 90°: (−ty, tx). Horizontal tangent (1,0)
      // → normal (0,1) → vertical tick, identical to the legacy render. The
      // template's (halfH + 4) margin is folded into the endpoints here.
      const nx = -tan.y
      const ny = tan.x
      const ext = halfH + 4
      prims.push({
        kind: 'line',
        key: `div-${bi}-${i}`,
        x1: pt.x + nx * ext, y1: pt.y + ny * ext,
        x2: pt.x - nx * ext, y2: pt.y - ny * ext,
        stroke: '#555555',
        strokeWidth: 0.8,
        linecap: 'round',
      })
    }
  })
}

// ── Stage-anchor notches — FlowGraph.vue:273-288 ────────────────────────────
// Only for flow.stageAnchors. One short vertical notch per non-entry,
// non-constraint, LABELLED node, drawn at the node's label x (labelX ?? x) and
// spanning node.y ± (bandWidth/2 + 6). The filter is FlowGraph's LITERAL
// `n.kind !== 'constraint'` (NOT the broader isConstraintNode predicate) — a v3
// colorScheme:'red' constraint lacking kind:'constraint' still gets a notch,
// faithful to FlowGraph.vue:276. The marginalia grey '#555555' has no named
// export in flowCurve.js, so it stays inline — faithful to FlowGraph.
function buildStageAnchors(ctx) {
  const { flow, prims } = ctx
  if (!flow.stageAnchors) return
  const half = (flow.bandWidth ?? 70) / 2
  const nodes = flow.nodes.filter(
    (n) => n.id !== flow.entryId && n.kind !== 'constraint' && n.label,
  )
  for (const node of nodes) {
    const ax = node.labelX ?? node.x
    prims.push({
      kind: 'line',
      key: `anchor-${node.id}`,
      x1: ax, y1: node.y - half - 6,
      x2: ax, y2: node.y + half + 6,
      stroke: '#555555',
      strokeWidth: 2.5,
      linecap: 'round',
      opacity: 0.85,
    })
  }
}

// Fork-root / pre-merge id sets — FlowGraph.vue:940-946 (v1/v2 shape-tolerant).
// A fork branch entry is either a bare id string (v1) or a {to} object (v2); a
// merge declares its incoming ids as `from` (or legacy `branches`). These two
// sets drive markerPropsFor's composed-flow node-anchor rule.
function forkRootIdSet(flow) {
  return new Set(
    (flow.forks || []).flatMap((f) =>
      (f.branches || []).map((b) => (typeof b === 'string' ? b : b.to))),
  )
}
function preMergeIdSet(flow) {
  return new Set((flow.merges || []).flatMap((m) => m.from || m.branches || []))
}

// markerLabelFor — FlowGraph.vue:1088-1092. showMetrics appends the cap/latency
// suffix; otherwise the bare label.
function markerLabelFor(node, showMetrics) {
  return showMetrics
    ? `${node.label} · cap ${node.capacity} · ${node.latency}s`
    : node.label
}

// labelOffsetFor — FlowGraph.vue:1105-1127. Per-node labelDx/labelDy override
// wins (default dy −60 when only one is set); else the hand-tuned N4 canonical
// offset map keyed by node id; else a generic above-the-midpoint default.
function labelOffsetFor(node) {
  if (node.labelDx !== undefined || node.labelDy !== undefined) {
    return { dx: node.labelDx ?? 0, dy: node.labelDy ?? -60 }
  }
  const offsetMap = {
    intake: { dx: -80, dy: 100 },
    design: { dx: -90, dy: -60 },
    build: { dx: -20, dy: -80 },
    'test-prep': { dx: 20, dy: 100 },
    review: { dx: 90, dy: -90 },
    ship: { dx: 60, dy: 100 },
  }
  return offsetMap[node.id] ?? { dx: 0, dy: -60 }
}

// markerPropsFor — FlowGraph.vue:948-1086. Faithful lift: props.flow → ctx.flow,
// the render-branch list → ctx.renderBranches, widths → ctx.widths, the fork/
// merge sets passed in. Returns the geometry props FlowSegmentMarker consumes.
// The many branches encode hard-won label-placement nuance — do NOT simplify:
//   • orphan node (on no render branch — a designer mid-edit, never in deck
//     flows): anchor at its own xy with a horizontal tangent and zero band.
//   • the per-node segment loop computes sStart/sEnd/sLabel and the midpoint
//     labelPoint; hasComposition (any fork/merge declared) + non-entry → anchor
//     the label at the node's own xy; a per-node labelX override wins over both.
//   • fallthrough (shouldn't reach): full-branch span anchored at the midpoint.
function markerPropsFor(node, ctx, forkRootIds, preMergeIds) {
  const { flow, widths, renderBranches } = ctx
  const branch = renderBranches.find((b) => b.nodeIds.includes(node.id))
  if (!branch) {
    return {
      startPoint: { x: node.x, y: node.y },
      endPoint: { x: node.x, y: node.y },
      startTangent: { x: 1, y: 0 },
      endTangent: { x: 1, y: 0 },
      bandWidthAtStart: 0,
      bandWidthAtEnd: 0,
      bandWidthAtLabel: 0,
      labelCenterlineY: node.y,
      labelAnchorX: node.x,
    }
  }
  const cl = branch.centerline
  const segLens = branchLatencyArc(branch, flow)
  const wfn = branchWidthFn(branch, flow, widths)
  let sStart = 0
  for (let i = 0; i < branch.nodeIds.length; i++) {
    if (branch.nodeIds[i] === node.id) {
      const sEnd = Math.min(sStart + segLens[i], cl.totalLength)
      const sLabel = Math.min((sStart + sEnd) / 2, cl.totalLength)
      const labelPoint = cl.pointAtArcLength(sLabel)
      const hasComposition = forkRootIds.size > 0 || preMergeIds.size > 0
      const useNodeAnchor = hasComposition && node.id !== flow.entryId
      const hasLabelOverride = node.labelX !== undefined
      const finalLabelAnchorX = hasLabelOverride
        ? node.labelX
        : (useNodeAnchor ? node.x : labelPoint.x)
      const finalLabelCenterlineY = hasLabelOverride
        ? (node.labelY ?? node.y)
        : (useNodeAnchor ? node.y : labelPoint.y)
      return {
        startPoint: cl.pointAtArcLength(sStart),
        endPoint: cl.pointAtArcLength(sEnd),
        startTangent: cl.tangentAtArcLength(sStart),
        endTangent: cl.tangentAtArcLength(sEnd),
        bandWidthAtStart: wfn(sStart),
        bandWidthAtEnd: wfn(sEnd),
        bandWidthAtLabel: wfn(sLabel),
        labelCenterlineY: finalLabelCenterlineY,
        labelAnchorX: (useNodeAnchor || hasLabelOverride) ? finalLabelAnchorX : null,
      }
    }
    sStart += segLens[i]
  }
  // Fallthrough (shouldn't reach) — FlowGraph.vue:1076-1085. FlowGraph omits
  // labelAnchorX here (so the SFC prop defaults to null); we make that explicit.
  return {
    startPoint: cl.pointAtArcLength(0),
    endPoint: cl.pointAtArcLength(cl.totalLength),
    startTangent: cl.tangentAtArcLength(0),
    endTangent: cl.tangentAtArcLength(cl.totalLength),
    bandWidthAtStart: wfn(0),
    bandWidthAtEnd: wfn(cl.totalLength),
    bandWidthAtLabel: wfn(cl.totalLength / 2),
    labelCenterlineY: cl.pointAtArcLength(cl.totalLength / 2).y,
    labelAnchorX: null,
  }
}

// Resolve a marker's label anchor point — FlowSegmentMarker.vue:236-260.
// midpoint → anchorBase (labelAnchorX override) → labelAnchor (+ dx/dy, with
// verticalLeader pinning x to anchorBase.x). Returns the trio so T8's leaders
// can reuse anchorBase.
function markerLabelAnchor(mp, labelDx, labelDy, verticalLeader) {
  const midpoint = {
    x: (mp.startPoint.x + mp.endPoint.x) / 2,
    y: (mp.startPoint.y + mp.endPoint.y) / 2,
  }
  const anchorBase = mp.labelAnchorX != null
    ? { x: mp.labelAnchorX, y: mp.labelCenterlineY || midpoint.y }
    : midpoint
  return {
    midpoint,
    anchorBase,
    labelAnchor: {
      x: verticalLeader ? anchorBase.x : anchorBase.x + labelDx,
      y: anchorBase.y + labelDy,
    },
  }
}

// Lazily mint the ONE shared constraint-hatch def — FlowSegmentMarker.vue:125-139
// (a 6×6 tile rotated 45° with 0.6px firebrick lines). The SFC minted a
// per-instance random pattern id purely for DOM-collision-avoidance across
// markers; the scene uses one stable, deterministic id reused by every
// constraint rect (plan "Known deviations" #3). Only set when a perpendicular
// constraint marker actually needs it — flows without one keep defs.hatch null.
function ensureHatchDef(ctx) {
  if (!ctx.defs.hatch) {
    ctx.defs.hatch = {
      id: `flow-hatch-${ctx.seq}`,
      tile: 6,
      rotate: 45,
      stroke: CONSTRAINT_INK, // === '#E2522B'
      strokeWidth: 0.6,
    }
  }
  return ctx.defs.hatch
}

// ── Segment markers — FlowGraph.vue:306-317 + FlowSegmentMarker.vue ─────────
// One marker per LABELLED node, in two visual registers: perpendicular (default
// — start/end boundary ticks + a hairline leader) and fence-post (a single
// vertical leader under the label). T9 adds constraint hatching. The marker
// colour is firebrick (CONSTRAINT_INK) for constraint nodes, else marginalia
// grey; showMetrics (from ctx.opts) appends the cap/latency suffix; fence-post
// style (flow.fenceMarkers) renders the label lowercased (FlowSegmentMarker.vue:113).
function buildSegmentMarkers(ctx) {
  const { flow, opts, prims } = ctx
  const forkRootIds = forkRootIdSet(flow)
  const preMergeIds = preMergeIdSet(flow)
  const fencePost = !!flow.fenceMarkers
  for (const node of flow.nodes) {
    if (!node.label) continue // skip empty-label nodes (e.g. _start) — :307/:1088
    const mp = markerPropsFor(node, ctx, forkRootIds, preMergeIds)
    const constraint = isConstraintNode(node)
    const { dx, dy } = labelOffsetFor(node)
    const { anchorBase, labelAnchor } = markerLabelAnchor(mp, dx, dy, !!flow.verticalLeaders)
    // The grey '#555555' marginalia ink has no named export in flowCurve.js, so
    // it stays inline — faithful to FlowGraph; CONSTRAINT_INK === '#E2522B'.
    const tickColor = constraint ? CONSTRAINT_INK : '#555555'
    // FlowGraph passes node.y − BOX_HALF_ISO as the box-top anchor when
    // showBoxes is on (fence-post leader descends to the box top, not band top).
    const boxTopY = flow.showBoxes ? node.y - BOX_HALF_ISO : null

    // Ticks / leaders paint BEFORE the label — FlowSegmentMarker.vue:41-118.
    if (fencePost) {
      // Fence-post leader — FlowSegmentMarker.vue:58-63 + leaderDescentEndY :210-217.
      // A single vertical hairline from just below the label baseline down to the
      // box top (showBoxes) or the band top at the label's x-position.
      const descentEndY = boxTopY != null
        ? boxTopY - 2
        : mp.labelCenterlineY - mp.bandWidthAtLabel / 2 - 2
      prims.push({
        kind: 'line',
        key: `marker-${node.id}-leader`,
        x1: labelAnchor.x, y1: labelAnchor.y + 6,
        x2: labelAnchor.x, y2: descentEndY,
        stroke: tickColor,
        strokeWidth: 1.0,
        linecap: 'round',
      })
    } else {
      // Boundary ticks — FlowSegmentMarker.vue:219-234. Perpendiculars (tangent
      // rotated 90° CCW → unit normal (−ty, tx)) at the segment start/end,
      // length 2·MARKER_TICK_HALF, centred on the centerline boundary point.
      const nStart = { x: -mp.startTangent.y, y: mp.startTangent.x }
      const nEnd = { x: -mp.endTangent.y, y: mp.endTangent.x }
      prims.push({
        kind: 'line',
        key: `marker-${node.id}-tick-start`,
        x1: mp.startPoint.x + nStart.x * MARKER_TICK_HALF, y1: mp.startPoint.y + nStart.y * MARKER_TICK_HALF,
        x2: mp.startPoint.x - nStart.x * MARKER_TICK_HALF, y2: mp.startPoint.y - nStart.y * MARKER_TICK_HALF,
        stroke: tickColor, strokeWidth: 1.2, linecap: 'round',
      })
      prims.push({
        kind: 'line',
        key: `marker-${node.id}-tick-end`,
        x1: mp.endPoint.x + nEnd.x * MARKER_TICK_HALF, y1: mp.endPoint.y + nEnd.y * MARKER_TICK_HALF,
        x2: mp.endPoint.x - nEnd.x * MARKER_TICK_HALF, y2: mp.endPoint.y - nEnd.y * MARKER_TICK_HALF,
        stroke: tickColor, strokeWidth: 1.2, linecap: 'round',
      })
      // Leader — FlowSegmentMarker.vue:265-293. From just below/above the label
      // (dirY baseline correction) to leaderEnd: verticalLeaders → straight drop
      // at anchorBase.x; else back off MARKER_LEADER_PAD along the
      // anchorBase→labelAnchor vector (mag<1e-6 guard → anchorBase itself).
      const dirY = dy < 0 ? 6 : -16
      const leaderStart = { x: labelAnchor.x, y: labelAnchor.y + dirY }
      let leaderEnd
      if (flow.verticalLeaders) {
        const signY = dy < 0 ? -1 : 1
        leaderEnd = { x: anchorBase.x, y: anchorBase.y + signY * MARKER_LEADER_PAD }
      } else {
        const ddx = labelAnchor.x - anchorBase.x
        const ddy = labelAnchor.y - anchorBase.y
        const mag = Math.hypot(ddx, ddy)
        leaderEnd = mag < 1e-6
          ? { x: anchorBase.x, y: anchorBase.y }
          : { x: anchorBase.x + (ddx / mag) * MARKER_LEADER_PAD, y: anchorBase.y + (ddy / mag) * MARKER_LEADER_PAD }
      }
      prims.push({
        kind: 'line',
        key: `marker-${node.id}-leader`,
        x1: leaderStart.x, y1: leaderStart.y,
        x2: leaderEnd.x, y2: leaderEnd.y,
        stroke: tickColor, strokeWidth: 0.6, linecap: 'round',
      })
    }

    // Label LAST in the per-node block — FlowSegmentMarker paints it after the
    // ticks/leader (:108-118). T7's label tests assert only counts/attrs.
    prims.push({
      kind: 'text',
      key: `marker-${node.id}-label`,
      x: labelAnchor.x,
      y: labelAnchor.y,
      text: markerLabelFor(node, !!opts.showMetrics),
      font: 'ET Book, Georgia, serif',
      fontStyle: 'italic',
      fontSize: 24,
      fill: tickColor,
      anchor: 'middle',
      textTransform: fencePost ? 'lowercase' : 'none',
    })

    // Constraint hatching paints LAST — FlowSegmentMarker.vue:125-139 (after the
    // label at :108-118). Perpendicular + constraint ONLY; fence-post suppresses
    // it (SFC v-if="isConstraint && markerStyle !== 'fence-post'"). One shared
    // hatch def + a {kind:'rect'} per constraint marker; y offsets above the
    // label when dy < 0, below when dy >= 0 (labelDy < 0 ? 8 : -28).
    if (!fencePost && constraint) {
      const hatch = ensureHatchDef(ctx)
      prims.push({
        kind: 'rect',
        key: `hatch-${node.id}`,
        x: labelAnchor.x - MARKER_HATCH_WIDTH / 2,
        y: labelAnchor.y + (dy < 0 ? 8 : -28),
        width: MARKER_HATCH_WIDTH,
        height: 14,
        fill: `url(#${hatch.id})`,
        opacity: 0.6,
      })
    }
  }
}

// ── Ghost markers (collapsed-stage labels) — FlowGraph.vue:334-373 ──────────
// Display-only labels for stages a flow has collapsed away (e.g. n18-after).
// Each ghost emits a vertical fence-post leader + an italic ET Book label,
// painted AFTER the live segment markers. FlowGraph wraps the whole family in a
// single `<g :style="{opacity}">`; the flat scene bakes that group opacity onto
// each primitive (plan "Known deviations" #1 — visually identical for the
// non-overlapping leader+label pair). Leader geometry mirrors :346-371:
//   below-ribbon (labelDy >= 0): from (y + labelDy) − 10 down to y + half + 2
//   above-ribbon (labelDy < 0):  from (y + labelDy) + 10 up to y − half − 2
// '#555555' is the marginalia grey (no named export — stays inline). Inert when
// flow.ghostMarkers is absent/empty.
function buildGhostMarkers(ctx) {
  const { flow, prims } = ctx
  const ghosts = flow.ghostMarkers
  if (!Array.isArray(ghosts) || ghosts.length === 0) return
  const groupOpacity = flow.ghostOpacity ?? 0.3 // group opacity baked per-prim
  const half = (flow.bandWidth ?? 70) / 2
  ghosts.forEach((gm) => {
    prims.push({
      kind: 'line',
      key: `ghost-${gm.label}-leader`,
      x1: gm.x,
      y1: gm.labelDy >= 0 ? (gm.y + gm.labelDy) - 10 : (gm.y + gm.labelDy) + 10,
      x2: gm.x,
      y2: gm.labelDy >= 0 ? gm.y + half + 2 : gm.y - half - 2,
      stroke: '#555555',
      strokeWidth: 1.0,
      linecap: 'round',
      opacity: groupOpacity,
    })
    prims.push({
      kind: 'text',
      key: `ghost-${gm.label}-label`,
      x: gm.x,
      y: gm.y + gm.labelDy,
      text: gm.label,
      font: 'ET Book, Georgia, serif',
      fontStyle: 'italic',
      fontSize: 24,
      fill: '#555555',
      anchor: 'middle',
      opacity: groupOpacity,
    })
  })
}

// ── Transform-node glyphs (split / combine) — FlowGraph.vue:383-396 ─────────
// One hairline glyph per transform:'split'|'combine' node, translated to its
// node anchor and stroked in the frozen ink/width/opacity register. Reuses the
// already-pure transformGlyphsFor(flow) (transformGlyph.js) for the geometry —
// no reimplementation. Painted AFTER the ghost markers (the last static family
// before agents); inert when the flow has no transform nodes.
function buildTransformGlyphs(ctx) {
  const { flow, prims } = ctx
  for (const g of transformGlyphsFor(flow)) {
    prims.push({
      kind: 'glyph',
      key: `xform-${g.id}`,
      d: g.d,
      transform: `translate(${g.x} ${g.y})`,
      // FlowGraph.vue:386 sets fill="none" explicitly; SVG <path> defaults to
      // BLACK fill, so a naive Phase-2 renderer would fill the glyph's open
      // stroke triangles solid black without it. Encode the nuance as data.
      fill: 'none',
      stroke: TRANSFORM_GLYPH_STROKE,
      strokeWidth: TRANSFORM_GLYPH_STROKE_WIDTH,
      opacity: TRANSFORM_GLYPH_OPACITY,
      linecap: 'round',
      linejoin: 'round',
    })
  }
}

// ── Minard legend strip — FlowGraph.vue:425-452 + :559-582 ──────────────────
// Width-encodes-throughput swatch + caption, painted LAST. The secondary line
// shows the flow's actual throughput ratio when a kind:'constraint' node AND a
// widest node are both derivable. Note: this legend uses the LEGACY literal
// `n.kind === 'constraint'` test specifically (NOT isConstraintNode), matching
// FlowGraph.vue:564 — a v3 colorScheme:'red' constraint lacking kind:'constraint'
// yields no secondary line. INK (=== '#15171A') is the palette's single source
// of truth (flowCurve.js); the caption greys '#333333'/'#777777' have no named
// export, so they stay inline — faithful to FlowGraph.
function buildLegend(ctx) {
  const { flow, widths, prims } = ctx
  if (flow.showLegend === false) return

  const swatch = { kind: 'polygon', key: 'legend-swatch', points: '40,833 160,821 160,849 40,837', fill: INK }
  const primary = {
    kind: 'text', key: 'legend-primary',
    x: 176, y: 835, text: 'width encodes throughput',
    font: 'ET Book, Georgia, serif', fontStyle: 'italic', fontSize: 18,
    fill: '#333333', baseline: 'middle',
  }
  prims.push(swatch, primary)

  // Secondary ratio line — FlowGraph.vue:564-582.
  const constraintNode = flow.nodes.find((n) => n.kind === 'constraint')
  const widestEntry = Object.entries(widths)
    .filter(([, w]) => typeof w === 'number')
    .reduce((best, [id, w]) => (w > best[1] ? [id, w] : best), ['', 0])
  const widestNode = widestEntry[0] ? flow.nodes.find((n) => n.id === widestEntry[0]) : null
  const ratio = (constraintNode && widestEntry[1] && widths[constraintNode.id])
    ? Math.round(widestEntry[1] / widths[constraintNode.id])
    : Math.round(MAX_RIBBON_WIDTH / MIN_RIBBON_WIDTH)
  if (constraintNode && widestNode) {
    prims.push({
      kind: 'text', key: 'legend-secondary',
      x: 176, y: 853,
      text: `${constraintNode.label} handles 1 unit · ${widestNode.label} handles ${ratio}`,
      font: 'ET Book, Georgia, serif', fontStyle: 'italic', fontSize: 14,
      fill: '#777777', baseline: 'middle',
    })
  }
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
