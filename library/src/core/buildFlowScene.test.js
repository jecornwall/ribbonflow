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

  // Key-scope to the decoration family: later paint-order families (segment
  // markers, etc.) also emit kind:'line'/'text', so filter on the dec- key.
  const lines = scene.static.filter((p) => p.kind === 'line' && (p.key || '').startsWith('dec-'))
  assert.equal(lines.length, 1, 'one spine line')
  const spine = lines[0]
  assert.deepEqual([spine.x1, spine.y1, spine.x2, spine.y2], [800, 120, 800, 780])
  assert.equal(spine.stroke, '#15171A')
  assert.equal(spine.strokeWidth, 14)
  assert.equal(spine.opacity, 0.9)

  const texts = scene.static.filter((p) => p.kind === 'text' && (p.key || '').startsWith('dec-'))
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
  // Key-scope to the decoration family — markers emit kind:'text' for the
  // (labelled) linear-flow nodes, which is not a decoration primitive.
  assert.equal(scene.static.filter((p) => (p.key || '').startsWith('dec-')).length, 0)
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

// ── Task 3: Rejection-edge arcs — FlowGraph.vue:184-192 + :871-894 ──────────
// NB: v12-rejections.v4.js is a RAW round-trip fixture — it deliberately omits
// derived render fields (e.g. node.latency) that normalizeFlow() fills, since
// its job is to prove byte-faithful losslessness, not to render. The render
// pipeline (FlowGraph / the deck) always paints a NORMALIZED flow, so the
// scene-builder tests must too: a raw flow has NaN segment bounds and crashes
// the (already-merged) coloured-overlay builder before reaching the arcs. We
// normalize here to feed buildFlowScene its real production input contract.
import rawRejectionFlow from '../../test/fixtures/flows/v12-rejections.v4.js'
import { normalizeFlow } from '../format/model.js'
import { REJECTION_COLOR } from './flowCurve.js'
import { REJECTION_ARC_DASHARRAY } from './flowRejectionArc.js'

const rejectionFlow = normalizeFlow(rawRejectionFlow)

test('buildFlowScene: rejection edges emit dotted rejectionArc primitives with arrowheads', () => {
  const sim = createFlowSimulation(rejectionFlow, { initialAgents: 0 })
  const scene = buildFlowScene(rejectionFlow, sim)
  const arcs = scene.static.filter((p) => p.kind === 'rejectionArc')
  const validRej = (rejectionFlow.rejections || []).filter(
    (r) => r && rejectionFlow.nodes.some((n) => n.id === r.from) && rejectionFlow.nodes.some((n) => n.id === r.to),
  )
  assert.equal(arcs.length, validRej.length, 'one arc per resolvable rejection edge')
  for (const arc of arcs) {
    assert.ok(arc.d.startsWith('M'), 'arc path is a real curve')
    assert.equal(typeof arc.arrowPoints, 'string')
    assert.ok(arc.arrowPoints.length > 0, 'arrowhead polygon points present')
    assert.equal(arc.stroke, REJECTION_COLOR)
    assert.equal(arc.dasharray, REJECTION_ARC_DASHARRAY)
  }
})

test('buildFlowScene: a flow with no rejections emits no rejectionArc primitives', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  assert.equal(buildFlowScene(flow, sim).static.filter((p) => p.kind === 'rejectionArc').length, 0)
})

// ── Task 4: Station boxes (isometric hairline parallelograms) ────────────────
// m3-coverage.v3 is raw author data; buildFlowScene's contract is a normalised
// flow (it derives centerlines from engine-filled fields), so normalize it here
// exactly as the T3 rejection fixture is normalised above.
import rawM3Flow from '../../test/fixtures/flows/m3-coverage.v3.js'

const m3Flow = normalizeFlow(rawM3Flow)

test('buildFlowScene: showBoxes emits one hairline parallelogram per node', () => {
  const sim = createFlowSimulation(forkFlow, { initialAgents: 0 })
  const scene = buildFlowScene(forkFlow, sim)
  const boxes = scene.static.filter((p) => p.kind === 'polygon' && p.key && p.key.startsWith('box-'))
  // Guard against a vacuous 0 === 0 pass if the fixture's showBoxes flag is ever
  // flipped: this test depends on n4-flow-a.js setting showBoxes:true.
  assert.ok(forkFlow.showBoxes, 'fixture must have showBoxes set')
  assert.equal(boxes.length, forkFlow.nodes.length, 'one box per node')
  for (const box of boxes) {
    assert.equal(box.fill, 'none', 'no fill — ribbon flows through')
    assert.ok([1.2, 1.8].includes(box.strokeWidth))
    assert.ok(['#15171A', '#E2522B'].includes(box.stroke))
    // points: four "x,y" vertex pairs, space-separated.
    assert.equal(box.points.trim().split(/\s+/).length, 4)
  }
})

