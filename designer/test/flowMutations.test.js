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
} from '../src/state/flowMutations.js'

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
  addEdge(flow, a, b)
  addEdge(flow, b, c)
  flow.forks = [{ from: a, branches: [{ to: b }, { to: c }] }]
  flow.merges = [{ to: c, from: [a, b] }]

  removeNode(flow, b)

  assert.equal(findNode(flow, b), undefined)
  assert.deepEqual(findNode(flow, a).successors, [], 'incoming edge to b gone')
  assert.deepEqual(
    flow.forks[0].branches.map((x) => x.to),
    [c],
    'fork branch to b gone',
  )
  assert.deepEqual(flow.merges[0].from, [a], 'merge source b gone')
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

test('setNodeField clears the field when given an empty value', () => {
  const flow = emptyFlow()
  const id = addNode(flow, 0, 0)
  setNodeField(flow, id, 'width', 50)
  assert.equal(findNode(flow, id).width, 50)
  setNodeField(flow, id, 'width', '')
  assert.equal('width' in findNode(flow, id), false, 'empty value deletes the field')
})
