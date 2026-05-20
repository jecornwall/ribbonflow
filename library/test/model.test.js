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
  SPEED_CONTROL_RANGE,
  CAPACITY_CONTROL_RANGE,
  DEFAULT_NODE_SPEED,
  DEFAULT_REJECTION_RATE,
  DEFAULT_REJECTION_BOW_DEPTH,
  DEFAULT_SPLIT_COUNT,
  DEFAULT_COMBINE_COUNT,
  MIN_LARGE_ADMITTING_WIDTH,
} from '../src/format/model.js'

import m3Flow from './fixtures/flows/m3-coverage.v3.js'
import v12Flow from './fixtures/flows/v12-rejections.v4.js'
import n5Flow from './fixtures/flows/n5-large-particles.v5.js'

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

test('normalizeFlow honours an authored capacity over the width default', () => {
  // bd ai-engineer-v9mj: capacity is an optional authored override. A
  // capacity:1 constraint must NOT be overwritten by capacityFromWidth.
  const out = normalizeFlow({
    nodes: [
      { id: 'constraint', x: 0, y: 0, length: 1, width: 30, capacity: 1 },
      { id: 'reservoir', x: 1, y: 0, length: 1, width: 70, capacity: 50 },
      { id: 'derived', x: 2, y: 0, length: 1, width: 30 },
    ],
  })
  const [c, r, d] = out.nodes
  assert.equal(c.capacity, 1, 'authored capacity:1 wins over width default')
  assert.equal(r.capacity, 50, 'authored reservoir capacity wins')
  assert.equal(d.capacity, capacityFromWidth(30), 'omitted capacity derives from width')
})

test('validateFlow warns on a non-positive-integer capacity', () => {
  const bad = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0, capacity: 0 }],
  })
  assert.ok(bad.warnings.some(w => w.includes('invalid capacity')))
  const ok = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0, kind: 'source', capacity: 3 }],
  })
  assert.ok(!ok.warnings.some(w => w.includes('invalid capacity')))
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

// ── bd ai-engineer-gez3 — the SPEED slider reaches well past the coupling
// ceiling so a heavily-converged node can be sped up enough to clear. ────────
test('SPEED_CONTROL_RANGE extends well beyond the coupling SPEED_RANGE', () => {
  // The slider's low end stays at the coupling minimum (no reason to widen it),
  // but its max must clear a ~4–5× converged node.
  assert.equal(SPEED_CONTROL_RANGE.min, SPEED_RANGE.min)
  assert.ok(SPEED_CONTROL_RANGE.max > SPEED_RANGE.max,
    'control max must exceed the 1.75 coupling ceiling')
  assert.ok(SPEED_CONTROL_RANGE.max >= 4,
    `control max ${SPEED_CONTROL_RANGE.max} must reach ~4×+ for a converged node`)
})

test('the default node speed sits inside the wider control range', () => {
  assert.ok(DEFAULT_NODE_SPEED >= SPEED_CONTROL_RANGE.min)
  assert.ok(DEFAULT_NODE_SPEED <= SPEED_CONTROL_RANGE.max)
})

test('widening the control range leaves the coupling maps untouched', () => {
  // The coupling map is anchored to SPEED_RANGE, not SPEED_CONTROL_RANGE — the
  // aligned default (width 70 ⇄ speed 1.0) must NOT shift.
  assert.equal(speedFromWidth(70), 1.0)
  assert.equal(widthFromSpeed(1.0), 70)
  // A speed past the coupling ceiling pegs width at WIDTH_RANGE.max.
  assert.equal(widthFromSpeed(SPEED_CONTROL_RANGE.max), WIDTH_RANGE.max)
})

test('a narrow node couples to a low speed (the constraint reads)', () => {
  assert.ok(speedFromWidth(30) < speedFromWidth(70))
  assert.ok(widthFromSpeed(0.4) < widthFromSpeed(1.0))
})

test('capacityFromWidth is monotone and never below 1', () => {
  assert.ok(capacityFromWidth(20) >= 1)
  assert.ok(capacityFromWidth(120) > capacityFromWidth(20))
})