test('buildFlowScene: a constraint node box uses the firebrick stroke', () => {
  // m3-coverage.v3 carries a colorScheme:'red' (constraint) node; add showBoxes.
  const flow = { ...m3Flow, showBoxes: true }
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const boxes = buildFlowScene(flow, sim).static.filter((p) => p.kind === 'polygon' && p.key.startsWith('box-'))
  assert.ok(boxes.some((b) => b.stroke === '#E2522B' && b.strokeWidth === 1.8), 'a constraint box is firebrick')
})

test('buildFlowScene: no showBoxes → no box polygons', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const boxes = buildFlowScene(flow, sim).static.filter((p) => p.kind === 'polygon' && (p.key || '').startsWith('box-'))
  assert.equal(boxes.length, 0)
})

test('buildFlowScene: segmentDividers emits interior boundary ticks (none on open ends)', () => {
  const sim = createFlowSimulation(pinchFlow, { initialAgents: 0 }) // n4-toc-baseline: segmentDividers:true
  const scene = buildFlowScene(pinchFlow, sim)
  const divs = scene.static.filter((p) => p.kind === 'line' && p.key && p.key.startsWith('div-'))
  // Interior boundaries per branch = nodeIds.length − 1 summed over render branches.
  const renderBranches = sim.branches.filter((b) => b.kind !== 'rejection')
  const expected = renderBranches.reduce((sum, b) => sum + Math.max(0, b.nodeIds.length - 1), 0)
  assert.equal(divs.length, expected)
  for (const d of divs) {
    assert.equal(d.stroke, '#555555')
    assert.equal(d.strokeWidth, 0.8)
    assert.equal(d.linecap, 'round')
    assert.ok(Number.isFinite(d.x1) && Number.isFinite(d.y2))
  }
})

test('buildFlowScene: no segmentDividers flag → no divider ticks', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const divs = buildFlowScene(flow, sim).static.filter((p) => (p.key || '').startsWith('div-'))
  assert.equal(divs.length, 0)
})

import multilaneFlow from '../../test/fixtures/flows/n9-multilane.js'

test('buildFlowScene: stageAnchors emits a notch per non-entry non-constraint labelled node', () => {
  const sim = createFlowSimulation(multilaneFlow, { initialAgents: 0 })
  const scene = buildFlowScene(multilaneFlow, sim)
  const notches = scene.static.filter((p) => p.kind === 'line' && p.key && p.key.startsWith('anchor-'))
  const expected = multilaneFlow.nodes.filter(
    (n) => n.id !== multilaneFlow.entryId && n.kind !== 'constraint' && n.label,
  ).length
  assert.equal(notches.length, expected)
  for (const n of notches) {
    assert.equal(n.stroke, '#555555')
    assert.equal(n.strokeWidth, 2.5)
    assert.equal(n.opacity, 0.85)
    assert.equal(n.x1, n.x2, 'notch is vertical')
    assert.ok(n.y2 > n.y1, 'spans top→bottom of the band + 6 each side')
  }
  // Independently pin the filter by key: the kind:'constraint' node
  // (cross-team-review) is excluded; a labelled non-constraint sibling
  // (build-feature) is present. Guards against the count-only tautology.
  const keys = new Set(notches.map((n) => n.key))
  assert.ok(!keys.has('anchor-cross-team-review'), 'constraint node excluded from notches')
  assert.ok(keys.has('anchor-build-feature'), 'labelled non-constraint node included')

  // Directly assert the labelX ?? node.x anchor override: design-review has
  // labelX 540 ≠ x 560, so its notch must sit at x=540, not 560.
  const dr = scene.static.find((p) => p.key === 'anchor-design-review')
  assert.equal(dr.x1, 540, 'notch uses labelX (540), not node.x (560)')
})

