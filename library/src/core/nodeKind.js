/**
 * nodeKind.js — node-semantics helpers shared by the renderer and designer.
 *
 * The "is this stage a constraint?" question has two valid encodings in the
 * flow format because the format evolved:
 *
 *   - Legacy v2: a dedicated `kind: 'constraint'` node type.
 *   - v3+ (current): the `constraint` type was removed (see format/model.js
 *     §516 — the v3 migration rejects `kind:'constraint'`). A constraint stage
 *     is now encoded as a narrow `width` + `colorScheme: 'red'`, the firebrick
 *     ribbon scheme (RIBBON_SCHEME_COLORS.red = CONSTRAINT_INK).
 *
 * `isConstraintNode` collapses both encodings into one predicate so callers
 * (FlowGraph label colouring, legend derivation, the designer inspector) all
 * agree on what reads as a constraint.
 *
 * bd ai-engineer-j5cq: restores the firebrick accent on constraint-stage
 * labels — post-M5 FlowGraph keyed the label colour off `kind === 'constraint'`
 * alone, so every v3+ constraint label fell back to plain grey.
 */

/**
 * True when `node` is a constraint stage under either format encoding.
 * Defensive against null / undefined / partial node objects.
 *
 * @param {object|null|undefined} node — a flow node
 * @returns {boolean}
 */
export function isConstraintNode(node) {
  if (!node) return false
  return node.kind === 'constraint' || node.colorScheme === 'red'
}
