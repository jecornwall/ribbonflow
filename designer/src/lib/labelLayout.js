/**
 * labelLayout.js — label collision-avoidance for the editor canvas.
 *
 * Pure geometry, no Vue / library imports, so it runs headless under
 * node:test. The designer places one text label per node at
 * `node.x + labelDx, node.y + labelDy` (CanvasNode draws it text-anchored
 * `middle` / baseline `middle`). When several nodes cluster, their labels
 * collide and the canvas reads as a tangle.
 *
 * `resolveLabelCollisions` finds overlapping label boxes and nudges the
 * lower-priority ones — those processed later in a stable top-to-bottom
 * order — away from their node along the label axis (up for an above-label,
 * down for a below-label) until they clear. useFlowDoc.tidyLabels() applies
 * the returned offsets through the existing `moveLabel` mutation, so the
 * nudge is a normal, undoable edit.
 *
 * See bd ai-engineer-fu5s (M3-polish).
 */

/**
 * Approximate per-character advance width, in viewBox units, for the canvas
 * label font (ET Book, 26px serif — see CanvasNode.vue). A serif body face
 * averages ~0.5em advance; 26px × 0.5 ≈ 13. This is a render-free estimate,
 * good enough to keep boxes from visibly touching.
 */
const DEFAULT_CHAR_WIDTH = 13

/** Approximate label box height (viewBox units) for the 26px canvas font. */
const DEFAULT_LABEL_HEIGHT = 30

/** Vertical step, in viewBox units, taken per nudge iteration. */
const DEFAULT_STEP = 10

/** Cap on total nudge distance so a pathological cluster cannot loop forever. */
const DEFAULT_MAX_NUDGE = 320

/** Extra clearance, in viewBox units, required between two label boxes. */
const DEFAULT_PAD = 6

/**
 * The axis-aligned bounding box of a node's label.
 * @param {{x,y,labelDx?,labelDy?,label?}} node
 * @param {{charWidth?:number,labelHeight?:number}} [opts]
 * @returns {{x0:number,x1:number,y0:number,y1:number}}
 */
export function labelBBox(node, opts = {}) {
  const charW = opts.charWidth ?? DEFAULT_CHAR_WIDTH
  const h = opts.labelHeight ?? DEFAULT_LABEL_HEIGHT
  const text = String(node.label ?? '')
  // Empty labels still occupy a minimum box so two empty labels separate.
  const w = Math.max(charW, text.length * charW)
  const cx = (node.x ?? 0) + (node.labelDx ?? 0)
  const cy = (node.y ?? 0) + (node.labelDy ?? 0)
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 }
}

/**
 * Do two boxes intersect (with optional clearance padding)?
 * @param {{x0,x1,y0,y1}} a
 * @param {{x0,x1,y0,y1}} b
 * @param {number} [pad] — required clearance; boxes closer than `pad` count.
 * @returns {boolean}
 */
export function bboxesOverlap(a, b, pad = 0) {
  return (
    a.x0 - pad < b.x1 &&
    b.x0 - pad < a.x1 &&
    a.y0 - pad < b.y1 &&
    b.y0 - pad < a.y1
  )
}

/**
 * Resolve label-label collisions across a node set.
 *
 * Labels are processed in a stable top-to-bottom (then left-to-right) order:
 * the first label of an overlapping cluster keeps its place; each subsequent
 * one is nudged along the label axis — away from its own node — until its
 * box clears every already-placed box. The nudge direction follows the
 * label's side: an above-label (`labelDy < 0`) moves further up, a below- or
 * on-line label moves down.
 *
 * @param {Array<{id,x,y,labelDx?,labelDy?,label?}>} nodes
 * @param {object} [opts] — charWidth / labelHeight / step / maxNudge / pad
 * @returns {Record<string,{labelDx:number,labelDy:number}>} a map of nodeId →
 *   the adjusted label offset, containing ONLY the labels that moved.
 */
export function resolveLabelCollisions(nodes, opts = {}) {
  const step = opts.step ?? DEFAULT_STEP
  const maxNudge = opts.maxNudge ?? DEFAULT_MAX_NUDGE
  const pad = opts.pad ?? DEFAULT_PAD

  const moves = {}
  const placed = []

  // Stable order: topmost label box first, then leftmost. Upper labels
  // therefore "win" their position and lower ones flow around them.
  const order = [...(nodes || [])].sort((a, b) => {
    const ay = (a.y ?? 0) + (a.labelDy ?? 0)
    const by = (b.y ?? 0) + (b.labelDy ?? 0)
    if (ay !== by) return ay - by
    return (a.x ?? 0) + (a.labelDx ?? 0) - ((b.x ?? 0) + (b.labelDx ?? 0))
  })

  for (const node of order) {
    const baseDy = node.labelDy ?? 0
    // Nudge away from the node: up for an above-label, down otherwise.
    const dir = baseDy < 0 ? -1 : 1
    let labelDy = baseDy
    let bbox = labelBBox({ ...node, labelDy }, opts)
    let nudged = 0
    while (
      nudged < maxNudge &&
      placed.some((p) => bboxesOverlap(bbox, p, pad))
    ) {
      labelDy += dir * step
      nudged += step
      bbox = labelBBox({ ...node, labelDy }, opts)
    }
    placed.push(bbox)
    if (labelDy !== baseDy) {
      moves[node.id] = { labelDx: node.labelDx ?? 0, labelDy }
    }
  }
  return moves
}