// ── bd ai-engineer-ey0b — the CAPACITY-override slider range reaches well past
// the width-derived ceiling so a converged node's pile-up can be cleared. ────
test('CAPACITY_CONTROL_RANGE extends beyond the width-derived capacity ceiling', () => {
  // capacityFromWidth tops out at the widest node; the override slider must
  // reach past it for a heavily-converged node (the N9 cross-team-review case).
  const widthDerivedMax = capacityFromWidth(WIDTH_RANGE.max)
  assert.ok(CAPACITY_CONTROL_RANGE.max > widthDerivedMax,
    `control max ${CAPACITY_CONTROL_RANGE.max} must exceed the width ceiling ${widthDerivedMax}`)
  assert.ok(CAPACITY_CONTROL_RANGE.max >= 8,
    `control max ${CAPACITY_CONTROL_RANGE.max} must reach a converged node's needs`)
})

test('CAPACITY_CONTROL_RANGE.min is 1 — the strict one-at-a-time gate', () => {
  // capacity:1 is a hard one-at-a-time gate; the slider must still reach it so
  // a designer can author (or restore) the deliberate-bottleneck optic.
  assert.equal(CAPACITY_CONTROL_RANGE.min, 1)
})

test('CAPACITY_CONTROL_RANGE bounds are positive integers', () => {
  assert.ok(Number.isInteger(CAPACITY_CONTROL_RANGE.min))
  assert.ok(Number.isInteger(CAPACITY_CONTROL_RANGE.max))
  assert.ok(CAPACITY_CONTROL_RANGE.max > CAPACITY_CONTROL_RANGE.min)
})

test('an explicit capacity inside the control range survives normalizeFlow', () => {
  // The override must reach the engine intact — normalizeFlow keeps an authored
  // integer rather than re-deriving it from width (bd ai-engineer-v9mj path).
  const cap = CAPACITY_CONTROL_RANGE.max
  const norm = normalizeFlow({
    nodes: [{ id: 'converged', x: 0, y: 0, width: 30, capacity: cap }],
  })
  assert.equal(norm.nodes[0].capacity, cap,
    'an explicit override capacity is honoured, not re-derived from width')
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

// ── v1.2 (bd ai-engineer-086t / R1): rejection edges ─────────────────────────
// normalizeFlow per-edge defaults (spec §2.3) + validateFlow rules (spec §2.4).

test('normalizeFlow ensures flow.rejections is an array', () => {
  const out = normalizeFlow({ nodes: [] })
  assert.deepEqual(out.rejections, [])
})

test('normalizeFlow fills per-edge rejection defaults (rate / bow.depth)', () => {
  const out = normalizeFlow({
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }],
    rejections: [{ from: 'b', to: 'a' }],
  })
  const rej = out.rejections[0]
  assert.equal(rej.rate, DEFAULT_REJECTION_RATE)
  assert.equal(rej.rate, 0.15)
  assert.equal(rej.bow.depth, DEFAULT_REJECTION_BOW_DEPTH)
  assert.equal(rej.bow.depth, 80)
})

test('normalizeFlow auto-picks bow.side opposite the from node label side', () => {
  const out = normalizeFlow({
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'above', x: 1, y: 0, labelSide: 'above' },
      { id: 'below', x: 2, y: 0, labelSide: 'below' },
    ],
    rejections: [
      { from: 'above', to: 'a' },
      { from: 'below', to: 'a' },
    ],
  })
  assert.equal(out.rejections[0].bow.side, 'below', 'label above → bow below')
  assert.equal(out.rejections[1].bow.side, 'above', 'label below → bow above')
})

test('normalizeFlow defaults bow.side to below when the from node has no label side', () => {
  const out = normalizeFlow({
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }],
    rejections: [{ from: 'b', to: 'a' }],
  })
  assert.equal(out.rejections[0].bow.side, 'below')
})

test('normalizeFlow preserves explicit rejection-edge fields over defaults', () => {
  const out = normalizeFlow({
    nodes: [{ id: 'a', x: 0, y: 0, labelSide: 'above' }, { id: 'b', x: 1, y: 0 }],
    rejections: [{ from: 'b', to: 'a', rate: 0.42, bow: { side: 'above', depth: 120 } }],
  })
  const rej = out.rejections[0]
  assert.equal(rej.rate, 0.42)
  assert.equal(rej.bow.side, 'above')
  assert.equal(rej.bow.depth, 120)
})

