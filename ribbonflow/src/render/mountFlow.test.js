// flow/library/src/render/mountFlow.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseHTML } from 'linkedom'
import { mountFlow } from './mountFlow.js'
import { AGENT_DEFAULT_FILL } from './agentsLayer.js'
import forkFlow from '../../test/fixtures/flows/n4-flow-a.js'
import { makeFakeScheduler, makeFakeIntersection } from '../../test/support/fakeEnv.js'

const require = createRequire(import.meta.url)

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
    // Author initialAgents like every real deck flow does. normalizeFlowInput
    // defaults the field to 0 (format/model.js:193), so a non-authoring flow
    // would seed 0 agents. mountFlow seeds `normalized.initialAgents ?? 8`
    // (parity-faithful to FlowGraph, which reads the same normalized field),
    // so authoring 8 here makes the loop tests paint agents.
    initialAgents: 8,
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
      raf: sched.raf, caf: sched.caf,
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

test('mountFlow: delegates a flow-set to the crossfade player (Phase 2b — no longer throws)', () => {
  const h = host()
  const { value } = opts(h)
  // A properly-shaped raw flow-set ({ key, flow } states). Phase 2b plays it
  // transparently via mountFlowSet rather than rejecting it.
  const flowSet = {
    states: [
      { key: 's0', flow: bareV1Flow() },
      { key: 's1', flow: bareV1Flow() },
    ],
  }
  const handle = mountFlow(h.el, flowSet, value)
  assert.ok(h.el.querySelector('.flow-set-player'), 'a flow-set mounts the crossfade player')
  assert.equal(h.el.querySelectorAll('.fsp-slot').length, 2, 'two crossfade slots')
  // single-flow svg is NOT painted directly into the host for a flow-set.
  assert.equal(h.el.querySelector(':scope > svg.flow-graph'), null)
  handle.destroy()
})

function agentCircles(el) {
  return [...el.querySelectorAll('g.flow-agents circle')]
}

test('mountFlow: on show, the loop steps the sim and paints agents that move', () => {
  const h = host()
  const { sched, inter, value } = (() => {
    const o = opts(h)
    return { sched: o.sched, inter: o.inter, value: o.value }
  })()
  const handle = mountFlow(h.el, bareV1Flow(), value)

  // Not visible yet → no frames, no agents.
  assert.equal(agentCircles(h.el).length, 0)

  inter.setIntersecting(true) // show → startFresh → schedules first frame
  sched.tick(16)              // run frame 1
  sched.tick(16)              // run frame 2
  const circles = agentCircles(h.el)
  assert.ok(circles.length > 0, 'agents painted after the loop runs')
  // Each agent circle carries a data-agent-id and a resolved fill.
  for (const c of circles) {
    assert.ok(c.getAttribute('data-agent-id') !== null)
    assert.ok(c.getAttribute('fill'))
  }
  // bareV1Flow agents are normal (non-defective/non-revising), so agentsView
  // yields fill:null → at least one circle must resolve to the cream default.
  // Pins the null-fill→cream resolution end-to-end through reconcile + applySpec.
  assert.ok(
    circles.some((c) => c.getAttribute('fill') === AGENT_DEFAULT_FILL),
    'a default-lifecycle agent paints the cream default',
  )

  // Capture a position, run more frames, assert at least one agent moved.
  // 8 agents seeded on a ~1000px ribbon at baseSpeed 200 advance well within
  // 10×16ms; notDeepEqual needs only one to move, so this is deterministic.
  const before = circles.map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`)
  for (let i = 0; i < 10; i++) sched.tick(16)
  const after = agentCircles(h.el).map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`)
  assert.notDeepEqual(after, before, 'agent positions advanced across frames')

  handle.destroy()
})

test('mountFlow: on hide the loop stops (no further scheduled frames)', () => {
  const h = host()
  const o = opts(h)
  const handle = mountFlow(h.el, bareV1Flow(), o.value)
  o.inter.setIntersecting(true)
  o.sched.tick(16)
  assert.ok(o.sched.pendingCount() > 0, 'a frame is scheduled while visible')
  o.inter.setIntersecting(false) // hide → stopLoop cancels the pending frame
  assert.equal(o.sched.pendingCount(), 0, 'no frame scheduled after hide')
  handle.destroy()
})

