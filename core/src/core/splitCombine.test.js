import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createFlowSimulation,
  radiusForSize,
} from './useFlowSimulation.js'
import { PARTICLE_RADIUS, LARGE_PARTICLE_SCALE } from './flowCurve.js'

// ──────────────────────────────────────────────────────────────────────────
// v1.3 L3 — engine split / combine mechanics (spec
// docs/superpowers/specs/2026-05-20-flow-v1.3-L3-split-combine-design.md;
// parent spec §3.2–§3.5, §7 items 5–7).
//
// Synthetic wide-band flows (width ≥ 60) so a large particle (r=9) travels
// comfortably. Every field the engine reads directly is set explicitly —
// these fixtures bypass normalizeFlow, exactly like linearFlow / forkFlow.
// ──────────────────────────────────────────────────────────────────────────

// Large source → split node (×4) → wide sink.
const splitFlow = {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  nodes: [
    { id: 'src', x: 200, y: 450, kind: 'source', rate: 1.0, particleSize: 'large',
      capacity: 3, latency: 0.5, width: 90, successors: ['decompose'] },
    { id: 'decompose', x: 700, y: 450, kind: 'normal', transform: 'split', splitCount: 4,
      capacity: 3, latency: 0.6, width: 90, successors: ['sink'] },
    { id: 'sink', x: 1200, y: 450, kind: 'normal',
      capacity: 30, latency: 0.4, width: 90, successors: [] },
  ],
}

// Small source → combine node (×4) → wide ship.
const combineFlow = {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  nodes: [
    { id: 'src', x: 200, y: 450, kind: 'source', rate: 3.0, particleSize: 'small',
      capacity: 4, latency: 0.3, width: 90, successors: ['integrate'] },
    { id: 'integrate', x: 800, y: 450, kind: 'normal', transform: 'combine', combineCount: 4,
      capacity: 8, latency: 0.5, width: 90, successors: ['ship'] },
    { id: 'ship', x: 1300, y: 450, kind: 'normal',
      capacity: 30, latency: 0.4, width: 90, successors: [] },
  ],
}

// Pure large-particle flow, no transform nodes — for physics / capacity.
const largeFlow = {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  nodes: [
    { id: 'src', x: 200, y: 450, kind: 'source', rate: 1.5, particleSize: 'large',
      capacity: 2, latency: 0.5, width: 60, successors: ['mid'] },
    { id: 'mid', x: 700, y: 450, kind: 'normal',
      capacity: 2, latency: 0.6, width: 60, successors: ['end'] },
    { id: 'end', x: 1200, y: 450, kind: 'normal',
      capacity: 2, latency: 0.4, width: 60, successors: [] },
  ],
}

const run = (sim, steps, dt = 1 / 60) => { for (let i = 0; i < steps; i++) sim.step(dt) }

// ── Size wiring ───────────────────────────────────────────────────────────

test('radiusForSize: small=PARTICLE_RADIUS, large=PARTICLE_RADIUS×LARGE_PARTICLE_SCALE', () => {
  assert.equal(radiusForSize('small'), PARTICLE_RADIUS)            // 3
  assert.equal(radiusForSize('large'), PARTICLE_RADIUS * LARGE_PARTICLE_SCALE)  // 9
  assert.equal(LARGE_PARTICLE_SCALE, 3)
})

test('a large-particle source emits agents with size:large and radius 9', () => {
  const sim = createFlowSimulation(largeFlow, { initialAgents: 4 })
  run(sim, 600)
  assert.ok(sim.agents.length > 0, 'flow should be populated')
  for (const a of sim.agents) {
    assert.equal(a.size, 'large', `agent ${a.id} should be large`)
    assert.equal(a.radius, PARTICLE_RADIUS * LARGE_PARTICLE_SCALE,
      `large agent ${a.id} radius`)
  }
})

test('a small-particle source emits agents with size:small and radius 3', () => {
  const sim = createFlowSimulation(combineFlow, { initialAgents: 4 })
  run(sim, 120)
  const movers = sim.agents.filter(a => a.lifecycle === 'in-process' && !a._held)
  assert.ok(movers.length > 0, 'flow should have in-process small agents')
  for (const a of movers) {
    assert.equal(a.size, 'small', `agent ${a.id} should be small`)
    assert.equal(a.radius, PARTICLE_RADIUS, `small agent ${a.id} radius`)
  }
})

// ── Split (§3.3, §7 item 5) ───────────────────────────────────────────────

test('split: a large agent into a splitCount=4 node yields exactly 4 small agents', () => {
  const sim = createFlowSimulation(splitFlow, { initialAgents: 4 })
  run(sim, 2400)  // 40s
  assert.ok(sim.traces.splits.length >= 1,
    `expected at least one split, got ${sim.traces.splits.length}`)
  for (const ev of sim.traces.splits) {
    assert.equal(ev.nodeId, 'decompose', 'split recorded at the split node')
    assert.equal(ev.agentIds.length, 4,
      `split should spawn exactly splitCount=4 smalls, got ${ev.agentIds.length}`)
    // 1 large consumed, 4 small produced → agent-count delta +(N−1)=+3.
    assert.ok(ev.sourceId, 'split records the despawned large')
    assert.equal(new Set(ev.agentIds).size, 4, 'spawned ids are distinct')
    assert.ok(!ev.agentIds.includes(ev.sourceId), 'large id not reused')
  }
})