test('normalizeFlow does not mutate a flow with rejections', () => {
  const input = {
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }],
    rejections: [{ from: 'b', to: 'a' }],
  }
  const before = JSON.stringify(input)
  normalizeFlow(input)
  assert.equal(JSON.stringify(input), before)
})

test('validateFlow accepts the v4 rejection-edges coverage fixture', () => {
  const r = validateFlow(v12Flow)
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
})

test('validateFlow errors on a rejection edge with a missing from node', () => {
  const r = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0, kind: 'source', successors: [] }],
    rejections: [{ from: 'ghost', to: 'a', rate: 0.2 }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /ghost/.test(e)))
})

test('validateFlow errors on a rejection edge with a missing to node', () => {
  const r = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0, kind: 'source', successors: [] }],
    rejections: [{ from: 'a', to: 'ghost', rate: 0.2 }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /ghost/.test(e)))
})

test('validateFlow errors when a node rejection rates sum to >= 1', () => {
  const r = validateFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', successors: ['rev'] },
      { id: 'rev', x: 1, y: 0, successors: [] },
    ],
    rejections: [
      { from: 'rev', to: 's', rate: 0.6 },
      { from: 'rev', to: 's', rate: 0.5 },
    ],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /sum/i.test(e)))
})

test('validateFlow errors on a rejection rate <= 0', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', successors: ['r'] },
            { id: 'r', x: 1, y: 0, successors: [] }],
    rejections: [{ from: 'r', to: 's', rate: 0 }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /rate/i.test(e)))
})

test('validateFlow errors on a rejection rate >= 1', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', successors: ['r'] },
            { id: 'r', x: 1, y: 0, successors: [] }],
    rejections: [{ from: 'r', to: 's', rate: 1 }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /rate/i.test(e)))
})

test('validateFlow warns when a rejection to is not upstream of from', () => {
  // a → b forward; a rejection a→b points forward, not back — probably an error.
  const r = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0, kind: 'source', successors: ['b'] },
            { id: 'b', x: 1, y: 0, successors: [] }],
    rejections: [{ from: 'a', to: 'b', rate: 0.2 }],
  })
  assert.equal(r.ok, true, 'a forward-pointing rejection is legal — only a warning')
  assert.ok(r.warnings.some(w => /upstream/i.test(w)))
})

test('validateFlow does not warn when a rejection to IS upstream of from', () => {
  const r = validateFlow({
    nodes: [{ id: 'a', x: 0, y: 0, kind: 'source', successors: ['b'] },
            { id: 'b', x: 1, y: 0, successors: [] }],
    rejections: [{ from: 'b', to: 'a', rate: 0.2 }],
  })
  assert.ok(!r.warnings.some(w => /upstream/i.test(w)))
})

test('validateFlow warns on a self-rejection (from === to)', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', successors: ['r'] },
            { id: 'r', x: 1, y: 0, successors: [] }],
    rejections: [{ from: 'r', to: 'r', rate: 0.2 }],
  })
  assert.ok(r.warnings.some(w => /self/i.test(w)))
})

// ── v1.3 L2 (bd ai-engineer-otci): large particles + split / combine ─────────
// normalizeFlow defaults (spec §2.3) + validateFlow rules (spec §2.4).

test('normalizeFlow fills particleSize:small on every source', () => {
  const out = normalizeFlow({
    nodes: [
      { id: 's1', x: 0, y: 0, kind: 'source' },
      { id: 's2', x: 1, y: 0, kind: 'source' },
      { id: 'n', x: 2, y: 0, kind: 'normal' },
    ],
  })
  assert.equal(out.nodes[0].particleSize, 'small')
  assert.equal(out.nodes[1].particleSize, 'small')
  // a non-source node never gains particleSize
  assert.equal(out.nodes[2].particleSize, undefined)
})

test('normalizeFlow fills transform:none on every node', () => {
  const out = normalizeFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source' },
      { id: 'n', x: 1, y: 0, kind: 'normal' },
    ],
  })
  assert.equal(out.nodes[0].transform, 'none')
  assert.equal(out.nodes[1].transform, 'none')
})

