// flow/library/src/render/mountFlowAuto.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountFlowAuto } from './mountFlowAuto.js'
import { makeFakeScheduler, makeFakeIntersection } from '../../test/support/fakeEnv.js'

function host() {
  const { document } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>')
  return { document, el: document.getElementById('host') }
}
function env(h) {
  const sched = makeFakeScheduler()
  const inter = makeFakeIntersection()
  return {
    document: h.document,
    raf: sched.raf, caf: sched.caf,
    IntersectionObserver: inter.IntersectionObserver,
    visibilityDocument: inter.document,
  }
}
function singleFlow() {
  return {
    viewBox: { w: 1600, h: 900 }, entryId: 'a', spawnRate: 1, initialAgents: 8,
    nodes: [
      { id: 'a', x: 200, y: 450, label: 'a', capacity: 1, latency: 0.6, successors: ['b'] },
      { id: 'b', x: 1200, y: 450, label: 'b', capacity: 1, latency: 0.6, successors: [] },
    ],
  }
}
function rawSet() {
  return { states: [{ key: 's0', flow: singleFlow() }, { key: 's1', flow: singleFlow() }] }
}

test('mountFlowAuto: mounts a single flow as one <svg.flow-graph>', () => {
  const h = host()
  const handle = mountFlowAuto(h.el, singleFlow(), env(h))
  assert.ok(h.el.querySelector('svg.flow-graph'), 'single-flow svg mounted')
  handle.destroy()
})

test('mountFlowAuto: update() with the SAME kind keeps one svg in the host', () => {
  const h = host()
  const handle = mountFlowAuto(h.el, singleFlow(), env(h))
  handle.update(singleFlow())
  assert.equal(h.el.querySelectorAll('svg.flow-graph').length, 1, 'exactly one svg after same-kind update')
  handle.destroy()
})

test('mountFlowAuto: update() across a KIND switch (single → flow-set) remounts cleanly', () => {
  const h = host()
  const handle = mountFlowAuto(h.el, singleFlow(), env(h))
  // No throw (mountFlow.update is mode-locked; mountFlowAuto remounts instead):
  assert.doesNotThrow(() => handle.update(rawSet()))
  // mountFlowSet creates two fsp-slot divs, each with its own svg.flow-graph
  // (one per state in the crossfade player). Verify at least one is present.
  assert.ok(h.el.querySelector('svg.flow-graph'), 'svgs mounted after kind switch to flow-set')
  handle.destroy()
})

test('mountFlowAuto: update() back from flow-set → single also remounts', () => {
  const h = host()
  const handle = mountFlowAuto(h.el, rawSet(), env(h))
  assert.doesNotThrow(() => handle.update(singleFlow()))
  assert.ok(h.el.querySelector('svg.flow-graph'), 'single-flow svg after switching back')
  handle.destroy()
})

test('mountFlowAuto: destroy() empties the host', () => {
  const h = host()
  const handle = mountFlowAuto(h.el, singleFlow(), env(h))
  handle.destroy()
  assert.equal(h.el.querySelector('svg.flow-graph'), null, 'host emptied on destroy')
})
