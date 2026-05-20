/**
 * model.test.js — the v3 flow model: defaults, engine-field derivation, the
 * Speed⇄Width coupling, and validation. Written test-first.
 *
 * normalizeFlow() and validateFlow() are the model layer. They are NOT part of
 * the round-trip invariant (serialize/deserialize stay faithful — see
 * docs/superpowers/specs/2026-05-20-flow-M2-design.md §2.5). normalizeFlow()
 * fills v3 defaults AND derives the engine-facing fields (latency/capacity/
 * widthMode) so the simulation engine + renderer consume a v3 flow unchanged.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeFlow,
  validateFlow,
  speedFromWidth,
  widthFromSpeed,
  capacityFromWidth,
  WIDTH_RANGE,
  SPEED_RANGE,
} from '../src/format/model.js'

import m3Flow from './fixtures/flows/m3-coverage.v3.js'

// ── normalizeFlow — flow + node defaults ─────────────────────────────────────

test('normalizeFlow fills flow-level defaults', () => {
  const out = normalizeFlow({ viewBox: { w: 100, h: 100 }, nodes: [] })
  assert.equal(out.baseSpeed, 200)
  assert.equal(out.initialAgents, 0)
  assert.deepEqual(out.forks, [])
  assert.deepEqual(out.merges, [])
})

test('normalizeFlow does not mutate its input', () => {
  const input = { viewBox: { w: 100, h: 100 }, nodes: [{ id: 'a', x: 0, y: 0 }] }
  const before = JSON.stringify(input)
  normalizeFlow(input)
  assert.equal(JSON.stringify(input), before)
})

test('normalizeFlow fills the v1.1 node controls with defaults', () => {
  const out = normalizeFlow({ nodes: [{ id: 'a', x: 0, y: 0 }] })
  const n = out.nodes[0]
  assert.equal(n.kind, 'normal')
  assert.equal(n.label, '')
  assert.deepEqual(n.successors, [])
  assert.equal(n.length, 0.8)
  assert.equal(n.speed, 1.0)
  assert.equal(n.width, 70)
  assert.equal(n.coupleSpeedWidth, true)
  assert.equal(n.colorScheme, 'neutral')
})

test('normalizeFlow defaults a source node rate to 1.0', () => {
  const out = normalizeFlow({ nodes: [{ id: 's', x: 0, y: 0, kind: 'source' }] })
  assert.equal(out.nodes[0].rate, 1.0)
})

test('normalizeFlow preserves explicitly-set values over defaults', () => {
  const out = normalizeFlow({
    baseSpeed: 999,
    nodes: [{ id: 'a', x: 0, y: 0, length: 1.5, speed: 0.4, width: 30,
              coupleSpeedWidth: false, colorScheme: 'red' }],
  })
  assert.equal(out.baseSpeed, 999)
  const n = out.nodes[0]
  assert.equal(n.length, 1.5)
  assert.equal(n.speed, 0.4)
  assert.equal(n.width, 30)
  assert.equal(n.coupleSpeedWidth, false)
  assert.equal(n.colorScheme, 'red')
})

// ── normalizeFlow — engine-field derivation (spec §4.2) ──────────────────────

test('normalizeFlow derives engine fields: latency←length, capacity←width', () => {
  const out = normalizeFlow({
    nodes: [{ id: 'a', x: 0, y: 0, length: 1.2, width: 30 }],
  })
  const n = out.nodes[0]
  assert.equal(n.latency, 1.2, 'latency is the node length')
  assert.equal(n.capacity, capacityFromWidth(30), 'capacity derives from width')
})

test('normalizeFlow sets widthMode:manual so explicit widths are honoured', () => {
  const out = normalizeFlow({ nodes: [] })
  assert.equal(out.widthMode, 'manual')
})

test('normalizeFlow fills even rateShare for fork branches that omit it', () => {
  const out = normalizeFlow({
    forks: [{ from: 'a', branches: [{ to: 'b' }, { to: 'c' }, { to: 'd' }] }],
    nodes: [],
  })
  for (const b of out.forks[0].branches) {
    assert.ok(Math.abs(b.rateShare - 1 / 3) < 1e-9)
  }
})

test('normalizeFlow leaves an already-complete v3 flow structurally intact', () => {
  const out = normalizeFlow(m3Flow)
  assert.equal(out.nodes.length, m3Flow.nodes.length)
  assert.equal(out.forks[0].branches[0].rateShare, 0.6)
  const review = out.nodes.find(n => n.id === 'review')
  assert.equal(review.colorScheme, 'red')
  assert.equal(review.latency, review.length)
})

// ── Speed⇄Width coupling maps (spec §2.1) ────────────────────────────────────

test('the coupling maps round-trip at the aligned default midpoint', () => {
  assert.equal(speedFromWidth(70), 1.0)
  assert.equal(widthFromSpeed(1.0), 70)
})

test('the coupling maps hit the range endpoints', () => {
  assert.equal(speedFromWidth(WIDTH_RANGE.min), SPEED_RANGE.min)
  assert.equal(speedFromWidth(WIDTH_RANGE.max), SPEED_RANGE.max)
  assert.equal(widthFromSpeed(SPEED_RANGE.min), WIDTH_RANGE.min)
  assert.equal(widthFromSpeed(SPEED_RANGE.max), WIDTH_RANGE.max)
})

test('the coupling maps clamp out-of-range inputs', () => {
  assert.equal(speedFromWidth(10_000), SPEED_RANGE.max)
  assert.equal(speedFromWidth(-10), SPEED_RANGE.min)
  assert.equal(widthFromSpeed(10), WIDTH_RANGE.max)
  assert.equal(widthFromSpeed(-1), WIDTH_RANGE.min)
})

test('a narrow node couples to a low speed (the constraint reads)', () => {
  assert.ok(speedFromWidth(30) < speedFromWidth(70))
  assert.ok(widthFromSpeed(0.4) < widthFromSpeed(1.0))
})

test('capacityFromWidth is monotone and never below 1', () => {
  assert.ok(capacityFromWidth(20) >= 1)
  assert.ok(capacityFromWidth(120) > capacityFromWidth(20))
})

// ── validateFlow ─────────────────────────────────────────────────────────────

test('validateFlow accepts the m3 coverage fixture', () => {
  const r = validateFlow(m3Flow)
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
})

test('validateFlow flags a duplicate node id', () => {
  const r = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 1 }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /duplicate/i.test(e)))
})

test('validateFlow flags a successor pointing at a missing node', () => {
  const r = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0, kind: 'source', successors: ['ghost'] }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /ghost/.test(e)))
})

test('validateFlow flags a fork referencing a missing branch target', () => {
  const r = validateFlow({
    forks: [{ from: 'a', branches: [{ to: 'ghost', rateShare: 1 }] }],
    nodes: [{ id: 'a', x: 0, y: 0, kind: 'source', successors: [] }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /ghost/.test(e)))
})

test('validateFlow warns when a flow has no source node', () => {
  const r = validateFlow({ nodes: [{ id: 'a', x: 0, y: 0, successors: [] }] })
  assert.ok(r.warnings.some(w => /source/i.test(w)))
})

test('validateFlow warns on a non-positive source rate', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', rate: 0, successors: [] }],
  })
  assert.ok(r.warnings.some(w => /rate/i.test(w)))
})

test('validateFlow warns on an unknown colorScheme', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', colorScheme: 'purple', successors: [] }],
  })
  assert.ok(r.warnings.some(w => /colorscheme/i.test(w)))
})

test('validateFlow warns on the removed kind:constraint', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', successors: ['c'] },
            { id: 'c', x: 1, y: 0, kind: 'constraint', successors: [] }],
  })
  assert.ok(r.warnings.some(w => /constraint/i.test(w)))
})
