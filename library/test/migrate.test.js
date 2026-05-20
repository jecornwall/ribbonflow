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
 *   `constraint` type dropped, latency/pinch-register removed. `capacity` is
 *   PRESERVED (bd ai-engineer-v9mj) — v3 re-admitted it as an optional
 *   authored node field, so it now forward-ports losslessly.
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
import { speedFromWidth, DEFAULT_NODE_SPEED } from '../src/format/model.js'

import n4FlowV1 from './fixtures/flows/n4-toc-baseline.js'
import n9FlowV1 from './fixtures/flows/n9-multilane.v1.js'
import m2FlowV2 from './fixtures/flows/m2-coverage.v2.js'
import m3FlowV3 from './fixtures/flows/m3-coverage.v3.js'
import v12FlowV4 from './fixtures/flows/v12-rejections.v4.js'

test('FLOW_FORMAT_VERSION is 5 after v1.3 L2', () => {
  assert.equal(FLOW_FORMAT_VERSION, 5)
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
    // bd ai-engineer-gmj7: a migrated constraint is deliberately decoupled
    // (its narrow width must not throttle speed); every other node keeps the
    // default Speed⇄Width coupling. n4's constraint is `implementation`.
    assert.equal(n.coupleSpeedWidth, n.id !== 'implementation')
    // capacity is preserved (v9mj) — every v1 n4 node authored one.
    assert.equal(typeof n.capacity, 'number', `${n.id} preserved capacity`)
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
  // bd ai-engineer-gmj7: a migrated constraint's speed is NOT coupled to its
  // narrow width — speedFromWidth(22)=0.4 would silently throttle throughput
  // 2.5× vs the deck original (no speed field → engine default 1.0).
  assert.equal(review.speed, DEFAULT_NODE_SPEED, 'constraint speed stays at engine default')
  assert.equal(review.coupleSpeedWidth, false, 'constraint Speed⇄Width decoupled')
  assert.equal(review.colorScheme, 'red', 'constraint node → red colour scheme')
})

test('v2→v3: a non-constraint node keeps the Speed⇄Width coupling', () => {
  const v3 = migrateFlow(m2FlowV2, 2)
  const laneSlow = v3.nodes.find(n => n.id === 'lane-slow')
  assert.equal(laneSlow.width, 30, 'explicit v2 width kept')
  assert.equal(laneSlow.speed, speedFromWidth(30), 'non-constraint speed ← coupled width')
  assert.equal(laneSlow.coupleSpeedWidth, true, 'non-constraint stays coupled')
})

test('v1→v3: a migrated narrow constraint keeps engine-default speed (bd gmj7)', () => {
  // n4's `implementation` constraint authors no width, so it migrates to the
  // narrow MIGRATED_CONSTRAINT_WIDTH (30). Coupling speed to that width gives
  // 0.4 — a 2.5× throttle the deck never had. Migration must leave it at 1.0.
  const v3 = migrateFlow(n4FlowV1, 1)
  const constraint = v3.nodes.find(n => n.id === 'implementation')
  assert.equal(constraint.width, 30, 'constraint migrated to the narrow width')
  assert.equal(constraint.speed, DEFAULT_NODE_SPEED,
    'speed NOT coupled to the narrow width — deck throughput preserved')
  assert.equal(constraint.coupleSpeedWidth, false, 'constraint Speed⇄Width decoupled')
})

test('v2→v3 drops the constraint type but preserves authored capacity', () => {
  const v3 = migrateFlow(m2FlowV2, 2)
  for (const n of v3.nodes) {
    assert.notEqual(n.kind, 'constraint')
    assert.equal(n.latency, undefined)
    assert.equal(n.constraintKind, undefined)
  }
  // capacity is PRESERVED (bd ai-engineer-v9mj): every m2-coverage node
  // authored one, and v3 re-admitted capacity as an optional node field.
  for (const n of v3.nodes) {
    assert.equal(typeof n.capacity, 'number', `${n.id} preserved capacity`)
  }
  // a non-constraint v2 node migrates to the neutral colour scheme
  const ship = v3.nodes.find(n => n.id === 'ship')
  assert.equal(ship.colorScheme, 'neutral')
})

test('v1→v3 preserves the constraint capacity:1 (crisp-queue override)', () => {
  // bd ai-engineer-v9mj: the deck's crisp queue-at-the-bottleneck optic comes
  // from a hard capacity:1 constraint. Migration must carry that authored
  // value forward, not drop it.
  const v3 = migrateFlow(n4FlowV1, 1)
  const constraint = v3.nodes.find(n => n.id === 'implementation')
  assert.equal(constraint.capacity, 1, 'constraint capacity:1 survives migration')
  const reservoir = v3.nodes.find(n => n.id === 'solution-design')
  assert.equal(reservoir.capacity, 30, 'reservoir capacity survives migration')
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

// ── v3 → v4 (the v1.2 rejection-edges step, bd ai-engineer-086t / R1) ─────────
// v3→v4 adds `flow.rejections = []` if absent. No other field changes — every
// v3 flow migrates cleanly. See flow-v1.2-rejection-edges-design.md §6.

test('v3→v4 adds an empty rejections[] array to a v3 flow', () => {
  const v4 = migrateFlow(m3FlowV3, 3)
  assert.ok(Array.isArray(v4.rejections), 'rejections is an array')
  assert.deepEqual(v4.rejections, [], 'rejections starts empty')
})

test('v3→…→v5 changes only rejections / particleSize / transform on a v3 flow', () => {
  // migrateFlow always runs the whole chain to LATEST_MIGRATED_VERSION, so a v3
  // input now lands at v5. Strip the fields the v3→v4 and v4→v5 steps add
  // (rejections[]; per-node transform; per-source particleSize); the rest must
  // be byte-identical to the v3 input.
  const v5 = migrateFlow(m3FlowV3, 3)
  const { rejections, ...rest } = v5
  const stripped = {
    ...rest,
    nodes: rest.nodes.map(({ particleSize, transform, ...n }) => n),
  }
  assert.deepEqual(stripped, m3FlowV3)
})

test('v3→v4 preserves an already-present rejections[] array untouched', () => {
  const withRejections = {
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }],
    rejections: [{ from: 'b', to: 'a', rate: 0.2, bow: { side: 'below', depth: 80 } }],
  }
  const v4 = migrateFlow(withRejections, 3)
  assert.deepEqual(v4.rejections, withRejections.rejections)
})

