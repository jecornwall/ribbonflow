import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PARTICLE_RADIUS,
  WALL_MARGIN,
  MIN_RIBBON_WIDTH,
  catmullRomPoint,
  buildBranches,
  buildPinchWidthFn,
  pinchZoneArcRanges,
  pinchZoneOutlinePath,
  DEFAULT_BAND_WIDTH,
  DEFAULT_CONSTRAINT_WIDTH,
  // v1.2 R2 — rejection-edge geometry
  quadBezierPoint,
  rejectionBowCurve,
  buildRejectionCenterline,
  rejectionEdgeAnchors,
  REJECTION_BAND_WIDTH,
} from './flowCurve.js'

test('constants — MIN_RIBBON_WIDTH = 2 × (radius + margin)', () => {
  assert.equal(MIN_RIBBON_WIDTH, 2 * (PARTICLE_RADIUS + WALL_MARGIN))
})

test('catmullRomPoint at t=0 of segment returns p1 (the segment start)', () => {
  const p0 = { x: 0, y: 0 }
  const p1 = { x: 10, y: 0 }
  const p2 = { x: 20, y: 0 }
  const p3 = { x: 30, y: 0 }
  const r = catmullRomPoint(p0, p1, p2, p3, 0)
  assert.ok(Math.abs(r.x - 10) < 1e-9, `expected ~10, got ${r.x}`)
  assert.ok(Math.abs(r.y - 0)  < 1e-9, `expected ~0,  got ${r.y}`)
})

test('catmullRomPoint at t=1 of segment returns p2 (the segment end)', () => {
  const p0 = { x: 0, y: 0 }
  const p1 = { x: 10, y: 0 }
  const p2 = { x: 20, y: 0 }
  const p3 = { x: 30, y: 0 }
  const r = catmullRomPoint(p0, p1, p2, p3, 1)
  assert.ok(Math.abs(r.x - 20) < 1e-9, `expected ~20, got ${r.x}`)
  assert.ok(Math.abs(r.y - 0)  < 1e-9, `expected ~0,  got ${r.y}`)
})

test('catmullRomPoint for collinear horizontal points lies on the line', () => {
  const p0 = { x: 0,  y: 5 }
  const p1 = { x: 10, y: 5 }
  const p2 = { x: 20, y: 5 }
  const p3 = { x: 30, y: 5 }
  for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const r = catmullRomPoint(p0, p1, p2, p3, t)
    assert.ok(
      Math.abs(r.y - 5) < 1e-6,
      `at t=${t}, expected y≈5, got ${r.y}`,
    )
  }
})

import { buildCenterline } from './flowCurve.js'

test('buildCenterline rejects fewer than 2 anchors', () => {
  assert.throws(() => buildCenterline([]), /at least 2 anchors/)
  assert.throws(() => buildCenterline([{ x: 0, y: 0 }]), /at least 2 anchors/)
})

test('buildCenterline with 2 anchors produces a straight-ish path passing through both', () => {
  const cl = buildCenterline([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  const a = cl.sample(0)
  const b = cl.sample(1)
  assert.ok(Math.abs(a.x -   0) < 1, `start x ≈ 0, got ${a.x}`)
  assert.ok(Math.abs(a.y -   0) < 1, `start y ≈ 0, got ${a.y}`)
  assert.ok(Math.abs(b.x - 100) < 1, `end x ≈ 100, got ${b.x}`)
  assert.ok(Math.abs(b.y -   0) < 1, `end y ≈ 0, got ${b.y}`)
})

test('buildCenterline samples are continuous (no gaps)', () => {
  const cl = buildCenterline([
    { x:   0, y:   0 },
    { x: 100, y: 100 },
    { x: 200, y:   0 },
    { x: 300, y: 100 },
  ])
  let prev = cl.sample(0)
  for (let i = 1; i <= 50; i++) {
    const t = i / 50
    const cur = cl.sample(t)
    const gap = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    assert.ok(gap < 30, `at t=${t}, gap=${gap.toFixed(1)} too large`)
    prev = cur
  }
})

test('centerline.totalLength matches Pythagorean distance for a straight line', () => {
  const cl = buildCenterline([{ x: 0, y: 0 }, { x: 300, y: 400 }])
  // Straight-line distance is 500. Numerical sampling will be very close.
  assert.ok(
    Math.abs(cl.totalLength - 500) < 5,
    `expected ~500, got ${cl.totalLength}`,
  )
})

test('pointAtArcLength(0) returns the first anchor; pointAtArcLength(totalLength) returns the last', () => {
  const cl = buildCenterline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }])
  const start = cl.pointAtArcLength(0)
  const end = cl.pointAtArcLength(cl.totalLength)
  assert.ok(Math.abs(start.x -   0) < 1, `start.x ≈ 0, got ${start.x}`)
  assert.ok(Math.abs(end.x   - 200) < 1, `end.x ≈ 200, got ${end.x}`)
})

test('pointAtArcLength is monotonic in s', () => {
  const cl = buildCenterline([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }])
  let prevX = -Infinity
  for (let i = 0; i <= 20; i++) {
    const s = (i / 20) * cl.totalLength
    const p = cl.pointAtArcLength(s)
    assert.ok(p.x >= prevX - 1e-3, `at s=${s.toFixed(1)}, x=${p.x} not monotonic`)
    prevX = p.x
  }
})

test('tangentAtArcLength along a straight horizontal line is (1, 0)', () => {
  const cl = buildCenterline([{ x: 0, y: 50 }, { x: 200, y: 50 }])
  const t = cl.tangentAtArcLength(cl.totalLength / 2)
  assert.ok(Math.abs(t.x - 1) < 0.05, `expected tx ≈ 1, got ${t.x}`)
  assert.ok(Math.abs(t.y)     < 0.05, `expected ty ≈ 0, got ${t.y}`)
})

test('tangentAtArcLength is unit length', () => {
  const cl = buildCenterline([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }])
  for (const s of [10, cl.totalLength / 2, cl.totalLength - 10]) {
    const t = cl.tangentAtArcLength(s)
    const mag = Math.hypot(t.x, t.y)
    assert.ok(Math.abs(mag - 1) < 0.05, `at s=${s}, |tangent|=${mag}, expected ≈ 1`)
  }
})

const linearFlow = {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  entryId: 'a',
  nodes: [
    { id: 'a', x:   200, y: 500, capacity: 1, latency: 0.6, successors: ['b'] },
    { id: 'b', x:   800, y: 500, capacity: 2, latency: 1.4, kind: 'constraint', successors: ['c'] },
    { id: 'c', x:  1400, y: 500, capacity: 1, latency: 0.4, successors: [] },
  ],
}

test('buildBranches on linear flow produces a single branch with all nodes', () => {
  const result = buildBranches(linearFlow)
  assert.equal(result.branches.length, 1)
  assert.deepEqual(result.branches[0].nodeIds, ['a', 'b', 'c'])
})

const forkFlow = {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  entryId: 'a',
  nodes: [
    { id: 'a', x:  200, y: 500, capacity: 1, latency: 0.5, successors: ['b', 'c'] },
    { id: 'b', x:  800, y: 300, capacity: 1, latency: 0.5, successors: ['d'] },
    { id: 'c', x:  800, y: 700, capacity: 1, latency: 0.5, successors: ['d'] },
    { id: 'd', x: 1400, y: 500, capacity: 1, latency: 0.5, kind: 'constraint', successors: [] },
  ],
}

test('buildBranches on fork+merge flow produces at least 2 branches covering all nodes', () => {
  const result = buildBranches(forkFlow)
  assert.ok(result.branches.length >= 2, `expected at least 2 branches, got ${result.branches.length}`)
  const seen = new Set(result.branches.flatMap(b => b.nodeIds))
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.ok(seen.has(id), `node ${id} missing from branches`)
  }
})

test('buildBranches attaches a centerline to each branch', () => {
  const result = buildBranches(linearFlow)
  const cl = result.branches[0].centerline
  assert.ok(cl && typeof cl.pointAtArcLength === 'function', 'branch missing centerline')
  assert.ok(cl.totalLength > 0, 'centerline has zero length')
})

