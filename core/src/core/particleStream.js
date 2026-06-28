/**
 * particleStream.js — a generic, headless particle stream along a centreline.
 *
 * The reusable foundation under ribbonflow's motion: emit particles at a rate,
 * advance each along the arc-length centreline at a speed, consume them at the
 * end. It is deliberately NOT coupled to the flow/station model
 * (createFlowSimulation) — there are no nodes, capacities, latencies, forks or
 * constraints here. Any host that has *a curve and a throughput* can drive it:
 * the station pipeline composes one stream per branch, and an embedder (e.g. a
 * stock-and-flow pipe) drives one stream per pipe.
 *
 * Pure + DOM-free. The host calls `step(dt)` each frame and reads `agents()` for
 * `{ id, x, y, r }` circles to draw. Deterministic when a `seed` is given
 * (mulberry32 lateral jitter); unseeded it uses Math.random, so production
 * playback is unchanged.
 *
 * Built on the same `buildCenterline` arc-length machinery the rest of the
 * library uses, so motion matches by construction.
 */
import { buildCenterline } from './flowCurve.js'
import { resolveRng } from './rng.js'
import { RENDER_RADIUS_SMALL } from './agentRender.js'

/**
 * @typedef {object} ParticleStreamConfig
 * @property {{x:number,y:number}[]} points — centreline anchors (>= 2). Fewer
 *   yields an inert stream (never throws — a transient host state must not crash).
 * @property {number} [ratePerSec=0] — emission rate (particles/sec). <= 0 emits
 *   nothing, so a stopped flow drains and goes still.
 * @property {number} [speed=0] — travel speed along the centreline (units/sec).
 * @property {number} [seed] — deterministic RNG seed for lateral jitter.
 * @property {number} [jitter=0] — lateral jitter amplitude (units, ± off centre).
 * @property {number} [renderRadius=RENDER_RADIUS_SMALL] — agent circle radius.
 */

/**
 * Create a particle stream.
 * @param {ParticleStreamConfig} [cfg]
 * @returns {{
 *   step(dt:number):void,
 *   agents():{id:number,x:number,y:number,r:number}[],
 *   update(next:{ratePerSec?:number,speed?:number}):void,
 *   reset():void,
 *   readonly count:number,
 * }}
 */
export function createParticleStream(cfg = {}) {
  const points = Array.isArray(cfg.points) ? cfg.points : []
  if (points.length < 2) return inertStream()

  const centerline = buildCenterline(points)
  const total = centerline.totalLength
  const rand = resolveRng(cfg.seed)
  const renderRadius = typeof cfg.renderRadius === 'number' ? cfg.renderRadius : RENDER_RADIUS_SMALL
  const jitter = Math.max(0, cfg.jitter ?? 0)

  let ratePerSec = Math.max(0, cfg.ratePerSec ?? 0)
  let speed = Math.max(0, cfg.speed ?? 0)
  let nextId = 1
  let emitAcc = 0
  /** @type {{id:number, s:number, lateral:number}[]} */
  let particles = []

  function step(dt) {
    if (!(dt > 0) || total <= 0) return
    // advance + consume at the far end
    if (speed > 0 && particles.length > 0) {
      for (const p of particles) p.s += speed * dt
      particles = particles.filter((p) => p.s <= total)
    }
    // emit; back-date each new particle by its sub-frame age so spacing is even
    if (ratePerSec > 0 && speed > 0) {
      emitAcc += ratePerSec * dt
      while (emitAcc >= 1) {
        emitAcc -= 1
        const ageInFrame = emitAcc / ratePerSec      // seconds it has already travelled
        const s0 = Math.min(total, speed * ageInFrame)
        const lateral = jitter > 0 ? (rand() - 0.5) * 2 * jitter : 0
        particles.push({ id: nextId++, s: s0, lateral })
      }
    } else {
      emitAcc = 0
    }
  }

  function agents() {
    const out = []
    for (const p of particles) {
      const c = centerline.pointAtArcLength(p.s)
      let x = c.x, y = c.y
      if (p.lateral !== 0) {
        const t = centerline.tangentAtArcLength(p.s)
        // normal = tangent rotated 90°: (-ty, tx)
        x += -t.y * p.lateral
        y += t.x * p.lateral
      }
      out.push({ id: p.id, x, y, r: renderRadius })
    }
    return out
  }

  function update(next = {}) {
    if (typeof next.ratePerSec === 'number') ratePerSec = Math.max(0, next.ratePerSec)
    if (typeof next.speed === 'number') speed = Math.max(0, next.speed)
  }

  function reset() {
    particles = []
    emitAcc = 0
  }

  return {
    step, agents, update, reset,
    get count() { return particles.length },
  }
}

/** A no-op stream for a degenerate (<2-point) centreline. */
function inertStream() {
  return {
    step() {},
    agents() { return [] },
    update() {},
    reset() {},
    get count() { return 0 },
  }
}