test('normalizeFlow fills splitCount:4 on a split node', () => {
  const out = normalizeFlow({
    nodes: [{ id: 'd', x: 0, y: 0, transform: 'split' }],
  })
  assert.equal(out.nodes[0].splitCount, DEFAULT_SPLIT_COUNT)
  assert.equal(out.nodes[0].splitCount, 4)
})

test('normalizeFlow fills combineCount:4 on a combine node', () => {
  const out = normalizeFlow({
    nodes: [{ id: 'c', x: 0, y: 0, transform: 'combine' }],
  })
  assert.equal(out.nodes[0].combineCount, DEFAULT_COMBINE_COUNT)
  assert.equal(out.nodes[0].combineCount, 4)
})

test('normalizeFlow does not add split/combine counts to a transform:none node', () => {
  const out = normalizeFlow({
    nodes: [{ id: 'n', x: 0, y: 0, transform: 'none' }],
  })
  assert.equal(out.nodes[0].splitCount, undefined)
  assert.equal(out.nodes[0].combineCount, undefined)
})

test('normalizeFlow preserves explicit particleSize / transform / counts', () => {
  const out = normalizeFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', particleSize: 'large' },
      { id: 'd', x: 1, y: 0, transform: 'split', splitCount: 7 },
      { id: 'c', x: 2, y: 0, transform: 'combine', combineCount: 9 },
    ],
  })
  assert.equal(out.nodes[0].particleSize, 'large')
  assert.equal(out.nodes[1].splitCount, 7)
  assert.equal(out.nodes[2].combineCount, 9)
})

test('normalizeFlow leaves the v5 large-particle coverage fixture intact', () => {
  const out = normalizeFlow(n5Flow)
  assert.equal(out.nodes.find(n => n.id === 'epic').particleSize, 'large')
  assert.equal(out.nodes.find(n => n.id === 'decompose').transform, 'split')
  assert.equal(out.nodes.find(n => n.id === 'decompose').splitCount, 3)
  assert.equal(out.nodes.find(n => n.id === 'integrate').combineCount, 5)
})

test('validateFlow accepts the v5 large-particle coverage fixture', () => {
  const r = validateFlow(n5Flow)
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
})

test('validateFlow errors on a split node with splitCount < 2', () => {
  const r = validateFlow({
    nodes: [{ id: 'd', x: 0, y: 0, kind: 'source', transform: 'split',
              splitCount: 1, successors: [] }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /splitCount/.test(e)))
})

test('validateFlow errors on a combine node with combineCount < 2', () => {
  const r = validateFlow({
    nodes: [{ id: 'c', x: 0, y: 0, kind: 'source', transform: 'combine',
              combineCount: 1, successors: [] }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /combineCount/.test(e)))
})

test('validateFlow does not error on a split node that authors no splitCount', () => {
  // normalizeFlow defaults splitCount to 4 — a node omitting it is not an error.
  const r = validateFlow({
    nodes: [{ id: 'd', x: 0, y: 0, kind: 'source', transform: 'split',
              successors: [] }],
  })
  assert.ok(!r.errors.some(e => /splitCount/.test(e)))
})

test('validateFlow warns when a combine node has capacity < combineCount', () => {
  // The engine holds smalls at a combine node until combineCount accumulate.
  // capacity < combineCount deadlocks: inbound smalls hit the capacity gate
  // before the pile reaches combineCount, so the combine never fires.
  const r = validateFlow({
    nodes: [{ id: 'c', x: 0, y: 0, kind: 'source', transform: 'combine',
              combineCount: 5, capacity: 3, successors: [] }],
  })
  assert.ok(r.ok, 'capacity < combineCount is a warning, not an error')
  assert.ok(r.warnings.some(w => /capacity/.test(w) && /combineCount/.test(w)),
    'warns about the capacity/combineCount mismatch')
})

test('validateFlow warns on capacity < DEFAULT_COMBINE_COUNT when count is unauthored', () => {
  // A combine node authoring no combineCount uses DEFAULT_COMBINE_COUNT (4).
  const r = validateFlow({
    nodes: [{ id: 'c', x: 0, y: 0, kind: 'source', transform: 'combine',
              capacity: 2, successors: [] }],
  })
  assert.ok(r.warnings.some(w => /capacity/.test(w) && /combineCount/.test(w)))
})

test('validateFlow does not warn when a combine node has capacity >= combineCount', () => {
  const r = validateFlow({
    nodes: [{ id: 'c', x: 0, y: 0, kind: 'source', transform: 'combine',
              combineCount: 4, capacity: 6, successors: [] }],
  })
  assert.ok(!r.warnings.some(w => /capacity/.test(w) && /combineCount/.test(w)))
})

test('validateFlow combine-capacity check ignores non-combine nodes', () => {
  // A plain node with a low authored capacity must not trip the combine warning.
  const r = validateFlow({
    nodes: [{ id: 'n', x: 0, y: 0, kind: 'source', capacity: 1, successors: [] }],
  })
  assert.ok(!r.warnings.some(w => /combineCount/.test(w)))
})

test('validateFlow warns on a large-particle path node too narrow to admit one', () => {
  // large source → a narrow node sitting before any split → carries large.
  const r = validateFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', particleSize: 'large',
        successors: ['narrow'] },
      { id: 'narrow', x: 1, y: 0, width: 20, transform: 'split', splitCount: 4,
        successors: [] },
    ],
  })
  assert.ok(r.warnings.some(w => /too narrow/i.test(w)))
})