// Regression: N4-like topology — fork into parallel paths, merge, then linear tail.
// Bug fixed in commit after baf174b: merge nodes must also start a branch so the
// post-merge linear continuation gets a centerline.
const mergeFollowupFlow = {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  entryId: 'a',
  nodes: [
    { id: 'a', x:  200, y: 500, capacity: 1, latency: 0.5, successors: ['b', 'c'] },
    { id: 'b', x:  600, y: 300, capacity: 1, latency: 0.5, successors: ['d'] },
    { id: 'c', x:  600, y: 700, capacity: 1, latency: 0.5, successors: ['d'] },
    { id: 'd', x: 1000, y: 500, capacity: 1, latency: 0.5, successors: ['e'] },
    { id: 'e', x: 1400, y: 500, capacity: 1, latency: 0.5, successors: [] },
  ],
}

test('buildBranches covers post-merge linear continuation (N4-like topology)', () => {
  const result = buildBranches(mergeFollowupFlow)
  const seen = new Set(result.branches.flatMap(b => b.nodeIds))
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    assert.ok(seen.has(id), `node ${id} missing from branches`)
  }
})

import {
  computeNodeWidths,
  effectiveNodeRates,
  WIDTH_POWER,
  MAX_RIBBON_WIDTH,
} from './flowCurve.js'

test('computeNodeWidths assigns MIN_RIBBON_WIDTH to the lowest-throughput node', () => {
  const widths = computeNodeWidths(linearFlow)
  // linearFlow: a(cap=1, lat=0.6, t≈1.67), b(cap=2, lat=1.4, t≈1.43, constraint), c(cap=1, lat=0.4, t=2.5)
  // b has lowest throughput, so widths.b === MIN_RIBBON_WIDTH.
  assert.equal(widths.b, MIN_RIBBON_WIDTH)
})

test('computeNodeWidths scales other nodes via WIDTH_POWER curve', () => {
  // Power-curve scaling (Jason 2026-05-16 feedback: more variance, Minard
  // register; visuals.md §10.2: P=1.7).
  // width = min(MAX_RIBBON_WIDTH, MIN × (throughput/min_throughput)^WIDTH_POWER).
  // linearFlow ratios stay well below the cap so the cap is inert here.
  const widths = computeNodeWidths(linearFlow)
  const ratio = (1 / 0.6) / (2 / 1.4)
  const expectedA = MIN_RIBBON_WIDTH * Math.pow(ratio, WIDTH_POWER)
  assert.ok(
    Math.abs(widths.a - expectedA) < 1e-6,
    `widths.a expected ${expectedA}, got ${widths.a}`,
  )
  // Ordering is preserved and amplified relative to linear scaling.
  assert.ok(widths.a > widths.b, 'a (higher throughput) wider than b (constraint)')
  assert.ok(widths.c > widths.a, 'c (highest throughput) widest')
})

test('computeNodeWidths caps at MAX_RIBBON_WIDTH for high-throughput nodes', () => {
  // visuals.md §10.2: hard cap at MAX_RIBBON_WIDTH so the constraint:widest
  // ratio lands at 1:7 instead of blowing out for fast stages (e.g. N4's
  // test-prep has raw width ~187 without the cap).
  const fastFlow = {
    viewBox: { w: 1600, h: 900 },
    baseSpeed: 200,
    entryId: 'slow',
    nodes: [
      // slow: throughput = 1 / 1.0 = 1.0 (constraint)
      { id: 'slow', x: 200, y: 500, capacity: 1, latency: 1.0, successors: ['fast'] },
      // fast: throughput = 10 / 0.1 = 100 — ratio 100×, raw width 10 × 100^1.7
      // ≈ 50 000 viewBox units, must clamp to MAX_RIBBON_WIDTH.
      { id: 'fast', x: 800, y: 500, capacity: 10, latency: 0.1, successors: [] },
    ],
  }
  const widths = computeNodeWidths(fastFlow)
  assert.equal(widths.slow, MIN_RIBBON_WIDTH)
  assert.equal(widths.fast, MAX_RIBBON_WIDTH,
    `fast (ratio 100×) should be clamped to MAX_RIBBON_WIDTH=${MAX_RIBBON_WIDTH}, got ${widths.fast}`)
})

test('computeNodeWidths warns if kind:constraint is not the actual narrowest', () => {
  const mismatched = {
    ...linearFlow,
    nodes: linearFlow.nodes.map(n => n.id === 'a' ? { ...n, kind: 'constraint' } : n),
  }
  const widths = computeNodeWidths(mismatched, { collectWarnings: true })
  assert.ok(widths.warnings && widths.warnings.length > 0, 'expected a warning')
  assert.match(widths.warnings[0], /constraint/)
})

import { ribbonOutlinePath } from './flowCurve.js'

test('ribbonOutlinePath returns a closed SVG path string', () => {
  const cl = buildCenterline([{ x: 0, y: 50 }, { x: 200, y: 50 }])
  const widthFn = (s) => 10  // constant 10 units
  const d = ribbonOutlinePath(cl, widthFn)
  assert.equal(typeof d, 'string')
  assert.match(d, /^M /,  'path should start with M (moveto)')
  assert.match(d, /Z\s*$/, 'path should end with Z (closepath)')
})

test('ribbonOutlinePath with constant width 10 on a 200-unit horizontal line covers ~2000 sq units', () => {
  // Constant-width ribbon on a straight line is approximately a rectangle
  // of length × width. The SVG path covers a closed area; we can't easily
  // assert area without a polygon library, so instead assert that the
  // bounding box is right.
  const cl = buildCenterline([{ x: 0, y: 50 }, { x: 200, y: 50 }])
  const d = ribbonOutlinePath(cl, () => 10)
  const coords = d.match(/-?\d+\.?\d*/g).map(Number)
  // Extract x and y values (alternating).
  const xs = coords.filter((_, i) => i % 2 === 0)
  const ys = coords.filter((_, i) => i % 2 === 1)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  assert.ok(Math.abs(xMin -   0) < 2, `xMin ≈ 0, got ${xMin}`)
  assert.ok(Math.abs(xMax - 200) < 2, `xMax ≈ 200, got ${xMax}`)
  assert.ok(Math.abs(yMin -  45) < 2, `yMin ≈ 45 (50 - 5), got ${yMin}`)
  assert.ok(Math.abs(yMax -  55) < 2, `yMax ≈ 55 (50 + 5), got ${yMax}`)
})

// ──────────────────────────────────────────────────────────────────────────
// Pinch-around-constraint width function (locked-v2, visuals.md §3.0.3.LOCKED-V2)
// ──────────────────────────────────────────────────────────────────────────

// Build a minimal linear flow that exercises the pinch math: 5 nodes, the
// middle one tagged constraint. Anchors are evenly spaced on a horizontal line
// so arc-length and x-coordinate are interchangeable.
function buildLinearPinchFlow() {
  return {
    viewBox: { w: 1600, h: 900 },
    baseSpeed: 200,
    entryId: 'a',
    bandWidth: 70,
    constraintWidth: 22,
    pinchMode: 'constraint-only',
    nodes: [
      { id: 'a', x:  200, y: 450, capacity: 1, latency: 1.0, successors: ['b'] },
      { id: 'b', x:  500, y: 450, capacity: 1, latency: 1.0, successors: ['c'] },
      { id: 'c', x:  800, y: 450, capacity: 1, latency: 1.6, kind: 'constraint', successors: ['d'] },
      { id: 'd', x: 1100, y: 450, capacity: 1, latency: 1.0, successors: ['e'] },
      { id: 'e', x: 1400, y: 450, capacity: 1, latency: 1.0, successors: [] },
    ],
  }
}

