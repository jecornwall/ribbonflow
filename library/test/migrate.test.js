/**
 * migrate.test.js — flow-format version migration (M2, bd ai-engineer-8aee).
 *
 * Written test-first. M2 bumps the flow format to version 2 (real multi-source
 * nodes, first-class forks). Any v1 export must load forward losslessly: a v1
 * envelope handed to deserializeFlow() is migrated to v2, and the migrated
 * result itself round-trips.
 *
 * v1→v2 migration (see docs/superpowers/specs/2026-05-20-flow-M2-design.md §4):
 *   1. entryId node → kind:'source', rate = spawnRate ?? 1.0
 *   2. delete top-level entryId / spawnRate
 *   3. forks[].branches: string[] → {to, rateShare}[]
 *   4. merges[].branches → merges[].from
 *   5. widthMode: 'manual'
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FLOW_FORMAT_VERSION,
  serializeFlow,
  deserializeFlow,
} from '../src/format/index.js'
import { migrateFlow } from '../src/format/migrate.js'

import n4FlowV1 from './fixtures/flows/n4-toc-baseline.js'
import n9FlowV1 from './fixtures/flows/n9-multilane.js'

test('FLOW_FORMAT_VERSION is 2 after M2', () => {
  assert.equal(FLOW_FORMAT_VERSION, 2)
})

test('migrateFlow lifts a v1 linear flow (n4) to v2', () => {
  const v2 = migrateFlow(n4FlowV1, 1)
  // top-level entry fields are removed
  assert.equal(v2.entryId, undefined)
  assert.equal(v2.spawnRate, undefined)
  // the old entry node is now a real source carrying the spawn rate
  const src = v2.nodes.find(n => n.id === 'problem-definition')
  assert.equal(src.kind, 'source')
  assert.equal(src.rate, 1.0) // n4 spawnRate
  // width behaviour preserved conservatively
  assert.equal(v2.widthMode, 'manual')
})

test('migrateFlow lifts a v1 multi-lane flow (n9) to v2', () => {
  const v2 = migrateFlow(n9FlowV1, 1)
  assert.equal(v2.entryId, undefined)
  assert.equal(v2.spawnRate, undefined)
  // the off-canvas _start entry becomes a source node
  const start = v2.nodes.find(n => n.id === '_start')
  assert.equal(start.kind, 'source')
  assert.equal(start.rate, 1.0)
})

test('migrateFlow converts v1 fork branches to {to, rateShare} objects', () => {
  const v2 = migrateFlow(n9FlowV1, 1)
  const fork = v2.forks[0]
  assert.equal(fork.from, '_start')
  assert.equal(fork.branches.length, 3)
  for (const b of fork.branches) {
    assert.equal(typeof b.to, 'string')
    assert.ok(Math.abs(b.rateShare - 1 / 3) < 1e-9, 'even default rateShare')
  }
  assert.deepEqual(fork.branches.map(b => b.to), ['discovery', 'triage', 'architecture'])
})

test('migrateFlow renames merge branches[] to from[]', () => {
  const v2 = migrateFlow(n9FlowV1, 1)
  const merge = v2.merges[0]
  assert.equal(merge.to, 'cross-team-review')
  assert.equal(merge.branches, undefined)
  assert.deepEqual(merge.from, ['build-feature', 'build-bug', 'build-platform'])
})

test('migrateFlow defaults source rate to 1.0 when v1 set no spawnRate', () => {
  const v1 = { entryId: 'a', nodes: [{ id: 'a', x: 0, y: 0, successors: [] }] }
  const v2 = migrateFlow(v1, 1)
  assert.equal(v2.nodes[0].kind, 'source')
  assert.equal(v2.nodes[0].rate, 1.0)
})

test('migrateFlow does not mutate the input flow', () => {
  const before = JSON.stringify(n4FlowV1)
  migrateFlow(n4FlowV1, 1)
  assert.equal(JSON.stringify(n4FlowV1), before)
})

test('deserializeFlow migrates a v1 envelope forward automatically', () => {
  const v1Envelope = JSON.stringify({ formatVersion: 1, flow: n4FlowV1 })
  const flow = deserializeFlow(v1Envelope)
  assert.equal(flow.entryId, undefined)
  assert.equal(flow.nodes.find(n => n.id === 'problem-definition').kind, 'source')
})

test('a migrated v1 flow itself round-trips losslessly as v2', () => {
  const migrated = deserializeFlow(JSON.stringify({ formatVersion: 1, flow: n9FlowV1 }))
  const restored = deserializeFlow(serializeFlow(migrated))
  assert.deepEqual(restored, migrated)
})

test('migrateFlow rejects an unknown source version', () => {
  assert.throws(() => migrateFlow({}, 99), /migrat/i)
})
