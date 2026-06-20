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

import forkFlow from '../../test/fixtures/flows/n4-flow-a.js'

test('buildFlowScene: fork/merge flow emits junction discs at the junction nodes', () => {
  const sim = createFlowSimulation(forkFlow, { initialAgents: 0 })
  const scene = buildFlowScene(forkFlow, sim)
  const discs = scene.static.filter((p) => p.kind === 'disc')
  // n4-flow-a has exactly two junctions: `design` (fork → build, test-prep)
  // and `review` (merge ← build, test-prep) — so exactly two discs.
  assert.equal(discs.length, 2, 'expected exactly two junction discs (design fork + review merge)')
  for (const disc of discs) {
    assert.equal(typeof disc.cx, 'number')
    assert.equal(typeof disc.cy, 'number')
    assert.ok(disc.r > 0, 'disc radius must be positive')
    assert.equal(typeof disc.fill, 'string')
  }
})

test('buildFlowScene: a purely linear flow emits no junction discs', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const discs = buildFlowScene(flow, sim).static.filter((p) => p.kind === 'disc')
  assert.equal(discs.length, 0)
})

test('buildFlowScene: end-to-end over n4-flow-a yields ribbons + discs, all well-formed', () => {
  const sim = createFlowSimulation(forkFlow, { initialAgents: 0 })
  const scene = buildFlowScene(forkFlow, sim)

  const kinds = new Set(scene.static.map((p) => p.kind))
  assert.ok(kinds.has('ribbon'), 'expected ribbon primitives')
  assert.ok(kinds.has('disc'), 'expected junction discs (n4-flow-a forks + merges)')

  // Every static primitive is renderable: paths carry a moveto, discs a radius.
  for (const p of scene.static) {
    if (p.kind === 'ribbon' || p.kind === 'path') assert.ok(p.d.startsWith('M'))
    if (p.kind === 'disc') assert.ok(p.r > 0)
  }

  // Ribbons come before discs in paint order (FlowGraph paints discs over ribbons).
  const firstDisc = scene.static.findIndex((p) => p.kind === 'disc')
  const lastRibbon = scene.static.map((p) => p.kind).lastIndexOf('ribbon')
  assert.ok(firstDisc > -1, 'expected at least one disc')
  assert.ok(lastRibbon < firstDisc, 'ribbons must paint before discs')
})

test('internals barrel re-exports buildFlowScene + agentsView', async () => {
  // internals.js re-exports .vue components that bare node cannot load, so we
  // verify the export at the source level rather than by dynamic import. This
  // checks the same invariant: the names appear as named exports in the barrel.
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const dir = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(dir, '../internals.js'), 'utf8')
  assert.ok(
    src.includes("export { buildFlowScene, agentsView } from './core/buildFlowScene.js'"),
    'internals.js must re-export buildFlowScene + agentsView from buildFlowScene.js',
  )
  // Also verify they are actually exported from the implementation module.
  const impl = await import('./buildFlowScene.js')
  assert.equal(typeof impl.buildFlowScene, 'function')
  assert.equal(typeof impl.agentsView, 'function')
})

// ── Task 1: Decorations (spine) — FlowGraph.vue:64-101 ──────────────────────

// A linear flow carrying one spine decoration (n14 context-layer register).
function spineFlow(extra = {}) {
  return {
    viewBox: { w: 1600, h: 900 },
    baseSpeed: 200,
    entryId: 'a',
    decorations: [
      { kind: 'spine', x: 800, y1: 120, y2: 780, color: '#15171A', width: 14, opacity: 0.9, label: 'context layer', labelSide: 'above', labelDy: -20 },
    ],
    nodes: [
      { id: 'a', x: 200, y: 450, label: 'a', capacity: 1, latency: 0.6, successors: ['b'] },
      { id: 'b', x: 1200, y: 450, label: 'b', capacity: 1, latency: 0.6, successors: [] },
    ],
    ...extra,
  }
}

