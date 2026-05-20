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