test('buildFlowScene: no stageAnchors flag → no notches', () => {
  const flow = linearFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const notches = buildFlowScene(flow, sim).static.filter((p) => (p.key || '').startsWith('anchor-'))
  assert.equal(notches.length, 0)
})

// ── Task 7: segment markers — geometry derivation + label text ──────────────

test('buildFlowScene: one marker label per labelled node, firebrick on constraints', () => {
  const sim = createFlowSimulation(forkFlow, { initialAgents: 0 })
  const scene = buildFlowScene(forkFlow, sim)
  const labels = scene.static.filter((p) => p.kind === 'text' && p.key && p.key.startsWith('marker-'))
  const labelled = forkFlow.nodes.filter((n) => n.label)
  assert.equal(labels.length, labelled.length, 'one label per labelled node')
  for (const l of labels) {
    assert.equal(l.font, 'ET Book, Georgia, serif')
    assert.equal(l.fontStyle, 'italic')
    assert.equal(l.fontSize, 24)
    assert.equal(l.anchor, 'middle')
    assert.ok(['#555555', '#E2522B'].includes(l.fill))
  }
})

test('buildFlowScene: showMetrics appends the cap/latency suffix to marker labels', () => {
  const sim = createFlowSimulation(forkFlow, { initialAgents: 0 })
  // Select the label TEXT specifically: post-T8 the first marker-keyed primitive
  // is a boundary-tick line (no .text), so target the `-label` text primitive.
  const plain = buildFlowScene(forkFlow, sim).static.find(
    (p) => p.kind === 'text' && (p.key || '').startsWith('marker-'),
  )
  const metric = buildFlowScene(forkFlow, sim, { showMetrics: true }).static.find(
    (p) => p.kind === 'text' && p.key === plain.key,
  )
  assert.ok(!plain.text.includes('· cap'))
  assert.ok(metric.text.includes('· cap'), 'metric label carries the cap/latency suffix')
})

// A linear flow whose interior node carries NO label — exercises the
// `if (!node.label) continue` guard in buildSegmentMarkers discriminatingly:
// the unlabelled node must emit no marker label while its labelled siblings do.
function mixedLabelFlow() {
  return {
    viewBox: { w: 1600, h: 900 },
    baseSpeed: 200,
    entryId: 'a',
    nodes: [
      { id: 'a', x: 200, y: 450, label: 'a', capacity: 1, latency: 0.6, successors: ['b'] },
      { id: 'b', x: 700, y: 450, /* intentionally no label */ capacity: 1, latency: 0.6, successors: ['c'] },
      { id: 'c', x: 1200, y: 450, label: 'c', capacity: 1, latency: 0.6, successors: [] },
    ],
  }
}

test('buildFlowScene: an unlabelled flow node emits no marker label; labelled siblings do', () => {
  const flow = mixedLabelFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const keys = new Set(buildFlowScene(flow, sim).static.filter((p) => p.kind === 'text').map((p) => p.key))
  assert.ok(!keys.has('marker-b-label'), 'unlabelled node b is skipped (guard fires)')
  assert.ok(keys.has('marker-a-label') && keys.has('marker-c-label'), 'labelled siblings still emit')
})

// ── Task 8: segment-marker boundary ticks + leader lines ────────────────────

test('buildFlowScene: perpendicular markers emit 2 ticks + 1 leader per labelled node', () => {
  const sim = createFlowSimulation(forkFlow, { initialAgents: 0 })
  const scene = buildFlowScene(forkFlow, sim)
  const labelled = forkFlow.nodes.filter((n) => n.label).length
  const ticks = scene.static.filter((p) => p.kind === 'line' && p.key && p.key.startsWith('marker-') && p.key.includes('tick'))
  const leaders = scene.static.filter((p) => p.kind === 'line' && p.key && p.key.startsWith('marker-') && p.key.includes('leader'))
  assert.equal(ticks.length, labelled * 2, 'start + end tick per marker')
  assert.equal(leaders.length, labelled, 'one perpendicular leader per marker')
  for (const t of ticks) {
    assert.equal(t.strokeWidth, 1.2)
    assert.ok(['#555555', '#E2522B'].includes(t.stroke))
  }
  for (const l of leaders) assert.equal(l.strokeWidth, 0.6)
})