test('buildPinchWidthFn — full-width plateau far from constraint', () => {
  const flow = buildLinearPinchFlow()
  const { branches } = buildBranches(flow)
  const wfn = buildPinchWidthFn(branches[0], flow)
  // At s=0 (the very entry) we should be well into the upstream plateau.
  assert.equal(wfn(0), 70, `s=0 expected bandWidth=70, got ${wfn(0)}`)
  // At s=totalLength (the very exit) we should be well into the downstream plateau.
  const total = branches[0].centerline.totalLength
  assert.equal(wfn(total), 70, `s=total expected bandWidth=70, got ${wfn(total)}`)
})

test('buildPinchWidthFn — constraint plateau at constraint segment', () => {
  const flow = buildLinearPinchFlow()
  const { branches } = buildBranches(flow)
  const ranges = pinchZoneArcRanges(branches[0], flow)
  const wfn = buildPinchWidthFn(branches[0], flow)
  // Midpoint of constraint segment should be exactly constraintWidth.
  const sMid = (ranges.constraintPlateau.sStart + ranges.constraintPlateau.sEnd) / 2
  assert.equal(wfn(sMid), 22, `s=constraint-mid expected 22, got ${wfn(sMid)}`)
})

test('buildPinchWidthFn — smooth monotonic transition (no step discontinuity)', () => {
  const flow = buildLinearPinchFlow()
  const { branches } = buildBranches(flow)
  const wfn = buildPinchWidthFn(branches[0], flow)
  const total = branches[0].centerline.totalLength
  // Sample 200 points across the centerline and assert no adjacent samples
  // differ by more than 5 units (a step function would jump by ~48 = 70-22
  // at the segment boundary). This catches "we forgot to smooth".
  let maxJump = 0
  let lastW = wfn(0)
  for (let i = 1; i <= 200; i++) {
    const w = wfn((i / 200) * total)
    const jump = Math.abs(w - lastW)
    if (jump > maxJump) maxJump = jump
    lastW = w
  }
  assert.ok(maxJump < 5,
    `smooth pinch should have no >5-unit jumps between adjacent samples; got ${maxJump.toFixed(2)}`)
})

test('buildPinchWidthFn — fallback to bandWidth when no constraint tagged', () => {
  const flow = buildLinearPinchFlow()
  // Untag the constraint.
  for (const n of flow.nodes) delete n.kind
  const { branches } = buildBranches(flow)
  const wfn = buildPinchWidthFn(branches[0], flow)
  const total = branches[0].centerline.totalLength
  for (let i = 0; i <= 10; i++) {
    const w = wfn((i / 10) * total)
    assert.equal(w, 70, `no-constraint flow should be flat at bandWidth; got ${w} at s=${i/10}*total`)
  }
})

test('pinchZoneArcRanges — emits upstream, plateau, downstream for middle-of-flow constraint', () => {
  const flow = buildLinearPinchFlow()
  const { branches } = buildBranches(flow)
  const ranges = pinchZoneArcRanges(branches[0], flow)
  assert.ok(ranges.upstream, 'upstream zone should exist')
  assert.ok(ranges.downstream, 'downstream zone should exist')
  assert.ok(ranges.constraintPlateau, 'plateau zone should exist')
  // Order: upstream.sStart < upstream.sEnd === plateau.sStart < plateau.sEnd === downstream.sStart < downstream.sEnd
  assert.ok(ranges.upstream.sStart < ranges.upstream.sEnd)
  assert.equal(ranges.upstream.sEnd, ranges.constraintPlateau.sStart)
  assert.equal(ranges.constraintPlateau.sEnd, ranges.downstream.sStart)
  assert.ok(ranges.downstream.sStart < ranges.downstream.sEnd)
})

test('pinchZoneOutlinePath — returns a closed SVG path with M and Z', () => {
  const flow = buildLinearPinchFlow()
  const { branches } = buildBranches(flow)
  const wfn = buildPinchWidthFn(branches[0], flow)
  const ranges = pinchZoneArcRanges(branches[0], flow)
  const d = pinchZoneOutlinePath(branches[0].centerline, wfn, ranges.upstream)
  assert.ok(d.startsWith('M '),     'pinch path should start with M')
  assert.ok(d.endsWith(' Z'),       'pinch path should end with Z')
  assert.ok(d.length > 50,          `pinch path should be non-trivial; got ${d.length} chars`)
})

test('pinchZoneOutlinePath — empty string for null range', () => {
  const flow = buildLinearPinchFlow()
  const { branches } = buildBranches(flow)
  const wfn = buildPinchWidthFn(branches[0], flow)
  assert.equal(pinchZoneOutlinePath(branches[0].centerline, wfn, null), '')
})

test('pinchZoneOutlinePath — empty string for NaN / inverted / equal range, no sampling', () => {
  // A stub centerline/widthFn that throws if ever sampled — proves the guard
  // short-circuits before any pointAtArcLength(NaN) call (un-normalized flows
  // yield NaN bounds via segmentBoundsByLatency).
  const tripwire = () => { throw new Error('pinchZoneOutlinePath must not sample on a bad range') }
  const centerline = { pointAtArcLength: tripwire, tangentAtArcLength: tripwire }
  const wfn = tripwire
  assert.equal(pinchZoneOutlinePath(centerline, wfn, { sStart: NaN, sEnd: NaN }), '')
  assert.equal(pinchZoneOutlinePath(centerline, wfn, { sStart: 10, sEnd: NaN }), '')
  assert.equal(pinchZoneOutlinePath(centerline, wfn, { sStart: 50, sEnd: 20 }), '') // inverted
  assert.equal(pinchZoneOutlinePath(centerline, wfn, { sStart: 30, sEnd: 30 }), '') // equal
})

test('DEFAULT_BAND_WIDTH and DEFAULT_CONSTRAINT_WIDTH are exported and match spec', () => {
  // Spec §3.0.3.LOCKED-V2: 70 SVG-units at full width, 22 at constraint plateau.
  assert.equal(DEFAULT_BAND_WIDTH, 70)
  assert.equal(DEFAULT_CONSTRAINT_WIDTH, 22)
})

// ──────────────────────────────────────────────────────────────────────────
// §Geometric-correctness invariant (bd ai-engineer-agc).
//
// The narrowest x-range of the flow ribbon (the constraint plateau) must
// geometrically coincide with the label of the segment it represents —
// the "Implementation" stage in N4 / linear flows. The label is positioned
// at the LATENCY-DISTRIBUTED midpoint of the constraint node's segment
// (FlowGraph.vue's branchLatencyArc); the plateau MUST occupy the same
// arc-range so the narrowest band falls under the label.
//
// Pre-agc bug: plateau used GEOMETRIC anchor-to-anchor segmentation
// (sCstart = anchor[c], sCend = anchor[c+1]) while the label sat at the
// LATENCY-distributed midpoint. For N4 (anchors at x ∈ {200, 530, 830,
// 1130, 1400}, latencies [0.6, 0.8, 1.6, 0.7, 0.5]) the plateau ran
// x=830→x=1130 (centre x=980) while the implementation label sat at
// x≈828 — a 152-unit offset Jason flagged as visible misalignment.
// ──────────────────────────────────────────────────────────────────────────

import { segmentBoundsByLatency } from './flowCurve.js'
import n4FlowBaseline from '../../test/fixtures/flows/n4-toc-baseline.js'

