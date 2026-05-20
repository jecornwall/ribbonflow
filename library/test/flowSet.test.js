/**
 * flowSet.test.js — the FLOW-SET format layer (M4, bd ai-engineer-nawa).
 *
 * Covers the same hard round-trip invariant as roundtrip.test.js, applied to
 * the flow-set abstraction: an ordered list of flow states + transition
 * metadata. Plus normalizeFlowSet default-fill, validateFlowSet structural
 * checks, and the interpolateFlow geometry engine.
 *
 * See docs/superpowers/specs/2026-05-20-flow-M4-design.md.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { FLOW_FORMAT_VERSION } from '../src/format/index.js'
import {
  serializeFlowSet,
  deserializeFlowSet,
  isFlowSetEnvelope,
  assembleFlowSet,
  normalizeFlowSet,
  validateFlowSet,
  interpolateFlow,
  TRANSITION_DEFAULTS,
  EASINGS,
} from '../src/format/flowSet.js'

import m3Flow from './fixtures/flows/m3-coverage.v3.js'

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A "before" state: the m3 coverage flow as-authored. */
function stateBefore() {
  return JSON.parse(JSON.stringify(m3Flow))
}

/** An "after" state: same topology, the `review` node widened + recoloured. */
function stateAfter() {
  const flow = JSON.parse(JSON.stringify(m3Flow))
  const review = flow.nodes.find((n) => n.id === 'review')
  review.width = 110
  review.speed = 1.5
  review.colorScheme = 'green'
  return flow
}

/** A fully-explicit flow-set — no default reliance, for the round-trip test. */
function coverageSet() {
  return {
    id: 'toc-baseline',
    title: 'ToC baseline',
    states: [
      { key: 'before', title: 'Before', flow: stateBefore() },
      { key: 'after', title: 'After', flow: stateAfter() },
    ],
    transition: { durationMs: 1200, holdMs: 3000, easing: 'linear' },
    autoplay: false,
    loop: false,
  }
}

// ── round-trip invariant ─────────────────────────────────────────────────────

test('serializeFlowSet output is a JSON flow-set envelope', () => {
  const parsed = JSON.parse(serializeFlowSet(coverageSet()))
  assert.equal(parsed.formatVersion, FLOW_FORMAT_VERSION)
  assert.ok(parsed.flowSet, 'envelope carries a flowSet payload')
})

test('round-trip is lossless for a fully-explicit flow-set', () => {
  const set = coverageSet()
  const restored = deserializeFlowSet(serializeFlowSet(set))
  assert.deepEqual(restored, set)
})

test('round-trip is idempotent — flow-set serialize is byte-stable', () => {
  const once = serializeFlowSet(coverageSet())
  const twice = serializeFlowSet(deserializeFlowSet(once))
  assert.equal(once, twice)
})

test('round-trip preserves every state flow byte-faithfully', () => {
  const set = coverageSet()
  const restored = deserializeFlowSet(serializeFlowSet(set))
  for (let i = 0; i < set.states.length; i++) {
    assert.deepEqual(restored.states[i].flow, set.states[i].flow)
  }
})

test('deserializeFlowSet accepts an already-parsed envelope object', () => {
  const set = coverageSet()
  const envelope = JSON.parse(serializeFlowSet(set))
  assert.deepEqual(deserializeFlowSet(envelope), set)
})

test('deserializeFlowSet rejects a future format version', () => {
  const bad = JSON.stringify({ formatVersion: 999, flowSet: { states: [] } })
  assert.throws(() => deserializeFlowSet(bad), /format version/i)
})

test('deserializeFlowSet rejects an envelope with no flowSet payload', () => {
  assert.throws(
    () => deserializeFlowSet(JSON.stringify({ formatVersion: FLOW_FORMAT_VERSION })),
    /flowSet/i,
  )
})

// ── envelope discrimination ──────────────────────────────────────────────────

test('isFlowSetEnvelope distinguishes a flow-set from a single flow', () => {
  assert.equal(isFlowSetEnvelope(serializeFlowSet(coverageSet())), true)
  assert.equal(
    isFlowSetEnvelope(JSON.stringify({ formatVersion: 3, flow: stateBefore() })),
    false,
  )
  assert.equal(isFlowSetEnvelope(stateBefore()), false)
  assert.equal(isFlowSetEnvelope('not json'), false)
  assert.equal(isFlowSetEnvelope(null), false)
})

// ── assembleFlowSet ──────────────────────────────────────────────────────────

test('assembleFlowSet builds a set from ordered states + meta', () => {
  const set = assembleFlowSet(
    [
      { key: 'a', title: 'A', flow: stateBefore() },
      { key: 'b', title: 'B', flow: stateAfter() },
    ],
    { id: 's', title: 'S', transition: { durationMs: 500 } },
  )
  assert.deepEqual(set.states.map((s) => s.key), ['a', 'b'])
  assert.equal(set.id, 's')
  assert.equal(set.transition.durationMs, 500)
})

test('assembleFlowSet deep-clones state flows (no aliasing)', () => {
  const flow = stateBefore()
  const set = assembleFlowSet([{ key: 'a', flow }])
  set.states[0].flow.nodes[0].x = -9999
  assert.notEqual(flow.nodes[0].x, -9999)
})

// ── normalizeFlowSet ─────────────────────────────────────────────────────────

