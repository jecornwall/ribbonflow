/**
 * slideFrame.js — slide-scope geometry for the editor canvas.
 *
 * The deck renders each slide at 1920×1080 (16:9). A flow's viewBox IS its
 * slide-scope coordinate space, so the designer draws a frame guide at that
 * rectangle — authored flows are then designed to fit within a slide's scope
 * (bd ai-engineer-qe6d). The editor-canvas viewBox is expanded by a gutter
 * margin around the frame so content placed *outside* the slide stays visible
 * and can be detected + brought back in bounds (bd ai-engineer-oxcq).
 *
 * Pure geometry — no Vue, no library imports — so it is unit-testable headless.
 */

/** Slide aspect ratio the deck renders at (1920×1080 = 16:9). */
export const SLIDE_ASPECT = 16 / 9

/** Fallback slide frame when a flow carries no viewBox. 16:9 (1600×900). */
export const DEFAULT_FRAME = { x: 0, y: 0, w: 1600, h: 900 }

/**
 * Gutter fraction added around the slide frame to form the editor-canvas
 * viewBox. 0.12 → a 12%-of-frame margin on every side, so a node dragged a
 * little past the slide edge stays visible against the dimmed gutter rather
 * than being clipped off the canvas.
 */
export const GUTTER_FRAC = 0.12

/**
 * The slide-scope rectangle for a flow.
 *
 * A flow's viewBox is its slide-scope coordinate space; the deck's slides are
 * 1920×1080 and the default flow viewBox (1600×900) shares that 16:9 ratio, so
 * the frame is simply the flow's viewBox. A flow with no / malformed viewBox
 * falls back to the 16:9 DEFAULT_FRAME.
 *
 * @param {{viewBox?: {x?:number,y?:number,w:number,h:number}}} flow
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function slideFrame(flow) {
  const v = flow?.viewBox
  if (!v || !Number.isFinite(v.w) || !Number.isFinite(v.h) || v.w <= 0 || v.h <= 0) {
    return { ...DEFAULT_FRAME }
  }
  return { x: v.x ?? 0, y: v.y ?? 0, w: v.w, h: v.h }
}

/** Inflate a rect by `frac` of its own size on every side. Pure. */
export function inflateRect(rect, frac) {
  const mx = rect.w * frac
  const my = rect.h * frac
  return { x: rect.x - mx, y: rect.y - my, w: rect.w + 2 * mx, h: rect.h + 2 * my }
}

/** Format a rect as an SVG `viewBox` attribute string. */
export function viewBoxStr(rect) {
  return `${rect.x} ${rect.y} ${rect.w} ${rect.h}`
}

/**
 * Whether a node's handle sits fully within the slide frame.
 *
 * `radius` insets the test by the node-handle radius, so a node whose circle
 * pokes past the slide edge counts as out of bounds (not just its centre). A
 * node with a non-finite position is treated as in bounds — it has no geometry
 * to judge.
 *
 * @param {{x:number,y:number}} node
 * @param {{x:number,y:number,w:number,h:number}} frame
 * @param {number} [radius]
 */
export function isNodeInBounds(node, frame, radius = 0) {
  if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return true
  return (
    node.x - radius >= frame.x &&
    node.x + radius <= frame.x + frame.w &&
    node.y - radius >= frame.y &&
    node.y + radius <= frame.y + frame.h
  )
}

/**
 * Ids of every node positioned (even partly) outside the slide frame.
 *
 * Edges follow their endpoint nodes, so an edge only leaves the slide because
 * a node does — detecting out-of-bounds nodes therefore covers out-of-bounds
 * edges too (bd ai-engineer-oxcq).
 */
export function outOfBoundsNodeIds(flow, frame, radius = 0) {
  return (flow?.nodes ?? [])
    .filter((n) => !isNodeInBounds(n, frame, radius))
    .map((n) => n.id)
}

/**
 * Clamp a coordinate pair so a node handle of `radius` sits fully inside the
 * frame. Returns integer coordinates (matching moveNode's rounding).
 */
export function clampToFrame(x, y, frame, radius = 0) {
  const cx = Math.min(Math.max(x, frame.x + radius), frame.x + frame.w - radius)
  const cy = Math.min(Math.max(y, frame.y + radius), frame.y + frame.h - radius)
  return { x: Math.round(cx), y: Math.round(cy) }
}
