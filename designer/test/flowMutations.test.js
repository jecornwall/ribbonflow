/**
 * flowMutations.test.js — headless unit tests for the designer's pure
 * mutation layer (src/state/flowMutations.js).
 *
 * These cover the editing-model logic: node create/move/delete, edge
 * create/delete with de-dup + self-loop guards, label-side sugar, and the
 * referential cleanup when a node is removed. The mutation layer imports no
 * Vue and no library .vue files, so it runs directly under `node --test`.
 *
 * The export→import round-trip (which needs the library's renderer-bearing
 * barrel) is verified in the browser via Playwright — see M3 spec §2.6 / §5:
 * the round-trip INVARIANT itself is the library's, already covered by its
 * 129 tests; the designer only needs to prove it does not corrupt the doc,
 * which the browser drive does end-to-end.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addNode,
  moveNode,
  removeNode,
  addEdge,
  removeEdge,
  setNodeKind,
  setLabelSide,
  moveLabel,
  setNodeField,
  uniqueId,
  findNode,
  withNodeAnchoredLabels,
  flowCenterlineY,
  snapToGrid,
  addRejection,
  removeRejection,
  setRejectionField,
  setRejectionBow,
  findRejection,
  setSourceParticleSize,
  setNodeTransform,
  setTransformCount,
  setNodeCapacity,
  reconcileForks,
  reconcileMerges,
  setForkRateShare,
  resetForkToEven,
  forkBranchesFor,
  predecessorsOf,
} from '../src/state/flowMutations.js'

/** Assert two numbers are equal within a small epsilon. */
function close(actual, expected, msg) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${msg || 'close'}: ${actual} ≉ ${expected}`,
  )
}
/** Sum of a fork entry's branch rateShares. */
function shareSum(fork) {
  return fork.branches.reduce((s, b) => s + b.rateShare, 0)
}

function emptyFlow() {
  return { viewBox: { w: 1600, h: 900 }, forks: [], merges: [], nodes: [] }
}

test('addNode creates a node with designer defaults and a unique id', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 100, 200)
  assert.equal(id, 'node-1')
  const n = findNode(flow, id)
  assert.equal(n.x, 100)
  assert.equal(n.y, 200)
  assert.equal(n.kind, 'normal')
  assert.equal(n.labelSide, 'above')
  assert.ok(n.labelDy < 0, 'default label sits above the node')
  assert.deepEqual(n.successors, [])
})

test('addNode stamps the v1.1 node controls and a colour scheme', () => {
  const flow = emptyFlow()
  const n = findNode(flow, addNode(flow, 0, 0))
  assert.equal(typeof n.length, 'number', 'has a LENGTH')
  assert.equal(typeof n.speed, 'number', 'has a SPEED')
  assert.equal(typeof n.width, 'number', 'has a WIDTH')
  assert.equal(n.coupleSpeedWidth, true, 'speed⇄width coupled by default')
  assert.equal(n.colorScheme, 'neutral', 'neutral colour scheme by default')
  assert.equal(n.capacity, undefined, 'no v2 capacity field')
  assert.equal(n.latency, undefined, 'no v2 latency field')
})

test('uniqueId skips ids already in use', () => {
  const flow = emptyFlow()
  addNode(flow, 0, 0) // node-1
  addNode(flow, 0, 0) // node-2
  assert.equal(uniqueId(flow), 'node-3')
})

test('moveNode updates position; rounds to integers', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  moveNode(flow, id, 333.7, 12.2)
  const n = findNode(flow, id)
  assert.equal(n.x, 334)
  assert.equal(n.y, 12)
})

test('addEdge links nodes; rejects self-loops and duplicates', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  assert.equal(addEdge(flow, a, b), true)
  assert.deepEqual(findNode(flow, a).successors, [b])
  assert.equal(addEdge(flow, a, b), false, 'duplicate rejected')
  assert.equal(addEdge(flow, a, a), false, 'self-loop rejected')
  assert.equal(addEdge(flow, a, 'ghost'), false, 'missing target rejected')
})

test('removeEdge drops just that edge', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, b)
  addEdge(flow, a, c)
  removeEdge(flow, a, b)
  assert.deepEqual(findNode(flow, a).successors, [c])
})

test('removeNode strips the node and every reference to it', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  const d = addNode(flow, 3, 3)
  addEdge(flow, a, b)
  // c has two predecessors (a and b) → a merge target
  addEdge(flow, a, c)
  addEdge(flow, b, c)
  addEdge(flow, a, d)
  assert.equal(flow.merges.length, 1, 'c is a merge target before removal')

  removeNode(flow, b)

  assert.equal(findNode(flow, b), undefined, 'b is gone')
  assert.deepEqual(
    findNode(flow, a).successors.slice().sort(),
    [c, d].sort(),
    'incoming edge to b gone from a.successors',
  )
  // b was a predecessor of c; removing it leaves only a → c is no longer a merge
  assert.equal(flow.merges.length, 0, 'merge entry cleaned up when predecessor removed')
})

test('setNodeKind keeps kind-specific fields coherent', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeKind(flow, id, 'source')
  assert.ok(findNode(flow, id).rate > 0, 'source gains a default rate')
  setNodeKind(flow, id, 'normal')
  assert.equal(findNode(flow, id).kind, 'normal')
})

test('setLabelSide is sugar over labelDy sign', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setLabelSide(flow, id, 'below')
  assert.equal(findNode(flow, id).labelSide, 'below')
  assert.ok(findNode(flow, id).labelDy > 0)
  setLabelSide(flow, id, 'above')
  assert.ok(findNode(flow, id).labelDy < 0)
})

test('moveLabel updates offsets and re-derives labelSide', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  moveLabel(flow, id, 10, 40)
  assert.equal(findNode(flow, id).labelDx, 10)
  assert.equal(findNode(flow, id).labelDy, 40)
  assert.equal(findNode(flow, id).labelSide, 'below')
})

test('withNodeAnchoredLabels stamps labelX/labelY = node xy for the preview', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 100, 200)
  moveNode(flow, a, 640, 318)
  const projected = withNodeAnchoredLabels(flow)
  const pn = findNode(projected, a)
  assert.equal(pn.labelX, 640, 'preview label anchors at node x')
  assert.equal(pn.labelY, 318, 'preview label anchors at node y')
  // The projection must NOT mutate the authored flow (export stays clean).
  assert.equal('labelX' in findNode(flow, a), false, 'authored flow untouched')
  assert.notEqual(projected.nodes, flow.nodes, 'fresh nodes array')
  assert.notEqual(projected.nodes[0], flow.nodes[0], 'fresh node objects')
})

test('withNodeAnchoredLabels tolerates a flow with no nodes', () => {
  const projected = withNodeAnchoredLabels({ viewBox: { w: 1600, h: 900 } })
  assert.deepEqual(projected.nodes, [])
})

test('flowCenterlineY returns the median node y (symmetry default)', () => {
  const flow = emptyFlow()
  addNode(flow, 0, 0) // node-1
  addNode(flow, 0, 0) // node-2
  addNode(flow, 0, 0) // node-3
  moveNode(flow, 'node-1', 0, 400)
  moveNode(flow, 'node-2', 0, 450)
  moveNode(flow, 'node-3', 0, 460)
  assert.equal(flowCenterlineY(flow), 450, 'odd count: middle value')
  addNode(flow, 0, 0) // node-4
  moveNode(flow, 'node-4', 0, 470)
  assert.equal(flowCenterlineY(flow), 455, 'even count: mean of the two middles')
})

test('flowCenterlineY falls back to the viewBox centre for an empty flow', () => {
  assert.equal(flowCenterlineY(emptyFlow()), 450)
  assert.equal(flowCenterlineY({ viewBox: { y: 100, h: 600 } }), 400)
})

test('snapToGrid rounds to the nearest grid multiple', () => {
  assert.equal(snapToGrid(0, 40), 0)
  assert.equal(snapToGrid(19, 40), 0)
  assert.equal(snapToGrid(21, 40), 40)
  assert.equal(snapToGrid(-19, 40), 0)
  assert.equal(snapToGrid(-21, 40), -40)
  assert.equal(snapToGrid(637, 40), 640)
})

test('snapToGrid is a no-op for a zero / missing grid', () => {
  assert.equal(snapToGrid(637, 0), 637)
  assert.equal(snapToGrid(637), 637)
})

// ── v1.2 rejection edges (spec §5 / §7 item 5) ───────────────────────────────

test('addRejection creates a rejection edge with default rate + bow', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0)
  assert.equal(addRejection(flow, b, a), true)
  assert.equal(flow.rejections.length, 1)
  const r = findRejection(flow, b, a)
  assert.equal(r.from, b)
  assert.equal(r.to, a)
  assert.ok(r.rate > 0 && r.rate < 1, 'has a default rate in (0,1)')
  assert.ok(r.bow && typeof r.bow.depth === 'number', 'has a bow depth')
  assert.ok(['above', 'below'].includes(r.bow.side), 'has a bow side')
})

test('addRejection auto-picks the bow side opposite the from node label', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0) // default labelSide 'above'
  addRejection(flow, b, a)
  assert.equal(findRejection(flow, b, a).bow.side, 'below', 'label above → arc below')

  setLabelSide(flow, b, 'below')
  const c = addNode(flow, 200, 0)
  addRejection(flow, b, c)
  assert.equal(findRejection(flow, b, c).bow.side, 'above', 'label below → arc above')
})

test('addRejection rejects duplicates and missing endpoints', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0)
  assert.equal(addRejection(flow, b, a), true)
  assert.equal(addRejection(flow, b, a), false, 'duplicate from→to rejected')
  assert.equal(addRejection(flow, b, 'ghost'), false, 'missing target rejected')
  assert.equal(addRejection(flow, 'ghost', a), false, 'missing source rejected')
  assert.equal(flow.rejections.length, 1)
})

test('addRejection permits self-rejection (validation surfaces it, §2.4)', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  assert.equal(addRejection(flow, a, a), true, 'self-rejection is legal model-side')
  assert.equal(flow.rejections.length, 1)
})

test('addRejection creates the rejections array when absent', () => {
  const flow = { viewBox: { w: 1600, h: 900 }, nodes: [] }
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0)
  addRejection(flow, b, a)
  assert.ok(Array.isArray(flow.rejections))
  assert.equal(flow.rejections.length, 1)
})

test('removeRejection drops just that rejection edge', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0)
  const c = addNode(flow, 200, 0)
  addRejection(flow, b, a)
  addRejection(flow, c, a)
  removeRejection(flow, b, a)
  assert.equal(flow.rejections.length, 1)
  assert.equal(findRejection(flow, b, a), undefined)
  assert.ok(findRejection(flow, c, a), 'other rejection edge untouched')
})

test('setRejectionField sets rate; empty value clears it for re-defaulting', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0)
  addRejection(flow, b, a)
  setRejectionField(flow, b, a, 'rate', 0.4)
  assert.equal(findRejection(flow, b, a).rate, 0.4)
  setRejectionField(flow, b, a, 'rate', '')
  assert.equal('rate' in findRejection(flow, b, a), false, 'empty value clears the field')
})

test('setRejectionBow updates side and/or depth independently', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0)
  addRejection(flow, b, a)
  setRejectionBow(flow, b, a, 'above', 120)
  let r = findRejection(flow, b, a)
  assert.equal(r.bow.side, 'above')
  assert.equal(r.bow.depth, 120)
  // a single component changes; the other is left intact
  setRejectionBow(flow, b, a, undefined, 60)
  r = findRejection(flow, b, a)
  assert.equal(r.bow.side, 'above', 'side untouched when undefined')
  assert.equal(r.bow.depth, 60)
  setRejectionBow(flow, b, a, 'below', undefined)
  r = findRejection(flow, b, a)
  assert.equal(r.bow.side, 'below')
  assert.equal(r.bow.depth, 60, 'depth untouched when undefined')
})

test('rejection mutations no-op on an unknown edge', () => {
  const flow = emptyFlow()
  addNode(flow, 0, 0)
  // none of these throw for a from→to with no rejection edge
  setRejectionField(flow, 'node-1', 'ghost', 'rate', 0.3)
  setRejectionBow(flow, 'node-1', 'ghost', 'above', 90)
  removeRejection(flow, 'node-1', 'ghost')
  assert.equal((flow.rejections || []).length, 0)
})

test('removeNode cascade-removes rejection edges referencing the node', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 100, 0)
  const c = addNode(flow, 200, 0)
  addRejection(flow, b, a) // b is the `to`-side reference's source… from=b, to=a
  addRejection(flow, c, b) // references b as `from`
  addRejection(flow, c, a) // does NOT reference b

  removeNode(flow, b)

  assert.equal(findRejection(flow, b, a), undefined, 'rejection with from=b gone')
  assert.equal(findRejection(flow, c, b), undefined, 'rejection with to=b gone')
  assert.ok(findRejection(flow, c, a), 'rejection not referencing b survives')
  assert.equal(flow.rejections.length, 1)
})

test('setNodeField clears the field when given an empty value', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeField(flow, id, 'width', 50)
  assert.equal(findNode(flow, id).width, 50)
  setNodeField(flow, id, 'width', '')
  assert.equal('width' in findNode(flow, id), false, 'empty value deletes the field')
})

// ── per-node CAPACITY override (bd ai-engineer-ey0b) ─────────────────────────

test('setNodeCapacity sets an explicit integer capacity override', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  assert.equal('capacity' in findNode(flow, id), false, 'no capacity by default')
  setNodeCapacity(flow, id, 4)
  assert.equal(findNode(flow, id).capacity, 4)
})

test('setNodeCapacity rounds a non-integer value to an integer', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeCapacity(flow, id, 3.7)
  assert.equal(findNode(flow, id).capacity, 4, 'rounded to nearest integer')
})

test('setNodeCapacity clamps a value below 1 up to 1 (engine requires ≥ 1)', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeCapacity(flow, id, 0)
  assert.equal(findNode(flow, id).capacity, 1)
  setNodeCapacity(flow, id, -5)
  assert.equal(findNode(flow, id).capacity, 1)
})

test('setNodeCapacity clears the override when given an empty value', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeCapacity(flow, id, 6)
  assert.equal(findNode(flow, id).capacity, 6)
  setNodeCapacity(flow, id, '')
  assert.equal('capacity' in findNode(flow, id), false, 'empty clears the override')
  setNodeCapacity(flow, id, 6)
  setNodeCapacity(flow, id, undefined)
  assert.equal('capacity' in findNode(flow, id), false, 'undefined clears the override')
})

test('setNodeCapacity no-ops on an unknown node id', () => {
  const flow = emptyFlow()
  setNodeCapacity(flow, 'nope', 4) // must not throw
  assert.equal(flow.nodes.length, 0)
})

// ── v1.3 large particles (spec §5 / §7 item 8) ───────────────────────────────

test('setSourceParticleSize sets the emit size on a source node', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeKind(flow, id, 'source')
  setSourceParticleSize(flow, id, 'large')
  assert.equal(findNode(flow, id).particleSize, 'large')
  setSourceParticleSize(flow, id, 'small')
  assert.equal(findNode(flow, id).particleSize, 'small')
})

test('setSourceParticleSize no-ops on a non-source node or unknown size', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0) // kind 'normal'
  setSourceParticleSize(flow, id, 'large')
  assert.equal('particleSize' in findNode(flow, id), false, 'not set on a normal node')
  setNodeKind(flow, id, 'source')
  setSourceParticleSize(flow, id, 'huge')
  assert.equal('particleSize' in findNode(flow, id), false, 'unknown size ignored')
})

test('setNodeTransform sets the transform and seeds the matching count', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeTransform(flow, id, 'split')
  let n = findNode(flow, id)
  assert.equal(n.transform, 'split')
  assert.equal(n.splitCount, 4, 'split seeds the default count')
  assert.equal('combineCount' in n, false, 'no combineCount on a split node')

  setNodeTransform(flow, id, 'combine')
  n = findNode(flow, id)
  assert.equal(n.transform, 'combine')
  assert.equal(n.combineCount, 4, 'combine seeds the default count')
})

test('setNodeTransform preserves an authored count when toggling away and back', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeTransform(flow, id, 'split')
  setTransformCount(flow, id, 7)
  assert.equal(findNode(flow, id).splitCount, 7)
  setNodeTransform(flow, id, 'none')
  assert.equal(findNode(flow, id).splitCount, 7, 'count kept while transform is none')
  setNodeTransform(flow, id, 'split')
  assert.equal(findNode(flow, id).splitCount, 7, 'authored count restored, not re-seeded')
})

test('setNodeTransform ignores an unknown transform', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeTransform(flow, id, 'shuffle')
  assert.equal('transform' in findNode(flow, id), false)
})

test('setTransformCount targets the field for the node transform', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  setNodeTransform(flow, a, 'split')
  setTransformCount(flow, a, 6)
  assert.equal(findNode(flow, a).splitCount, 6, 'split node → splitCount')

  const b = addNode(flow, 1, 1)
  setNodeTransform(flow, b, 'combine')
  setTransformCount(flow, b, 3)
  assert.equal(findNode(flow, b).combineCount, 3, 'combine node → combineCount')
})

test('setTransformCount rounds to an integer and clears on an empty value', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeTransform(flow, id, 'split')
  setTransformCount(flow, id, 5.7)
  assert.equal(findNode(flow, id).splitCount, 6, 'finite number rounded to integer')
  setTransformCount(flow, id, '')
  assert.equal('splitCount' in findNode(flow, id), false, 'empty value clears the field')
})

test('setTransformCount no-ops on a node with no transform', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0) // transform unset → treated as 'none'
  setTransformCount(flow, id, 8)
  const n = findNode(flow, id)
  assert.equal('splitCount' in n, false)
  assert.equal('combineCount' in n, false)
})

// ── fork authoring: forks[] ↔ successors[] sync (bead ai-engineer-kcmj) ──────
// Spec: docs/superpowers/specs/2026-05-21-flow-fork-authoring-design.md

/** Build a flow where `a` forks into the given successor ids. */
function forkFlow(...succIds) {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  for (const want of succIds) {
    const id = addNode(flow, 100, 0)
    // rename so the test reads clearly
    findNode(flow, id).id = want
    addEdge(flow, a, want)
  }
  return { flow, a }
}

test('addEdge making a 2-successor node materialises NO fork entry (even split)', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, b)
  addEdge(flow, a, c)
  assert.equal(flow.forks.length, 0, 'an even fork carries no forks[] entry')
})

test('forkBranchesFor: even split with no entry, [] below 2 successors', () => {
  const { flow, a } = forkFlow('b', 'c')
  const branches = forkBranchesFor(flow, a)
  assert.deepEqual(branches.map((x) => x.to), ['b', 'c'])
  close(branches[0].rateShare, 0.5, 'b even')
  close(branches[1].rateShare, 0.5, 'c even')
  // a node with one successor is not a fork
  const lone = emptyFlow()
  const x = addNode(lone, 0, 0)
  const y = addNode(lone, 1, 1)
  addEdge(lone, x, y)
  assert.deepEqual(forkBranchesFor(lone, x), [])
})

test('setForkRateShare materialises an entry and rebalances siblings to sum 1', () => {
  const { flow, a } = forkFlow('b', 'c')
  setForkRateShare(flow, a, 'b', 0.7)
  assert.equal(flow.forks.length, 1, 'a non-even split materialises an entry')
  const fork = flow.forks[0]
  assert.equal(fork.from, a)
  assert.deepEqual(fork.branches.map((x) => x.to), ['b', 'c'], 'branches mirror successors')
  close(fork.branches[0].rateShare, 0.7, 'dragged branch holds its share')
  close(fork.branches[1].rateShare, 0.3, 'sibling absorbs the remainder')
  close(shareSum(fork), 1, 'shares sum to 1')
})

test('setForkRateShare rebalances 3-way siblings proportionally (keeps their ratio)', () => {
  const { flow, a } = forkFlow('b', 'c', 'd')
  setForkRateShare(flow, a, 'c', 0.5) // c half; b & d split the remainder evenly
  const before = Object.fromEntries(
    flow.forks[0].branches.map((x) => [x.to, x.rateShare]),
  )
  const ratioBefore = before.c / before.d
  setForkRateShare(flow, a, 'b', 0.7) // pin b — c & d absorb the rest
  const after = Object.fromEntries(
    flow.forks[0].branches.map((x) => [x.to, x.rateShare]),
  )
  close(after.b, 0.7, 'b pinned')
  close(after.c / after.d, ratioBefore, 'c:d ratio preserved through the rebalance')
  close(shareSum(flow.forks[0]), 1, 'shares still sum to 1')
})

test('setForkRateShare landing on an even split prunes the entry', () => {
  const { flow, a } = forkFlow('b', 'c')
  setForkRateShare(flow, a, 'b', 0.7)
  assert.equal(flow.forks.length, 1)
  setForkRateShare(flow, a, 'b', 0.5) // back to even
  assert.equal(flow.forks.length, 0, 'an even split carries no entry')
})

test('reconcileForks: addEdge appends a branch and renormalises an existing fork', () => {
  const { flow, a } = forkFlow('b', 'c')
  setForkRateShare(flow, a, 'b', 0.7) // b 0.7 / c 0.3
  const d = addNode(flow, 200, 0)
  findNode(flow, d).id = 'd'
  addEdge(flow, a, 'd') // 2 → 3 successors
  const fork = flow.forks[0]
  assert.deepEqual(fork.branches.map((x) => x.to), ['b', 'c', 'd'])
  close(shareSum(fork), 1, 'renormalised to sum 1')
  const by = Object.fromEntries(fork.branches.map((x) => [x.to, x.rateShare]))
  close(by.b / by.c, 7 / 3, 'b:c ratio preserved when the new branch makes room')
  assert.ok(by.d > 0, 'the new branch gets a positive share')
})

test('reconcileForks: removeEdge then re-add round-trips the rate ratios', () => {
  const { flow, a } = forkFlow('b', 'c')
  setForkRateShare(flow, a, 'b', 0.7) // b 0.7 / c 0.3
  const d = addNode(flow, 200, 0)
  findNode(flow, d).id = 'd'
  addEdge(flow, a, 'd')
  removeEdge(flow, a, 'd') // back to a 2-way fork
  const fork = flow.forks[0]
  assert.deepEqual(fork.branches.map((x) => x.to), ['b', 'c'])
  close(fork.branches[0].rateShare, 0.7, 'b ratio restored after add+remove')
  close(fork.branches[1].rateShare, 0.3, 'c ratio restored after add+remove')
})

test('reconcileForks: removeEdge dropping below 2 successors prunes the entry', () => {
  const { flow, a } = forkFlow('b', 'c')
  setForkRateShare(flow, a, 'b', 0.7)
  removeEdge(flow, a, 'c') // a now has one successor
  assert.equal(flow.forks.length, 0, 'no longer a fork → entry pruned')
})

test('removeNode of a fork branch target reconciles the surviving entry', () => {
  const { flow, a } = forkFlow('b', 'c', 'd')
  setForkRateShare(flow, a, 'b', 0.6)
  setForkRateShare(flow, a, 'c', 0.3) // b/c/d all distinct
  removeNode(flow, 'c')
  const fork = flow.forks[0]
  assert.deepEqual(fork.branches.map((x) => x.to), ['b', 'd'], 'c branch gone')
  close(shareSum(fork), 1, 'survivors renormalised to sum 1')
})

test('removeNode of the fork root removes the fork entry', () => {
  const { flow, a } = forkFlow('b', 'c')
  setForkRateShare(flow, a, 'b', 0.7)
  removeNode(flow, a)
  assert.equal(flow.forks.length, 0, 'fork.from gone → entry removed')
})

test('resetForkToEven drops the entry, returning the fork to an even split', () => {
  const { flow, a } = forkFlow('b', 'c')
  setForkRateShare(flow, a, 'b', 0.8)
  assert.equal(flow.forks.length, 1)
  resetForkToEven(flow, a)
  assert.equal(flow.forks.length, 0)
  const branches = forkBranchesFor(flow, a)
  close(branches[0].rateShare, 0.5, 'even again')
})

test('setForkRateShare no-ops below 2 successors or for an unknown branch', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  addEdge(flow, a, b)
  setForkRateShare(flow, a, b, 0.7) // a has one successor — not a fork
  assert.equal(flow.forks.length, 0)
  const { flow: f2, a: a2 } = forkFlow('b', 'c')
  setForkRateShare(f2, a2, 'ghost', 0.7) // unknown branch
  assert.equal(f2.forks.length, 0)
})

test('predecessorsOf returns every node listing the id as a successor', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, c)
  addEdge(flow, b, c)
  assert.deepEqual(predecessorsOf(flow, c).sort(), [a, b].sort())
  assert.deepEqual(predecessorsOf(flow, a), [], 'a has no predecessors')
})

// ── merges[] derivation: reconcileMerges (bead ai-engineer-b38t) ─────────────
// Spec: merges[] is purely topology-derived (no authored data). A node with
// ≥2 predecessors gets a { to, from[] } entry. reconcileMerges() wipes and
// recomputes from scratch; it is called by addEdge / removeEdge / removeNode.

test('reconcileMerges: no merges when every node has ≤1 predecessor', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, b)
  addEdge(flow, b, c)
  // single-predecessor chain: no merges
  reconcileMerges(flow)
  assert.equal(flow.merges.length, 0, 'no merge nodes → empty merges[]')
})

test('reconcileMerges: two predecessors materialises a merges[] entry', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, c)
  addEdge(flow, b, c)
  // addEdge calls reconcileMerges internally, but test explicitly too
  reconcileMerges(flow)
  assert.equal(flow.merges.length, 1, 'one merge node → one entry')
  const m = flow.merges[0]
  assert.equal(m.to, c, 'merge target is c')
  assert.deepEqual(m.from.slice().sort(), [a, b].sort(), 'both predecessors listed')
})

test('reconcileMerges: three predecessors materialises one entry with all three', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  const d = addNode(flow, 3, 3)
  addEdge(flow, a, d)
  addEdge(flow, b, d)
  addEdge(flow, c, d)
  reconcileMerges(flow)
  assert.equal(flow.merges.length, 1)
  assert.deepEqual(flow.merges[0].from.slice().sort(), [a, b, c].sort())
})

test('addEdge auto-derives merges[] when a second predecessor is added', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, c)
  assert.equal(flow.merges.length, 0, 'single predecessor → no merge entry')
  addEdge(flow, b, c)
  assert.equal(flow.merges.length, 1, 'second predecessor → merge entry materialised')
  assert.equal(flow.merges[0].to, c)
})

test('removeEdge dropping to 1 predecessor removes the merge entry', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, c)
  addEdge(flow, b, c)
  assert.equal(flow.merges.length, 1)
  removeEdge(flow, b, c)
  assert.equal(flow.merges.length, 0, 'only one predecessor remains → entry removed')
})

test('removeNode removes the merge entry for its target', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, c)
  addEdge(flow, b, c)
  assert.equal(flow.merges.length, 1)
  removeNode(flow, c) // c was the merge target
  assert.equal(flow.merges.length, 0, 'merge target removed → entry gone')
})

test('removeNode removes the merge entry when a predecessor is removed', () => {
  const flow = emptyFlow()
  const a = addNode(flow, 0, 0)
  const b = addNode(flow, 1, 1)
  const c = addNode(flow, 2, 2)
  addEdge(flow, a, c)
  addEdge(flow, b, c)
  assert.equal(flow.merges.length, 1)
  removeNode(flow, b) // b was a predecessor of c
  assert.equal(flow.merges.length, 0, 'predecessor removed → only one remains → entry gone')
})
