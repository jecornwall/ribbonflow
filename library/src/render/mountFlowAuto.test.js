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
  // (one per crossfade slot). Exact count catches a skipped destroy: a leaking
  // single-flow svg would leave 3 elements, not 2.
  assert.equal(h.el.querySelectorAll('svg.flow-graph').length, 2, 'flow-set mounts both slot svgs after kind switch')
  // Scaffold presence confirms a flow-set was mounted, not just a single flow.
  assert.ok(h.el.querySelector('.flow-set-player'), 'flow-set scaffold present after kind switch')
  handle.destroy()
})

test('mountFlowAuto: update() back from flow-set → single also remounts', () => {
  const h = host()
  const handle = mountFlowAuto(h.el, rawSet(), env(h))
  assert.doesNotThrow(() => handle.update(singleFlow()))
  // Exact count catches a skipped destroy: a leaked flow-set (2 slot svgs) + the
  // new single-flow svg would leave 3 elements, not 1.
  assert.equal(h.el.querySelectorAll('svg.flow-graph').length, 1, 'only the single-flow svg remains after switching back')
  // Scaffold absence confirms the old flow-set player was torn down.
  assert.equal(h.el.querySelector('.flow-set-player'), null, 'flow-set scaffold absent after switching back')
  handle.destroy()
})

test('mountFlowAuto: destroy() empties the host', () => {
  const h = host()
  const handle = mountFlowAuto(h.el, singleFlow(), env(h))
  handle.destroy()
  assert.equal(h.el.querySelector('svg.flow-graph'), null, 'host emptied on destroy')
})
