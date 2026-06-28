import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SPLIT_GLYPH_PATH,
  COMBINE_GLYPH_PATH,
  transformGlyphFor,
  transformGlyphsFor,
} from './transformGlyph.js'

// ──────────────────────────────────────────────────────────────────────────
// v1.3 L4 — split / combine node glyphs (spec §4).
//
// A `transform: 'split'` or `'combine'` node gets a small, subtle glyph in
// FlowGraph so author and audience can see which nodes transform particle
// size. Split and combine get DISTINCT glyphs; a plain ('none' / unset) node
// gets none. The glyph geometry is a pure helper (FlowGraph.vue renders the
// returned path) so it is unit-testable without an SFC compiler.
// ──────────────────────────────────────────────────────────────────────────

test('a split node gets the split glyph', () => {
  const g = transformGlyphFor({ id: 'n1', x: 100, y: 200, transform: 'split' })
  assert.ok(g, 'expected a glyph for a split node')
  assert.equal(g.kind, 'split')
  assert.equal(g.d, SPLIT_GLYPH_PATH)
})

test('a combine node gets the combine glyph', () => {
  const g = transformGlyphFor({ id: 'n2', x: 300, y: 400, transform: 'combine' })
  assert.ok(g, 'expected a glyph for a combine node')
  assert.equal(g.kind, 'combine')
  assert.equal(g.d, COMBINE_GLYPH_PATH)
})

test('split and combine glyphs are distinct', () => {
  assert.notEqual(SPLIT_GLYPH_PATH, COMBINE_GLYPH_PATH)
})

test('a plain node gets no glyph', () => {
  assert.equal(transformGlyphFor({ id: 'n3', x: 0, y: 0, transform: 'none' }), null)
  assert.equal(transformGlyphFor({ id: 'n4', x: 0, y: 0 }), null)
})

test('a null / undefined node gets no glyph', () => {
  assert.equal(transformGlyphFor(null), null)
  assert.equal(transformGlyphFor(undefined), null)
})

test('the glyph carries the node id and position for placement', () => {
  const g = transformGlyphFor({ id: 'decompose', x: 700, y: 450, transform: 'split' })
  assert.equal(g.id, 'decompose')
  assert.equal(g.x, 700)
  assert.equal(g.y, 450)
})

test('transformGlyphsFor returns one glyph per transform node, in node order', () => {
  const flow = {
    nodes: [
      { id: 'src', x: 0, y: 0, transform: 'none' },
      { id: 'sp', x: 100, y: 0, transform: 'split' },
      { id: 'mid', x: 200, y: 0 },
      { id: 'cm', x: 300, y: 0, transform: 'combine' },
    ],
  }
  const glyphs = transformGlyphsFor(flow)
  assert.equal(glyphs.length, 2)
  assert.deepEqual(glyphs.map(g => g.id), ['sp', 'cm'])
  assert.deepEqual(glyphs.map(g => g.kind), ['split', 'combine'])
})

test('transformGlyphsFor tolerates a missing / empty flow', () => {
  assert.deepEqual(transformGlyphsFor(null), [])
  assert.deepEqual(transformGlyphsFor({}), [])
  assert.deepEqual(transformGlyphsFor({ nodes: [] }), [])
})
