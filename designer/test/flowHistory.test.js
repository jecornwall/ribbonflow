/**
 * flowHistory.test.js — headless unit tests for the designer's undo/redo
 * snapshot stack (src/state/flowHistory.js).
 *
 * The history module is deliberately PURE — it stores opaque snapshots and
 * knows nothing of Vue or the flow format. useFlowDoc.js wraps it with
 * cloneFlow snapshots, reactive `canUndo`/`canRedo` flags, and the
 * suppress-on-load guard (see bd ai-engineer-fu5s). These tests cover the
 * stack algebra: record clears redo, the limit ring-buffers, undo/redo walk
 * the timeline, and a fresh edit after an undo forks the future cleanly.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistory } from '../src/state/flowHistory.js'

test('a fresh history has nothing to undo or redo', () => {
  const h = createHistory()
  assert.equal(h.canUndo, false)
  assert.equal(h.canRedo, false)
  assert.equal(h.undo(), null)
  assert.equal(h.redo(), null)
})

test('reset seeds the present without making it undoable', () => {
  const h = createHistory()
  h.reset('A')
  assert.equal(h.present, 'A')
  assert.equal(h.canUndo, false)
  assert.equal(h.canRedo, false)
})

test('record pushes the prior present onto the undo stack', () => {
  const h = createHistory()
  h.reset('A')
  h.record('B')
  assert.equal(h.present, 'B')
  assert.equal(h.canUndo, true)
  assert.equal(h.undoDepth, 1)
})

test('undo walks back to the previous snapshot and enables redo', () => {
  const h = createHistory()
  h.reset('A')
  h.record('B')
  h.record('C')
  assert.equal(h.undo(), 'B')
  assert.equal(h.present, 'B')
  assert.equal(h.canRedo, true)
  assert.equal(h.undo(), 'A')
  assert.equal(h.present, 'A')
  assert.equal(h.canUndo, false)
})

test('redo walks forward again after an undo', () => {
  const h = createHistory()
  h.reset('A')
  h.record('B')
  h.record('C')
  h.undo()
  h.undo()
  assert.equal(h.redo(), 'B')
  assert.equal(h.redo(), 'C')
  assert.equal(h.present, 'C')
  assert.equal(h.canRedo, false)
})

test('a new record after an undo clears the redo stack (forks the future)', () => {
  const h = createHistory()
  h.reset('A')
  h.record('B')
  h.record('C')
  h.undo() // present = B, future = [C]
  assert.equal(h.canRedo, true)
  h.record('D') // new edit from B — C is no longer reachable
  assert.equal(h.canRedo, false)
  assert.equal(h.present, 'D')
  assert.equal(h.undo(), 'B')
})

test('undo at the start of history is a no-op returning null', () => {
  const h = createHistory()
  h.reset('A')
  assert.equal(h.undo(), null)
  assert.equal(h.present, 'A')
})

test('redo past the newest snapshot is a no-op returning null', () => {
  const h = createHistory()
  h.reset('A')
  h.record('B')
  assert.equal(h.redo(), null)
  assert.equal(h.present, 'B')
})

test('the undo stack is bounded by the configured limit', () => {
  const h = createHistory({ limit: 3 })
  h.reset('s0')
  for (let i = 1; i <= 10; i++) h.record(`s${i}`)
  // present = s10; only the 3 most recent priors are retained.
  assert.equal(h.undoDepth, 3)
  assert.equal(h.undo(), 's9')
  assert.equal(h.undo(), 's8')
  assert.equal(h.undo(), 's7')
  assert.equal(h.undo(), null) // s0..s6 fell off the back
})

test('record before any reset still establishes a present', () => {
  const h = createHistory()
  h.record('A')
  assert.equal(h.present, 'A')
  assert.equal(h.canUndo, false)
  h.record('B')
  assert.equal(h.canUndo, true)
  assert.equal(h.undo(), 'A')
})

test('reset clears an existing timeline', () => {
  const h = createHistory()
  h.reset('A')
  h.record('B')
  h.record('C')
  h.undo()
  h.reset('X')
  assert.equal(h.present, 'X')
  assert.equal(h.canUndo, false)
  assert.equal(h.canRedo, false)
})

test('snapshots are stored by reference — the module does not clone', () => {
  // The store layer is responsible for cloning; history stores opaque values.
  const h = createHistory()
  const objA = { v: 1 }
  const objB = { v: 2 }
  h.reset(objA)
  h.record(objB)
  assert.equal(h.undo(), objA)
})
