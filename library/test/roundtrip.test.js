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

test('round-trip is lossless for the N9 multi-lane flow (forks)', () => {
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

test('cloneFlow returns a deep, independent copy', () => {
  const copy = cloneFlow(n4Flow)
  assert.deepEqual(copy, n4Flow)
  assert.notEqual(copy, n4Flow)
  assert.notEqual(copy.nodes, n4Flow.nodes)
  copy.nodes[0].x = -99999
  assert.notEqual(n4Flow.nodes[0].x, -99999, 'mutating the clone must not touch the original')
})
