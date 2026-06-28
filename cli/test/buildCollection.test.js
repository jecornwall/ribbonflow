// flow/cli/test/buildCollection.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCollection } from '../src/buildCollection.js'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

test('buildCollection: keyed map carries every VALID flow', async () => {
  const { flows } = await buildCollection(FIXTURES)
  assert.deepEqual(
    Object.keys(flows).sort(),
    ['current-single', 'nested/deep/inner', 'set-pair', 'v1-legacy'],
  )
})

test('buildCollection: a v1 flow is migrated to current AND normalized', async () => {
  const { flows } = await buildCollection(FIXTURES)
  const entry = flows['v1-legacy']
  assert.ok(entry, 'v1 flow present')
  assert.equal(entry.isSet, false)
  const flow = entry.flow
  // migration: the v1 entryId wrapper is gone, the entry node became a source
  assert.equal(flow.entryId, undefined, 'v1 entryId removed by migration')
  const start = flow.nodes.find((n) => n.id === 'start')
  assert.equal(start.kind, 'source', 'v1 entry node promoted to a source')
  // migration: the retired constraint type is converted to a normal node
  const work = flow.nodes.find((n) => n.id === 'work')
  assert.equal(work.kind, 'normal', 'constraint kind dropped')
  // migration mapped the v1 `latency` onto the v3 authored `length`
  assert.equal(start.length, 0.8, 'v1 latency → v3 length (start)')
  assert.equal(work.length, 1.4, 'v1 latency → v3 length (work)')
  // normalization: defaults filled, engine fields derived
  for (const node of flow.nodes) {
    assert.equal(typeof node.length, 'number', `${node.id} has length`)
    assert.equal(typeof node.width, 'number', `${node.id} has width`)
    assert.equal(typeof node.colorScheme, 'string', `${node.id} has colorScheme`)
    assert.equal(node.transform, 'none', `${node.id} carries the v5 transform default`)
  }
  // title falls back to a humanized key when the flow carries none
  assert.equal(typeof entry.title, 'string')
  assert.ok(entry.title.length > 0)
})

test('buildCollection: a current single flow keeps its own title', async () => {
  const { flows } = await buildCollection(FIXTURES)
  const entry = flows['current-single']
  assert.equal(entry.isSet, false)
  assert.equal(entry.title, 'Intake to Ship', 'flow.title used when present')
})

test('buildCollection: a flow-set is deserialized + normalized', async () => {
  const { flows } = await buildCollection(FIXTURES)
  const entry = flows['set-pair']
  assert.ok(entry, 'flow-set present')
  assert.equal(entry.isSet, true)
  assert.equal(entry.title, 'Before and After', 'flow-set title used')
  assert.equal(entry.flow.states.length, 2, 'both states retained')
  // each state flow is normalized (transition defaults + per-flow normalize)
  assert.ok(entry.flow.transition, 'transition present')
  for (const state of entry.flow.states) {
    for (const node of state.flow.nodes) {
      assert.equal(typeof node.length, 'number')
      assert.equal(node.transform, 'none')
    }
  }
})

test('buildCollection: an invalid flow is recorded in errors and SKIPPED — never throws', async () => {
  const result = await buildCollection(FIXTURES)
  assert.ok(Array.isArray(result.errors))
  const err = result.errors.find((e) => e.key === 'invalid-dangling')
  assert.ok(err, 'the invalid flow is recorded as an error')
  assert.equal(typeof err.message, 'string')
  assert.ok(err.message.length > 0, 'error carries a message')
  // and it does NOT appear in the valid flows map
  assert.equal(result.flows['invalid-dangling'], undefined)
})
