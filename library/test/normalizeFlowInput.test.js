/**
 * normalizeFlowInput.test.js — <FlowEmbed> bare-flow input handling (bd ai-engineer-n2k9).
 *
 * Written test-FIRST (blocker 0). normalizeFlowInput() is the format gate for
 * <FlowEmbed>. A slide may hand it ANY of: a bare flow object (deck v1 format),
 * a serialized JSON string, or a parsed envelope. <FlowEmbed> must render ALL of
 * these without errors.
 *
 * The critical regression: a deck v1 flow object has `entryId` / `spawnRate` /
 * `capacity`+`latency` nodes and no `formatVersion`. Before this fix,
 * normalizeFlowInput passed it through UNTOUCHED → 189 console errors (NaN
 * attributes on SVG elements) and a hard crash in pinchZoneOutlinePath
 * ("Cannot read properties of undefined"). Fix: detect the bare flow's version,
 * migrate forward, then run normalizeFlow (idempotent).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeFlowInput,
  FLOW_FORMAT_VERSION,
} from '../src/format/index.js'

import n4FlowV1 from './fixtures/flows/n4-toc-baseline.js'
import n9FlowV1 from './fixtures/flows/n9-multilane.js'
import m3FlowV3 from './fixtures/flows/m3-coverage.v3.js'

// ── Bare v1 flow object (the deck-format input) ───────────────────────────────

test('normalizeFlowInput: bare v1 flow (entryId present) migrates and normalizes', () => {
  const result = normalizeFlowInput(n4FlowV1)
  // v1→v2 migration removes the top-level entry markers
  assert.equal(result.entryId, undefined, 'entryId removed by migration')
  assert.equal(result.spawnRate, undefined, 'spawnRate removed by migration')
  // normalizeFlow adds the engine-facing mode flag and defaults
  assert.equal(result.widthMode, 'manual', 'normalizeFlow sets widthMode')
  assert.ok(Array.isArray(result.nodes), 'nodes array present')
  assert.ok(Array.isArray(result.forks), 'forks array filled by normalizeFlow')
  assert.ok(Array.isArray(result.merges), 'merges array filled by normalizeFlow')
})

test('normalizeFlowInput: bare v1 flow — every node carries the required engine fields', () => {
  const result = normalizeFlowInput(n4FlowV1)
  for (const n of result.nodes) {
    assert.equal(typeof n.latency, 'number', `${n.id}: latency (engine field) present`)
    assert.equal(typeof n.capacity, 'number', `${n.id}: capacity (engine field) present`)
    assert.equal(typeof n.length, 'number', `${n.id}: length (v3 authored control) present`)
    assert.equal(typeof n.width, 'number', `${n.id}: width (v3 authored control) present`)
    assert.equal(typeof n.speed, 'number', `${n.id}: speed (v3 authored control) present`)
    assert.equal(typeof n.colorScheme, 'string', `${n.id}: colorScheme (v3 field) present`)
  }
})

test('normalizeFlowInput: bare v1 flow — old entry node becomes a source', () => {
  const result = normalizeFlowInput(n4FlowV1)
  // n4-toc-baseline.js has entryId:'problem-definition'
  const src = result.nodes.find(n => n.id === 'problem-definition')
  assert.ok(src, 'old entry node still present in nodes array')
  assert.equal(src.kind, 'source', 'old entry node migrated to kind:source')
  assert.ok(typeof src.rate === 'number', 'source node carries a numeric rate')
})

test('normalizeFlowInput: bare v1 n9-multilane (fork/merge) migrates without error', () => {
  // n9-multilane has fork/merge declarations and an off-canvas _start fork node
  assert.doesNotThrow(() => normalizeFlowInput(n9FlowV1))
  const result = normalizeFlowInput(n9FlowV1)
  assert.equal(result.entryId, undefined, 'entryId removed')
  const start = result.nodes.find(n => n.id === '_start')
  assert.ok(start, '_start node preserved')
  assert.equal(start.kind, 'source', '_start promoted to source')
})

test('normalizeFlowInput: bare v1 n9-multilane — fork branches use {to, rateShare} objects', () => {
  const result = normalizeFlowInput(n9FlowV1)
  const fork = result.forks.find(f => f.from === '_start')
  assert.ok(fork, 'fork preserved')
  for (const b of fork.branches) {
    assert.equal(typeof b.to, 'string', 'branch.to is a string')
    assert.equal(typeof b.rateShare, 'number', 'branch.rateShare is a number')
  }
})

test('normalizeFlowInput: bare v1 flow does NOT mutate the original object', () => {
  const snapshot = JSON.stringify(n4FlowV1)
  normalizeFlowInput(n4FlowV1)
  assert.equal(JSON.stringify(n4FlowV1), snapshot, 'original v1 flow unchanged')
})

// ── Bare v3 flow object (designer-authored or already-migrated) ───────────────

test('normalizeFlowInput: bare v3 flow normalizes without migration side-effects', () => {
  const result = normalizeFlowInput(m3FlowV3)
  // v3 fields must survive
  assert.equal(result.widthMode, 'manual', 'normalizeFlow sets widthMode')
  const review = result.nodes.find(n => n.id === 'review')
  assert.ok(review, 'v3 node present')
  assert.equal(review.colorScheme, 'red', 'v3 colorScheme preserved')
  // Engine fields are derived (normalizeFlow fills them)
  assert.equal(typeof review.latency, 'number', 'latency derived from length')
  assert.equal(typeof review.capacity, 'number', 'capacity derived from width')
})

test('normalizeFlowInput: already-normalized v3 flow is idempotent', () => {
  const once = normalizeFlowInput(m3FlowV3)
  const twice = normalizeFlowInput(once)
  // Key fields must be stable across two normalization passes
  for (const n of once.nodes) {
    const n2 = twice.nodes.find(x => x.id === n.id)
    assert.ok(n2, `node ${n.id} present in second pass`)
    assert.equal(n2.latency, n.latency, `${n.id}: latency stable`)
    assert.equal(n2.capacity, n.capacity, `${n.id}: capacity stable`)
    assert.equal(n2.colorScheme, n.colorScheme, `${n.id}: colorScheme stable`)
  }
})

// ── Serialized envelope forms (pre-existing behaviour preserved) ─────────────

test('normalizeFlowInput: JSON string envelope deserializes and normalizes', () => {
  const envelope = JSON.stringify({ formatVersion: FLOW_FORMAT_VERSION, flow: m3FlowV3 })
  const result = normalizeFlowInput(envelope)
  assert.equal(result.widthMode, 'manual')
  assert.ok(Array.isArray(result.nodes))
  assert.equal(typeof result.nodes[0].latency, 'number', 'engine field derived from envelope')
})

test('normalizeFlowInput: parsed envelope object deserializes and normalizes', () => {
  const envelope = { formatVersion: FLOW_FORMAT_VERSION, flow: m3FlowV3 }
  const result = normalizeFlowInput(envelope)
  assert.equal(result.widthMode, 'manual')
  assert.ok(Array.isArray(result.nodes))
})

test('normalizeFlowInput: v1 envelope string migrates all the way to v3 and normalizes', () => {
  const v1envelope = JSON.stringify({ formatVersion: 1, flow: n4FlowV1 })
  const result = normalizeFlowInput(v1envelope)
  assert.equal(result.entryId, undefined, 'migration removed entryId')
  assert.equal(result.widthMode, 'manual', 'normalization set widthMode')
  const src = result.nodes.find(n => n.id === 'problem-definition')
  assert.equal(src.kind, 'source')
})

// ── Error cases ────────────────────────────────────────────────────────────────

test('normalizeFlowInput: throws a TypeError on null', () => {
  assert.throws(() => normalizeFlowInput(null), /normalizeFlowInput/)
})

test('normalizeFlowInput: throws a TypeError on undefined', () => {
  assert.throws(() => normalizeFlowInput(undefined), /normalizeFlowInput/)
})

test('normalizeFlowInput: throws a TypeError on a number', () => {
  assert.throws(() => normalizeFlowInput(42), /normalizeFlowInput/)
})