test('buildFlowScene: fence-post markers emit a single 1.0px leader, no ticks', () => {
  const flow = { ...forkFlow, fenceMarkers: true }
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const scene = buildFlowScene(flow, sim)
  const labelled = flow.nodes.filter((n) => n.label).length
  const ticks = scene.static.filter((p) => (p.key || '').startsWith('marker-') && (p.key || '').includes('tick'))
  const leaders = scene.static.filter((p) => p.kind === 'line' && (p.key || '').startsWith('marker-') && (p.key || '').includes('leader'))
  assert.equal(ticks.length, 0, 'fence-post has no boundary ticks')
  assert.equal(leaders.length, labelled, 'one fence-post leader per marker')
  for (const l of leaders) {
    assert.equal(l.strokeWidth, 1.0)
    assert.equal(l.x1, l.x2, 'fence-post leader is vertical')
  }
})

// ── Task 9: Segment markers — constraint hatching ────────────────────────────

test('buildFlowScene: a perpendicular constraint marker emits a hatch rect + shared hatch def', () => {
  const sim = createFlowSimulation(m3Flow, { initialAgents: 0 })
  const scene = buildFlowScene(m3Flow, sim)
  const hatches = scene.static.filter((p) => p.kind === 'rect' && p.key && p.key.startsWith('hatch-'))
  const constraints = m3Flow.nodes.filter((n) => isConstraintNodeTest(n) && n.label)
  assert.ok(constraints.length >= 1, 'fixture must carry a labelled constraint node')
  assert.equal(hatches.length, constraints.length, 'one hatch rect per constraint marker')
  assert.ok(scene.defs.hatch, 'shared hatch def present')
  assert.equal(scene.defs.hatch.stroke, '#E2522B')
  for (const h of hatches) {
    assert.equal(h.width, 200)
    assert.equal(h.height, 14)
    assert.equal(h.opacity, 0.6)
    assert.equal(h.fill, `url(#${scene.defs.hatch.id})`)
  }
})

test('buildFlowScene: fence-post mode suppresses constraint hatching; no constraints → no hatch def', () => {
  const fence = { ...m3Flow, fenceMarkers: true }
  const fsim = createFlowSimulation(fence, { initialAgents: 0 })
  const fscene = buildFlowScene(fence, fsim)
  assert.equal(fscene.static.filter((p) => (p.key || '').startsWith('hatch-')).length, 0)
  assert.equal(fscene.defs.hatch, null)

  const plain = buildFlowScene(linearFlow(), createFlowSimulation(linearFlow(), { initialAgents: 0 }))
  assert.equal(plain.defs.hatch, null, 'no constraints → hatch def stays null')
})

// Inline flow with TWO labelled perpendicular constraint nodes — exercises the
// ensureHatchDef REUSE branch (2nd constraint hits the already-set ctx.defs.hatch).
// Every node carries latency, so it builds against the engine without normalizeFlow.
function twoConstraintFlow() {
  return {
    viewBox: { w: 1600, h: 900 }, baseSpeed: 200, entryId: 'a',
    nodes: [
      { id: 'a', x: 200, y: 450, label: 'a', capacity: 1, latency: 0.6, successors: ['b'] },
      { id: 'b', x: 600, y: 450, label: 'b', colorScheme: 'red', capacity: 1, latency: 0.6, successors: ['c'] },
      { id: 'c', x: 1000, y: 450, label: 'c', colorScheme: 'red', capacity: 1, latency: 0.6, successors: [] },
    ],
  }
}

test('buildFlowScene: multiple constraint markers share ONE hatch def', () => {
  const flow = twoConstraintFlow()
  const sim = createFlowSimulation(flow, { initialAgents: 0 })
  const scene = buildFlowScene(flow, sim)
  const hatches = scene.static.filter((p) => p.kind === 'rect' && (p.key || '').startsWith('hatch-'))
  assert.equal(hatches.length, 2, 'two constraint nodes → two hatch rects')
  assert.ok(scene.defs.hatch, 'one shared hatch def')
  const fills = new Set(hatches.map((h) => h.fill))
  assert.equal(fills.size, 1, 'both rects reference the SAME def id')
  assert.equal(hatches[0].fill, `url(#${scene.defs.hatch.id})`)
})

// Local mirror of isConstraintNode for the test's expectation (kind:'constraint'
// OR colorScheme:'red') — avoids importing the production predicate into asserts.
function isConstraintNodeTest(n) {
  return !!n && (n.kind === 'constraint' || n.colorScheme === 'red')
}
