/**
 * labelLayout.test.js — headless unit tests for the label collision-avoidance
 * resolver (src/lib/labelLayout.js).
 *
 * The resolver is pure geometry: given the designer's nodes (each with an
 * x/y anchor and a labelDx/labelDy offset), it finds labels whose text boxes
 * overlap and nudges the lower-priority ones away from their node along the
 * label axis until they clear. useFlowDoc.tidyLabels() applies the result
 * through the existing moveLabel mutation. See bd ai-engineer-fu5s (M3-polish).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  labelBBox,
  bboxesOverlap,
  resolveLabelCollisions,
} from '../src/lib/labelLayout.js'

test('labelBBox centres the box on the node + label offset', () => {
  const bb = labelBBox(
    { x: 100, y: 200, labelDx: 0, labelDy: -70, label: 'ab' },
    { charWidth: 10, labelHeight: 30 },
  )
  // text 'ab' → width 20; centre at (100, 130).
  assert.equal(bb.x0, 90)
  assert.equal(bb.x1, 110)
  assert.equal(bb.y0, 115)
  assert.equal(bb.y1, 145)
})

test('labelBBox gives an empty label a minimum width, not zero', () => {
  const bb = labelBBox({ x: 0, y: 0, label: '' }, { charWidth: 10 })
  assert.ok(bb.x1 - bb.x0 > 0, 'an empty label still has a non-zero box')
})

test('bboxesOverlap detects an intersection and a clean gap', () => {
  const a = { x0: 0, x1: 10, y0: 0, y1: 10 }
  const b = { x0: 5, x1: 15, y0: 5, y1: 15 }
  const c = { x0: 100, x1: 110, y0: 100, y1: 110 }
  assert.equal(bboxesOverlap(a, b), true)
  assert.equal(bboxesOverlap(a, c), false)
})

test('non-overlapping labels are left untouched', () => {
  const nodes = [
    { id: 'n1', x: 0, y: 0, labelDx: 0, labelDy: -70, label: 'one' },
    { id: 'n2', x: 500, y: 0, labelDx: 0, labelDy: -70, label: 'two' },
  ]
  const moves = resolveLabelCollisions(nodes)
  assert.deepEqual(moves, {})
})

test('two overlapping labels are separated — the resolver returns a move', () => {
  // Both nodes sit at the same anchor with the same label offset, so their
  // label boxes coincide exactly.
  const nodes = [
    { id: 'n1', x: 100, y: 200, labelDx: 0, labelDy: -70, label: 'review' },
    { id: 'n2', x: 100, y: 200, labelDx: 0, labelDy: -70, label: 'review' },
  ]
  const moves = resolveLabelCollisions(nodes)
  assert.equal(Object.keys(moves).length, 1, 'exactly one label is nudged')
})

test('after resolution no two label boxes overlap', () => {
  const nodes = [
    { id: 'a', x: 100, y: 300, labelDx: 0, labelDy: -70, label: 'discovery' },
    { id: 'b', x: 110, y: 300, labelDx: 0, labelDy: -70, label: 'triage' },
    { id: 'c', x: 120, y: 300, labelDx: 0, labelDy: -70, label: 'architecture' },
  ]
  const moves = resolveLabelCollisions(nodes)
  // Apply the moves, then assert every pair clears.
  const resolved = nodes.map((n) =>
    moves[n.id] ? { ...n, ...moves[n.id] } : n,
  )
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const bi = labelBBox(resolved[i])
      const bj = labelBBox(resolved[j])
      assert.equal(
        bboxesOverlap(bi, bj),
        false,
        `${resolved[i].id} and ${resolved[j].id} still overlap after tidy`,
      )
    }
  }
})

test('an above-label is nudged further UP, a below-label further DOWN', () => {
  // n1 keeps its place; n2 collides and must move away from its node.
  const above = [
    { id: 'n1', x: 100, y: 200, labelDx: 0, labelDy: -60, label: 'aaaa' },
    { id: 'n2', x: 100, y: 200, labelDx: 0, labelDy: -60, label: 'aaaa' },
  ]
  const aMoves = resolveLabelCollisions(above)
  const aMoved = Object.values(aMoves)[0]
  assert.ok(aMoved.labelDy < -60, 'above-label moves further up (more negative)')

  const below = [
    { id: 'n1', x: 100, y: 200, labelDx: 0, labelDy: 60, label: 'aaaa' },
    { id: 'n2', x: 100, y: 200, labelDx: 0, labelDy: 60, label: 'aaaa' },
  ]
  const bMoves = resolveLabelCollisions(below)
  const bMoved = Object.values(bMoves)[0]
  assert.ok(bMoved.labelDy > 60, 'below-label moves further down (more positive)')
})

test('resolution is idempotent — a second pass finds nothing to move', () => {
  const nodes = [
    { id: 'a', x: 100, y: 300, labelDx: 0, labelDy: -70, label: 'discovery' },
    { id: 'b', x: 110, y: 300, labelDx: 0, labelDy: -70, label: 'triage' },
    { id: 'c', x: 120, y: 300, labelDx: 0, labelDy: -70, label: 'review' },
  ]
  const moves = resolveLabelCollisions(nodes)
  const resolved = nodes.map((n) =>
    moves[n.id] ? { ...n, ...moves[n.id] } : n,
  )
  const second = resolveLabelCollisions(resolved)
  assert.deepEqual(second, {}, 'a tidied flow has nothing left to tidy')
})

test('an empty or single-node flow yields no moves', () => {
  assert.deepEqual(resolveLabelCollisions([]), {})
  assert.deepEqual(
    resolveLabelCollisions([{ id: 'solo', x: 0, y: 0, label: 'x' }]),
    {},
  )
})
