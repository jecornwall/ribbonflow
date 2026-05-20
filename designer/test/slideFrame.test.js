/**
 * slideFrame.test.js — headless unit tests for the slide-scope geometry
 * (src/lib/slideFrame.js): the slide frame guide (bd ai-engineer-qe6d) and
 * out-of-bounds detection / clamping (bd ai-engineer-oxcq).
 *
 * Pure geometry — no Vue, no library — so it runs directly under `node --test`.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SLIDE_ASPECT,
  DEFAULT_FRAME,
  slideFrame,
  inflateRect,
  viewBoxStr,
  isNodeInBounds,
  outOfBoundsNodeIds,
  clampToFrame,
} from '../src/lib/slideFrame.js'

// ── slideFrame ───────────────────────────────────────────────────────────────

test('slideFrame returns the flow viewBox as the slide-scope rect', () => {
  const f = slideFrame({ viewBox: { x: 0, y: 0, w: 1600, h: 900 } })
  assert.deepEqual(f, { x: 0, y: 0, w: 1600, h: 900 })
})

test('slideFrame defaults x/y to 0 when absent', () => {
  assert.deepEqual(slideFrame({ viewBox: { w: 1920, h: 1080 } }), {
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
  })
})

test('slideFrame falls back to the 16:9 default for a missing / bad viewBox', () => {
  assert.deepEqual(slideFrame({}), DEFAULT_FRAME)
  assert.deepEqual(slideFrame(null), DEFAULT_FRAME)
  assert.deepEqual(slideFrame({ viewBox: { w: 0, h: 0 } }), DEFAULT_FRAME)
  assert.deepEqual(slideFrame({ viewBox: { w: -10, h: 100 } }), DEFAULT_FRAME)
})

test('the default frame matches the deck slide aspect ratio', () => {
  assert.equal(DEFAULT_FRAME.w / DEFAULT_FRAME.h, SLIDE_ASPECT)
})

// ── inflateRect / viewBoxStr ─────────────────────────────────────────────────

test('inflateRect grows the rect by a fraction of its size on every side', () => {
  const r = inflateRect({ x: 0, y: 0, w: 1000, h: 500 }, 0.1)
  assert.deepEqual(r, { x: -100, y: -50, w: 1200, h: 600 })
})

test('viewBoxStr formats a rect as an SVG viewBox string', () => {
  assert.equal(viewBoxStr({ x: -10, y: -5, w: 100, h: 50 }), '-10 -5 100 50')
})

// ── isNodeInBounds ───────────────────────────────────────────────────────────

const FRAME = { x: 0, y: 0, w: 1600, h: 900 }

test('isNodeInBounds: a node well inside the frame is in bounds', () => {
  assert.equal(isNodeInBounds({ x: 800, y: 450 }, FRAME), true)
})

test('isNodeInBounds: a node past the left edge is out of bounds', () => {
  assert.equal(isNodeInBounds({ x: -50, y: 450 }, FRAME), false)
})

test('isNodeInBounds: the radius inset catches a node whose handle pokes past the edge', () => {
  // centre is inside, but a 16-radius handle crosses the right edge
  assert.equal(isNodeInBounds({ x: 1590, y: 450 }, FRAME), true)
  assert.equal(isNodeInBounds({ x: 1590, y: 450 }, FRAME, 16), false)
})

test('isNodeInBounds: a node with a non-finite position is treated as in bounds', () => {
  assert.equal(isNodeInBounds({ x: NaN, y: 10 }, FRAME), true)
})

// ── outOfBoundsNodeIds ───────────────────────────────────────────────────────

test('outOfBoundsNodeIds lists exactly the nodes outside the frame', () => {
  const flow = {
    nodes: [
      { id: 'a', x: 800, y: 450 },
      { id: 'b', x: -100, y: 450 },
      { id: 'c', x: 800, y: 2000 },
    ],
  }
  assert.deepEqual(outOfBoundsNodeIds(flow, FRAME), ['b', 'c'])
})

test('outOfBoundsNodeIds is empty for a flow with no nodes', () => {
  assert.deepEqual(outOfBoundsNodeIds({}, FRAME), [])
})

// ── clampToFrame ─────────────────────────────────────────────────────────────

test('clampToFrame pulls an out-of-bounds point inside the frame', () => {
  assert.deepEqual(clampToFrame(-200, 450, FRAME), { x: 0, y: 450 })
  assert.deepEqual(clampToFrame(800, 5000, FRAME), { x: 800, y: 900 })
})

test('clampToFrame leaves an in-bounds point untouched', () => {
  assert.deepEqual(clampToFrame(800, 450, FRAME), { x: 800, y: 450 })
})

test('clampToFrame respects the radius inset so the whole handle lands inside', () => {
  assert.deepEqual(clampToFrame(-200, -200, FRAME, 16), { x: 16, y: 16 })
  assert.deepEqual(clampToFrame(9999, 9999, FRAME, 16), { x: 1584, y: 884 })
})

test('clampToFrame returns integer coordinates', () => {
  const p = clampToFrame(12.7, 33.2, FRAME)
  assert.equal(Number.isInteger(p.x), true)
  assert.equal(Number.isInteger(p.y), true)
})