test('buildFlowScene: a spine decoration emits a line + label, BEFORE the ribbons', () => {
  const flow = spineFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const scene = buildFlowScene(flow, sim)

  const lines = scene.static.filter((p) => p.kind === 'line')
  assert.equal(lines.length, 1, 'one spine line')
  const spine = lines[0]
  assert.deepEqual([spine.x1, spine.y1, spine.x2, spine.y2], [800, 120, 800, 780])
  assert.equal(spine.stroke, '#15171A')
  assert.equal(spine.strokeWidth, 14)
  assert.equal(spine.opacity, 0.9)

  const texts = scene.static.filter((p) => p.kind === 'text')
  assert.equal(texts.length, 1, 'one spine label')
  assert.equal(texts[0].text, 'context layer')
  assert.deepEqual([texts[0].x, texts[0].y], [800, 100]) // y1 + labelDy = 120 + (−20)

  // Paint order: the decoration line precedes the first ribbon.
  const firstLine = scene.static.findIndex((p) => p.kind === 'line')
  const firstRibbon = scene.static.findIndex((p) => p.kind === 'ribbon')
  assert.ok(firstLine < firstRibbon, 'decoration paints before ribbons')
})

test('buildFlowScene: no decorations → no decoration primitives', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const scene = buildFlowScene(flow, sim)
  assert.equal(scene.static.filter((p) => p.kind === 'line').length, 0)
  assert.equal(scene.static.filter((p) => p.kind === 'text').length, 0)
})

test('buildFlowScene: spine colour falls back to the ribbon scheme when no override', () => {
  const flow = spineFlow({ decorations: [{ kind: 'spine', x: 800, y1: 120, y2: 780, colorScheme: 'neutral' }] })
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const spine = buildFlowScene(flow, sim).static.find((p) => p.kind === 'line')
  assert.equal(spine.stroke, RIBBON_SCHEME_COLORS.neutral)
  assert.equal(spine.strokeWidth, 14) // default width
  assert.equal(spine.opacity, 0.9)    // default opacity
})

// ── Task 2: Pinch-zone roses — FlowGraph.vue:155-173 + :792-803 ──────────────
import pinchFlow from '../../test/fixtures/flows/n4-toc-baseline.js'

test('buildFlowScene: a constraint-only flow emits pinch-rose overlays', () => {
  const sim = createFlowSimulation(pinchFlow, { initialAgents: 0 })
  const scene = buildFlowScene(pinchFlow, sim)
  // NB: n4-toc-baseline has no fork/merge junctions, so this scene emits zero
  // 'disc' primitives — a "roses after discs" ordering assertion would pass
  // trivially (lastDisc -1) without verifying anything, so the test name claims
  // only what it checks. buildPinchRoses is wired after buildJunctionDiscs in
  // buildFlowScene; that call-order is the structural guarantee.
  const roses = scene.static.filter((p) => p.kind === 'path' && p.key && p.key.startsWith('pinch-'))
  assert.ok(roses.length >= 1, 'expected at least one pinch-rose path')
  for (const r of roses) {
    assert.ok(r.d.startsWith('M'), 'rose path is a real outline')
    assert.ok(
      [pinchFlow.pinchFillColor || '#e6c8c8', pinchFlow.constraintFillColor || '#d8a8a8'].includes(r.fill),
      `rose fill is one of the two rose tones, got ${r.fill}`,
    )
  }
  // Constraint-plateau roses use the deeper tone.
  assert.ok(roses.some((r) => r.fill === (pinchFlow.constraintFillColor || '#d8a8a8')), 'expected a constraint plateau')
})

test('buildFlowScene: a non-pinch flow emits no pinch-rose overlays', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const roses = buildFlowScene(flow, sim).static.filter((p) => p.key && p.key.startsWith('pinch-'))
  assert.equal(roses.length, 0)
})
