// flow/library/src/render/mountFlow.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountFlow } from './mountFlow.js'
import { makeFakeScheduler, makeFakeIntersection } from '../../test/support/fakeEnv.js'

function host() {
  const { document } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>')
  return { document, el: document.getElementById('host') }
}

// A bare v1-style deck flow (top-level entryId) — exercises the Finding-0
// migrate+normalize path: must render without NaN attributes.
function bareV1Flow() {
  return {
    viewBox: { w: 1600, h: 900 },
    entryId: 'a',
    spawnRate: 1,
    nodes: [
      { id: 'a', x: 200, y: 450, label: 'a', capacity: 1, latency: 0.6, successors: ['b'] },
      { id: 'b', x: 1200, y: 450, label: 'b', capacity: 1, latency: 0.6, successors: [] },
    ],
  }
}

// Common injected opts: fake scheduler + fake intersection (kept OFF-screen so
// no loop runs in mount-only tests) + the host document.
function opts(h, extra = {}) {
  const sched = makeFakeScheduler()
  const inter = makeFakeIntersection()
  return {
    sched, inter,
    value: {
      document: h.document,
      raf: sched.raf, caf: sched.caf, now: sched.now,
      IntersectionObserver: inter.IntersectionObserver,
      visibilityDocument: inter.document,
      ...extra,
    },
  }
}

test('mountFlow: paints one <svg.flow-graph> with the static paint group', () => {
  const h = host()
  const { value } = opts(h)
  const handle = mountFlow(h.el, bareV1Flow(), value)
  const svg = h.el.querySelector('svg.flow-graph')
  assert.ok(svg, 'an svg root was mounted')
  assert.equal(svg.getAttribute('viewBox'), '0 0 1600 900')
  const paint = svg.querySelector('g.flow-paint')
  assert.ok(paint && paint.childNodes.length > 0, 'static primitives were painted')
  // bare v1 flow rendered without NaN attrs (Finding-0 regression guard):
  assert.equal(svg.outerHTML.includes('NaN'), false, 'no NaN attributes')
  handle.destroy()
})

test('mountFlow: builds an empty agents group (filled per frame, not at mount)', () => {
  const h = host()
  const { value } = opts(h)
  const handle = mountFlow(h.el, bareV1Flow(), value)
  const agents = h.el.querySelector('g.flow-agents')
  assert.ok(agents, 'agents group present')
  handle.destroy()
})

test('mountFlow: throws a clear error on a flow-set (Phase 2b not yet supported)', () => {
  const h = host()
  const { value } = opts(h)
  const flowSet = { states: [bareV1Flow(), bareV1Flow()] } // a raw flow-set
  assert.throws(
    () => mountFlow(h.el, flowSet, value),
    /flow-set/i,
    'mountFlow rejects flow-sets with a clear message',
  )
})
