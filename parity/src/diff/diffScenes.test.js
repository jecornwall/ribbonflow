// flow/parity/src/diff/diffScenes.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffScenes } from './diffScenes.js'

const scene = (viewBox, byTag) => ({ viewBox, byTag })

test('diffScenes: identical scenes are ok with no missing/extra', () => {
  const a = scene('0 0 100 100', { path: ['d=M0 0|fill=#a'], circle: ['cx=1|cy=1'] })
  const r = diffScenes(a, scene('0 0 100 100', { path: ['d=M0 0|fill=#a'], circle: ['cx=1|cy=1'] }))
  assert.equal(r.ok, true)
  assert.equal(r.viewBoxMatch, true)
  assert.equal(r.perTag.path.missing.length, 0)
  assert.equal(r.perTag.path.extra.length, 0)
  assert.equal(r.perTag.path.matched, 1)
})

test('diffScenes: order-independent (legend z-order deviation) — still ok', () => {
  const g = scene('0 0 10 10', { polygon: ['A', 'B'], path: ['P'] })
  const c = scene('0 0 10 10', { path: ['P'], polygon: ['B', 'A'] })
  assert.equal(diffScenes(g, c).ok, true)
})

test('diffScenes: a shape in golden but not candidate → missing, not ok', () => {
  const g = scene('0 0 10 10', { circle: ['disc1', 'disc2'] })
  const c = scene('0 0 10 10', { circle: ['disc1'] })
  const r = diffScenes(g, c)
  assert.equal(r.ok, false)
  assert.deepEqual(r.perTag.circle.missing, ['disc2'])
  assert.deepEqual(r.perTag.circle.extra, [])
})

test('diffScenes: a shape in candidate but not golden → extra, not ok', () => {
  const g = scene('0 0 10 10', { line: ['L1'] })
  const c = scene('0 0 10 10', { line: ['L1', 'L2'] })
  const r = diffScenes(g, c)
  assert.equal(r.ok, false)
  assert.deepEqual(r.perTag.line.extra, ['L2'])
})

test('diffScenes: multiset — duplicate counts matter', () => {
  const g = scene('0 0 10 10', { line: ['L', 'L'] })
  const c = scene('0 0 10 10', { line: ['L'] })
  const r = diffScenes(g, c)
  assert.deepEqual(r.perTag.line.missing, ['L'])
  assert.equal(r.ok, false)
})

test('diffScenes: a tag present on only one side surfaces as missing/extra', () => {
  const g = scene('0 0 10 10', { text: ['hello'] })
  const c = scene('0 0 10 10', {})
  const r = diffScenes(g, c)
  assert.deepEqual(r.perTag.text.missing, ['hello'])
  assert.equal(r.ok, false)
})

test('diffScenes: viewBox mismatch fails the gate', () => {
  const r = diffScenes(scene('0 0 1600 900', { path: ['P'] }), scene('0 0 1280 720', { path: ['P'] }))
  assert.equal(r.viewBoxMatch, false)
  assert.equal(r.ok, false)
  assert.equal(r.goldenViewBox, '0 0 1600 900')
  assert.equal(r.candidateViewBox, '0 0 1280 720')
})
