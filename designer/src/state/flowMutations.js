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
  NEW_NODE_LENGTH,
  NEW_NODE_SPEED,
  NEW_NODE_WIDTH,
  NEW_NODE_COLOR_SCHEME,
  DEFAULT_SOURCE_RATE,
  NEW_REJECTION_RATE,
  NEW_REJECTION_BOW_DEPTH,
  NEW_SPLIT_COUNT,
  NEW_COMBINE_COUNT,
} from '../lib/constants.js'

/** Legal `source.particleSize` values (mirrors library PARTICLE_SIZES). */
const PARTICLE_SIZE_VALUES = ['small', 'large']
/** Legal `node.transform` values (mirrors library NODE_TRANSFORMS). */
const NODE_TRANSFORM_VALUES = ['none', 'split', 'combine']

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
 * Create a node at (x, y) with documented designer defaults — the v1.1 node
 * controls (LENGTH / SPEED / WIDTH, Speed⇄Width coupled) and the neutral
 * colour scheme. Returns its id.
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
    length: NEW_NODE_LENGTH,
    speed: NEW_NODE_SPEED,
    width: NEW_NODE_WIDTH,
    coupleSpeedWidth: true,
    colorScheme: NEW_NODE_COLOR_SCHEME,
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
  // v1.2: a rejection edge naming the removed node at EITHER end goes too
  // (spec §5 — "removing a node removes any rejection edges referencing it").
  if (Array.isArray(flow.rejections)) {
    flow.rejections = flow.rejections.filter(
      (r) => r.from !== id && r.to !== id,
    )
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

// ── v1.2 rejection edges (spec §5) ───────────────────────────────────────────
// A rejection edge models failed-review work travelling BACK to an earlier
// node to be re-done. Stored in `flow.rejections[]` as
// `{ from, to, rate, bow: { side, depth } }` — separate from forward
// `successors[]` because rejection paths are backward, thin, and rendered
// distinctly (charter §Data model; spec §2). The library owns the format and
// fills any omitted defaults via normalizeFlow; these mutations seed concrete
// values so a designer-created edge round-trips with explicit geometry.

/** Find a rejection edge by from→to, or undefined. */
export function findRejection(flow, from, to) {
  return (flow.rejections || []).find((r) => r.from === from && r.to === to)
}

/**
 * Add a rejection edge from → to. Seeds the default rate and a complete bow:
 * the bow side is auto-picked OPPOSITE the `from` node's label side (matching
 * the library's normalizeFlow §2.3, so the arc and the label do not collide).
 *
 * No duplicate (from, to) pairs; both endpoints must exist. Self-rejection
 * (from === to) is permitted — the library flags it as a validation WARNING,
 * not an error (spec §2.4), so the mutation layer allows it and lets
 * validateFlow surface it. Returns true if an edge was added.
 */
export function addRejection(flow, from, to) {
  const fromNode = findNode(flow, from)
  if (!fromNode || !findNode(flow, to)) return false
  if (!Array.isArray(flow.rejections)) flow.rejections = []
  if (flow.rejections.some((r) => r.from === from && r.to === to)) return false
  // autoRejectionBowSide (model.js §2.3): label 'below' → arc 'above';
  // label 'above' or unset → arc 'below'.
  const side = fromNode.labelSide === 'below' ? 'above' : 'below'
  flow.rejections.push({
    from,
    to,
    rate: NEW_REJECTION_RATE,
    bow: { side, depth: NEW_REJECTION_BOW_DEPTH },
  })
  return true
}

/** Remove the rejection edge from → to. */
export function removeRejection(flow, from, to) {
  if (!Array.isArray(flow.rejections)) return
  flow.rejections = flow.rejections.filter(
    (r) => !(r.from === from && r.to === to),
  )
}

/**
 * Set a scalar field on a rejection edge (currently `rate`). An empty value
 * deletes the field, letting normalizeFlow re-fill the documented default.
 */
export function setRejectionField(flow, from, to, key, value) {
  const r = findRejection(flow, from, to)
  if (!r) return
  if (value === undefined || value === '' || value === null) {
    delete r[key]
  } else {
    r[key] = value
  }
}

/**
 * Set a rejection edge's bow geometry. `side` is 'above' | 'below'; `depth` is
 * the perpendicular arc displacement in viewBox units. Either argument may be
 * left `undefined` to change only the other component.
 */
export function setRejectionBow(flow, from, to, side, depth) {
  const r = findRejection(flow, from, to)
  if (!r) return
  if (r.bow == null || typeof r.bow !== 'object') r.bow = {}
  if (side !== undefined) r.bow.side = side
  if (depth !== undefined) r.bow.depth = depth
}

// ── v1.3 large particles (spec §5) ───────────────────────────────────────────
// A source emits one particle size (`source.particleSize`); a node may
// `transform` arriving particles — `split` (1 large → splitCount small) or
// `combine` (combineCount small → 1 large). The library owns the format and
// fills omitted defaults via normalizeFlow; these mutations seed concrete
// values so a designer edit round-trips with explicit fields — matching the
// v1.2 rejection-mutation precedent.

/**
 * Set a source node's emitted particle size ('small' | 'large'). A no-op on a
 * non-source node (the field belongs on sources — spec §2.1) and on an
 * unrecognised size.
 */
export function setSourceParticleSize(flow, id, size) {
  const n = findNode(flow, id)
  if (!n || n.kind !== 'source') return
  if (!PARTICLE_SIZE_VALUES.includes(size)) return
  n.particleSize = size
}

/**
 * Set a node's transform behaviour ('none' | 'split' | 'combine'). Switching
 * to split / combine seeds the matching count default (4) when absent;
 * switching to 'none' leaves any authored count intact so toggling back
 * restores it — validateFlow ignores a stale count on a non-matching
 * transform (spec §2.4). A no-op on an unrecognised transform.
 */
export function setNodeTransform(flow, id, transform) {
  const n = findNode(flow, id)
  if (!n) return
  if (!NODE_TRANSFORM_VALUES.includes(transform)) return
  n.transform = transform
  if (transform === 'split' && n.splitCount === undefined) {
    n.splitCount = NEW_SPLIT_COUNT
  }
  if (transform === 'combine' && n.combineCount === undefined) {
    n.combineCount = NEW_COMBINE_COUNT
  }
}

/**
 * Set the transform count of a split / combine node. The target field is
 * picked from the node's current transform — `splitCount` for split,
 * `combineCount` for combine; a no-op on a 'none' node. An empty value clears
 * the field, letting normalizeFlow re-fill the default. A finite number is
 * rounded to an integer (counts are integers ≥ 2); validateFlow surfaces a
 * count < 2 (spec §2.4), so the mutation does not clamp.
 */
export function setTransformCount(flow, id, n) {
  const node = findNode(flow, id)
  if (!node) return
  const key =
    node.transform === 'split'
      ? 'splitCount'
      : node.transform === 'combine'
        ? 'combineCount'
        : null
  if (!key) return
  if (n === undefined || n === '' || n === null) {
    delete node[key]
  } else if (typeof n === 'number' && Number.isFinite(n)) {
    node[key] = Math.round(n)
  } else {
    node[key] = n
  }
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
 * Change a node's kind, keeping kind-specific fields coherent. v1.1 dropped
 * the `constraint` type — `kind` is now `'normal' | 'source'`. A source node
 * gains a default emit `rate`.
 */
export function setNodeKind(flow, id, kind) {
  const n = findNode(flow, id)
  if (!n) return
  n.kind = kind
  if (kind === 'source' && n.rate === undefined) n.rate = DEFAULT_SOURCE_RATE
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

/**
 * The y-coordinate of a flow's dominant horizontal line — the MEDIAN y of its
 * existing nodes (bd ai-engineer-1dr8). A node created via the add-node tool
 * snaps to this line so additions stay symmetric with the existing flow
 * instead of landing wherever the cursor happened to be — "better defaults
 * favouring symmetry". The user can still drag the node off the line after.
 *
 * Median (not mean) so one off-line node does not drag the default askew.
 * Falls back to the viewBox vertical centre when the flow has no nodes yet.
 */
export function flowCenterlineY(flow) {
  const ys = (flow.nodes || [])
    .map((n) => n.y)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b)
  if (ys.length === 0) {
    const v = flow.viewBox || {}
    return Math.round((v.y ?? 0) + (v.h ?? 900) / 2)
  }
  const mid = Math.floor(ys.length / 2)
  return ys.length % 2 === 1
    ? ys[mid]
    : Math.round((ys[mid - 1] + ys[mid]) / 2)
}

/**
 * Snap a coordinate to the nearest multiple of `grid` (bd ai-engineer-esx8).
 * Pure helper; the store applies it to node moves / creation only while the
 * optional snap-to-grid mode is enabled. A zero / missing grid is a no-op.
 */
export function snapToGrid(value, grid) {
  if (!grid || grid <= 0) return value
  // `|| 0` normalises the -0 that Math.round yields for small negatives.
  return Math.round(value / grid) * grid || 0
}
