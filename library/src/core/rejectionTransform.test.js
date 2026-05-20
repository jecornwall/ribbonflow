import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFlowSimulation, projectToCenterline } from './useFlowSimulation.js'
import { REJECTION_BAND_WIDTH, PARTICLE_RADIUS, LARGE_PARTICLE_SCALE } from './flowCurve.js'

// ──────────────────────────────────────────────────────────────────────────
// Cross-feature suite — v1.2 rejection edges × v1.3 large particles.
// bd ai-engineer-2mtd.
//
// Neither the v1.2 rejection suite (useFlowSimulation.test.js) nor the v1.3
// split/combine suite (splitCombine.test.js) exercised rejection × large or
// rejection × transform together. This file closes that gap:
//
//   1. a large particle (r=9) revising along a THIN rejection branch
//      (REJECTION_BAND_WIDTH=14, half-width 7 < the large radius) — the
//      Tier-1 no-escape invariant must still hold on rejection geometry
//      thinner than a forward ribbon;
//   2. rejection rolled on a SPLIT node — a large is rejection-rolled on
//      entry; rejected larges revise, un-rejected larges split;
//   3. rejection FROM a COMBINE node — the combine-fired large is subject
//      to the rejection roll (verifies the ai-engineer-zq54 fix).
//
// Synthetic flows — every field the engine reads is set explicitly, exactly
// like the linearFlow / splitFlow / rejectionFlow fixtures.
// ──────────────────────────────────────────────────────────────────────────

const LARGE_RADIUS = PARTICLE_RADIUS * LARGE_PARTICLE_SCALE  // 9
const run = (sim, steps, dt = 1 / 60) => { for (let i = 0; i < steps; i++) sim.step(dt) }

// ── Case 1 — large particle revising on a thin rejection branch ────────────
// A large-particle source feeds a linear pipeline; the `review` node rejects
// half its outflow back to `design`. A rejected large becomes 'revising' and
// rides the thin REJECTION_BAND_WIDTH=14 bow — a band whose half-width (7) is
// SMALLER than the large radius (9). The no-escape clamp collapses to
// maxAllowed=0, so the large's CENTRE is pinned to the rejection centerline.
const largeRejectFlow = {
  viewBox: { w: 1800, h: 900 }, baseSpeed: 200,
  rejections: [
    { from: 'review', to: 'design', rate: 0.5, bow: { side: 'below', depth: 110 } },
  ],
  nodes: [
    { id: 'intake', x: 200,  y: 450, kind: 'source', rate: 1.2, particleSize: 'large',
      capacity: 3, latency: 0.4, width: 90, successors: ['design'] },
    { id: 'design', x: 650,  y: 450, capacity: 3, latency: 0.5, width: 90, successors: ['review'] },
    { id: 'review', x: 1100, y: 450, capacity: 3, latency: 0.5, width: 90, successors: ['ship'] },
    { id: 'ship',   x: 1500, y: 450, capacity: 30, latency: 0.3, width: 90, successors: [] },
  ],
}

test('rejection×large: a large particle rides a thin rejection branch', () => {
  const sim = createFlowSimulation(largeRejectFlow, { initialAgents: 5 })
  let sawRevisingLarge = false
  for (let i = 0; i < 3600; i++) {
    sim.step(1 / 60)
    for (const a of sim.agents) {
      if (a.lifecycle === 'revising' && a.currentNodeId != null && a.size === 'large') {
        sawRevisingLarge = true
      }
    }
  }
  assert.ok(sim.traces.revisions.length > 0, 'some rejections occurred over 60s')
  assert.ok(sawRevisingLarge,
    'a large particle was actually seen riding a rejection branch')
})

