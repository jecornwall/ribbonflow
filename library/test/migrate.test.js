/**
 * migrate.test.js — flow-format version migration.
 *
 * Written test-first. The format envelope carries a `formatVersion`; any older
 * export must load forward through deserializeFlow().
 *
 * v1→v2 (M2, bd ai-engineer-8aee): real multi-source nodes, first-class forks.
 * v2→v3 (v1.1, beads ai-engineer-t0c8 / wec5 — see
 *   docs/superpowers/specs/2026-05-20-flow-v1.1-node-controls-design.md §4.3):
 *   the Length/Speed/Width node controls, per-node colour scheme, the
 *   `constraint` type dropped, capacity/latency/pinch-register removed.
 *
 * migrateFlow() applies the whole chain — a v1 flow lifts straight to v3.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FLOW_FORMAT_VERSION,
  serializeFlow,
  deserializeFlow,
} from '../src/format/index.js'
import { migrateFlow } from '../src/format/migrate.js'
import { speedFromWidth } from '../src/format/model.js'

import n4FlowV1 from './fixtures/flows/n4-toc-baseline.js'
import n9FlowV1 from './fixtures/flows/n9-multilane.js'
import m2FlowV2 from './fixtures/flows/m2-coverage.v2.js'

test('FLOW_FORMAT_VERSION is 3 after v1.1', () => {
  assert.equal(FLOW_FORMAT_VERSION, 3)
})

// ── v1 → … → v3 (the whole chain) ────────────────────────────────────────────

test('migrateFlow lifts a v1 linear flow (n4) forward to v3', () => {
  const v3 = migrateFlow(n4FlowV1, 1)
  // top-level entry fields removed (v1→v2)
  assert.equal(v3.entryId, undefined)
  assert.equal(v3.spawnRate, undefined)
  // the old entry node is now a real source carrying the spawn rate
  const src = v3.nodes.find(n => n.id === 'problem-definition')
  assert.equal(src.kind, 'source')
  assert.equal(src.rate, 1.0)
  // v2→v3: widthMode and the pinch register are gone
  assert.equal(v3.widthMode, undefined)
  assert.equal(v3.pinchMode, undefined)
  assert.equal(v3.pinchPreset, undefined)
})

test('migrateFlow lifts a v1 multi-lane flow (n9) forward to v3', () => {
  const v3 = migrateFlow(n9FlowV1, 1)
  assert.equal(v3.entryId, undefined)
  const start = v3.nodes.find(n => n.id === '_start')
  assert.equal(start.kind, 'source')
  assert.equal(start.rate, 1.0)
})

test('migrateFlow converts v1 fork branches to {to, rateShare} objects', () => {
  const v3 = migrateFlow(n9FlowV1, 1)
  const fork = v3.forks[0]
  assert.equal(fork.from, '_start')
  assert.equal(fork.branches.length, 3)
  for (const b of fork.branches) {
    assert.equal(typeof b.to, 'string')
    assert.ok(Math.abs(b.rateShare - 1 / 3) < 1e-9, 'even default rateShare')
  }
})

test('migrateFlow renames merge branches[] to from[]', () => {
  const v3 = migrateFlow(n9FlowV1, 1)
  const merge = v3.merges[0]
  assert.equal(merge.to, 'cross-team-review')
  assert.equal(merge.branches, undefined)
  assert.deepEqual(merge.from, ['build-feature', 'build-bug', 'build-platform'])
})

test('every v1-migrated node carries the v3 node controls', () => {
  const v3 = migrateFlow(n4FlowV1, 1)
  for (const n of v3.nodes) {
    assert.equal(typeof n.length, 'number', `${n.id} has length`)
    assert.equal(typeof n.speed, 'number', `${n.id} has speed`)
    assert.equal(typeof n.width, 'number', `${n.id} has width`)
    assert.equal(typeof n.colorScheme, 'string', `${n.id} has colorScheme`)
    assert.equal(n.coupleSpeedWidth, true)
    assert.equal(n.capacity, undefined, `${n.id} dropped capacity`)
    assert.equal(n.latency, undefined, `${n.id} dropped latency`)
    assert.notEqual(n.kind, 'constraint', `${n.id} dropped the constraint type`)
  }
})

// ── v2 → v3 (the node-controls rework) ───────────────────────────────────────

test('v2→v3 maps latency→length and keeps an explicit width', () => {
  const v3 = migrateFlow(m2FlowV2, 2)
  const review = v3.nodes.find(n => n.id === 'review')
  assert.equal(review.length, 2.0, 'length ← v2 latency')
  assert.equal(review.width, 22, 'explicit v2 width kept')
  assert.equal(review.speed, speedFromWidth(22), 'speed ← coupled width')
  assert.equal(review.colorScheme, 'red', 'constraint node → red colour scheme')
})

test('v2→v3 drops the constraint type and the constraint-only fields', () => {
  const v3 = migrateFlow(m2FlowV2, 2)
  for (const n of v3.nodes) {
    assert.notEqual(n.kind, 'constraint')
    assert.equal(n.capacity, undefined)
    assert.equal(n.latency, undefined)
    assert.equal(n.constraintKind, undefined)
  }
  // a non-constraint v2 node migrates to the neutral colour scheme
  const ship = v3.nodes.find(n => n.id === 'ship')
  assert.equal(ship.colorScheme, 'neutral')
})

test('v2→v3 drops widthMode and the whole pinch register', () => {
  const v3 = migrateFlow(m2FlowV2, 2)
  for (const f of [
    'widthMode', 'pinchPreset', 'pinchMode', 'ribbonColor', 'bandWidth',
    'constraintWidth', 'constraintPlateauWidth', 'pinchFillColor',
    'constraintFillColor',
  ]) {
    assert.equal(v3[f], undefined, `flow.${f} removed`)
  }
})

test('v2→v3 preserves first-class forks / merges and source rates', () => {
  const v3 = migrateFlow(m2FlowV2, 2)
  assert.deepEqual(v3.forks, m2FlowV2.forks)
  assert.deepEqual(v3.merges, m2FlowV2.merges)
  const sources = v3.nodes.filter(n => n.kind === 'source')
  assert.deepEqual(sources.map(s => [s.id, s.rate]), [
    ['src-frontend', 0.6], ['src-backend', 0.4],
  ])
})

// ── invariants ───────────────────────────────────────────────────────────────

test('migrateFlow does not mutate the input flow', () => {
  const before = JSON.stringify(n4FlowV1)
  migrateFlow(n4FlowV1, 1)
  assert.equal(JSON.stringify(n4FlowV1), before)
  const beforeV2 = JSON.stringify(m2FlowV2)
  migrateFlow(m2FlowV2, 2)
  assert.equal(JSON.stringify(m2FlowV2), beforeV2)
})

test('deserializeFlow migrates a v1 envelope all the way to v3', () => {
  const v1Envelope = JSON.stringify({ formatVersion: 1, flow: n4FlowV1 })
  const flow = deserializeFlow(v1Envelope)
  assert.equal(flow.entryId, undefined)
  const src = flow.nodes.find(n => n.id === 'problem-definition')
  assert.equal(src.kind, 'source')
  assert.equal(typeof src.length, 'number')
})

test('deserializeFlow migrates a v2 envelope to v3', () => {
  const v2Envelope = JSON.stringify({ formatVersion: 2, flow: m2FlowV2 })
  const flow = deserializeFlow(v2Envelope)
  assert.equal(flow.widthMode, undefined)
  assert.equal(flow.nodes.find(n => n.id === 'review').colorScheme, 'red')
})

test('a migrated flow itself round-trips losslessly as v3', () => {
  const migrated = deserializeFlow(JSON.stringify({ formatVersion: 2, flow: m2FlowV2 }))
  const restored = deserializeFlow(serializeFlow(migrated))
  assert.deepEqual(restored, migrated)
})

test('migrateFlow rejects an unknown source version', () => {
  assert.throws(() => migrateFlow({}, 99), /migrat/i)
})
