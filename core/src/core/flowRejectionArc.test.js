import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rejectionArcCurve,
  rejectionArcPath,
  rejectionArrowPoints,
  rejectionArrowPointsAttr,
  REJECTION_ARC_STROKE_WIDTH,
  REJECTION_ARC_DASHARRAY,
  REJECTION_ARROW_LENGTH,
} from './flowRejectionArc.js'
import {
  rejectionBowCurve,
  buildRejectionCenterline,
  quadBezierPoint,
  REJECTION_COLOR,
  REJECTION_PARTICLE_COLOR,
} from './flowCurve.js'

// ──────────────────────────────────────────────────────────────────────────
// v1.2 R3 — rendering. FlowRejectionArc.vue is a thin SFC shell over the pure
// flowRejectionArc.js geometry helper; the SFC itself is not node:test-loadable
// (the library has no SFC compiler in its test runner — visual DOM checks are
// R5 Playwright, spec §7.6). These tests cover the render geometry the SFC
// binds: the spec §4 invariant is that the rendered arc and the engine
// rejection-branch centerline share ONE source curve (rejectionBowCurve).
// ──────────────────────────────────────────────────────────────────────────

const FROM = { x: 900, y: 300 }
const TO = { x: 300, y: 300 }
const BOW = { side: 'below', depth: 90 }

/** Parse an `M x y Q cx cy x2 y2` path into { p0, ctrl, p1 }. */
function parseQuadPath(d) {
  const n = d.replace(/[MQ]/g, ' ').trim().split(/\s+/).map(Number)
  assert.equal(n.length, 6, `expected 6 numbers in quad path, got: ${d}`)
  return {
    p0: { x: n[0], y: n[1] },
    ctrl: { x: n[2], y: n[3] },
    p1: { x: n[4], y: n[5] },
  }
}