test('split: the despawned large is gone and small particles reach the downstream sink', () => {
  const sim = createFlowSimulation(splitFlow, { initialAgents: 4 })
  run(sim, 2400)
  assert.ok(sim.traces.splits.length >= 1, 'a split must have happened')
  const splitSourceIds = new Set(sim.traces.splits.map(s => s.sourceId))
  for (const a of sim.agents) {
    assert.ok(!splitSourceIds.has(a.id),
      `despawned large ${a.id} should not still be alive`)
  }
  // Smalls produced by the split flow downstream into the sink.
  const sinkEntries = sim.traces.entries.filter(e => e.nodeId === 'sink')
  assert.ok(sinkEntries.length >= 4,
    `split children should reach the sink, got ${sinkEntries.length} entries`)
})

test('split: the large decomposes AT the split node — forward-only, no downstream-then-backward teleport (bd ai-engineer-4pce)', () => {
  // Regression for the v1.3-L3 cross-OUT split bug (Jason 2026-05-21, "Test
  // explosion"): the large used to enter the split node, traverse the ENTIRE
  // split→successor segment, despawn at the SUCCESSOR's anchor, and only then
  // spawn the children back at the split node — a visible backward teleport.
  // The fix decomposes the large AT the split node on the cross-INTO frame.
  const sim = createFlowSimulation(splitFlow, { initialAgents: 4 })
  const splitX = splitFlow.nodes.find(n => n.id === 'decompose').x  // 700
  const sinkX  = splitFlow.nodes.find(n => n.id === 'sink').x       // 1200
  // Last in-process position seen for every large, frame by frame.
  const lastLargeX = new Map()
  for (let i = 0; i < 2400; i++) {
    for (const a of sim.agents) {
      if (a.size === 'large' && a.lifecycle === 'in-process') {
        lastLargeX.set(a.id, a.x)
      }
    }
    sim.step(1 / 60)
  }
  assert.ok(sim.traces.splits.length >= 1, 'a split must have happened')
  for (const ev of sim.traces.splits) {
    const x = lastLargeX.get(ev.sourceId)
    assert.ok(x != null, `the despawned large ${ev.sourceId} was tracked while alive`)
    // The large must despawn AT the split node — never after travelling
    // downstream toward the sink.
    assert.ok(Math.abs(x - splitX) < Math.abs(x - sinkX),
      `large ${ev.sourceId} decomposed at x=${x.toFixed(0)}: expected at the `
      + `split node (x≈${splitX}), not downstream toward the sink (x≈${sinkX})`)
    // Its children must enter the simulation AT the split node and then flow
    // FORWARD (their first downstream entry is the sink, not a node upstream
    // of the split).
    for (const childId of ev.agentIds) {
      const childEntries = sim.traces.entries.filter(e => e.id === childId)
      assert.equal(childEntries[0].nodeId, 'decompose',
        `split child ${childId} must spawn AT the split node`)
    }
  }
})

test('split: a split node passes a SMALL arrival through unchanged (no decomposition)', () => {
  const smallThroughSplit = {
    viewBox: { w: 1600, h: 900 }, baseSpeed: 200,
    nodes: [
      { id: 'src', x: 200, y: 450, kind: 'source', rate: 2.0, particleSize: 'small',
        capacity: 3, latency: 0.3, width: 60, successors: ['decompose'] },
      { id: 'decompose', x: 700, y: 450, kind: 'normal', transform: 'split', splitCount: 4,
        capacity: 3, latency: 0.4, width: 60, successors: ['sink'] },
      { id: 'sink', x: 1200, y: 450, kind: 'normal',
        capacity: 30, latency: 0.4, width: 60, successors: [] },
    ],
  }
  const sim = createFlowSimulation(smallThroughSplit, { initialAgents: 4 })
  run(sim, 1800)
  assert.equal(sim.traces.splits.length, 0,
    'a small arrival at a split node must NOT trigger a split')
  assert.ok(sim.traces.exits.some(e => e.nodeId === 'sink'),
    'smalls should pass through and complete at the sink')
})

// ── Combine (§3.4, §7 item 6) ─────────────────────────────────────────────

test('combine: 4 small agents into a combineCount=4 node yield exactly one large', () => {
  const sim = createFlowSimulation(combineFlow, { initialAgents: 4 })
  run(sim, 2400)
  assert.ok(sim.traces.combines.length >= 1,
    `expected at least one combine, got ${sim.traces.combines.length}`)
  for (const ev of sim.traces.combines) {
    assert.equal(ev.nodeId, 'integrate', 'combine recorded at the combine node')
    assert.equal(ev.agentIds.length, 4,
      `combine consumes exactly combineCount=4 smalls, got ${ev.agentIds.length}`)
    assert.ok(ev.largeId, 'combine records the spawned large')
  }
  // The spawned large is a real large agent (alive or already shipped).
  const everLargeIds = new Set(sim.traces.combines.map(c => c.largeId))
  for (const a of sim.agents) {
    if (everLargeIds.has(a.id)) {
      assert.equal(a.size, 'large', `combine-spawned ${a.id} must be large`)
    }
  }
})

