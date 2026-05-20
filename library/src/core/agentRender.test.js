import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RENDER_RADIUS_SMALL,
  renderRadiusForSize,
  renderRadiusForAgent,
} from './agentRender.js'
import { LARGE_PARTICLE_SCALE } from './flowCurve.js'

// ──────────────────────────────────────────────────────────────────────────
// v1.3 L4 — agent render radius (spec §4).
//
// FlowAgent draws an agent at a RENDER radius, distinct from the engine's
// PHYSICS radius (PARTICLE_RADIUS=3 / large=9). The render radius preserves
// the historical small-particle appearance (FlowAgent default r=3.5, the
// +0.5 legibility padding from the earlier review-capture fix) AND keeps the
// large:small visible ratio at exactly LARGE_PARTICLE_SCALE (3×) — the whole
// point of the feature is that a large dot reads as 3× a small one.
//
// Render geometry lives in this pure helper (no SFC compiler in the test
// runner) following the R3 precedent — FlowAgent.vue is a thin <circle>.
// ──────────────────────────────────────────────────────────────────────────

test('RENDER_RADIUS_SMALL preserves the historical FlowAgent default (3.5)', () => {
  assert.equal(RENDER_RADIUS_SMALL, 3.5)
})

test('renderRadiusForSize: small renders at the small render radius', () => {
  assert.equal(renderRadiusForSize('small'), RENDER_RADIUS_SMALL)
})

test('renderRadiusForSize: large renders at exactly LARGE_PARTICLE_SCALE× small', () => {
  assert.equal(renderRadiusForSize('large'), RENDER_RADIUS_SMALL * LARGE_PARTICLE_SCALE)
  assert.equal(renderRadiusForSize('large'), 10.5)
})

test('renderRadiusForSize: the large:small ratio is exactly 3×', () => {
  assert.equal(
    renderRadiusForSize('large') / renderRadiusForSize('small'),
    LARGE_PARTICLE_SCALE,
  )
})

test('renderRadiusForSize: unknown / missing size falls back to small', () => {
  assert.equal(renderRadiusForSize(undefined), RENDER_RADIUS_SMALL)
  assert.equal(renderRadiusForSize(null), RENDER_RADIUS_SMALL)
  assert.equal(renderRadiusForSize('medium'), RENDER_RADIUS_SMALL)
})

test('renderRadiusForAgent: reads agent.size', () => {
  assert.equal(renderRadiusForAgent({ size: 'large' }), 10.5)
  assert.equal(renderRadiusForAgent({ size: 'small' }), 3.5)
})

test('renderRadiusForAgent: an agent with no size renders small', () => {
  assert.equal(renderRadiusForAgent({}), RENDER_RADIUS_SMALL)
  assert.equal(renderRadiusForAgent(null), RENDER_RADIUS_SMALL)
  assert.equal(renderRadiusForAgent(undefined), RENDER_RADIUS_SMALL)
})
