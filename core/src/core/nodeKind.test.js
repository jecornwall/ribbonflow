import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isConstraintNode } from './nodeKind.js'

// bd ai-engineer-j5cq — constraint-stage labels must render in the firebrick
// CONSTRAINT_INK accent. Post-M5 the constraint is encoded as colorScheme:'red'
// (the v2 kind:'constraint' type was removed in format v3 — see model.js §516).
// FlowGraph must treat BOTH encodings as a constraint when colouring labels,
// otherwise a v3+ constraint stage renders in plain grey.

test('isConstraintNode — v3+ encoding: colorScheme red is a constraint', () => {
  assert.equal(isConstraintNode({ id: 'implementation', colorScheme: 'red' }), true)
})

test('isConstraintNode — legacy v2 encoding: kind constraint is a constraint', () => {
  assert.equal(isConstraintNode({ id: 'old', kind: 'constraint' }), true)
})

test('isConstraintNode — neutral / green nodes are not constraints', () => {
  assert.equal(isConstraintNode({ id: 'design', kind: 'normal', colorScheme: 'neutral' }), false)
  assert.equal(isConstraintNode({ id: 'fast', kind: 'normal', colorScheme: 'green' }), false)
})

test('isConstraintNode — rose scheme is not a constraint accent', () => {
  // rose is the retained dusty-rose register, NOT the firebrick constraint.
  assert.equal(isConstraintNode({ id: 'r', colorScheme: 'rose' }), false)
})

test('isConstraintNode — source nodes follow the same rule', () => {
  assert.equal(isConstraintNode({ id: 's', kind: 'source', colorScheme: 'neutral' }), false)
  assert.equal(isConstraintNode({ id: 's2', kind: 'source', colorScheme: 'red' }), true)
})

test('isConstraintNode — defensive: null / undefined / missing fields', () => {
  assert.equal(isConstraintNode(null), false)
  assert.equal(isConstraintNode(undefined), false)
  assert.equal(isConstraintNode({}), false)
})
