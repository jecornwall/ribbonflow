/**
 * agentRender.js — pure render-geometry helper for FlowAgent (v1.3 L4, spec §4).
 *
 * The engine carries a PHYSICS radius per agent (PARTICLE_RADIUS=3 for small,
 * 9 for large — see useFlowSimulation.radiusForSize). The renderer draws at a
 * RENDER radius, which is deliberately NOT the physics radius:
 *
 *   - Small particles render at RENDER_RADIUS_SMALL=3.5, not the physics 3.
 *     The +0.5 is the legibility padding established by the original FlowAgent
 *     default (a circle of physics-r=3 sits just below the legibility floor
 *     when the deck is scaled down for review captures). L4 preserves that
 *     appearance byte-for-byte — small particles look exactly as before.
 *
 *   - Large particles render at exactly LARGE_PARTICLE_SCALE× the small render
 *     radius (3× → 10.5). The feature's whole meaning is "a large dot reads as
 *     3× a small one"; scaling the render radius (not adding a fixed padding)
 *     keeps that visible ratio exact. Same fill colour as a small particle —
 *     size alone carries the meaning (Jason, 2026-05-20 brainstorm).
 *
 * Provenance note (applied default, spec §4): the spec text says FlowAgent
 * "draws the agent circle at agent.radius". Taken literally that would shrink
 * small particles from 3.5→3 — a silent regression of the deliberate
 * legibility-padding fix. We instead map physics size → render radius here,
 * preserving small=3.5 and giving large an exact 3× of that. Documented on
 * bd ai-engineer-8xhz.
 *
 * Kept as a pure module (no SFC compiler in the library test runner) so the
 * render radius is unit-testable — the R3 flowRejectionArc.js precedent.
 */
import { LARGE_PARTICLE_SCALE } from './flowCurve.js'

// The small-particle render radius — the historical FlowAgent default. Physics
// radius is 3; the rendered circle carries +0.5 of legibility padding.
export const RENDER_RADIUS_SMALL = 3.5

/**
 * Render radius for a particle of the given size. A large particle renders at
 * exactly LARGE_PARTICLE_SCALE× the small radius. Any unknown/missing size
 * falls back to small — a transient mid-edit designer state must never crash.
 *
 * @param {'small'|'large'|undefined} size
 * @returns {number} render radius in viewBox units
 */
export function renderRadiusForSize(size) {
  return size === 'large'
    ? RENDER_RADIUS_SMALL * LARGE_PARTICLE_SCALE
    : RENDER_RADIUS_SMALL
}

/**
 * Render radius for an agent object. Reads `agent.size` (the field the engine
 * sets from the emitting source / a combine fire). An agent with no size — a
 * fixture pushed straight onto sim.agents, a pre-v1.3 flow — renders small.
 *
 * @param {{size?: string}|null|undefined} agent
 * @returns {number} render radius in viewBox units
 */
export function renderRadiusForAgent(agent) {
  return renderRadiusForSize(agent ? agent.size : undefined)
}