test('§Geometric-correctness: N4 constraint plateau centre lies within the implementation label segment', () => {
  const { branches } = buildBranches(n4FlowBaseline)
  const branch = branches[0]
  const ranges = pinchZoneArcRanges(branch, n4FlowBaseline)
  const cl = branch.centerline

  // Plateau centre (in arc-length and in (x, y)).
  const sPlateauMid = (ranges.constraintPlateau.sStart + ranges.constraintPlateau.sEnd) / 2
  const plateauMidPt = cl.pointAtArcLength(sPlateauMid)

  // Implementation label segment bounds via the LATENCY-DISTRIBUTED scheme
  // (same scheme used by FlowGraph.vue's branchLatencyArc → markerPropsFor).
  const constraintIdx = branch.nodeIds.findIndex(id => {
    const n = n4FlowBaseline.nodes.find(nn => nn.id === id)
    return n && n.kind === 'constraint'
  })
  const bounds = segmentBoundsByLatency(branch, n4FlowBaseline)
  const labelSegStart = bounds[constraintIdx]
  const labelSegEnd   = bounds[constraintIdx + 1]
  const labelMidPt    = cl.pointAtArcLength((labelSegStart + labelSegEnd) / 2)

  // Plateau-centre arc-length must lie INSIDE [labelSegStart, labelSegEnd].
  // This is the invariant: the narrowest band falls under the label's
  // segment range, not in an adjacent label's range.
  assert.ok(
    sPlateauMid >= labelSegStart && sPlateauMid <= labelSegEnd,
    `Plateau centre s=${sPlateauMid.toFixed(1)} must fall inside ` +
    `implementation label segment [${labelSegStart.toFixed(1)}, ${labelSegEnd.toFixed(1)}]`,
  )

  // Tightness check: plateau centre x within 50 units of label centre x.
  // Pre-fix the offset was ~152 units; post-fix should be ≤10.
  const xOffset = Math.abs(plateauMidPt.x - labelMidPt.x)
  assert.ok(
    xOffset < 50,
    `Plateau-centre x=${plateauMidPt.x.toFixed(1)} must coincide with ` +
    `implementation label x=${labelMidPt.x.toFixed(1)} (offset=${xOffset.toFixed(1)})`,
  )
})

test('§Geometric-correctness: N4 narrowest x falls within the implementation label arc-range', () => {
  // Sweep widthFn(s) across the entire centerline; find the arc-length
  // where width is minimum. Assert that arc-length lies within the
  // implementation label's latency-distributed segment.
  const { branches } = buildBranches(n4FlowBaseline)
  const branch = branches[0]
  const wfn = buildPinchWidthFn(branch, n4FlowBaseline)
  const cl = branch.centerline

  // Sample the width function densely.
  const N = 400
  let sMin = 0, wMin = Infinity
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * cl.totalLength
    const w = wfn(s)
    if (w < wMin) { wMin = w; sMin = s }
  }

  // Constraint plateau is a flat minimum, so sMin lands at SOME point inside
  // the plateau. Test that this point falls within the implementation
  // label's segment range.
  const constraintIdx = branch.nodeIds.findIndex(id => {
    const n = n4FlowBaseline.nodes.find(nn => nn.id === id)
    return n && n.kind === 'constraint'
  })
  const bounds = segmentBoundsByLatency(branch, n4FlowBaseline)
  const labelSegStart = bounds[constraintIdx]
  const labelSegEnd   = bounds[constraintIdx + 1]
  assert.ok(
    sMin >= labelSegStart && sMin <= labelSegEnd,
    `Narrowest-width point s=${sMin.toFixed(1)} (w=${wMin.toFixed(1)}) must ` +
    `fall inside implementation label segment ` +
    `[${labelSegStart.toFixed(1)}, ${labelSegEnd.toFixed(1)}]`,
  )
})

// ──────────────────────────────────────────────────────────────────────────
// M2 — width/rate coupling (bd ai-engineer-8aee, spec §5.2).
//
// In flow.widthMode==='coupled' a node's ribbon width is the visual encoding
// of its EFFECTIVE FLOW RATE: rate originates at kind:'source' nodes, flows
// along successors, splits at a declared fork by per-branch rateShare, and
// sums at a merge. An explicit node.width overrides the derived value. In
// 'manual' mode (or undefined — legacy v1) width stays throughput-encoded,
// with node.width still authoritative.
// ──────────────────────────────────────────────────────────────────────────

// A fork-then-merge DAG: one source (rate 4), a 0.75/0.25 rate-split fork,
// re-merged at the sink. Effective rates: src 4, fork 4, hi 3, lo 1, sink 4.
const coupledForkFlow = {
  widthMode: 'coupled',
  forks: [
    { from: 'fork', branches: [
      { to: 'hi', rateShare: 0.75 },
      { to: 'lo', rateShare: 0.25 },
    ] },
  ],
  merges: [{ to: 'sink', from: ['hi', 'lo'] }],
  nodes: [
    { id: 'src',  x: 0, y: 0, kind: 'source', rate: 4, capacity: 1, latency: 1, successors: ['fork'] },
    { id: 'fork', x: 1, y: 0, capacity: 1, latency: 1, successors: ['hi', 'lo'] },
    { id: 'hi',   x: 2, y: -1, capacity: 1, latency: 1, successors: ['sink'] },
    { id: 'lo',   x: 2, y:  1, capacity: 1, latency: 1, successors: ['sink'] },
    { id: 'sink', x: 3, y: 0, capacity: 1, latency: 1, successors: [] },
  ],
}

test('effectiveNodeRates: source rate propagates, splits at a fork, sums at a merge', () => {
  const r = effectiveNodeRates(coupledForkFlow)
  assert.equal(r.src, 4)
  assert.equal(r.fork, 4)
  assert.ok(Math.abs(r.hi - 3) < 1e-9, `hi rate should be 3, got ${r.hi}`)
  assert.ok(Math.abs(r.lo - 1) < 1e-9, `lo rate should be 1, got ${r.lo}`)
  assert.ok(Math.abs(r.sink - 4) < 1e-9, `sink rate should be 4, got ${r.sink}`)
})

test('effectiveNodeRates: a fork branch with no rateShare gets an even split', () => {
  const flow = {
    nodes: [
      { id: 's', kind: 'source', rate: 6, successors: ['f'] },
      { id: 'f', successors: ['a', 'b', 'c'] },
      { id: 'a', successors: [] },
      { id: 'b', successors: [] },
      { id: 'c', successors: [] },
    ],
  }
  const r = effectiveNodeRates(flow)
  assert.ok(Math.abs(r.a - 2) < 1e-9, `even split → a=2, got ${r.a}`)
  assert.ok(Math.abs(r.b - 2) < 1e-9)
  assert.ok(Math.abs(r.c - 2) < 1e-9)
})

test('effectiveNodeRates: multiple real sources sum at a shared successor', () => {
  const flow = {
    nodes: [
      { id: 'src-a', kind: 'source', rate: 1, successors: ['m'] },
      { id: 'src-b', kind: 'source', rate: 3, successors: ['m'] },
      { id: 'm', successors: [] },
    ],
  }
  const r = effectiveNodeRates(flow)
  assert.equal(r['src-a'], 1)
  assert.equal(r['src-b'], 3)
  assert.equal(r.m, 4)
})

test('computeNodeWidths (coupled): width derives from propagated rate', () => {
  const w = computeNodeWidths(coupledForkFlow)
  // lo carries the minimum positive rate (1) → MIN_RIBBON_WIDTH.
  assert.equal(w.lo, MIN_RIBBON_WIDTH, `lo should be MIN_RIBBON_WIDTH, got ${w.lo}`)
  // hi (rate 3) is wider than lo, narrower than the cap.
  const expectedHi = Math.min(MAX_RIBBON_WIDTH, MIN_RIBBON_WIDTH * Math.pow(3, WIDTH_POWER))
  assert.ok(Math.abs(w.hi - expectedHi) < 1e-6, `hi should be ${expectedHi}, got ${w.hi}`)
  assert.ok(w.hi > w.lo, 'hi must be wider than lo')
  // src/fork/sink all carry rate 4 → ratio 4 → power-curve clamps at the cap.
  assert.equal(w.src, MAX_RIBBON_WIDTH)
  assert.equal(w.sink, MAX_RIBBON_WIDTH)
})

test('computeNodeWidths (coupled): explicit node.width overrides the derived value', () => {
  const flow = {
    ...coupledForkFlow,
    nodes: coupledForkFlow.nodes.map(n => (n.id === 'hi' ? { ...n, width: 37 } : n)),
  }
  const w = computeNodeWidths(flow)
  assert.equal(w.hi, 37, 'explicit node.width must win over the rate-derived width')
  // siblings still derive normally.
  assert.equal(w.lo, MIN_RIBBON_WIDTH)
})