test('rejection×large: Tier-1 no-escape holds for a large on a thin rejection arc', () => {
  const sim = createFlowSimulation(largeRejectFlow, { initialAgents: 5 })
  let maxCentreDist = 0
  let samples = 0
  for (let i = 0; i < 3600; i++) {
    sim.step(1 / 60)
    for (const a of sim.agents) {
      if (a.lifecycle !== 'revising' || a.currentNodeId == null || a.size !== 'large') continue
      const b = sim.branches.find(rb =>
        rb.kind === 'rejection' &&
        rb.nodeIds[0] === a.currentNodeId && rb.nodeIds[1] === a.targetNodeId)
      assert.ok(b, 'revising large is seated on a rejection branch')
      const d = Math.sqrt(projectToCenterline(b.centerline, a.x, a.y).distance2)
      if (d > maxCentreDist) maxCentreDist = d
      samples++
      // Tier-1 no-escape: the agent CENTRE stays within the band half-width.
      assert.ok(d <= REJECTION_BAND_WIDTH / 2,
        `large escaped the rejection band: centre ${d.toFixed(2)} > half-width 7`)
    }
  }
  assert.ok(samples > 0, 'a large was observed on a rejection branch')
  // The band half-width (7) is below the large radius (9), so the no-escape
  // clamp collapses to maxAllowed=0 — the large CENTRE is pinned to the
  // centerline (only sub-unit integration noise off it).
  assert.ok(maxCentreDist <= 2,
    `large should be pinned to the thin-arc centerline, max centre dist ${maxCentreDist.toFixed(2)}`)
  assert.equal(sim.traces.escapes.length, 0,
    `teleport backstop fired: ${JSON.stringify(sim.traces.escapes.slice(0, 2))}`)
})

// ── Case 2 — rejection rolled on a SPLIT node ──────────────────────────────
// A large-particle source feeds a `transform:'split'` node that also carries
// a rejection edge back to the source. A large entering the split node is
// rejection-rolled on entry: a rejected large revises (rides the rejection
// branch, never splits); an un-rejected large proceeds and decomposes.
const splitRejectFlow = {
  viewBox: { w: 2000, h: 900 }, baseSpeed: 240,
  rejections: [
    { from: 'decompose', to: 'intake', rate: 0.35, bow: { side: 'above', depth: 130 } },
  ],
  nodes: [
    { id: 'intake', x: 250,  y: 450, kind: 'source', rate: 3.0, particleSize: 'large',
      capacity: 8, latency: 0.25, width: 110, successors: ['decompose'] },
    { id: 'decompose', x: 850, y: 450, kind: 'normal', transform: 'split', splitCount: 4,
      capacity: 30, latency: 0.3, width: 110, successors: ['sink'] },
    { id: 'sink', x: 1500, y: 450, kind: 'normal',
      capacity: 120, latency: 0.4, width: 110, successors: [] },
  ],
}

test('rejection×split: a large is rejection-rolled on entry to a split node', () => {
  const sim = createFlowSimulation(splitRejectFlow, { initialAgents: 8, maxAgents: 400 })
  run(sim, 7200)  // 120s
  const splitChildIds = new Set(sim.traces.splits.flatMap(s => s.agentIds))
  // Larges that ENTERED the split node (excludes the split children that
  // also spawn there).
  const largeDecEntries = sim.traces.entries.filter(
    e => e.nodeId === 'decompose' && !splitChildIds.has(e.id)).length
  const revFromSplit = sim.traces.revisions.filter(r => r.from === 'decompose')
  assert.ok(largeDecEntries > 20,
    `need a stable sample of large entries to the split node (got ${largeDecEntries})`)
  assert.ok(sim.traces.splits.length > 0,
    'un-rejected larges still decompose at the split node')
  assert.ok(revFromSplit.length > 0,
    'rejected larges revise off the split node')
  // Every revision off the split node carries the split node as `from` and
  // the rejection edge `to`.
  for (const rev of revFromSplit) {
    assert.equal(rev.to, 'intake', 'split-node rejection routes to the edge `to`')
  }
  // The realised rejection frequency tracks the configured 0.35 rate.
  const freq = revFromSplit.length / largeDecEntries
  assert.ok(Math.abs(freq - 0.35) <= 0.12,
    `split-node rejection freq ${freq.toFixed(3)} should track rate 0.35`)
  assert.equal(sim.traces.escapes.length, 0,
    `teleport backstop fired: ${JSON.stringify(sim.traces.escapes.slice(0, 2))}`)
})

