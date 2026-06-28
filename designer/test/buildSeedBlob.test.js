import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSeedBlob } from '../src/seed/buildSeedBlob.js'

test('buildSeedBlob shapes sets/flows for the localStorage backend', () => {
  const blob = buildSeedBlob(
    [
      {
        id: 'n4-startup',
        title: 'N4 · startup collapse',
        transition: { durationMs: 900, holdMs: 2400, easing: 'easeInOut' },
        flows: [
          { slug: 'before', title: 'Before', envelope: { formatVersion: 5, flow: { nodes: [] } } },
        ],
      },
    ],
    '2026-06-28T00:00:00.000Z',
  )
  assert.equal(blob.sets.length, 1)
  const s = blob.sets[0]
  assert.equal(s.id, 'n4-startup')
  assert.deepEqual(s.transition, { durationMs: 900, holdMs: 2400, easing: 'easeInOut' })
  assert.equal(s.flows[0].slug, 'before')
  assert.equal(s.flows[0].title, 'Before')
  assert.equal(s.flows[0].updatedAt, '2026-06-28T00:00:00.000Z')
  assert.deepEqual(s.flows[0].envelope, { formatVersion: 5, flow: { nodes: [] } })
})

test('buildSeedBlob omits transition when absent', () => {
  const blob = buildSeedBlob([{ id: 'x', title: 'X', flows: [] }], 't')
  assert.ok(!('transition' in blob.sets[0]))
})