test('validateFlow does not warn for a wide node on a large-particle path', () => {
  const r = validateFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', particleSize: 'large',
        successors: ['wide'] },
      { id: 'wide', x: 1, y: 0, width: 70, successors: [] },
    ],
  })
  assert.ok(!r.warnings.some(w => /too narrow/i.test(w)))
})

test('validateFlow does not warn for a narrow node downstream of a split', () => {
  // a split converts large→small; a narrow node AFTER it carries only small.
  const r = validateFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', particleSize: 'large',
        successors: ['d'] },
      { id: 'd', x: 1, y: 0, width: 80, transform: 'split', splitCount: 4,
        successors: ['narrow'] },
      { id: 'narrow', x: 2, y: 0, width: 20, successors: [] },
    ],
  })
  assert.ok(!r.warnings.some(w => /too narrow/i.test(w)))
})

test('validateFlow warns when a flow emits large but has no split node and a node is too narrow', () => {
  const r = validateFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', particleSize: 'large',
        successors: ['narrow'] },
      { id: 'narrow', x: 1, y: 0, width: 22, successors: [] },
    ],
  })
  assert.ok(r.warnings.some(w => /no split node/i.test(w)))
})

test('validateFlow does not raise the no-split warning when a split node exists', () => {
  const r = validateFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', particleSize: 'large',
        successors: ['narrow'] },
      { id: 'narrow', x: 1, y: 0, width: 22, transform: 'split', splitCount: 4,
        successors: [] },
    ],
  })
  assert.ok(!r.warnings.some(w => /no split node/i.test(w)))
})

test('validateFlow raises no large-particle warnings for a small-only flow', () => {
  const r = validateFlow({
    nodes: [
      { id: 's', x: 0, y: 0, kind: 'source', particleSize: 'small',
        successors: ['narrow'] },
      { id: 'narrow', x: 1, y: 0, width: 20, successors: [] },
    ],
  })
  assert.ok(!r.warnings.some(w => /too narrow|no split/i.test(w)))
})

test('validateFlow warns on an unknown transform value', () => {
  const r = validateFlow({
    nodes: [{ id: 'n', x: 0, y: 0, kind: 'source', transform: 'wibble',
              successors: [] }],
  })
  assert.ok(r.warnings.some(w => /unknown transform/i.test(w)))
})

test('validateFlow warns on an unknown particleSize value', () => {
  const r = validateFlow({
    nodes: [{ id: 's', x: 0, y: 0, kind: 'source', particleSize: 'huge',
              successors: [] }],
  })
  assert.ok(r.warnings.some(w => /unknown particleSize/i.test(w)))
})

test('MIN_LARGE_ADMITTING_WIDTH is the documented ~28 threshold', () => {
  assert.equal(MIN_LARGE_ADMITTING_WIDTH, 28)
})