test('rejection×split: a rejected large does NOT also split', () => {
  const sim = createFlowSimulation(splitRejectFlow, { initialAgents: 8, maxAgents: 400 })
  run(sim, 7200)
  // A split records its source large in `sourceId`; a revision records the
  // revised agent in `agentId`. A given large is rejected OR split — the two
  // outcomes are mutually exclusive at the split-node exit.
  const splitSourceIds = new Set(sim.traces.splits.map(s => s.sourceId))
  const revisedFromSplit = sim.traces.revisions
    .filter(r => r.from === 'decompose')
    .map(r => r.agentId)
  for (const id of revisedFromSplit) {
    assert.ok(!splitSourceIds.has(id),
      `large ${id} was both rejected at and split by the decompose node`)
  }
})

// ── Case 3 — rejection FROM a combine node (ai-engineer-zq54 fix) ───────────
// Small particles pile into a `transform:'combine'` node; the combine-fired
// large is subject to the rejection roll at the node exit. Before zq54 a
// rejection edge whose `from` is a combine node was a silent no-op.
const combineRejectFlow = {
  viewBox: { w: 1900, h: 900 }, baseSpeed: 200,
  rejections: [
    { from: 'integrate', to: 'prep', rate: 0.4, bow: { side: 'above', depth: 120 } },
  ],
  nodes: [
    { id: 'src', x: 200, y: 450, kind: 'source', rate: 3.0, particleSize: 'small',
      capacity: 6, latency: 0.3, width: 90, successors: ['prep'] },
    { id: 'prep', x: 650, y: 450, kind: 'normal',
      capacity: 8, latency: 0.3, width: 90, successors: ['integrate'] },
    { id: 'integrate', x: 1150, y: 450, kind: 'normal', transform: 'combine', combineCount: 4,
      capacity: 8, latency: 0.5, width: 90, successors: ['ship'] },
    { id: 'ship', x: 1600, y: 450, kind: 'normal',
      capacity: 30, latency: 0.4, width: 90, successors: [] },
  ],
}

test('rejection×combine: a rejection edge FROM a combine node fires', () => {
  const sim = createFlowSimulation(combineRejectFlow, { initialAgents: 8 })
  run(sim, 5400)  // 90s
  assert.ok(sim.traces.combines.length > 0, 'combines occurred')
  const revFromCombine = sim.traces.revisions.filter(r => r.from === 'integrate')
  // Before zq54 this was always 0 — the held smalls return before the roll
  // point and the fired large was deferred-spawned past it.
  assert.ok(revFromCombine.length > 0,
    'a rejection edge from a combine node must actually fire')
  for (const rev of revFromCombine) {
    assert.equal(rev.to, 'prep', 'combine-node rejection routes to the edge `to`')
  }
})

test('rejection×combine: the rejected agent is the combine-fired LARGE', () => {
  const sim = createFlowSimulation(combineRejectFlow, { initialAgents: 8 })
  // The agent revising off a combine node must be a large — the combine
  // node's only output is the composed large particle.
  let sawRevisingLarge = false
  for (let i = 0; i < 5400; i++) {
    sim.step(1 / 60)
    for (const a of sim.agents) {
      if (a.lifecycle === 'revising' && a.currentNodeId === 'integrate') {
        assert.equal(a.size, 'large',
          'the agent revising off a combine node must be the combine-fired large')
        sawRevisingLarge = true
      }
    }
  }
  assert.ok(sawRevisingLarge, 'a combine-fired large was seen revising')
  // The combine-fired large is the only agent created by the combine — the
  // held smalls are despawned. Every largeId from a combine trace is a large.
  const largeIds = new Set(sim.traces.combines.map(c => c.largeId))
  assert.ok(largeIds.size > 0, 'combine traces record the fired larges')
})

test('rejection×combine: a rejected combine-large re-enters its `to` node', () => {
  const sim = createFlowSimulation(combineRejectFlow, { initialAgents: 8 })
  run(sim, 5400)
  const revFromCombine = sim.traces.revisions.filter(r => r.from === 'integrate')
  assert.ok(revFromCombine.length > 0, 'a combine-node rejection fired')
  // A rejected large rides the rejection branch back and ENTERS the `to` node.
  const reentered = revFromCombine.some(rev =>
    sim.traces.entries.some(e =>
      e.id === rev.agentId && e.nodeId === rev.to && e.t > rev.t))
  assert.ok(reentered,
    'a combine-rejected large re-entered the rejection edge `to` node')
  assert.equal(sim.traces.escapes.length, 0,
    `teleport backstop fired: ${JSON.stringify(sim.traces.escapes.slice(0, 2))}`)
})