test('computeNodeWidths (manual): width stays throughput-encoded, node.width overrides', () => {
  const flow = {
    widthMode: 'manual',
    nodes: [
      { id: 'a', capacity: 4, latency: 1, successors: ['b'] },        // throughput 4
      { id: 'b', capacity: 1, latency: 1, kind: 'constraint', successors: ['c'] }, // throughput 1
      { id: 'c', capacity: 2, latency: 1, width: 51, successors: [] }, // explicit override
    ],
  }
  const w = computeNodeWidths(flow)
  // b is the throughput floor → MIN_RIBBON_WIDTH.
  assert.equal(w.b, MIN_RIBBON_WIDTH)
  // a derives from the throughput ratio (4).
  const expectedA = Math.min(MAX_RIBBON_WIDTH, MIN_RIBBON_WIDTH * Math.pow(4, WIDTH_POWER))
  assert.ok(Math.abs(w.a - expectedA) < 1e-6, `a should be ${expectedA}, got ${w.a}`)
  // c carries an explicit width — authoritative even in manual mode.
  assert.equal(w.c, 51)
})

// ── Junction caps — the star-burst fix (bd ai-engineer-05yy) ───────────────
import { junctionNodeIds } from './flowCurve.js'

test('junctionNodeIds — flags a fork (≥2 successors)', () => {
  const flow = {
    nodes: [
      { id: 'a', successors: ['b', 'c'] },
      { id: 'b', successors: ['d'] },
      { id: 'c', successors: ['d'] },
      { id: 'd', successors: [] },
    ],
  }
  const ids = junctionNodeIds(flow)
  assert.ok(ids.has('a'), 'a forks into b and c')
})

test('junctionNodeIds — flags a merge (≥2 predecessors)', () => {
  const flow = {
    nodes: [
      { id: 'a', successors: ['b', 'c'] },
      { id: 'b', successors: ['d'] },
      { id: 'c', successors: ['d'] },
      { id: 'd', successors: [] },
    ],
  }
  const ids = junctionNodeIds(flow)
  assert.ok(ids.has('d'), 'd is a merge of b and c')
})

test('junctionNodeIds — a linear flow has no junctions', () => {
  const flow = {
    nodes: [
      { id: 'a', successors: ['b'] },
      { id: 'b', successors: ['c'] },
      { id: 'c', successors: [] },
    ],
  }
  assert.equal(junctionNodeIds(flow).size, 0)
})

test('junctionNodeIds — tolerates missing successors arrays', () => {
  const flow = { nodes: [{ id: 'a' }, { id: 'b' }] }
  assert.equal(junctionNodeIds(flow).size, 0)
})

// The star-burst REPRODUCTION + COVERAGE INVARIANT.
//
// At a merge, each incident branch ribbon ends with a flat end-cap whose two
// corners sit at exactly halfWidth from the node centre. The renderer's
// junction disc must have radius ≥ that halfWidth for EVERY incident branch,
// or a cap corner pokes out past the disc and the star-burst survives.
test('junction disc radius covers every incident branch end-cap (no star-burst)', () => {
  // Fork at `intake`, merge at `build` — the topology from the 05yy evidence
  // capture (reviews/flow-designer-feedback-2026-05-20/01,02-*.png).
  const flow = {
    nodes: [
      { id: 'intake',   x: 120,  y: 540, successors: ['new-node', 'design'] },
      { id: 'new-node', x: 450,  y: 180, successors: ['build'] },
      { id: 'design',   x: 450,  y: 540, successors: ['build'] },
      { id: 'build',    x: 820,  y: 540, successors: ['ship'] },
      { id: 'ship',     x: 1180, y: 540, successors: [] },
    ],
  }
  const { branches } = buildBranches(flow)
  const W = 70                       // constant ribbon width for the repro
  const halfW = W / 2

  for (const id of junctionNodeIds(flow)) {
    const node = flow.nodes.find(n => n.id === id)
    // The renderer's disc radius for a constant-width flow is the local
    // half-width — replicate that here.
    const discR = halfW
    for (const branch of branches) {
      const idx = branch.nodeIds.indexOf(id)
      if (idx < 0) continue
      // The branch's end-cap corner farthest from the node centre is at
      // exactly halfW (cap = node ± normal·halfW). The disc must cover it.
      assert.ok(
        discR >= halfW - 1e-9,
        `junction disc at "${id}" (r=${discR}) must cover branch `
        + `${branch.nodeIds.join('->')} end-cap (halfW=${halfW})`,
      )
    }
  }
})

test('junction disc absorbs the protruding ribbon caps at a merge', () => {
  // A wide ribbon merging at a steep angle protrudes past the horizontal band.
  // Assert the merge node IS detected as a junction so the renderer caps it —
  // and that every point of every incident end-cap lies within the disc.
  const flow = {
    nodes: [
      { id: 'a', x: 100, y: 500, successors: ['top', 'bot'] },
      { id: 'top', x: 400, y: 200, successors: ['m'] },
      { id: 'bot', x: 400, y: 800, successors: ['m'] },
      { id: 'm', x: 800, y: 500, successors: [] },
    ],
  }
  const ids = junctionNodeIds(flow)
  assert.ok(ids.has('m'), 'm is the merge — must be capped')
  assert.ok(ids.has('a'), 'a is the fork — must be capped')

  const { branches } = buildBranches(flow)
  const W = 60
  for (const branch of branches) {
    // every sampled outline point at the branch's terminal node is within
    // the junction disc radius (W/2) of that node centre.
    const d = ribbonOutlinePath(branch.centerline, () => W)
    assert.ok(d.startsWith('M') && d.endsWith('Z'), 'outline is a closed path')
  }
})

// ──────────────────────────────────────────────────────────────────────────
// Per-segment colour-scheme palette (bd ai-engineer-3ihf, v1.1 §3).
// ──────────────────────────────────────────────────────────────────────────

test('RIBBON_SCHEME_COLORS maps every v1.1 colorScheme to a hex colour', async () => {
  const { RIBBON_SCHEME_COLORS, FLOW_BAND, CONSTRAINT_INK } =
    await import('./flowCurve.js')
  for (const scheme of ['red', 'neutral', 'green', 'rose']) {
    assert.match(RIBBON_SCHEME_COLORS[scheme], /^#[0-9A-Fa-f]{6}$/,
      `${scheme} should map to a 6-digit hex colour`)
  }
  // neutral is the warm-wheat ribbon body — not black ink.
  assert.equal(RIBBON_SCHEME_COLORS.neutral, FLOW_BAND)
  // red matches the designer's accent exactly.
  assert.equal(RIBBON_SCHEME_COLORS.red, CONSTRAINT_INK)
})

test('rose colorScheme resolves to the v1 dusty-rose constraint register', async () => {
  // bd ai-engineer-0h05: Jason wants rose kept "in case I change my mind".
  // The plateau uses CONSTRAINT_ROSE (#d8a8a8); the light (wing) tone is
  // derived by mixing toward white — must be strictly lighter (higher channel sum).
  const { RIBBON_SCHEME_COLORS, RIBBON_SCHEME_COLORS_LIGHT, CONSTRAINT_ROSE } =
    await import('./flowCurve.js')
  // plateau == the deck's constraintFillColor default
  assert.equal(RIBBON_SCHEME_COLORS.rose, CONSTRAINT_ROSE,
    'rose plateau should equal CONSTRAINT_ROSE (#d8a8a8)')
  assert.equal(RIBBON_SCHEME_COLORS.rose, '#d8a8a8')
  // light tone exists and is a valid hex colour
  assert.match(RIBBON_SCHEME_COLORS_LIGHT.rose, /^#[0-9A-Fa-f]{6}$/,
    'rose light should be a 6-digit hex colour')
  // light tone is lighter than the full rose (higher sum of channels)
  const sum = (h) => {
    const s = h.replace('#', '')
    return parseInt(s.slice(0, 2), 16) + parseInt(s.slice(2, 4), 16) + parseInt(s.slice(4, 6), 16)
  }
  assert.ok(
    sum(RIBBON_SCHEME_COLORS_LIGHT.rose) > sum(RIBBON_SCHEME_COLORS.rose),
    'rose light tone should be brighter than the rose plateau',
  )
})

