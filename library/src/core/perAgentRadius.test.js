import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createFlowSimulation,
  agentRadius,
  physWallMargin,
  desiredSep,
  DESIRED_SEP_FACTOR,
} from './useFlowSimulation.js'
import { PARTICLE_RADIUS, WALL_MARGIN } from './flowCurve.js'
import n4Flow from '../../test/fixtures/flows/n4-toc-baseline.js'

// ──────────────────────────────────────────────────────────────────────────
// v1.3 L1 — per-agent radius refactor (spec §3.1, §7 item 1).
//
// L1 replaces the global PARTICLE_RADIUS assumption with a per-agent radius.
// It is behaviour-preserving: every agent is created with radius ==
// PARTICLE_RADIUS, so every per-agent / per-pair expression reduces exactly
// to its former global value. These focused tests pin that contract; the
// gate that L1 changed NOTHING observable is the rest of the engine suite
// still passing 281/0.
// ──────────────────────────────────────────────────────────────────────────

const linearFlow = {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  entryId: 'a',
  nodes: [
    { id: 'a', x:  200, y: 500, capacity: 1, latency: 0.6, successors: ['b'] },
    { id: 'b', x:  800, y: 500, capacity: 2, latency: 1.4, kind: 'constraint', successors: ['c'] },
    { id: 'c', x: 1400, y: 500, capacity: 1, latency: 0.4, successors: [] },
  ],
}

test('agentRadius defaults to PARTICLE_RADIUS for an agent with no radius field', () => {
  // Agents a test pushes straight onto sim.agents have no `radius` — the
  // fallback keeps the refactor invisible to such fixtures.
  assert.equal(agentRadius({}), PARTICLE_RADIUS)
  assert.equal(agentRadius({ radius: undefined }), PARTICLE_RADIUS)
  assert.equal(agentRadius({ radius: 9 }), 9)
})

test('every engine-created agent is initialised with radius === PARTICLE_RADIUS', () => {
  // Bulk-fill mode (linearFlow has no spawnRate): exercises the in-process
  // and pending seed agent literals.
  const bulk = createFlowSimulation(linearFlow, { initialAgents: 8 })
  assert.ok(bulk.agents.length > 0)
  for (const a of bulk.agents) {
    assert.equal(a.radius, PARTICLE_RADIUS, `seed agent ${a.id} missing radius`)
  }

  // Rate-limited mode (n4 fixture): exercises the seed, pending, and
  // createSourceAgents literals plus the promotion / recycle paths.
  const rl = createFlowSimulation(n4Flow, { initialAgents: 12 })
  for (let i = 0; i < 1800; i++) rl.step(1 / 60)
  assert.ok(rl.agents.length > 0)
  for (const a of rl.agents) {
    assert.equal(a.radius, PARTICLE_RADIUS,
      `agent ${a.id} (lifecycle ${a.lifecycle}) missing radius after 30s`)
  }
})

test('desiredSep reduces to the old 2.5 × PARTICLE_RADIUS when both radii are PARTICLE_RADIUS', () => {
  const a = { radius: PARTICLE_RADIUS }
  const b = { radius: PARTICLE_RADIUS }
  assert.equal(desiredSep(a, b), 2.5 * PARTICLE_RADIUS)   // 7.5 — the former global DESIRED_SEP
  // Also holds when the radius field is absent (fallback path).
  assert.equal(desiredSep({}, {}), 2.5 * PARTICLE_RADIUS)
})

test('desiredSep is per-pair: 1.25 × (rᵢ + rⱼ)', () => {
  const small = { radius: PARTICLE_RADIUS }          // r = 3
  const large = { radius: PARTICLE_RADIUS * 3 }      // r = 9 (L3 large particle)
  assert.equal(desiredSep(small, large), DESIRED_SEP_FACTOR * (3 + 9))   // 15
  assert.equal(desiredSep(large, large), DESIRED_SEP_FACTOR * (9 + 9))   // 22.5
})

test('physWallMargin reduces to PARTICLE_RADIUS + WALL_MARGIN for a small agent', () => {
  assert.equal(physWallMargin({ radius: PARTICLE_RADIUS }), PARTICLE_RADIUS + WALL_MARGIN)  // 5
  assert.equal(physWallMargin({}), PARTICLE_RADIUS + WALL_MARGIN)                            // fallback
  // A large agent's centre must keep further from the wall.
  assert.equal(physWallMargin({ radius: 9 }), 9 + WALL_MARGIN)
})