test('migrateFlow lifts a v1 flow all the way forward to v4 (rejections added)', () => {
  const v4 = migrateFlow(n4FlowV1, 1)
  assert.ok(Array.isArray(v4.rejections), 'v1→…→v4 chain ends with rejections[]')
})

test('deserializeFlow migrates a v3 envelope to v4', () => {
  const v3Envelope = JSON.stringify({ formatVersion: 3, flow: m3FlowV3 })
  const flow = deserializeFlow(v3Envelope)
  assert.ok(Array.isArray(flow.rejections), 'v3 envelope gains rejections[] on load')
})

// ── v4 → v5 (the v1.3 L2 large-particles step, bd ai-engineer-otci) ──────────
// v4→v5 gives every source `particleSize: 'small'` and every node
// `transform: 'none'`. No other field changes — every v4 flow migrates
// cleanly. See flow-v1.3-large-particles-design.md §6.

test('v4→v5 gives every source particleSize:small', () => {
  const v5 = migrateFlow(v12FlowV4, 4)
  for (const n of v5.nodes.filter(n => n.kind === 'source')) {
    assert.equal(n.particleSize, 'small', `${n.id} source defaults to small`)
  }
})

test('v4→v5 gives every node transform:none', () => {
  const v5 = migrateFlow(v12FlowV4, 4)
  for (const n of v5.nodes) {
    assert.equal(n.transform, 'none', `${n.id} defaults to transform none`)
  }
})

test('v4→v5 changes no field other than particleSize / transform', () => {
  const v5 = migrateFlow(v12FlowV4, 4)
  // Strip the two added node fields; the rest must be byte-identical to v4.
  const stripped = {
    ...v5,
    nodes: v5.nodes.map(({ particleSize, transform, ...rest }) => rest),
  }
  assert.deepEqual(stripped, v12FlowV4)
})

test('v4→v5 adds no splitCount / combineCount (a v4 flow has no transform nodes)', () => {
  const v5 = migrateFlow(v12FlowV4, 4)
  for (const n of v5.nodes) {
    assert.equal(n.splitCount, undefined, `${n.id} gains no splitCount`)
    assert.equal(n.combineCount, undefined, `${n.id} gains no combineCount`)
  }
})

test('v4→v5 preserves an already-present particleSize / transform untouched', () => {
  const authored = {
    nodes: [
      { id: 'a', x: 0, y: 0, kind: 'source', particleSize: 'large' },
      { id: 'b', x: 1, y: 0, transform: 'split', splitCount: 6 },
    ],
  }
  const v5 = migrateFlow(authored, 4)
  assert.equal(v5.nodes[0].particleSize, 'large')
  assert.equal(v5.nodes[1].transform, 'split')
  assert.equal(v5.nodes[1].splitCount, 6)
})

test('migrateFlow lifts a v1 flow all the way forward to v5', () => {
  const v5 = migrateFlow(n4FlowV1, 1)
  assert.ok(Array.isArray(v5.rejections), 'v1→…→v5 chain still adds rejections[]')
  for (const n of v5.nodes) {
    assert.equal(n.transform, 'none', `${n.id} has transform after the full chain`)
  }
})

test('deserializeFlow migrates a v4 envelope to v5', () => {
  const v4Envelope = JSON.stringify({ formatVersion: 4, flow: v12FlowV4 })
  const flow = deserializeFlow(v4Envelope)
  assert.equal(flow.nodes.find(n => n.id === 'intake').particleSize, 'small')
  for (const n of flow.nodes) assert.equal(n.transform, 'none')
})

// ── invariants ───────────────────────────────────────────────────────────────

test('migrateFlow does not mutate the input flow', () => {
  const before = JSON.stringify(n4FlowV1)
  migrateFlow(n4FlowV1, 1)
  assert.equal(JSON.stringify(n4FlowV1), before)
  const beforeV2 = JSON.stringify(m2FlowV2)
  migrateFlow(m2FlowV2, 2)
  assert.equal(JSON.stringify(m2FlowV2), beforeV2)
  const beforeV4 = JSON.stringify(v12FlowV4)
  migrateFlow(v12FlowV4, 4)
  assert.equal(JSON.stringify(v12FlowV4), beforeV4)
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
