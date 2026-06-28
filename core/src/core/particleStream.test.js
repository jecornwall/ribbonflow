import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createParticleStream } from './particleStream.js'
import { RENDER_RADIUS_SMALL } from './agentRender.js'

const LINE = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
const stepN = (s, n, dt) => { for (let i = 0; i < n; i++) s.step(dt) }

test('a degenerate (<2-point) centreline yields an inert stream, never throws', () => {
  const s = createParticleStream({ points: [{ x: 0, y: 0 }], ratePerSec: 10, speed: 50 })
  assert.doesNotThrow(() => stepN(s, 10, 0.1))
  assert.equal(s.agents().length, 0)
  assert.equal(s.count, 0)
})

test('emits particles that ride the centreline at the render radius', () => {
  const s = createParticleStream({ points: LINE, ratePerSec: 10, speed: 50 })
  stepN(s, 60, 1 / 60) // 1s
  const agents = s.agents()
  assert.ok(agents.length > 0, 'should have emitted some particles')
  for (const a of agents) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y))
    assert.ok(a.x >= -0.01 && a.x <= 100.01, `x in range: ${a.x}`)
    assert.ok(Math.abs(a.y) < 1e-6, `no jitter → y on the line: ${a.y}`)
    assert.equal(a.r, RENDER_RADIUS_SMALL)
  }
})

test('reaches a steady-state count ≈ ratePerSec × travelTime', () => {
  // travelTime = total/speed = 100/50 = 2s; steady count ≈ 10/s × 2s = 20
  const s = createParticleStream({ points: LINE, ratePerSec: 10, speed: 50 })
  stepN(s, 600, 1 / 60) // 10s — well past fill
  assert.ok(s.count >= 18 && s.count <= 22, `steady count ~20, got ${s.count}`)
})

test('a stopped flow (ratePerSec 0) emits nothing and drains to empty', () => {
  const s = createParticleStream({ points: LINE, ratePerSec: 10, speed: 50 })
  stepN(s, 120, 1 / 60)          // fill
  assert.ok(s.count > 0)
  s.update({ ratePerSec: 0 })    // collapse: flow stops
  stepN(s, 240, 1 / 60)          // 4s — longer than travelTime
  assert.equal(s.count, 0, 'pipe drains and goes still')
})

test('density scales with rate (more particles when faster)', () => {
  const slow = createParticleStream({ points: LINE, ratePerSec: 5, speed: 50 })
  const fast = createParticleStream({ points: LINE, ratePerSec: 20, speed: 50 })
  stepN(slow, 600, 1 / 60); stepN(fast, 600, 1 / 60)
  assert.ok(fast.count > slow.count, `fast (${fast.count}) denser than slow (${slow.count})`)
})

test('even spacing within a frame (no start-of-pipe clumping)', () => {
  // a single large dt that emits several particles at once must spread them
  const s = createParticleStream({ points: LINE, ratePerSec: 30, speed: 60 })
  s.step(0.2) // 0.2s × 30/s = 6 emissions in one frame
  const xs = s.agents().map((a) => a.x).sort((a, b) => a - b)
  assert.ok(xs.length >= 5, `several particles emitted, got ${xs.length}`)
  const gaps = xs.slice(1).map((x, i) => x - xs[i])
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  for (const g of gaps) assert.ok(Math.abs(g - mean) < mean * 0.5 + 1e-6, `gaps even-ish: ${gaps}`)
})

test('seeded jitter is deterministic and lateral; unseeded still runs', () => {
  const a = createParticleStream({ points: LINE, ratePerSec: 10, speed: 50, seed: 7, jitter: 4 })
  const b = createParticleStream({ points: LINE, ratePerSec: 10, speed: 50, seed: 7, jitter: 4 })
  stepN(a, 120, 1 / 60); stepN(b, 120, 1 / 60)
  assert.deepEqual(a.agents(), b.agents(), 'same seed → identical agents')
  assert.ok(a.agents().some((p) => Math.abs(p.y) > 1e-6), 'jitter pushes particles off the centreline')
  const u = createParticleStream({ points: LINE, ratePerSec: 10, speed: 50, jitter: 4 })
  assert.doesNotThrow(() => stepN(u, 60, 1 / 60))
})

test('update() retunes rate and speed live', () => {
  const s = createParticleStream({ points: LINE, ratePerSec: 0, speed: 0 })
  stepN(s, 120, 1 / 60)
  assert.equal(s.count, 0)
  s.update({ ratePerSec: 10, speed: 50 })
  stepN(s, 120, 1 / 60)
  assert.ok(s.count > 0, 'starts flowing after update')
  s.reset()
  assert.equal(s.count, 0, 'reset clears particles')
})