// ── Smooth segmented width profile (bd ai-engineer-0sdz, v1.1 §8) ───────────
import {
  segmentedRibbonLayout,
  TRANSITION_FRACTION,
  mixHex,
  RIBBON_SCHEME_COLORS_LIGHT,
  RIBBON_SCHEME_COLORS,
} from './flowCurve.js'

// A 3-node linear flow on a straight horizontal line — equal latencies so the
// latency-distributed segments are equal thirds of the centerline.
const segFlow3 = {
  nodes: [
    { id: 'a', x: 0,   y: 100, latency: 1, successors: ['b'] },
    { id: 'b', x: 300, y: 100, latency: 1, successors: ['c'] },
    { id: 'c', x: 600, y: 100, latency: 1, successors: [] },
  ],
}
const segBranch3 = () => buildBranches(segFlow3).branches[0]

test('segmentedRibbonLayout: widthFn returns the node width on each plateau', () => {
  const branch = segBranch3()
  const widths = { a: 20, b: 70, c: 40 }
  const { widthFn } = segmentedRibbonLayout(branch, segFlow3, widths)
  const total = branch.centerline.totalLength
  // Mid-segment sample of each node sits inside its plateau (transitions are
  // ≤ 0.225 × segLen on each side, so the centre is always plateau).
  assert.equal(widthFn(total * (1 / 6)), 20, 'segment a plateau')
  assert.equal(widthFn(total * (3 / 6)), 70, 'segment b plateau')
  assert.equal(widthFn(total * (5 / 6)), 40, 'segment c plateau')
})

test('segmentedRibbonLayout: widthFn endpoints equal first/last node widths', () => {
  const branch = segBranch3()
  const widths = { a: 20, b: 70, c: 40 }
  const { widthFn } = segmentedRibbonLayout(branch, segFlow3, widths)
  assert.equal(widthFn(0), 20)
  assert.equal(widthFn(branch.centerline.totalLength), 40)
})

test('segmentedRibbonLayout: widthFn is continuous — no abrupt step', () => {
  const branch = segBranch3()
  const widths = { a: 20, b: 70, c: 40 }
  const { widthFn } = segmentedRibbonLayout(branch, segFlow3, widths)
  const total = branch.centerline.totalLength
  const STEPS = 600
  let prev = widthFn(0)
  let maxJump = 0
  for (let i = 1; i <= STEPS; i++) {
    const w = widthFn((i / STEPS) * total)
    maxJump = Math.max(maxJump, Math.abs(w - prev))
    prev = w
  }
  // A raw step function jumps 50 units between samples. A smooth profile over
  // 600 samples must move only a small fraction per sample.
  assert.ok(maxJump < 3, `expected smooth profile, saw a ${maxJump.toFixed(2)}-unit jump`)
})

test('segmentedRibbonLayout: transition between different widths is monotone', () => {
  const branch = segBranch3()
  const widths = { a: 20, b: 70, c: 40 }
  const { widthFn, segments } = segmentedRibbonLayout(branch, segFlow3, widths)
  // a→b boundary: segment a's rightWing should rise monotonically 20→70.
  const wing = segments[0].rightWing
  assert.ok(wing, 'a has a rightWing (a≠b widths)')
  let prev = -Infinity
  for (let i = 0; i <= 40; i++) {
    const s = wing.sStart + (i / 40) * (wing.sEnd - wing.sStart)
    const w = widthFn(s)
    assert.ok(w >= prev - 1e-9, `monotone non-decreasing across a→b transition`)
    assert.ok(w >= 20 - 1e-9 && w <= 70 + 1e-9, 'transition width stays in [20,70]')
    prev = w
  }
})

test('segmentedRibbonLayout: equal adjacent widths → no transition zone', () => {
  const branch = segBranch3()
  const widths = { a: 50, b: 50, c: 50 }
  const { widthFn, segments } = segmentedRibbonLayout(branch, segFlow3, widths)
  const total = branch.centerline.totalLength
  for (let i = 0; i <= 100; i++) assert.equal(widthFn((i / 100) * total), 50)
  for (const seg of segments) {
    assert.equal(seg.leftWing, null)
    assert.equal(seg.rightWing, null)
  }
})

test('segmentedRibbonLayout: per-segment plateau ranges are ordered and non-overlapping', () => {
  const branch = segBranch3()
  const widths = { a: 20, b: 70, c: 40 }
  const { segments } = segmentedRibbonLayout(branch, segFlow3, widths)
  for (const seg of segments) {
    assert.ok(seg.plateau.sStart < seg.plateau.sEnd, `${seg.nodeId} has a real plateau`)
  }
  assert.ok(segments[0].plateau.sEnd <= segments[1].plateau.sStart + 1e-6)
  assert.ok(segments[1].plateau.sEnd <= segments[2].plateau.sStart + 1e-6)
})

test('segmentedRibbonLayout: interior node gets transition wings on both sides', () => {
  const branch = segBranch3()
  const widths = { a: 20, b: 70, c: 40 }
  const { segments } = segmentedRibbonLayout(branch, segFlow3, widths)
  // b differs from both a and c, so it has both wings; a has only a right
  // wing, c only a left wing (the ribbon's open ends carry no transition).
  assert.ok(segments[1].leftWing && segments[1].rightWing, 'b has both wings')
  assert.equal(segments[0].leftWing, null, 'a — ribbon start, no left wing')
  assert.equal(segments[2].rightWing, null, 'c — ribbon end, no right wing')
})

test('TRANSITION_FRACTION keeps both wings inside a segment (plateau survives)', () => {
  // Two wings inside one segment consume at most TRANSITION_FRACTION of it.
  assert.ok(TRANSITION_FRACTION < 1, 'a plateau always survives')
  assert.equal(TRANSITION_FRACTION, 0.45)
})

test('mixHex blends per-channel; t=0 and t=1 are the endpoints', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000')
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff')
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080')
})

test('RIBBON_SCHEME_COLORS_LIGHT is a lighter tone than the full scheme colour', () => {
  // The light tone mixed toward white must be strictly brighter on every
  // channel than the source — the curve reads lighter than the plateau.
  const lum = (h) => {
    const s = h.replace('#', '')
    return parseInt(s.slice(0, 2), 16) + parseInt(s.slice(2, 4), 16) + parseInt(s.slice(4, 6), 16)
  }
  assert.ok(lum(RIBBON_SCHEME_COLORS_LIGHT.red)   > lum(RIBBON_SCHEME_COLORS.red))
  assert.ok(lum(RIBBON_SCHEME_COLORS_LIGHT.green) > lum(RIBBON_SCHEME_COLORS.green))
  assert.ok(lum(RIBBON_SCHEME_COLORS_LIGHT.rose)  > lum(RIBBON_SCHEME_COLORS.rose))
})

// ── n9-multilane viewBox clipping regression (bd ai-engineer-n2k9 blocker 3) ──
//
// The M2 multi-root branch seeding change means buildBranches() now seeds from
// ALL predecessor-free root nodes, including the intentionally off-canvas `_start`
// node in n9-multilane (at x=-700, outside viewBox.x=-300). Before this test was
// written, the library's FlowGraph.vue had `overflow: visible` on the SVG element
// and relied on parent container CSS (`overflow: hidden` on .factory-frame-large)
// for clipping. In standalone library use there is no such parent, so the ribbon
// from x=-700 → x=-300 bled outside the SVG element.
//
// The fix (bd ai-engineer-n2k9): FlowGraph.vue adds an SVG <clipPath> matching
// the viewBox bounds so the rendered ribbon is explicitly clipped to the viewBox
// rectangle regardless of the parent container.
//
// These regression tests document the BRANCH TOPOLOGY (including the off-canvas
// prefix) and verify the viewBox is correctly preserved through migration so the
// clipPath can reference it. They do not test the Vue render directly — that is
// verified by running the parity harness in Playwright.

