/**
 * flowRejectionArc.js — pure render geometry for a rejection edge (v1.2 R3).
 *
 * The visible rejection arc and the engine's rejection-branch centerline must
 * agree by construction (spec §4): both are the SAME quadratic Bézier. R2
 * factored that curve into flowCurve.js#rejectionBowCurve and built the engine
 * centerline (buildRejectionCenterline) on top of it. This module is the
 * RENDER half — it derives the SVG path string and arrowhead polygon from the
 * exact same `rejectionBowCurve`, so the dotted arc the audience sees traces
 * the path the 'revising' particles physically travel.
 *
 * Kept as a pure module (no Vue) so it is node:test-friendly — FlowRejectionArc.vue
 * is a thin SFC shell that binds these outputs to SVG attributes.
 */

import { rejectionBowCurve } from './flowCurve.js'

/** Rendered stroke width of the rejection arc (viewBox units) — spec §4 "thin". */
export const REJECTION_ARC_STROKE_WIDTH = 2

/**
 * Dotted stroke pattern (spec §4). A near-zero dash with a round line-cap
 * renders as a row of dots rather than dashes — `0` dashes vanish in some
 * renderers, so a hairline `1` dash is used with `stroke-linecap="round"`.
 */
export const REJECTION_ARC_DASHARRAY = '1 5'

/** Arrowhead triangle size at the `to` end (viewBox units). */
export const REJECTION_ARROW_LENGTH = 11
export const REJECTION_ARROW_HALF_WIDTH = 5

/** Round a coordinate so the emitted path/points strings stay compact. */
function fmt(n) {
  return Number(n.toFixed(3))
}

/**
 * The quadratic-Bézier control points for a rejection edge. Thin re-export of
 * `rejectionBowCurve` — the single shared source for both the rendered arc
 * (here) and the engine centerline (buildRejectionCenterline).
 */
export function rejectionArcCurve(from, to, bow) {
  return rejectionBowCurve(from, to, bow)
}

/**
 * The SVG path `d` for the rejection arc: a single quadratic Bézier from the
 * `from` anchor to the `to` anchor, bowed by `bow`.
 */
export function rejectionArcPath(from, to, bow) {
  const { p0, ctrl, p1 } = rejectionBowCurve(from, to, bow)
  return `M ${fmt(p0.x)} ${fmt(p0.y)} Q ${fmt(ctrl.x)} ${fmt(ctrl.y)} ${fmt(p1.x)} ${fmt(p1.y)}`
}

/**
 * The three vertices of the arrowhead triangle at the `to` end, oriented along
 * the arc's tangent there. For a quadratic Bézier the tangent at t=1 is
 * proportional to (p1 − ctrl); the triangle's tip sits exactly on the `to`
 * anchor and its base is set back by REJECTION_ARROW_LENGTH along that tangent.
 * Returns [{x,y}, {x,y}, {x,y}] — tip first, then the two base corners.
 */
export function rejectionArrowPoints(from, to, bow) {
  const { ctrl, p1 } = rejectionBowCurve(from, to, bow)
  let tx = p1.x - ctrl.x
  let ty = p1.y - ctrl.y
  const len = Math.hypot(tx, ty) || 1
  tx /= len
  ty /= len
  // Unit normal to the tangent.
  const nx = -ty
  const ny = tx
  const bx = p1.x - tx * REJECTION_ARROW_LENGTH
  const by = p1.y - ty * REJECTION_ARROW_LENGTH
  return [
    { x: p1.x, y: p1.y },
    { x: bx + nx * REJECTION_ARROW_HALF_WIDTH, y: by + ny * REJECTION_ARROW_HALF_WIDTH },
    { x: bx - nx * REJECTION_ARROW_HALF_WIDTH, y: by - ny * REJECTION_ARROW_HALF_WIDTH },
  ]
}

/** The arrowhead vertices as an SVG `<polygon points>` attribute string. */
export function rejectionArrowPointsAttr(from, to, bow) {
  return rejectionArrowPoints(from, to, bow)
    .map((p) => `${fmt(p.x)},${fmt(p.y)}`)
    .join(' ')
}
