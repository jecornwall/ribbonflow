// flow/library/src/core/buildFlowScene.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFlowSimulation } from './useFlowSimulation.js'
import { buildFlowScene } from './buildFlowScene.js'

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