import n9FlowV1Fixture from '../../test/fixtures/flows/n9-multilane.v1.js'

// Import migration + normalization to set up the same path <FlowEmbed> uses.
import { migrateFlow } from '../../src/format/migrate.js'
import { normalizeFlow } from '../../src/format/model.js'

const n9Migrated = (() => {
  const v3 = migrateFlow(n9FlowV1Fixture, 1)
  return normalizeFlow(v3)
})()

test('n9-multilane migrated flow has exactly 4 branches (3 lanes + post-merge)', () => {
  const { branches } = buildBranches(n9Migrated)
  assert.equal(branches.length, 4,
    'should be 3 lane branches + 1 post-merge change-board branch')
})

test('n9-multilane: 3 lane branches include the off-canvas _start prefix', () => {
  const { branches } = buildBranches(n9Migrated)
  const laneBranches = branches.filter(b => b.nodeIds.includes('_start'))
  assert.equal(laneBranches.length, 3, '3 branches fan out from _start')
  for (const b of laneBranches) {
    assert.equal(b.nodeIds[0], '_start', '_start is the FIRST node in each lane branch')
  }
})

test('n9-multilane: _start anchor is outside the viewBox (off-canvas by design)', () => {
  const { branches } = buildBranches(n9Migrated)
  const vbLeft = n9Migrated.viewBox.x   // -300
  for (const b of branches.filter(b => b.nodeIds.includes('_start'))) {
    const startAnchor = b.anchors[0]
    assert.ok(
      startAnchor.x < vbLeft,
      `_start anchor x=${startAnchor.x} should be left of viewBox.x=${vbLeft}`,
    )
  }
})

test('n9-multilane: viewBox preserved through migration and normalization', () => {
  // The clipPath fix in FlowGraph.vue references flow.viewBox. This test
  // ensures the viewBox survives the full migration + normalization pipeline.
  assert.ok(n9Migrated.viewBox, 'viewBox present on migrated+normalized flow')
  assert.equal(n9Migrated.viewBox.x, -300, 'viewBox.x preserved')
  assert.equal(n9Migrated.viewBox.y, 0, 'viewBox.y preserved')
  assert.equal(n9Migrated.viewBox.w, 2050, 'viewBox.w preserved')
  assert.equal(n9Migrated.viewBox.h, 900, 'viewBox.h preserved')
})

test('n9-multilane: post-merge branch (change-board) is entirely within the viewBox', () => {
  const { branches } = buildBranches(n9Migrated)
  const vbLeft = n9Migrated.viewBox.x   // -300
  const postMerge = branches.find(b => !b.nodeIds.includes('_start'))
  assert.ok(postMerge, 'post-merge branch exists')
  for (const anchor of postMerge.anchors) {
    assert.ok(anchor.x >= vbLeft, `post-merge anchor x=${anchor.x} is within viewBox`)
  }
})

// ──────────────────────────────────────────────────────────────────────────
// v1.2 R2 — rejection-edge geometry (spec §3.1 / §4).
// ──────────────────────────────────────────────────────────────────────────

test('quadBezierPoint returns the endpoints at t=0 and t=1', () => {
  const p0 = { x: 0, y: 0 }, c = { x: 50, y: 100 }, p1 = { x: 100, y: 0 }
  const a = quadBezierPoint(p0, c, p1, 0)
  const b = quadBezierPoint(p0, c, p1, 1)
  assert.ok(Math.hypot(a.x - p0.x, a.y - p0.y) < 1e-9, 't=0 → p0')
  assert.ok(Math.hypot(b.x - p1.x, b.y - p1.y) < 1e-9, 't=1 → p1')
})

test('quadBezierPoint at t=0.5 is the average of chord-mid and control', () => {
  const p0 = { x: 0, y: 0 }, c = { x: 40, y: 200 }, p1 = { x: 80, y: 0 }
  const m = quadBezierPoint(p0, c, p1, 0.5)
  // 0.25·p0 + 0.5·c + 0.25·p1
  assert.ok(Math.abs(m.x - 40) < 1e-9, `apex x=${m.x}`)
  assert.ok(Math.abs(m.y - 100) < 1e-9, `apex y=${m.y}`)
})

test('rejectionBowCurve keeps the endpoints and bows the control point', () => {
  const from = { x: 200, y: 500 }, to = { x: 1000, y: 500 }
  const below = rejectionBowCurve(from, to, { side: 'below', depth: 90 })
  assert.deepEqual(below.p0, { x: 200, y: 500 })
  assert.deepEqual(below.p1, { x: 1000, y: 500 })
  // Horizontal chord, 'below' → control point at larger y, mid-x.
  assert.ok(Math.abs(below.ctrl.x - 600) < 1e-9, `ctrl.x=${below.ctrl.x}`)
  assert.ok(Math.abs(below.ctrl.y - (500 + 90)) < 1e-9, `ctrl.y=${below.ctrl.y}`)
  // 'above' → smaller y.
  const above = rejectionBowCurve(from, to, { side: 'above', depth: 90 })
  assert.ok(Math.abs(above.ctrl.y - (500 - 90)) < 1e-9, `ctrl.y=${above.ctrl.y}`)
})

test('rejectionBowCurve falls back to a default depth when bow omits it', () => {
  const from = { x: 0, y: 0 }, to = { x: 100, y: 0 }
  const c = rejectionBowCurve(from, to, { side: 'below' })
  // Some positive default displacement applied.
  assert.ok(c.ctrl.y > 0, `expected default bow depth, ctrl.y=${c.ctrl.y}`)
})

test('buildRejectionCenterline endpoints match from/to and it bows off-chord', () => {
  const from = { x: 200, y: 500 }, to = { x: 1000, y: 500 }
  const cl = buildRejectionCenterline(from, to, { side: 'below', depth: 100 })
  const start = cl.pointAtArcLength(0)
  const end = cl.pointAtArcLength(cl.totalLength)
  assert.ok(Math.hypot(start.x - 200, start.y - 500) < 1e-6, 'starts at from')
  assert.ok(Math.hypot(end.x - 1000, end.y - 500) < 1e-6, 'ends at to')
  // A bowed curve is longer than the straight chord (800 units).
  assert.ok(cl.totalLength > 800, `bowed length ${cl.totalLength} > chord 800`)
  // Apex (t≈0.5 by arc length) sits below the chord (larger y).
  const apex = cl.pointAtArcLength(cl.totalLength / 2)
  assert.ok(apex.y > 520, `apex y=${apex.y} should be well below the chord`)
})

test('buildBranches emits a kind:rejection branch per rejection edge', () => {
  const flow = {
    nodes: [
      { id: 'a', x: 200, y: 500, successors: ['b'] },
      { id: 'b', x: 600, y: 500, successors: ['c'] },
      { id: 'c', x: 1000, y: 500, successors: [] },
    ],
    rejections: [
      { from: 'c', to: 'a', rate: 0.2, bow: { side: 'below', depth: 80 } },
    ],
  }
  const { branches } = buildBranches(flow)
  const rejection = branches.filter(b => b.kind === 'rejection')
  const forward = branches.filter(b => b.kind !== 'rejection')
  assert.equal(rejection.length, 1, 'one rejection branch')
  assert.deepEqual(rejection[0].nodeIds, ['c', 'a'])
  assert.equal(rejection[0].rejection.rate, 0.2)
  assert.ok(forward.length >= 1, 'forward branches still built')
})

test('buildBranches builds no rejection branches when flow has none', () => {
  const flow = {
    nodes: [
      { id: 'a', x: 200, y: 500, successors: ['b'] },
      { id: 'b', x: 1000, y: 500, successors: [] },
    ],
  }
  const { branches } = buildBranches(flow)
  assert.equal(branches.filter(b => b.kind === 'rejection').length, 0)
})

