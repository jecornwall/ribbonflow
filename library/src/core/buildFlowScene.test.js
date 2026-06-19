// flow/library/src/core/buildFlowScene.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFlowSimulation } from './useFlowSimulation.js'
import { buildFlowScene, agentsView } from './buildFlowScene.js'
import { REJECTION_PARTICLE_COLOR, DEFECTIVE_PARTICLE_COLOR, RIBBON_SCHEME_COLORS, RIBBON_SCHEME_COLORS_LIGHT } from './flowCurve.js'
import { RENDER_RADIUS_SMALL } from './agentRender.js'

// A minimal two-node linear flow — enough to exercise viewBox + one branch.
function linearFlow() {
  return {
    viewBox: { w: 1600, h: 900 },
    baseSpeed: 200,
    entryId: 'a',
    nodes: [
      { id: 'a', x: 200, y: 450, label: 'a', capacity: 1, latency: 0.6, successors: ['b'] },
      { id: 'b', x: 1200, y: 450, label: 'b', capacity: 1, latency: 0.6, successors: [] },
    ],
  }
}

test('buildFlowScene: viewBox defaults x/y to 0 and carries w/h', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const scene = buildFlowScene(flow, sim)
  assert.deepEqual(scene.viewBox, { x: 0, y: 0, w: 1600, h: 900 })
})

test('buildFlowScene: clip def rect equals the viewBox bounds, id is stable per call', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const scene = buildFlowScene(flow, sim)
  assert.equal(typeof scene.defs.clipId, 'string')
  assert.ok(scene.defs.clipId.length > 0)
  assert.deepEqual(scene.defs.clipRect, { x: 0, y: 0, width: 1600, height: 900 })
})

test('buildFlowScene: wobble def is null unless flow.inkWobble is set', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  assert.equal(buildFlowScene(flow, sim).defs.wobble, null)

  const wobbly = { ...linearFlow(), inkWobble: true }
  const wsim = createFlowSimulation(wobbly, { initialAgents: 0 })
  const wscene = buildFlowScene(wobbly, wsim)
  assert.equal(wscene.defs.wobble.baseFrequency, 0.012)
  assert.equal(wscene.defs.wobble.scale, 1.6)
  assert.ok(wscene.defs.wobble.id.length > 0)
})

test('agentsView: drops pending agents, keeps active ones', () => {
  const sim = {
    agents: [
      { id: 1, x: 10, y: 20, lifecycle: 'pending' },
      { id: 2, x: 30, y: 40, lifecycle: 'active' },
    ],
  }
  const view = agentsView(sim)
  assert.equal(view.length, 1)
  assert.equal(view[0].id, 2)
  assert.deepEqual([view[0].x, view[0].y], [30, 40])
})

test('agentsView: colour precedence — revising beats defective beats default', () => {
  const sim = {
    agents: [
      { id: 1, x: 0, y: 0, lifecycle: 'revising', defective: true },
      { id: 2, x: 0, y: 0, lifecycle: 'active', defective: true },
      { id: 3, x: 0, y: 0, lifecycle: 'active' },
    ],
  }
  const [a, b, c] = agentsView(sim)
  assert.equal(a.fill, REJECTION_PARTICLE_COLOR)
  assert.equal(b.fill, DEFECTIVE_PARTICLE_COLOR)
  assert.equal(c.fill, null)
})

test('agentsView: radius defaults to the small render radius', () => {
  const sim = { agents: [{ id: 1, x: 0, y: 0, lifecycle: 'active' }] }
  assert.equal(agentsView(sim)[0].r, RENDER_RADIUS_SMALL)
})

test('buildFlowScene: one ribbon primitive per non-rejection branch', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const scene = buildFlowScene(flow, sim)
  const ribbons = scene.static.filter((p) => p.kind === 'ribbon')
  const renderBranches = sim.branches.filter((b) => b.kind !== 'rejection')
  assert.equal(ribbons.length, renderBranches.length)
  for (const r of ribbons) {
    assert.equal(typeof r.d, 'string')
    assert.ok(r.d.startsWith('M'), `ribbon path should start with a moveto, got: ${r.d.slice(0, 8)}`)
  }
})

test('buildFlowScene: ribbon fill honours flow.ribbonColor, else neutral', () => {
  const neutralFlow = linearFlow()
  const nsim = createFlowSimulation(neutralFlow, { initialAgents: 0 })
  const nribbon = buildFlowScene(neutralFlow, nsim).static.find((p) => p.kind === 'ribbon')
  assert.ok(nribbon, 'expected at least one ribbon')
  assert.equal(nribbon.fill, RIBBON_SCHEME_COLORS.neutral)

  const tinted = { ...linearFlow(), ribbonColor: '#abcdef' }
  const tsim = createFlowSimulation(tinted, { initialAgents: 0 })
  const tribbon = buildFlowScene(tinted, tsim).static.find((p) => p.kind === 'ribbon')
  assert.ok(tribbon, 'expected at least one ribbon')
  assert.equal(tribbon.fill, '#abcdef')
})

// A linear flow whose middle node is GREEN — exercises the non-pinch
// two-tone overlay (plateau in full tone, wings in light tone).
function coloredFlow() {
  return {
    viewBox: { w: 1600, h: 900 },
    baseSpeed: 200,
    entryId: 'a',
    nodes: [
      { id: 'a', x: 200, y: 450, label: 'a', capacity: 1, latency: 0.6, colorScheme: 'neutral', successors: ['b'] },
      { id: 'b', x: 700, y: 450, label: 'b', capacity: 1, latency: 0.6, colorScheme: 'green', successors: ['c'] },
      { id: 'c', x: 1200, y: 450, label: 'c', capacity: 1, latency: 0.6, colorScheme: 'neutral', successors: [] },
    ],
  }
}

test('buildFlowScene: neutral-only flow emits no coloured-segment overlays', () => {
  const flow = linearFlow() // no colorScheme anywhere → all neutral
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const paths = buildFlowScene(flow, sim).static.filter((p) => p.kind === 'path')
  assert.equal(paths.length, 0)
})

test('buildFlowScene: a green node emits plateau (full) + wing (light) overlays', () => {
  const flow = coloredFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const paths = buildFlowScene(flow, sim).static.filter((p) => p.kind === 'path')
  assert.ok(paths.length >= 1, 'expected at least the plateau overlay')
  assert.ok(paths.some((p) => p.fill === RIBBON_SCHEME_COLORS.green), 'plateau in full green')
  for (const p of paths) {
    assert.ok(p.d.startsWith('M'))
    assert.ok([RIBBON_SCHEME_COLORS.green, RIBBON_SCHEME_COLORS_LIGHT.green].includes(p.fill))
  }
})
