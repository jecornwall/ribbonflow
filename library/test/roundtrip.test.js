/**
 * roundtrip.test.js — the flow-format round-trip invariant (M1, bd ai-engineer-lla7).
 *
 * Written test-first. The hard invariant from the project charter:
 *
 *   "Round-trippable (export then re-import is lossless, so reload-to-edit works)."
 *
 * The library's serialization layer owns the flow format. A flow exported
 * by serializeFlow() and re-imported by deserializeFlow() must be value-equal
 * to the original — every field the designer can set survives the cycle.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FLOW_FORMAT_VERSION,
  serializeFlow,
  deserializeFlow,
  cloneFlow,
} from '../src/format/index.js'

import n4Flow from './fixtures/flows/n4-toc-baseline.js'
import n9Flow from './fixtures/flows/n9-multilane.js'
import m2Flow from './fixtures/flows/m2-coverage.v2.js'
import m3Flow from './fixtures/flows/m3-coverage.v3.js'
import v12Flow from './fixtures/flows/v12-rejections.v4.js'

test('FLOW_FORMAT_VERSION is a positive integer', () => {
  assert.equal(typeof FLOW_FORMAT_VERSION, 'number')
  assert.ok(Number.isInteger(FLOW_FORMAT_VERSION))
  assert.ok(FLOW_FORMAT_VERSION >= 1)
})

test('serializeFlow produces a string', () => {
  assert.equal(typeof serializeFlow(n4Flow), 'string')
})

test('serializeFlow output is valid JSON carrying a format envelope', () => {
  const parsed = JSON.parse(serializeFlow(n4Flow))
  assert.equal(parsed.formatVersion, FLOW_FORMAT_VERSION)
  assert.ok(parsed.flow, 'envelope carries a flow payload')
})

test('round-trip is lossless for the N4 baseline flow', () => {
  const restored = deserializeFlow(serializeFlow(n4Flow))
  assert.deepEqual(restored, n4Flow)
})

test('round-trip is lossless for the N9 multi-lane flow (3 real sources, merge)', () => {
  const restored = deserializeFlow(serializeFlow(n9Flow))
  assert.deepEqual(restored, n9Flow)
})

test('round-trip is idempotent — serialize is byte-stable across cycles', () => {
  const once = serializeFlow(n4Flow)
  const twice = serializeFlow(deserializeFlow(once))
  assert.equal(once, twice)
})

test('round-trip preserves every node field a designer can set', () => {
  const restored = deserializeFlow(serializeFlow(n4Flow))
  for (let i = 0; i < n4Flow.nodes.length; i++) {
    assert.deepEqual(restored.nodes[i], n4Flow.nodes[i])
  }
})

test('deserializeFlow accepts an already-parsed envelope object', () => {
  const envelope = JSON.parse(serializeFlow(n4Flow))
  assert.deepEqual(deserializeFlow(envelope), n4Flow)
})

test('deserializeFlow rejects an unknown / future format version', () => {
  const bad = JSON.stringify({ formatVersion: 999, flow: {} })
  assert.throws(() => deserializeFlow(bad), /format version/i)
})

test('deserializeFlow rejects a payload with no flow', () => {
  assert.throws(
    () => deserializeFlow(JSON.stringify({ formatVersion: FLOW_FORMAT_VERSION })),
    /flow/i,
  )
})

// ── M2 (bd ai-engineer-8aee): the evolved v2 data model ──────────────────────
// Every field M2 added must survive serialize → deserialize byte-faithfully.
// m2-coverage.v2.js sets every new field explicitly (no default reliance).

test('round-trip is lossless for the full M2 v2 coverage flow', () => {
  const restored = deserializeFlow(serializeFlow(m2Flow))
  assert.deepEqual(restored, m2Flow)
})

test('round-trip preserves the two real source nodes and their rates', () => {
  const restored = deserializeFlow(serializeFlow(m2Flow))
  const sources = restored.nodes.filter(n => n.kind === 'source')
  assert.equal(sources.length, 2)
  assert.deepEqual(
    sources.map(s => [s.id, s.rate]),
    [['src-frontend', 0.6], ['src-backend', 0.4]],
  )
})

test('round-trip preserves first-class forks with per-branch rateShare', () => {
  const restored = deserializeFlow(serializeFlow(m2Flow))
  assert.deepEqual(restored.forks, m2Flow.forks)
  assert.equal(restored.forks[0].branches[0].rateShare, 0.7)
})

test('round-trip preserves first-class merges (to / from)', () => {
  const restored = deserializeFlow(serializeFlow(m2Flow))
  assert.deepEqual(restored.merges, m2Flow.merges)
})

test('round-trip preserves widthMode and per-node width overrides', () => {
  const restored = deserializeFlow(serializeFlow(m2Flow))
  assert.equal(restored.widthMode, 'coupled')
  for (let i = 0; i < m2Flow.nodes.length; i++) {
    assert.equal(restored.nodes[i].width, m2Flow.nodes[i].width)
  }
})

test('round-trip preserves the pinchPreset and constraintKind register knobs', () => {
  const restored = deserializeFlow(serializeFlow(m2Flow))
  assert.equal(restored.pinchPreset, 'constraint-pinch')
  const constraint = restored.nodes.find(n => n.kind === 'constraint')
  assert.equal(constraint.constraintKind, 'pinch')
})

test('round-trip of the M2 flow is idempotent (byte-stable)', () => {
  const once = serializeFlow(m2Flow)
  const twice = serializeFlow(deserializeFlow(once))
  assert.equal(once, twice)
})

// ── v1.1 (beads ai-engineer-t0c8 / wec5): the v3 node-controls model ─────────
// Every v3 field — the three node controls, coupleSpeedWidth, colorScheme —
// must survive serialize → deserialize byte-faithfully. m3-coverage.v3.js sets
// every field explicitly (no default reliance). Round-trip governs v3↔v3;
// migration (v2→v3) is the separately-tested transform.

test('round-trip is lossless for the full v3 coverage flow', () => {
  const restored = deserializeFlow(serializeFlow(m3Flow))
  assert.deepEqual(restored, m3Flow)
})

test('round-trip preserves the three node controls (length / speed / width)', () => {
  const restored = deserializeFlow(serializeFlow(m3Flow))
  for (let i = 0; i < m3Flow.nodes.length; i++) {
    const a = restored.nodes[i], b = m3Flow.nodes[i]
    assert.equal(a.length, b.length, `${b.id} length`)
    assert.equal(a.speed, b.speed, `${b.id} speed`)
    assert.equal(a.width, b.width, `${b.id} width`)
  }
})

test('round-trip preserves coupleSpeedWidth (both true and false)', () => {
  const restored = deserializeFlow(serializeFlow(m3Flow))
  const fast = restored.nodes.find(n => n.id === 'lane-fast')
  const slow = restored.nodes.find(n => n.id === 'lane-slow')
  assert.equal(fast.coupleSpeedWidth, true)
  assert.equal(slow.coupleSpeedWidth, false)
})

test('round-trip preserves the per-node colorScheme (red / neutral / green)', () => {
  const restored = deserializeFlow(serializeFlow(m3Flow))
  assert.equal(restored.nodes.find(n => n.id === 'review').colorScheme, 'red')
  assert.equal(restored.nodes.find(n => n.id === 'intake').colorScheme, 'neutral')
  assert.equal(restored.nodes.find(n => n.id === 'ship').colorScheme, 'green')
})

test('round-trip of the v3 flow is idempotent (byte-stable)', () => {
  const once = serializeFlow(m3Flow)
  const twice = serializeFlow(deserializeFlow(once))
  assert.equal(once, twice)
})

// ── v1.2 (bd ai-engineer-086t / R1): rejection edges ─────────────────────────
// The v4 model adds a first-class top-level `rejections[]` array. Every nested
// field — from / to / rate / bow.side / bow.depth — must survive serialize →
// deserialize byte-faithfully. v12-rejections.v4.js sets every field explicitly.
// Spec §6: "Write the round-trip test before the serializer change."

test('round-trip is lossless for the full v4 rejection-edges coverage flow', () => {
  const restored = deserializeFlow(serializeFlow(v12Flow))
  assert.deepEqual(restored, v12Flow)
})

test('round-trip preserves the rejections[] array and every nested field', () => {
  const restored = deserializeFlow(serializeFlow(v12Flow))
  assert.deepEqual(restored.rejections, v12Flow.rejections)
  assert.equal(restored.rejections.length, 2)
  const [r0, r1] = restored.rejections
  assert.deepEqual(r0, { from: 'review', to: 'design', rate: 0.15,
    bow: { side: 'below', depth: 90 } })
  assert.deepEqual(r1, { from: 'review', to: 'build', rate: 0.1,
    bow: { side: 'above', depth: 70 } })
})

test('round-trip preserves the nested bow object (side + depth)', () => {
  const restored = deserializeFlow(serializeFlow(v12Flow))
  for (let i = 0; i < v12Flow.rejections.length; i++) {
    assert.deepEqual(restored.rejections[i].bow, v12Flow.rejections[i].bow)
  }
})

test('round-trip of the v4 rejection flow is idempotent (byte-stable)', () => {
  const once = serializeFlow(v12Flow)
  const twice = serializeFlow(deserializeFlow(once))
  assert.equal(once, twice)
})

test('cloneFlow returns a deep, independent copy', () => {
  const copy = cloneFlow(n4Flow)
  assert.deepEqual(copy, n4Flow)
  assert.notEqual(copy, n4Flow)
  assert.notEqual(copy.nodes, n4Flow.nodes)
  copy.nodes[0].x = -99999
  assert.notEqual(n4Flow.nodes[0].x, -99999, 'mutating the clone must not touch the original')
})