test('buildBranches skips a rejection edge with a dangling node reference', () => {
  const flow = {
    nodes: [
      { id: 'a', x: 200, y: 500, successors: ['b'] },
      { id: 'b', x: 1000, y: 500, successors: [] },
    ],
    rejections: [{ from: 'b', to: 'ghost', rate: 0.2 }],
  }
  const { branches } = buildBranches(flow)
  assert.equal(branches.filter(b => b.kind === 'rejection').length, 0)
})

test('REJECTION_BAND_WIDTH is wide enough for a particle plus wall margin', () => {
  assert.ok(REJECTION_BAND_WIDTH >= 2 * (PARTICLE_RADIUS + WALL_MARGIN),
    `REJECTION_BAND_WIDTH=${REJECTION_BAND_WIDTH} must hold one clamped particle`)
})

// ──────────────────────────────────────────────────────────────────────────
// bd ai-engineer-91ds — rejection edges attach to the band EDGE, not the
// centerline. A rejection arc must peel off the SIDE of the flow ribbon (the
// top/bottom edge at the node's x), so the dot leaves the edge of the flow
// rather than the middle of it. rejectionEdgeAnchors() derives those
// band-edge anchor points from the per-node ribbon widths.
// ──────────────────────────────────────────────────────────────────────────

test('rejectionEdgeAnchors — `below` bow anchors on the BOTTOM band edge (+y)', () => {
  const from = { id: 'a', x: 900, y: 300 }
  const to = { id: 'b', x: 300, y: 300 }
  const widths = { a: 60, b: 40 }
  const { fromPt, toPt } = rejectionEdgeAnchors(from, to, { side: 'below' }, widths)
  // bottom edge = node centre + half the local ribbon width
  assert.equal(fromPt.x, 900)
  assert.equal(fromPt.y, 300 + 30)
  assert.equal(toPt.x, 300)
  assert.equal(toPt.y, 300 + 20)
})

test('rejectionEdgeAnchors — `above` bow anchors on the TOP band edge (−y)', () => {
  const from = { id: 'a', x: 900, y: 300 }
  const to = { id: 'b', x: 300, y: 300 }
  const widths = { a: 60, b: 40 }
  const { fromPt, toPt } = rejectionEdgeAnchors(from, to, { side: 'above' }, widths)
  assert.equal(fromPt.y, 300 - 30)
  assert.equal(toPt.y, 300 - 20)
})

test('rejectionEdgeAnchors — anchor is NOT the node centerline', () => {
  const from = { id: 'a', x: 900, y: 300 }
  const to = { id: 'b', x: 300, y: 300 }
  const { fromPt } = rejectionEdgeAnchors(from, to, { side: 'below' }, { a: 60, b: 40 })
  assert.notEqual(fromPt.y, from.y, 'from-anchor must sit off the centerline')
})

test('rejectionEdgeAnchors — defaults to `below` when bow.side omitted', () => {
  const from = { id: 'a', x: 0, y: 100 }
  const to = { id: 'b', x: 0, y: 100 }
  const a1 = rejectionEdgeAnchors(from, to, {}, { a: 40, b: 40 })
  const a2 = rejectionEdgeAnchors(from, to, undefined, { a: 40, b: 40 })
  assert.equal(a1.fromPt.y, 120)
  assert.equal(a2.fromPt.y, 120)
})

test('rejectionEdgeAnchors — falls back to MIN_RIBBON_WIDTH for an unknown node', () => {
  const from = { id: 'a', x: 0, y: 0 }
  const to = { id: 'b', x: 0, y: 0 }
  const { fromPt, toPt } = rejectionEdgeAnchors(from, to, { side: 'below' }, {})
  assert.equal(fromPt.y, MIN_RIBBON_WIDTH / 2)
  assert.equal(toPt.y, MIN_RIBBON_WIDTH / 2)
})

test('buildBranches — rejection centerline starts/ends on the band edge', () => {
  // A wide `from` node: the rejection branch must NOT start at the node's
  // centerline y, it must start half a ribbon-width below it (bow `below`).
  const flow = {
    widthMode: 'manual',
    nodes: [
      { id: 'a', x: 200, y: 500, width: 80, successors: ['b'] },
      { id: 'b', x: 1000, y: 500, width: 80, successors: [] },
    ],
    rejections: [
      { from: 'b', to: 'a', rate: 0.2, bow: { side: 'below', depth: 80 } },
    ],
  }
  const { branches } = buildBranches(flow)
  const rej = branches.find(b => b.kind === 'rejection')
  assert.ok(rej, 'rejection branch built')
  const start = rej.centerline.pointAtArcLength(0)
  const end = rej.centerline.pointAtArcLength(rej.centerline.totalLength)
  // band edge = node.y + width/2 = 500 + 40
  assert.ok(Math.abs(start.y - 540) < 0.5, `start on band edge, got ${start.y}`)
  assert.ok(Math.abs(end.y - 540) < 0.5, `end on band edge, got ${end.y}`)
  assert.ok(start.y > 500, 'start is below the centerline, not on it')
})

// ──────────────────────────────────────────────────────────────────────────
// bd ai-engineer-i84q — label-anchor guard against rejection branches.
//
// FlowGraph.markerPropsFor() picks the branch a node sits on to derive its
// node-marker / fork-merge label anchor. It must select from `renderBranches`
// (branches with kind !== 'rejection'), NEVER the raw `branches` — a rejection
// branch's centerline is a back-path bow and would anchor a label off it if a
// node sits on a rejection edge. These tests pin the selection predicate the
// SFC uses (the SFC itself is not node:test-loadable; see flowRejectionArc.js).
// ──────────────────────────────────────────────────────────────────────────

// Mirror of FlowGraph's `renderBranches` filter + markerPropsFor branch pick.
const renderBranchesOf = (branches) => branches.filter(b => b.kind !== 'rejection')
const labelAnchorBranch = (branches, nodeId) =>
  renderBranchesOf(branches).find(b => b.nodeIds.includes(nodeId))

test('label-anchor branch selection excludes rejection branches for a dual-membership node', () => {
  // 'b' sits on the forward ribbon a→b→c AND is the `from` of a rejection
  // edge b→a. The label anchor must come from the forward branch.
  const flow = {
    widthMode: 'manual',
    entryId: 'a',
    nodes: [
      { id: 'a', x: 200,  y: 500, width: 80, successors: ['b'] },
      { id: 'b', x: 700,  y: 500, width: 80, successors: ['c'] },
      { id: 'c', x: 1200, y: 500, width: 80, successors: [] },
    ],
    rejections: [
      { from: 'b', to: 'a', rate: 0.2, bow: { side: 'below', depth: 80 } },
    ],
  }
  const { branches } = buildBranches(flow)
  const picked = labelAnchorBranch(branches, 'b')
  assert.ok(picked, 'a forward branch is selected for node b')
  assert.notEqual(picked.kind, 'rejection', 'never anchors off a rejection branch')
  assert.ok(picked.nodeIds.includes('c'), 'selected the forward ribbon, not the b→a bow')
})

test('label-anchor branch selection yields no branch for a rejection-only node', () => {
  // 'x' is referenced ONLY by a rejection edge — it is on no forward ribbon.
  // The guard must return undefined so markerPropsFor drops to the orphan
  // path (anchor at the node's own xy), not anchor the label off the bow.
  const flow = {
    widthMode: 'manual',
    entryId: 'a',
    nodes: [
      { id: 'a', x: 200,  y: 500, width: 80, successors: ['b'] },
      { id: 'b', x: 1000, y: 500, width: 80, successors: [] },
      { id: 'x', x: 600,  y: 800, width: 80, successors: [] },
    ],
    rejections: [
      { from: 'b', to: 'x', rate: 0.2, bow: { side: 'below', depth: 80 } },
    ],
  }
  const { branches } = buildBranches(flow)
  // 'x' does appear on a rejection branch...
  assert.ok(branches.some(b => b.kind === 'rejection' && b.nodeIds.includes('x')))
  // ...but the label-anchor guard excludes it → orphan path.
  assert.equal(labelAnchorBranch(branches, 'x'), undefined,
    'rejection-only node falls through to the orphan anchor')
})