test('normalizeFlowSet fills transition + flow-set defaults', () => {
  const norm = normalizeFlowSet({ states: [{ key: 'a', flow: stateBefore() }] })
  assert.deepEqual(norm.transition, TRANSITION_DEFAULTS)
  assert.equal(norm.autoplay, true)
  assert.equal(norm.loop, true)
})

test('normalizeFlowSet keeps authored transition fields, fills only gaps', () => {
  const norm = normalizeFlowSet({
    states: [{ key: 'a', flow: stateBefore() }],
    transition: { durationMs: 100 },
  })
  assert.equal(norm.transition.durationMs, 100)
  assert.equal(norm.transition.holdMs, TRANSITION_DEFAULTS.holdMs)
})

test('normalizeFlowSet normalizes every state flow (engine fields derived)', () => {
  const norm = normalizeFlowSet({ states: [{ key: 'a', flow: stateBefore() }] })
  const node = norm.states[0].flow.nodes[0]
  assert.equal(typeof node.capacity, 'number', 'normalizeFlow derived capacity')
  assert.equal(typeof node.latency, 'number', 'normalizeFlow derived latency')
})

test('normalizeFlowSet does not mutate its input', () => {
  const input = { states: [{ key: 'a', flow: stateBefore() }] }
  normalizeFlowSet(input)
  assert.equal(input.transition, undefined)
})

// ── validateFlowSet ──────────────────────────────────────────────────────────

test('validateFlowSet accepts a well-formed set', () => {
  const res = validateFlowSet(coverageSet())
  assert.equal(res.ok, true)
  assert.deepEqual(res.errors, [])
})

test('validateFlowSet flags an empty state list', () => {
  const res = validateFlowSet({ states: [] })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /no states/i)
})

test('validateFlowSet flags duplicate state keys', () => {
  const res = validateFlowSet({
    states: [
      { key: 'dup', flow: stateBefore() },
      { key: 'dup', flow: stateAfter() },
    ],
  })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /duplicate state key/i)
})

test('validateFlowSet warns when states do not share topology', () => {
  const drifted = stateAfter()
  drifted.nodes.push({ id: 'extra', x: 0, y: 0, label: 'extra', successors: [] })
  const res = validateFlowSet({
    states: [
      { key: 'a', flow: stateBefore() },
      { key: 'b', flow: drifted },
    ],
  })
  assert.equal(res.ok, true, 'topology drift is a warning, not an error')
  assert.match(res.warnings.join(' '), /topology/i)
})

test('validateFlowSet errors on a negative transition duration', () => {
  const res = validateFlowSet({
    states: [{ key: 'a', flow: stateBefore() }],
    transition: { durationMs: -5 },
  })
  assert.equal(res.ok, false)
})

// ── interpolateFlow ──────────────────────────────────────────────────────────

test('interpolateFlow at t=0 equals the first state geometry', () => {
  const a = stateBefore()
  const b = stateAfter()
  const mid = interpolateFlow(a, b, 0)
  const review = mid.nodes.find((n) => n.id === 'review')
  assert.equal(review.width, a.nodes.find((n) => n.id === 'review').width)
})

test('interpolateFlow at t=1 equals the second state geometry', () => {
  const a = stateBefore()
  const b = stateAfter()
  const mid = interpolateFlow(a, b, 1)
  const review = mid.nodes.find((n) => n.id === 'review')
  assert.equal(review.width, b.nodes.find((n) => n.id === 'review').width)
})

test('interpolateFlow at t=0.5 lerps numeric node geometry', () => {
  const a = stateBefore()
  const b = stateAfter() // review.width set to 110
  const wa = a.nodes.find((n) => n.id === 'review').width
  const wb = b.nodes.find((n) => n.id === 'review').width
  const mid = interpolateFlow(a, b, 0.5)
  assert.equal(mid.nodes.find((n) => n.id === 'review').width, (wa + wb) / 2)
})

test('interpolateFlow clamps t outside [0,1]', () => {
  const a = stateBefore()
  const b = stateAfter()
  assert.equal(
    interpolateFlow(a, b, -3).nodes.find((n) => n.id === 'review').width,
    a.nodes.find((n) => n.id === 'review').width,
  )
})

test('interpolateFlow switches discrete fields at the t=0.5 threshold', () => {
  const a = stateBefore() // review.colorScheme 'red'
  const b = stateAfter()  // review.colorScheme 'green'
  assert.equal(interpolateFlow(a, b, 0.49).nodes.find((n) => n.id === 'review').colorScheme, 'red')
  assert.equal(interpolateFlow(a, b, 0.5).nodes.find((n) => n.id === 'review').colorScheme, 'green')
})

test('interpolateFlow rejects flows with non-matching node-id sets', () => {
  const a = stateBefore()
  const b = stateAfter()
  b.nodes.push({ id: 'extra', x: 0, y: 0, successors: [] })
  assert.throws(() => interpolateFlow(a, b, 0.5), /node-id set/i)
})

test('interpolateFlow does not mutate its inputs', () => {
  const a = stateBefore()
  const b = stateAfter()
  const aw = a.nodes.find((n) => n.id === 'review').width
  interpolateFlow(a, b, 0.5)
  assert.equal(a.nodes.find((n) => n.id === 'review').width, aw)
})

// ── EASINGS ──────────────────────────────────────────────────────────────────

test('EASINGS map endpoints to 0 and 1', () => {
  for (const fn of Object.values(EASINGS)) {
    assert.equal(fn(0), 0)
    assert.equal(fn(1), 1)
  }
})
