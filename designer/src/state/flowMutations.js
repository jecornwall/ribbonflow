/**
 * flowMutations.js — the designer's pure mutation layer.
 *
 * Every function here takes a flow object and mutates it in place (or returns
 * a derived value). They are deliberately PURE of any Vue / library import so
 * they can be unit-tested headless under node:test (see test/flowMutations.
 * test.js). useFlowDoc.js wraps them with reactivity, selection bookkeeping,
 * and preview-key bumping — see M3 spec §3.1.
 *
 * The designer thinks in nodes + edges; edges are stored as per-node
 * `successors[]` (the library owns that internal topology storage — charter
 * §Data model). Forks/merges are first-class M2 model and are kept consistent
 * when a node is removed.
 */

import {
  LABEL_GAP,
  NEW_NODE_CAPACITY,
  NEW_NODE_LATENCY,
  DEFAULT_SOURCE_RATE,
} from '../lib/constants.js'

/** Find a node by id, or undefined. */
export function findNode(flow, id) {
  return (flow.nodes || []).find((n) => n.id === id)
}

/** Generate an id not already used by any node: `node-1`, `node-2`, … */
export function uniqueId(flow, base = 'node') {
  const used = new Set((flow.nodes || []).map((n) => n.id))
  let i = 1
  while (used.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * Create a node at (x, y) with documented designer defaults. Returns its id.
 */
export function addNode(flow, x, y) {
  const id = uniqueId(flow)
  if (!Array.isArray(flow.nodes)) flow.nodes = []
  flow.nodes.push({
    id,
    x: Math.round(x),
    y: Math.round(y),
    label: 'new node',
    kind: 'normal',
    capacity: NEW_NODE_CAPACITY,
    latency: NEW_NODE_LATENCY,
    labelSide: 'above',
    labelDx: 0,
    labelDy: -LABEL_GAP,
    successors: [],
  })
  return id
}

/** Move a node to (x, y). Edges follow for free — they read node positions. */
export function moveNode(flow, id, x, y) {
  const n = findNode(flow, id)
  if (!n) return
  n.x = Math.round(x)
  n.y = Math.round(y)
}

/**
 * Remove a node and every reference to it: incoming edges (other nodes'
 * successors), and any fork/merge that names it.
 */
export function removeNode(flow, id) {
  flow.nodes = (flow.nodes || []).filter((n) => n.id !== id)
  for (const n of flow.nodes) {
    if (Array.isArray(n.successors)) {
      n.successors = n.successors.filter((s) => s !== id)
    }
  }
  if (Array.isArray(flow.forks)) {
    flow.forks = flow.forks
      .filter((f) => f.from !== id)
      .map((f) => ({
        ...f,
        branches: (f.branches || []).filter((b) => b.to !== id),
      }))
  }
  if (Array.isArray(flow.merges)) {
    flow.merges = flow.merges
      .filter((m) => m.to !== id)
      .map((m) => ({ ...m, from: (m.from || []).filter((x) => x !== id) }))
  }
}

/**
 * Add an edge from → to (pushes `to` into from.successors).
 * No self-loops, no duplicates, both endpoints must exist.
 * Returns true if an edge was added.
 */
export function addEdge(flow, from, to) {
  if (from === to) return false
  const n = findNode(flow, from)
  if (!n || !findNode(flow, to)) return false
  if (!Array.isArray(n.successors)) n.successors = []
  if (n.successors.includes(to)) return false
  n.successors.push(to)
  return true
}

/** Remove the edge from → to. */
export function removeEdge(flow, from, to) {
  const n = findNode(flow, from)
  if (!n || !Array.isArray(n.successors)) return
  n.successors = n.successors.filter((s) => s !== to)
}

/** Set an arbitrary field on a node (label, width, rate, capacity, …). */
export function setNodeField(flow, id, key, value) {
  const n = findNode(flow, id)
  if (!n) return
  if (value === undefined || value === '' || value === null) {
    delete n[key]
  } else {
    n[key] = value
  }
}

/**
 * Change a node's kind, keeping kind-specific fields coherent:
 * source → ensure a `rate`; constraint → ensure a `constraintKind`.
 */
export function setNodeKind(flow, id, kind) {
  const n = findNode(flow, id)
  if (!n) return
  n.kind = kind
  if (kind === 'source' && n.rate === undefined) n.rate = DEFAULT_SOURCE_RATE
  if (kind === 'constraint' && n.constraintKind === undefined) {
    n.constraintKind = 'pinch'
  }
}

/**
 * Set a node's label side (above/below). This is sugar over `labelDy`: it
 * records the intent (`labelSide`) AND resets `labelDy` to that side's default
 * gap, which the user can then fine-tune by dragging the label. See M3 §2.5.
 */
export function setLabelSide(flow, id, side) {
  const n = findNode(flow, id)
  if (!n) return
  n.labelSide = side
  n.labelDy = side === 'below' ? LABEL_GAP : -LABEL_GAP
}

/** Move a node's label to offset (dx, dy) relative to the node. */
export function moveLabel(flow, id, dx, dy) {
  const n = findNode(flow, id)
  if (!n) return
  n.labelDx = Math.round(dx)
  n.labelDy = Math.round(dy)
  // Keep labelSide consistent with the dragged position.
  n.labelSide = dy >= 0 ? 'below' : 'above'
}

/** Set a flow-level field (widthMode, bandWidth, baseSpeed, …). */
export function setFlowField(flow, key, value) {
  if (value === undefined || value === '' || value === null) {
    delete flow[key]
  } else {
    flow[key] = value
  }
}

/**
 * Project a flow for the LIVE PREVIEW so its segment labels anchor at each
 * node's own xy position (bd ai-engineer-t173).
 *
 * Why: the library renderer (FlowGraph.markerPropsFor) places a segment label
 * at the *latency-proportioned arc-midpoint* of the node's branch segment by
 * default — an arc fraction that does NOT track the node's geometric anchor.
 * So when the designer drags a node, the preview ribbon's pinch/segment moves
 * with the node but the label stays behind at the stale arc fraction: "label
 * does not follow its segment". The editor canvas never had this bug — it draws
 * the label at `node.x + labelDx` directly.
 *
 * The library already exposes a node-anchored label path: when a node carries
 * `labelX` / `labelY`, markerPropsFor anchors the label (and its leader) at
 * that point instead of the arc-midpoint. This projection stamps each node's
 * own xy as `labelX` / `labelY` so the preview label sits at exactly
 * `node.x + labelDx, node.y + labelDy` — byte-for-byte the editor-canvas
 * placement, and it tracks the node on every move.
 *
 * Preview-only: this is applied to `doc.normalized`, never to the authored
 * `doc.flow` that `export` serialises — so the exported file stays free of
 * derived `labelX` / `labelY` and the round-trip invariant is untouched.
 * Returns a fresh flow with fresh node objects; the input is not mutated.
 */
export function withNodeAnchoredLabels(flow) {
  return {
    ...flow,
    nodes: (flow.nodes || []).map((n) => ({ ...n, labelX: n.x, labelY: n.y })),
  }
}
