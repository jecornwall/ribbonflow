/**
 * transformGlyph.js — pure glyph geometry for split / combine nodes
 * (v1.3 L4, spec §4).
 *
 * A node with `transform: 'split'` turns one large particle into N small
 * ones; `transform: 'combine'` accumulates N small particles and fires one
 * large. FlowGraph draws a small, subtle glyph on each transform node so the
 * author (and the audience) can see which nodes transform without opening the
 * inspector.
 *
 * The glyphs are deliberately minimal — a single hairline path in the deck's
 * ink colour, matching the restraint of the existing node chrome (segment
 * dividers, stage-anchor notches). Flow runs left→right, so:
 *
 *   - SPLIT: one stem entering from the left forks into two diverging strokes
 *     to the right — literally "one becomes many".
 *   - COMBINE: two strokes entering from the left converge into one stem to
 *     the right — "many become one".
 *
 * Paths are in glyph-LOCAL coordinates (origin = node anchor); FlowGraph
 * translates each path to its node's (x, y). Pure module — no SFC compiler in
 * the library test runner — so the geometry is unit-testable (R3 precedent).
 */

// Glyph stroke register — matches the deck ink; hairline weight, round joins.
export const TRANSFORM_GLYPH_STROKE = '#15171A'
export const TRANSFORM_GLYPH_STROKE_WIDTH = 1.6
// Subtle: the glyph is node chrome, not an emphasis mark. Kept just visible.
export const TRANSFORM_GLYPH_OPACITY = 0.8

// Split: a fork. One stem in from the left (−8→−1) splitting into two strokes
// diverging up-right and down-right. Reads "1 → N".
export const SPLIT_GLYPH_PATH = 'M-8 0 L-1 0 M-1 0 L8 -6 M-1 0 L8 6'

// Combine: a merge — the split fork mirrored. Two strokes in from the left
// converging to one stem out to the right. Reads "N → 1".
export const COMBINE_GLYPH_PATH = 'M-8 -6 L1 0 M-8 6 L1 0 M1 0 L8 0'

const GLYPH_PATHS = {
  split: SPLIT_GLYPH_PATH,
  combine: COMBINE_GLYPH_PATH,
}

/**
 * Glyph descriptor for one node, or null if the node does not transform.
 *
 * @param {{id?: string, x?: number, y?: number, transform?: string}|null|undefined} node
 * @returns {{id: string, kind: 'split'|'combine', d: string, x: number, y: number}|null}
 */
export function transformGlyphFor(node) {
  if (!node) return null
  const kind = node.transform
  const d = GLYPH_PATHS[kind]
  if (!d) return null
  return { id: node.id, kind, d, x: node.x, y: node.y }
}

/**
 * Glyph descriptors for every transform node in a flow, in node order.
 * Tolerates a missing / empty flow (transient designer state).
 *
 * @param {{nodes?: Array}|null|undefined} flow
 * @returns {Array<{id: string, kind: string, d: string, x: number, y: number}>}
 */
export function transformGlyphsFor(flow) {
  if (!flow || !Array.isArray(flow.nodes)) return []
  return flow.nodes.map(transformGlyphFor).filter(Boolean)
}
