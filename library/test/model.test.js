/**
 * model.test.js — the v2 flow model: defaults, presets, validation
 * (M2, bd ai-engineer-8aee). Written test-first.
 *
 * normalizeFlow() and validateFlow() are the model layer. They are NOT part of
 * the round-trip invariant (serialize/deserialize stay faithful — see
 * docs/superpowers/specs/2026-05-20-flow-M2-design.md §2.5). normalizeFlow()
 * fills documented defaults; validateFlow() reports structural problems.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeFlow,
  validateFlow,
  PINCH_PRESETS,
} from '../src/format/model.js'

import m2Flow from './fixtures/flows/m2-coverage.v2.js'

// ── normalizeFlow ────────────────────────────────────────────────────────────

test('normalizeFlow fills flow-level defaults', () => {
  const out = normalizeFlow({ viewBox: { w: 100, h: 100 }, nodes: [] })
  assert.equal(out.baseSpeed, 200)
  assert.equal(out.initialAgents, 0)
  assert.equal(out.widthMode, 'coupled')
  assert.deepEqual(out.forks, [])
  assert.deepEqual(out.merges, [])
})

test('normalizeFlow does not mutate its input', () => {
  const input = { viewBox: { w: 100, h: 100 }, nodes: [{ id: 'a', x: 0, y: 0 }] }
  const before = JSON.stringify(input)
  normalizeFlow(input)
  assert.equal(JSON.stringify(input), before)
})

test('normalizeFlow fills per-node defaults', () => {
  const out = normalizeFlow({ nodes: [{ id: 'a', x: 0, y: 0 }] })
  const n = out.nodes[0]
  assert.equal(n.kind, 'normal')
  assert.equal(n.label, '')
  assert.deepEqual(n.successors, [])
  assert.equal(n.labelDx, 0)
  assert.equal(n.labelDy, 0)
})

test('normalizeFlow defaults a source node rate to 1.0', () => {
  const out = normalizeFlow({ nodes: [{ id: 's', x: 0, y: 0, kind: 'source' }] })
  assert.equal(out.nodes[0].rate, 1.0)
})

test('normalizeFlow defaults a constraint node constraintKind to pinch', () => {
  const out = normalizeFlow({ nodes: [{ id: 'c', x: 0, y: 0, kind: 'constraint' }] })
  assert.equal(out.nodes[0].constraintKind, 'pinch')
})

test('normalizeFlow preserves explicitly-set values over defaults', () => {
  const out = normalizeFlow({
    baseSpeed: 999, widthMode: 'manual',
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', rate: 0.25 }],
  })
  assert.equal(out.baseSpeed, 999)
  assert.equal(out.widthMode, 'manual')
  assert.equal(out.nodes[0].rate, 0.25)
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

test('normalizeFlow expands a pinchPreset into flat register fields', () => {
  const out = normalizeFlow({ pinchPreset: 'constraint-pinch', nodes: [] })
  assert.equal(out.pinchMode, PINCH_PRESETS['constraint-pinch'].pinchMode)
  assert.equal(out.bandWidth, PINCH_PRESETS['constraint-pinch'].bandWidth)
})

test('an explicit flat register field beats the pinchPreset', () => {
  const out = normalizeFlow({ pinchPreset: 'constraint-pinch', bandWidth: 123, nodes: [] })
  assert.equal(out.bandWidth, 123)
})

test('normalizeFlow leaves an already-complete v2 flow structurally intact', () => {
  const out = normalizeFlow(m2Flow)
  assert.equal(out.nodes.length, m2Flow.nodes.length)
  assert.equal(out.widthMode, 'coupled')
  assert.equal(out.forks[0].branches[0].rateShare, 0.7)
})

// ── PINCH_PRESETS ────────────────────────────────────────────────────────────

test('PINCH_PRESETS ships the two named M2 presets', () => {
  assert.ok(PINCH_PRESETS['constraint-pinch'])
  assert.ok(PINCH_PRESETS['throughput-encoded'])
})

// ── validateFlow ─────────────────────────────────────────────────────────────

test('validateFlow accepts the m2 coverage fixture', () => {
  const r = validateFlow(m2Flow)
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

test('validateFlow warns when fork rateShares do not sum to 1', () => {
  const r = validateFlow({
    forks: [{ from: 'a', branches: [{ to: 'b', rateShare: 0.2 }, { to: 'c', rateShare: 0.2 }] }],
    nodes: [
      { id: 'a', x: 0, y: 0, kind: 'source', successors: ['b', 'c'] },
      { id: 'b', x: 1, y: 0, successors: [] },
      { id: 'c', x: 1, y: 1, successors: [] },
    ],
  })
  assert.ok(r.warnings.some(w => /rateshare/i.test(w)))
})

test('validateFlow warns on a non-positive source rate', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', rate: 0, successors: [] }],
  })
  assert.ok(r.warnings.some(w => /rate/i.test(w)))
})
