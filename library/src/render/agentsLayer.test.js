// flow/library/src/render/agentsLayer.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentCircleSpec, reconcileAgents, AGENT_DEFAULT_FILL } from './agentsLayer.js'

test('agentCircleSpec: maps a view row to a circle; null fill → cream default', () => {
  const spec = agentCircleSpec({ id: 7, x: 10, y: 20, r: 3.5, fill: null })
  assert.equal(spec.tag, 'circle')
  assert.deepEqual([spec.attrs.cx, spec.attrs.cy, spec.attrs.r], [10, 20, 3.5])
  assert.equal(spec.attrs.fill, AGENT_DEFAULT_FILL)       // null → cream
  assert.equal(spec.attrs.fill, '#F4F2ED')
  assert.equal(spec.attrs['data-agent-id'], 7)
  assert.equal(spec.attrs.stroke, 'none')
  assert.equal(spec.attrs['shape-rendering'], 'geometricPrecision')
})

test('agentCircleSpec: an explicit fill (revising/defective) is kept', () => {
  const spec = agentCircleSpec({ id: 1, x: 0, y: 0, r: 3.5, fill: '#b5524b' })
  assert.equal(spec.attrs.fill, '#b5524b')
})

test('agentCircleSpec: undefined fill also resolves to the cream default', () => {
  assert.equal(agentCircleSpec({ id: 1, x: 0, y: 0, r: 3.5, fill: undefined }).attrs.fill, AGENT_DEFAULT_FILL)
})

test('reconcileAgents: first frame adds every agent', () => {
  const prev = new Map()
  const next = [{ id: 1, x: 0, y: 0, r: 3.5, fill: null }, { id: 2, x: 5, y: 5, r: 3.5, fill: null }]
  const ops = reconcileAgents(prev, next)
  assert.deepEqual(ops.adds.map((a) => a.id), [1, 2])
  assert.deepEqual(ops.moves, [])
  assert.deepEqual(ops.removes, [])
})

test('reconcileAgents: persisting agents move, gone agents are removed, new ones added', () => {
  const prev = new Map([
    [1, { id: 1, x: 0, y: 0, r: 3.5, fill: null }],
    [2, { id: 2, x: 5, y: 5, r: 3.5, fill: null }],
  ])
  const next = [
    { id: 1, x: 1, y: 1, r: 3.5, fill: null },   // moved
    { id: 3, x: 9, y: 9, r: 3.5, fill: null },   // new
  ]
  const ops = reconcileAgents(prev, next)
  assert.deepEqual(ops.adds.map((a) => a.id), [3])
  assert.deepEqual(ops.moves.map((m) => m.id), [1])
  assert.deepEqual(ops.removes, [2])
})

test('reconcileAgents: a fill change is a move (so colour updates each frame)', () => {
  const prev = new Map([[1, { id: 1, x: 0, y: 0, r: 3.5, fill: null }]])
  const next = [{ id: 1, x: 0, y: 0, r: 3.5, fill: '#b5524b' }]  // became revising
  const ops = reconcileAgents(prev, next)
  assert.deepEqual(ops.moves.map((m) => m.id), [1])
})

test('reconcileAgents: an unchanged agent is in no bucket', () => {
  const a = { id: 1, x: 0, y: 0, r: 3.5, fill: null }
  const ops = reconcileAgents(new Map([[1, { ...a }]]), [{ ...a }])
  assert.deepEqual(ops, { adds: [], moves: [], removes: [] })
})

test('reconcileAgents: a y-only or r-only change is a move', () => {
  const base = { id: 1, x: 0, y: 0, r: 3.5, fill: null }
  const yMove = reconcileAgents(new Map([[1, { ...base }]]), [{ ...base, y: 7 }])
  assert.deepEqual(yMove.moves.map((m) => m.id), [1])
  const rMove = reconcileAgents(new Map([[1, { ...base }]]), [{ ...base, r: 10.5 }])
  assert.deepEqual(rMove.moves.map((m) => m.id), [1])
})