test('mountFlow: re-show rebuilds the sim fresh (pile-up fix)', () => {
  const h = host()
  const o = opts(h)
  const handle = mountFlow(h.el, bareV1Flow(), o.value)
  o.inter.setIntersecting(true)
  for (let i = 0; i < 30; i++) o.sched.tick(16) // accumulate some sim state
  o.inter.setIntersecting(false)                // hide → stopLoop
  assert.equal(o.sched.pendingCount(), 0, 'no frame scheduled while hidden')
  o.inter.setIntersecting(true)                 // re-show → startFresh
  assert.ok(o.sched.pendingCount() > 0, 're-show restarted the loop')
  o.sched.tick(16)
  // startFresh rebuilds the sim clean + repaints; assert agents present rather
  // than exact positions/counts (the sim's spawn jitter uses unseeded
  // Math.random, so position-equality would flake).
  assert.ok(
    agentCircles(h.el).length > 0,
    're-show repainted agents fresh (startFresh ran applyAgents)',
  )
  handle.destroy()
})

test('mountFlow: update(nextFlow) rebuilds the static scene (topology swap safe)', () => {
  const h = host()
  const o = opts(h)
  const handle = mountFlow(h.el, bareV1Flow(), o.value)
  const before = h.el.querySelector('g.flow-paint').childNodes.length

  // Swap to the richer fork flow — more families → different paint child count.
  handle.update(forkFlow)
  const svgs = h.el.querySelectorAll('svg.flow-graph')
  assert.equal(svgs.length, 1, 'still exactly one svg (old one replaced, not duplicated)')
  const after = h.el.querySelector('g.flow-paint').childNodes.length
  assert.notEqual(after, before, 'static scene was rebuilt for the new flow')
  assert.equal(h.el.querySelector('svg.flow-graph').outerHTML.includes('NaN'), false)
  handle.destroy()
})

test('mountFlow: destroy removes the svg and stops scheduling', () => {
  const h = host()
  const o = opts(h)
  const handle = mountFlow(h.el, bareV1Flow(), o.value)
  o.inter.setIntersecting(true)
  o.sched.tick(16)
  handle.destroy()
  assert.equal(h.el.querySelector('svg.flow-graph'), null, 'svg removed')
  assert.equal(o.sched.pendingCount(), 0, 'destroy cancelled the pending frame')
  o.sched.tick(16)
  assert.equal(o.sched.pendingCount(), 0, 'and no frame re-armed after destroy')
})

test('mountFlow: update while visible keeps the loop running on the new scene', () => {
  const h = host()
  const o = opts(h)
  const handle = mountFlow(h.el, bareV1Flow(), o.value)
  o.inter.setIntersecting(true)   // show → loop running
  o.sched.tick(16)
  assert.ok(o.sched.pendingCount() > 0, 'loop running before the swap')

  handle.update(forkFlow)         // swap while visible → wasRunning branch
  assert.ok(o.sched.pendingCount() > 0, 'loop survived the swap')
  o.sched.tick(16)
  assert.ok(agentCircles(h.el).length > 0, 'agents repaint on the new scene after the swap')
  handle.destroy()
})

test('mountFlow: end-to-end over n4-flow-a — static families painted once, agents animate, clean teardown', () => {
  const h = host()
  const o = opts(h)
  const handle = mountFlow(h.el, forkFlow, o.value)

  const svg = h.el.querySelector('svg.flow-graph')
  // Static families present (ribbons + junction discs at least — n4-flow-a forks).
  assert.ok(svg.querySelectorAll('g.flow-paint path').length > 0, 'ribbons/paths painted')
  assert.ok(svg.querySelectorAll('g.flow-paint circle').length > 0, 'junction discs painted')

  o.inter.setIntersecting(true)
  for (let i = 0; i < 5; i++) o.sched.tick(16)
  assert.ok([...svg.querySelectorAll('g.flow-agents circle')].length > 0, 'agents present after frames')

  handle.destroy()
  assert.equal(h.el.querySelector('svg.flow-graph'), null)
  assert.equal(o.sched.pendingCount(), 0, 'loop stopped on destroy')
})

test('index barrel re-exports mountFlow', () => {
  // Source-text check (the internals barrel transitively imports .vue SFCs that
  // bare node --test cannot load — same pattern as the buildFlowScene re-export test).
  const fs = require('node:fs')
  const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('mountFlow'), 'index re-exports mountFlow')
})