test('combine: fires ONLY at combineCount — never before — and the pile accumulates first', () => {
  const sim = createFlowSimulation(combineFlow, { initialAgents: 4 })
  const COMBINE_COUNT = 4
  let maxHeldBeforeFirstCombine = 0
  for (let i = 0; i < 2400; i++) {
    sim.step(1 / 60)
    const combines = sim.traces.combines.length
    const enteredCombine = sim.traces.entries.filter(e => e.nodeId === 'integrate').length
    // A combine can never have fired before combineCount smalls entered it.
    assert.ok(combines * COMBINE_COUNT <= enteredCombine,
      `combine fired early: ${combines} combines but only ${enteredCombine} entries`)
    if (combines === 0) {
      const held = sim.agents.filter(a => a._held === 'integrate').length
      if (held > maxHeldBeforeFirstCombine) maxHeldBeforeFirstCombine = held
    }
  }
  assert.ok(sim.traces.combines.length >= 1, 'a combine must have happened')
  assert.ok(maxHeldBeforeFirstCombine >= 2,
    `smalls should visibly pile up before firing, max held seen = ${maxHeldBeforeFirstCombine}`)
})

test('combine: a combine node passes a LARGE arrival through unchanged', () => {
  const largeThroughCombine = {
    viewBox: { w: 1600, h: 900 }, baseSpeed: 200,
    nodes: [
      { id: 'src', x: 200, y: 450, kind: 'source', rate: 1.0, particleSize: 'large',
        capacity: 2, latency: 0.5, width: 90, successors: ['integrate'] },
      { id: 'integrate', x: 800, y: 450, kind: 'normal', transform: 'combine', combineCount: 4,
        capacity: 8, latency: 0.5, width: 90, successors: ['ship'] },
      { id: 'ship', x: 1300, y: 450, kind: 'normal',
        capacity: 30, latency: 0.4, width: 90, successors: [] },
    ],
  }
  const sim = createFlowSimulation(largeThroughCombine, { initialAgents: 4 })
  run(sim, 2400)
  assert.equal(sim.traces.combines.length, 0,
    'a large arrival at a combine node must NOT be held or combined')
  assert.ok(!sim.agents.some(a => a._held),
    'no agent should be held — larges are not held')
  assert.ok(sim.traces.exits.some(e => e.nodeId === 'ship'),
    'larges should pass straight through to ship')
})

// ── Large physics + capacity (§3.2, §7 item 7) ────────────────────────────

test('large physics: no large particle escapes a band wide enough to admit it', () => {
  const sim = createFlowSimulation(largeFlow, { initialAgents: 6 })
  const SAMPLES = 200
  const violations = []
  for (let i = 0; i < 1200; i++) {  // 20s
    sim.step(1 / 60)
    for (const a of sim.agents) {
      if (a.lifecycle === 'pending') continue
      const branch = sim.branches.find(b => b.nodeIds.includes(a.currentNodeId))
      if (!branch) continue
      let bestDist2 = Infinity
      for (let j = 0; j <= SAMPLES; j++) {
        const s = (j / SAMPLES) * branch.centerline.totalLength
        const p = branch.centerline.pointAtArcLength(s)
        const d2 = (p.x - a.x) ** 2 + (p.y - a.y) ** 2
        if (d2 < bestDist2) bestDist2 = d2
      }
      const myHalfW = (sim.widths[a.currentNodeId] ?? 10) / 2
      const dist = Math.sqrt(bestDist2)
      // The agent CENTRE must stay within halfW; its circle edge (radius 9)
      // is kept inside by physWallMargin. 2-unit grace for numerical noise.
      if (dist > myHalfW + 2) violations.push({ id: a.id, dist, myHalfW, t: i / 60 })
    }
  }
  assert.equal(sim.traces.escapes.length, 0,
    `teleport backstop fired: ${JSON.stringify(sim.traces.escapes.slice(0, 2))}`)
  assert.equal(violations.length, 0,
    `large particles escaped: ${JSON.stringify(violations.slice(0, 3))}`)
})

test('capacity: a large particle occupies exactly one slot — occupancy never exceeds capacity', () => {
  const sim = createFlowSimulation(largeFlow, { initialAgents: 6 })
  const cap = Object.fromEntries(largeFlow.nodes.map(n => [n.id, n.capacity]))
  for (let i = 0; i < 1800; i++) {
    sim.step(1 / 60)
    for (const id of Object.keys(cap)) {
      assert.ok(sim.occupancy[id] <= cap[id],
        `occupancy[${id}]=${sim.occupancy[id]} exceeded capacity ${cap[id]} at t=${i / 60}`)
    }
  }
})