const near = (a, b, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (eps ${eps})`)

test('rejectionArcPath emits a single quadratic Bézier (M … Q …)', () => {
  const d = rejectionArcPath(FROM, TO, BOW)
  assert.match(d, /^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/)
})

test('rendered arc IS the shared rejectionBowCurve (physics ⇔ visuals)', () => {
  const parsed = parseQuadPath(rejectionArcPath(FROM, TO, BOW))
  const curve = rejectionBowCurve(FROM, TO, BOW)
  near(parsed.p0.x, curve.p0.x)
  near(parsed.p0.y, curve.p0.y)
  near(parsed.ctrl.x, curve.ctrl.x)
  near(parsed.ctrl.y, curve.ctrl.y)
  near(parsed.p1.x, curve.p1.x)
  near(parsed.p1.y, curve.p1.y)
  // rejectionArcCurve is the thin re-export the SFC / designer share.
  assert.deepEqual(rejectionArcCurve(FROM, TO, BOW), curve)
})

test('rendered arc matches the engine rejection-branch centerline', () => {
  // The engine centerline (buildRejectionCenterline) samples the SAME bow
  // curve. The rendered arc and the centerline must share endpoints exactly,
  // and every interior point of the rendered Bézier must lie on the curve the
  // engine traces.
  const parsed = parseQuadPath(rejectionArcPath(FROM, TO, BOW))
  const cl = buildRejectionCenterline(FROM, TO, BOW)
  const start = cl.pointAtArcLength(0)
  const end = cl.pointAtArcLength(cl.totalLength)
  near(parsed.p0.x, start.x)
  near(parsed.p0.y, start.y)
  near(parsed.p1.x, end.x)
  near(parsed.p1.y, end.y)
  // Interior sample: a point on the rendered Bézier must coincide with a point
  // on the engine centerline (both are the identical quadratic Bézier).
  const mid = quadBezierPoint(parsed.p0, parsed.ctrl, parsed.p1, 0.5)
  let best = Infinity
  for (let i = 0; i <= 200; i++) {
    const p = cl.pointAtArcLength((i / 200) * cl.totalLength)
    best = Math.min(best, Math.hypot(p.x - mid.x, p.y - mid.y))
  }
  assert.ok(best < 0.5, `rendered arc midpoint off the engine centerline (${best})`)
})

test('bow side and depth steer the arc (control point displaced)', () => {
  const below = rejectionBowCurve(FROM, TO, { side: 'below', depth: 90 })
  const above = rejectionBowCurve(FROM, TO, { side: 'above', depth: 90 })
  const deep = rejectionBowCurve(FROM, TO, { side: 'below', depth: 160 })
  // For this horizontal chord, 'below' is +y and 'above' is -y.
  assert.ok(below.ctrl.y > FROM.y, 'below should bow downward')
  assert.ok(above.ctrl.y < FROM.y, 'above should bow upward')
  assert.ok(deep.ctrl.y > below.ctrl.y, 'larger depth should bow further')
})

test('rejectionArrowPoints — three vertices, tip on the `to` anchor', () => {
  const pts = rejectionArrowPoints(FROM, TO, BOW)
  assert.equal(pts.length, 3)
  near(pts[0].x, TO.x)
  near(pts[0].y, TO.y)
})

test('arrowhead is oriented along the arc tangent at `to`', () => {
  const pts = rejectionArrowPoints(FROM, TO, BOW)
  const { ctrl, p1 } = rejectionBowCurve(FROM, TO, BOW)
  // Tangent at t=1 of a quadratic Bézier ∝ (p1 − ctrl).
  let tx = p1.x - ctrl.x
  let ty = p1.y - ctrl.y
  const len = Math.hypot(tx, ty)
  tx /= len
  ty /= len
  // The base midpoint sits REJECTION_ARROW_LENGTH behind the tip along −tangent.
  const baseMid = {
    x: (pts[1].x + pts[2].x) / 2,
    y: (pts[1].y + pts[2].y) / 2,
  }
  near(baseMid.x, p1.x - tx * REJECTION_ARROW_LENGTH)
  near(baseMid.y, p1.y - ty * REJECTION_ARROW_LENGTH)
})

test('rejectionArrowPointsAttr — SVG polygon `points` string of 3 vertices', () => {
  const attr = rejectionArrowPointsAttr(FROM, TO, BOW)
  const verts = attr.trim().split(/\s+/)
  assert.equal(verts.length, 3)
  for (const v of verts) assert.match(v, /^-?[\d.]+,-?[\d.]+$/)
})

test('rejection arc stroke is thin and dotted (spec §4)', () => {
  assert.equal(REJECTION_ARC_STROKE_WIDTH, 2)
  // dasharray: two positive numbers, gap strictly larger than the dash — a
  // dotted (not dashed) pattern when paired with a round line-cap.
  const [dash, gap] = REJECTION_ARC_DASHARRAY.trim().split(/\s+/).map(Number)
  assert.ok(dash > 0 && gap > 0, 'dasharray must be two positive lengths')
  assert.ok(gap > dash, 'dotted: gap should exceed dash length')
})

test('REJECTION_COLOR is a hex colour distinct from the firebrick accent', () => {
  assert.match(REJECTION_COLOR, /^#[0-9a-f]{6}$/i)
  assert.notEqual(REJECTION_COLOR.toLowerCase(), '#e2522b') // not CONSTRAINT_INK
})

test('REJECTION_PARTICLE_COLOR is the cream dot tinted toward REJECTION_COLOR', () => {
  assert.match(REJECTION_PARTICLE_COLOR, /^#[0-9a-f]{6}$/i)
  const CREAM = '#f4f2ed'
  assert.notEqual(REJECTION_PARTICLE_COLOR.toLowerCase(), CREAM)
  const hex = (h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  const [pr, pg, pb] = hex(REJECTION_PARTICLE_COLOR)
  const [cr, cg, cb] = hex(CREAM)
  const [rr, rg, rb] = hex(REJECTION_COLOR)
  // Each channel of the tint sits between cream and REJECTION_COLOR.
  const between = (p, a, b) => p >= Math.min(a, b) - 1 && p <= Math.max(a, b) + 1
  assert.ok(between(pr, cr, rr), 'red channel between cream and rejection')
  assert.ok(between(pg, cg, rg), 'green channel between cream and rejection')
  assert.ok(between(pb, cb, rb), 'blue channel between cream and rejection')
})
