/**
 * flowCurve.js — pure curve & ribbon math for the flow-animation system.
 *
 * Centripetal Catmull-Rom centerlines through anchor points.
 * Arc-length parameterised. Variable-width ribbon outlines.
 *
 * See docs/superpowers/specs/2026-05-16-flow-animation-redesign-design.md.
 */

// ---- Physical constants ---------------------------------------------------

export const PARTICLE_RADIUS = 3      // viewBox units (agents are circles of this radius)
// v1.3 — large-particle diameter ratio (large-particle spec §3.1; L3). A large
// agent's radius is PARTICLE_RADIUS × LARGE_PARTICLE_SCALE (small r=3 → large
// r=9). Exported here next to PARTICLE_RADIUS so the engine (radiusForSize)
// and L4 rendering (FlowAgent) derive the large radius from one constant.
export const LARGE_PARTICLE_SCALE = 3
export const WALL_MARGIN     = 2      // viewBox units — gap between agent edge and ribbon wall
export const MIN_RIBBON_WIDTH = 2 * (PARTICLE_RADIUS + WALL_MARGIN)  // 10 units

// ---- Catmull-Rom (centripetal, alpha = 0.5) -------------------------------

const ALPHA = 0.5

function tDelta(p0, p1) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y
  return Math.pow(dx * dx + dy * dy, ALPHA / 2)  // |p1 - p0|^alpha
}

/**
 * Evaluate the centripetal Catmull-Rom spline on the segment p1→p2,
 * given the four control points p0, p1, p2, p3 and parameter t ∈ [0,1].
 * Returns { x, y }.
 *
 * IMPORTANT: ghost control points (p0, p3) must not coincide with p1
 * or p2 respectively, or the t=1 result is corrupted by safe() zero-
 * denominator handling. For path endpoints, use reflected neighbours
 * (see buildCenterline, Task 2).
 */
export function catmullRomPoint(p0, p1, p2, p3, t) {
  const t0 = 0
  const t1 = t0 + tDelta(p0, p1)
  const t2 = t1 + tDelta(p1, p2)
  const t3 = t2 + tDelta(p2, p3)

  // Map t ∈ [0,1] onto [t1, t2]
  const tt = t1 + t * (t2 - t1)

  // Avoid division by zero at coincident points
  const safe = (denom) => (Math.abs(denom) < 1e-12 ? 1e-12 : denom)

  const a1x = ((t1 - tt) / safe(t1 - t0)) * p0.x + ((tt - t0) / safe(t1 - t0)) * p1.x
  const a1y = ((t1 - tt) / safe(t1 - t0)) * p0.y + ((tt - t0) / safe(t1 - t0)) * p1.y
  const a2x = ((t2 - tt) / safe(t2 - t1)) * p1.x + ((tt - t1) / safe(t2 - t1)) * p2.x
  const a2y = ((t2 - tt) / safe(t2 - t1)) * p1.y + ((tt - t1) / safe(t2 - t1)) * p2.y
  const a3x = ((t3 - tt) / safe(t3 - t2)) * p2.x + ((tt - t2) / safe(t3 - t2)) * p3.x
  const a3y = ((t3 - tt) / safe(t3 - t2)) * p2.y + ((tt - t2) / safe(t3 - t2)) * p3.y

  const b1x = ((t2 - tt) / safe(t2 - t0)) * a1x + ((tt - t0) / safe(t2 - t0)) * a2x
  const b1y = ((t2 - tt) / safe(t2 - t0)) * a1y + ((tt - t0) / safe(t2 - t0)) * a2y
  const b2x = ((t3 - tt) / safe(t3 - t1)) * a2x + ((tt - t1) / safe(t3 - t1)) * a3x
  const b2y = ((t3 - tt) / safe(t3 - t1)) * a2y + ((tt - t1) / safe(t3 - t1)) * a3y

  const cx = ((t2 - tt) / safe(t2 - t1)) * b1x + ((tt - t1) / safe(t2 - t1)) * b2x
  const cy = ((t2 - tt) / safe(t2 - t1)) * b1y + ((tt - t1) / safe(t2 - t1)) * b2y

  return { x: cx, y: cy }
}

// ---- Centerline through anchors -------------------------------------------

/**
 * Build an arc-length-parameterised centerline object from a dense, ordered
 * list of sample points. Shared by buildCenterline (Catmull-Rom forward
 * branches) and buildRejectionCenterline (quadratic-Bézier rejection
 * branches), so both expose the IDENTICAL sampling interface the engine and
 * renderer consume — { totalLength, sample, pointAtArcLength, tangentAtArcLength }.
 *
 * `extra` is shallow-merged onto the result (e.g. { anchors, segmentCount }).
 */
function arcLengthCenterline(points, extra = {}) {
  const totalSamples = points.length - 1
  const cumLength = [0]
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    cumLength.push(cumLength[i - 1] + Math.hypot(dx, dy))
  }
  const totalLength = cumLength[cumLength.length - 1]

  return {
    ...extra,
    totalLength,

    sample(t) {
      const tc = Math.max(0, Math.min(1, t))
      const idx = Math.floor(tc * totalSamples)
      return points[Math.min(idx, totalSamples)]
    },

    /**
     * Look up the point on the centerline at arc length `s` (in viewBox units).
     * Clamps s to [0, totalLength]. Linear interpolation between samples.
     */
    pointAtArcLength(s) {
      const sc = Math.max(0, Math.min(totalLength, s))
      // Binary search cumLength for the bracketing samples.
      let lo = 0, hi = cumLength.length - 1
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1
        if (cumLength[mid] <= sc) lo = mid
        else hi = mid
      }
      const lenSpan = cumLength[hi] - cumLength[lo]
      const f = lenSpan < 1e-12 ? 0 : (sc - cumLength[lo]) / lenSpan
      return {
        x: points[lo].x + f * (points[hi].x - points[lo].x),
        y: points[lo].y + f * (points[hi].y - points[lo].y),
      }
    },

    /**
     * Unit-length tangent vector at arc length `s`. Numerical derivative
     * via centered difference; small enough delta to be accurate, large
     * enough to avoid sample-discretisation noise.
     */
    tangentAtArcLength(s) {
      const eps = Math.min(1, totalLength * 0.001)  // 0.1% of total
      const sa = Math.max(0, s - eps)
      const sb = Math.min(totalLength, s + eps)
      const pa = this.pointAtArcLength(sa)
      const pb = this.pointAtArcLength(sb)
      const dx = pb.x - pa.x, dy = pb.y - pa.y
      const mag = Math.hypot(dx, dy)
      if (mag < 1e-12) return { x: 1, y: 0 }
      return { x: dx / mag, y: dy / mag }
    },
  }
}

/**
 * Build a centerline that passes through every anchor in order using
 * centripetal Catmull-Rom segments. Endpoints are clamped by reflecting
 * neighbour anchors (so the start and end points are exactly the first
 * and last anchors).
 *
 * Returns an object with:
 *   - anchors: the original anchor array
 *   - sample(t): t ∈ [0,1] → { x, y } point along the centerline
 *   - segmentCount: number of CR segments (anchors.length - 1)
 */
export function buildCenterline(anchors) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    throw new Error('buildCenterline: need at least 2 anchors')
  }

  // Reflect endpoints so first segment starts at anchors[0] and last ends
  // at anchors[N-1].
  const n = anchors.length
  const padded = [
    { x: 2 * anchors[0].x - anchors[1].x, y: 2 * anchors[0].y - anchors[1].y },
    ...anchors,
    { x: 2 * anchors[n - 1].x - anchors[n - 2].x, y: 2 * anchors[n - 1].y - anchors[n - 2].y },
  ]

  const segmentCount = n - 1

  // Build the dense sample-point list from the Catmull-Rom segments, then
  // hand it to arcLengthCenterline for the shared arc-length machinery.
  const SAMPLES_PER_SEGMENT = 50
  const totalSamples = segmentCount * SAMPLES_PER_SEGMENT
  const points = []     // { x, y } per sample

  for (let i = 0; i <= totalSamples; i++) {
    const t = i / totalSamples
    const total = t * segmentCount
    let seg = Math.floor(total)
    if (seg >= segmentCount) seg = segmentCount - 1
    const u = total - seg
    points.push(catmullRomPoint(padded[seg], padded[seg + 1], padded[seg + 2], padded[seg + 3], u))
  }

  return arcLengthCenterline(points, { anchors, segmentCount })
}

// ---- Rejection-edge geometry (v1.2 R2 — spec §3.1 / §4) -------------------
//
// A rejection edge renders + simulates as a thin bowed arc carrying
// "failed-review" work backward to an earlier node. The SAME quadratic-Bézier
// curve feeds both the engine centerline (here) and the R3 rendered path, so
// physics and visuals agree by construction (spec §4).

/**
 * Fixed band width for a rejection branch — wide enough for one small particle
 * (radius PARTICLE_RADIUS) plus wall margin. NOT width/rate coupled (spec §3.1).
 */
export const REJECTION_BAND_WIDTH = 14

/**
 * Fallback bow depth (viewBox units) when a rejection edge omits `bow.depth`.
 * Mirrors format/model.js's DEFAULT_REJECTION_BOW_DEPTH — inlined here
 * (module-private) so the curve layer carries no format-layer dependency,
 * exactly as DEFAULT_SOURCE_RATE is inlined for effectiveNodeRates.
 */
const REJECTION_BOW_DEPTH_FALLBACK = 80

/** Evaluate a quadratic Bézier with control points p0, c, p1 at t ∈ [0,1]. */
export function quadBezierPoint(p0, c, p1, t) {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  }
}

/**
 * The rejection bow curve (spec §4): a quadratic Bézier from `fromPt` to
 * `toPt`. The control point is the chord midpoint displaced perpendicular to
 * the chord by `bow.depth`, on the side given by `bow.side` ('above'|'below').
 *
 * 'above' displaces the control point toward smaller y (screen-up), 'below'
 * toward larger y. For a (degenerate) vertical chord the perpendicular is
 * horizontal and the side is honoured as authored without a y-based flip.
 *
 * Returns { p0, ctrl, p1 } — the three control points. SHARED by the engine
 * centerline (buildRejectionCenterline) and the R3 rendered path.
 */
export function rejectionBowCurve(fromPt, toPt, bow) {
  const side  = bow && bow.side === 'above' ? 'above' : 'below'
  const depth = bow && typeof bow.depth === 'number'
    ? bow.depth
    : REJECTION_BOW_DEPTH_FALLBACK
  const mid = { x: (fromPt.x + toPt.x) / 2, y: (fromPt.y + toPt.y) / 2 }
  const dx = toPt.x - fromPt.x, dy = toPt.y - fromPt.y
  const len = Math.hypot(dx, dy) || 1
  // Unit normal to the chord.
  let nx = -dy / len, ny = dx / len
  // Orient: 'above' → normal points to -y, 'below' → +y.
  if ((side === 'above' && ny > 0) || (side === 'below' && ny < 0)) {
    nx = -nx; ny = -ny
  }
  const ctrl = { x: mid.x + nx * depth, y: mid.y + ny * depth }
  return { p0: { x: fromPt.x, y: fromPt.y }, ctrl, p1: { x: toPt.x, y: toPt.y } }
}

/**
 * Build an arc-length-parameterised centerline for a rejection edge — the
 * §4 bow curve sampled densely. Exposes the same interface as buildCenterline,
 * so the engine treats a rejection branch like any other branch.
 */
export function buildRejectionCenterline(fromPt, toPt, bow) {
  const { p0, ctrl, p1 } = rejectionBowCurve(fromPt, toPt, bow)
  const SAMPLES = 100
  const points = []
  for (let i = 0; i <= SAMPLES; i++) {
    points.push(quadBezierPoint(p0, ctrl, p1, i / SAMPLES))
  }
  return arcLengthCenterline(points, {
    anchors: [{ x: fromPt.x, y: fromPt.y }, { x: toPt.x, y: toPt.y }],
    segmentCount: 1,
  })
}

// ---- Branch builder -------------------------------------------------------

/**
 * Walk the flow's node graph starting at each root (predecessor-free /
 * source) node and emit a list of "branches" — linear paths of nodes that
 * share one continuous centerline.
 *
 * A branch ends at a fork (current node has multiple successors), at a
 * merge (a successor has multiple predecessors), or at a leaf (no successors).
 * Each branch carries a Catmull-Rom centerline through its node anchors.
 *
 * Returns: { branches: [{ nodeIds, anchors, centerline }, ...] }
 */
export function buildBranches(flow) {
  const nodeById = new Map(flow.nodes.map(n => [n.id, n]))
  const predecessors = new Map()
  for (const n of flow.nodes) {
    for (const s of n.successors || []) {
      if (!predecessors.has(s)) predecessors.set(s, [])
      predecessors.get(s).push(n.id)
    }
  }
  const isFork = (id) => (nodeById.get(id).successors || []).length > 1
  const isMerge = (id) => (predecessors.get(id) || []).length > 1
  const isLeaf = (id) => (nodeById.get(id).successors || []).length === 0

  // Collect branch seeds: { prefix: [nodeId, ...], startId }
  // Each branch begins from an optional prefix (e.g. the fork parent) then
  // walks forward from startId until it hits a fork, a merge successor, or a leaf.
  const seeds = []

  // Helper: walk forward from startId, optionally prepending prefix nodes.
  const addSeed = (prefix, startId) => seeds.push({ prefix, startId })

  // Roots: every predecessor-free node seeds a branch tree. M2 (spec §5.1):
  // a v2 flow may have MULTIPLE real source nodes, so buildBranches no longer
  // keys off flow.entryId — it seeds from each root. For a v1 single-entry
  // flow the entry node is the sole root, so behaviour is unchanged.
  const isRoot = (id) => (predecessors.get(id) || []).length === 0
  const rootIds = flow.nodes.map(n => n.id).filter(isRoot)

  // Seed each root. If a root is a fork, each child branch gets the root
  // prepended; otherwise the root itself begins a branch.
  for (const rootId of rootIds) {
    if (isFork(rootId)) {
      for (const s of nodeById.get(rootId).successors) addSeed([rootId], s)
    } else {
      addSeed([], rootId)
    }
  }

  // For all non-root fork nodes, each fork child gets the fork parent prepended.
  for (const n of flow.nodes) {
    if (!isRoot(n.id) && isFork(n.id)) {
      for (const s of n.successors) {
        addSeed([n.id], s)
      }
    }
  }

  // Every merge node that has a successor also starts a new branch (the post-merge
  // linear continuation). Without this, flows like `a→{b,c}→d→e` lose the d→e tail
  // because the b- and c-rooted branches both terminate at d (the merge) and
  // nothing seeds the d→e walk. Merges that are also leaves (no successor) are
  // excluded — there's nothing to walk into, and a single-node branch would crash
  // buildCenterline.
  for (const n of flow.nodes) {
    if (isMerge(n.id) && !isLeaf(n.id)) addSeed([], n.id)
  }

  const branches = []
  for (const { prefix, startId } of seeds) {
    const nodeIds = [...prefix, startId]
    let cur = startId
    while (true) {
      const node = nodeById.get(cur)
      if (isLeaf(node.id)) break
      if (isFork(node.id)) break
      const nextId = node.successors[0]
      if (isMerge(nextId)) {
        nodeIds.push(nextId)
        break
      }
      nodeIds.push(nextId)
      cur = nextId
    }
    // A lone node has no centerline (buildCenterline needs ≥2 anchors). This
    // skips an isolated node — e.g. a stray predecessor-free leaf — that the
    // multi-root seeding above could otherwise turn into a single-node seed.
    if (nodeIds.length < 2) continue
    const anchors = nodeIds.map(id => ({ x: nodeById.get(id).x, y: nodeById.get(id).y }))
    branches.push({
      nodeIds,
      anchors,
      centerline: buildCenterline(anchors),
    })
  }

  // ── Rejection branches (v1.2 R2 — spec §3.1) ──────────────────────────────
  // Each rejection edge becomes a THIN branch: a quadratic-Bézier bow
  // centerline from `from`'s anchor to `to`'s anchor. Tagged kind:'rejection'
  // so selectBranch + the renderer treat them distinctly from forward
  // ribbons. Fixed-width (REJECTION_BAND_WIDTH) — NOT width/rate coupled.
  // A dangling `from`/`to` reference is skipped here (validateFlow flags it).
  for (const rej of flow.rejections || []) {
    if (rej == null) continue
    const fromNode = nodeById.get(rej.from)
    const toNode = nodeById.get(rej.to)
    if (!fromNode || !toNode) continue
    const fromPt = { x: fromNode.x, y: fromNode.y }
    const toPt = { x: toNode.x, y: toNode.y }
    branches.push({
      kind: 'rejection',
      rejection: rej,
      nodeIds: [rej.from, rej.to],
      anchors: [fromPt, toPt],
      centerline: buildRejectionCenterline(fromPt, toPt, rej.bow),
    })
  }

  return { branches }
}

// ---- Junction nodes (fork / merge) ----------------------------------------

/**
 * Identify "junction" nodes — fork nodes (≥2 successors) and merge nodes
 * (≥2 predecessors).
 *
 * Why this matters (bd ai-engineer-05yy — the star-burst artifact):
 * each branch ribbon is an independent variable-width band drawn by
 * ribbonOutlinePath(), and it terminates with a FLAT end-cap perpendicular
 * to that branch's local tangent. At a fork or merge, several branch ribbons
 * share one node as an endpoint but approach/leave it at DIFFERENT tangent
 * angles. Their flat end-caps are rotated relative to one another, so each
 * cap's corners protrude past the neighbouring ribbons — the union renders as
 * a radiating "star-burst" spike pattern. There is no geometry tying the
 * branches together at the shared node.
 *
 * The renderer's fix is a "junction cap": a filled disc centred on the node.
 * Every incident branch's end-cap corner sits at exactly halfWidth from the
 * node centre, so a disc whose radius is the local ribbon half-width is a
 * corner-free convex cover that absorbs every protruding cap. See FlowGraph's
 * `junctionDiscs` computed.
 *
 * @param {object} flow — a flow config with `nodes` (each `{ id, successors }`)
 * @returns {Set<string>} the ids of every fork-or-merge node
 */
export function junctionNodeIds(flow) {
  const predCount = new Map()
  for (const n of flow.nodes || []) {
    for (const s of n.successors || []) {
      predCount.set(s, (predCount.get(s) || 0) + 1)
    }
  }
  const ids = new Set()
  for (const n of flow.nodes || []) {
    if ((n.successors || []).length > 1) ids.add(n.id)   // fork
    if ((predCount.get(n.id) || 0) > 1)  ids.add(n.id)    // merge
  }
  return ids
}

// ---- Per-node ribbon widths -----------------------------------------------

/**
 * Power-curve exponent for ribbon-width scaling (Jason 2026-05-16 feedback:
 * "much more variance in thickness, Minard-style"). Linear scaling (exponent
 * 1.0) produced widths that read too similar across segments; exponent 1.7
 * amplifies the contrast while preserving the throughput ordering — the
 * constraint stays narrowest, the fastest stage gets dramatically wider.
 *
 * Per visuals.md §10.2 the visual designer specified P=1.7 with a hard cap
 * at MAX_RIBBON_WIDTH so the highest-throughput segments don't blow out and
 * the constraint:widest ratio lands at the target 1:7.
 *
 * Reference: assets/style-references/run5-iter2-jason/02-minard-napoleon-russia.png
 * (Minard's army-strength river narrowing 100×+ at the bottleneck).
 */
export const WIDTH_POWER = 1.7

/**
 * Hard upper bound on ribbon width, in viewBox units. Per visuals.md §10.2:
 * power-curve exponent P=1.7 with raw-width cap so the constraint:widest
 * ratio lands at 1:7 (10:70). Without this, test-prep (raw ~187) and ship
 * (raw ~84) would blow out the ribbon.
 */
export const MAX_RIBBON_WIDTH = 70

/**
 * Default source emit rate (particles/sec). Mirrors format/model.js's
 * DEFAULT_SOURCE_RATE — inlined (module-private) so the curve/engine layer
 * carries no dependency on the format layer (M2 spec §5.2).
 */
const DEFAULT_SOURCE_RATE = 1.0

/**
 * Propagate per-node *effective flow rate* through the flow's DAG (M2 §5.2).
 *
 * Rate originates at `kind:'source'` nodes — each contributes its own `rate`
 * (default DEFAULT_SOURCE_RATE) — then flows along `successors`: it splits at
 * a declared fork by per-branch `rateShare` (even split when a branch omits
 * `rateShare`, or when the node has no `forks[]` entry) and sums at a merge.
 * Nodes are processed in topological order (Kahn). Cyclic nodes — which
 * validateFlow() flags as an error — keep whatever rate reached them before
 * the cycle rather than throwing here.
 *
 * @param {object} flow — a flow config (v2 shape: source nodes + optional forks)
 * @returns {{ [id: string]: number }} effective rate per node id
 */
export function effectiveNodeRates(flow) {
  const nodes = flow.nodes || []
  const byId = new Map(nodes.map(n => [n.id, n]))
  const forkByFrom = new Map((flow.forks || []).map(f => [f.from, f]))

  const rate = {}
  const indeg = {}
  for (const n of nodes) {
    rate[n.id] = n.kind === 'source'
      ? (typeof n.rate === 'number' ? n.rate : DEFAULT_SOURCE_RATE)
      : 0
    indeg[n.id] = 0
  }
  for (const n of nodes) {
    for (const s of n.successors || []) {
      if (indeg[s] !== undefined) indeg[s] += 1
    }
  }

  // Kahn topological order.
  const queue = nodes.filter(n => indeg[n.id] === 0).map(n => n.id)
  const order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    for (const s of byId.get(id).successors || []) {
      if (indeg[s] === undefined) continue
      indeg[s] -= 1
      if (indeg[s] === 0) queue.push(s)
    }
  }

  for (const id of order) {
    const node = byId.get(id)
    const succ = node.successors || []
    if (succ.length === 0) continue
    const fork = forkByFrom.get(id)
    for (const s of succ) {
      let share = 1 / succ.length
      if (fork) {
        const br = (fork.branches || []).find(
          b => (typeof b === 'string' ? b : b.to) === s,
        )
        if (br && typeof br.rateShare === 'number') share = br.rateShare
      }
      if (rate[s] !== undefined) rate[s] += rate[id] * share
    }
  }
  return rate
}

/**
 * Compute per-node ribbon width from a flow config.
 *
 * Two modes, keyed on `flow.widthMode` (M2 spec §2.3 / §5.2):
 *
 *  - `'coupled'` — width is the visual encoding of *effective flow rate*:
 *      width_i = MIN_RIBBON_WIDTH × (rate_i / min_rate)^WIDTH_POWER,
 *    capped at MAX_RIBBON_WIDTH. Rate is propagated by effectiveNodeRates().
 *  - `'manual'` or unset (legacy v1) — width is throughput-encoded:
 *      throughput_i = capacity_i / latency_i,
 *      width_i = MIN_RIBBON_WIDTH × (throughput_i / min_throughput)^WIDTH_POWER.
 *
 * In BOTH modes an explicit `node.width` is authoritative and overrides the
 * derived value — that is the charter's "independent tweaking / artistic
 * licence" knob.
 *
 * `opts.collectWarnings` (throughput mode only) flags a `kind:'constraint'`
 * node that is not actually the narrowest.
 *
 * Returns { [id]: width, warnings? }.
 */
export function computeNodeWidths(flow, opts = {}) {
  const widths = {}

  // ── Coupled mode: width derives from propagated flow rate (M2 §5.2) ────────
  if (flow.widthMode === 'coupled') {
    const rates = effectiveNodeRates(flow)
    const positive = Object.values(rates).filter(r => r > 0)
    const minRate = positive.length ? Math.min(...positive) : 1
    for (const n of flow.nodes) {
      if (typeof n.width === 'number') { widths[n.id] = n.width; continue }
      const r = rates[n.id]
      if (!(r > 0)) { widths[n.id] = MIN_RIBBON_WIDTH; continue }
      widths[n.id] = Math.min(
        MAX_RIBBON_WIDTH,
        MIN_RIBBON_WIDTH * Math.pow(r / minRate, WIDTH_POWER),
      )
    }
    if (opts.collectWarnings) widths.warnings = []
    return widths
  }

  // ── Manual / legacy mode: throughput-encoded ───────────────────────────────
  const throughputs = {}
  for (const n of flow.nodes) {
    throughputs[n.id] = n.capacity / n.latency
  }
  const minThroughput = Math.min(...Object.values(throughputs))
  const actualConstraintId = Object.keys(throughputs).find(
    id => Math.abs(throughputs[id] - minThroughput) < 1e-9,
  )

  for (const n of flow.nodes) {
    if (typeof n.width === 'number') { widths[n.id] = n.width; continue }
    const ratio = throughputs[n.id] / minThroughput
    widths[n.id] = Math.min(
      MAX_RIBBON_WIDTH,
      MIN_RIBBON_WIDTH * Math.pow(ratio, WIDTH_POWER),
    )
  }

  if (opts.collectWarnings) {
    const taggedConstraint = flow.nodes.find(n => n.kind === 'constraint')
    if (taggedConstraint && taggedConstraint.id !== actualConstraintId) {
      widths.warnings = [
        `Node "${taggedConstraint.id}" is tagged kind:constraint but `
        + `"${actualConstraintId}" has the lowest throughput. `
        + `Tag mismatch — check capacity/latency values.`,
      ]
    } else {
      widths.warnings = []
    }
  }

  return widths
}

/**
 * Build an SVG `d` string for a closed filled ribbon centered on the given
 * centerline, with width determined by widthFn(s) where s is arc length.
 *
 * Walks the centerline at sample resolution, computes the local normal,
 * and emits two polylines (top edge then bottom edge in reverse), closed.
 *
 * Resolution defaults to 1 sample per 4 arc units; tune via opts.step.
 */
export function ribbonOutlinePath(centerline, widthFn, opts = {}) {
  const step = opts.step || 4
  const samples = Math.max(8, Math.ceil(centerline.totalLength / step))

  const top = []     // {x, y} along top edge
  const bottom = []  // {x, y} along bottom edge

  for (let i = 0; i <= samples; i++) {
    const s = (i / samples) * centerline.totalLength
    const c = centerline.pointAtArcLength(s)
    const t = centerline.tangentAtArcLength(s)
    // Normal is tangent rotated 90° counter-clockwise: (-ty, tx)
    const nx = -t.y, ny = t.x
    const halfW = widthFn(s) / 2
    top.push({ x: c.x + nx * halfW, y: c.y + ny * halfW })
    bottom.push({ x: c.x - nx * halfW, y: c.y - ny * halfW })
  }

  const fmt = (n) => n.toFixed(2)
  let d = `M ${fmt(top[0].x)} ${fmt(top[0].y)}`
  for (let i = 1; i < top.length; i++) {
    d += ` L ${fmt(top[i].x)} ${fmt(top[i].y)}`
  }
  for (let i = bottom.length - 1; i >= 0; i--) {
    d += ` L ${fmt(bottom[i].x)} ${fmt(bottom[i].y)}`
  }
  d += ' Z'
  return d
}

// ---- Locked-v2 palette ----------------------------------------------------
//
// Per visuals.md §3.0.3.LOCKED-V2 palette additions. Tokens exported here as
// the canonical source; flow definitions may override per-instance via
// `ribbonColor` / `pinchFillColor` / `constraintFillColor` props.

export const FLOW_BAND       = '#e8d8b0'  // warm wheat — body of band at full width
export const PINCH_ROSE      = '#e6c8c8'  // dusty rose — fill of curved-taper pinch zones
export const CONSTRAINT_ROSE = '#d8a8a8'  // deeper rose — tonal background inside constraint
export const INK             = '#15171A'  // historical ribbon ink (legacy fallback)
export const CONSTRAINT_INK  = '#E2522B'  // firebrick — the one accent

// ---- Rejection-edge palette (v1.2 R3 — spec §4) ---------------------------
//
// A rejection edge (failed-review back-path) renders as a thin dotted arc in
// REJECTION_COLOR — a DESATURATED alert red, deliberately quieter than the
// firebrick CONSTRAINT_INK accent so a rejection branch reads as a secondary
// back-channel, not a second focal accent competing with the constraint.
export const REJECTION_COLOR = '#b5524b'
// Particles riding a rejection branch ('revising' agents) render as the normal
// cream particle dot mixed toward REJECTION_COLOR, so they read as the same
// dot, just travelling the back-path (spec §4, Jason decision B). mixHex is a
// hoisted function declaration, so this module-load-time call is well-defined.
export const REJECTION_PARTICLE_COLOR = mixHex('#F4F2ED', REJECTION_COLOR, 0.55)

// ---- Per-segment colour-scheme palette (v1.1 §3, bd ai-engineer-3ihf) -----
//
// The v1.1 node model carries a per-node `colorScheme` ('red'|'neutral'|
// 'green'|'rose') in place of the removed `constraint` node type. These are
// the ribbon-segment fills the live preview (FlowGraph) paints:
//   - neutral → FLOW_BAND (#e8d8b0): the warm-wheat ribbon body — the
//     established locked-v2 ribbon colour every deck flow already sets via
//     `ribbonColor`. v1.1 flows drop `ribbonColor`, so neutral IS that wheat
//     (Jason 2026-05-20: "yellow / beige tone for neutral, not black"). The
//     cream agents read against wheat exactly as they do in the deck.
//   - red → CONSTRAINT_INK (#E2522B): exactly the designer's red.
//   - green → #3FAE6B: exactly the designer's green.
//   - rose → CONSTRAINT_ROSE (#d8a8a8): the v1 dusty-rose constraint register
//     (plateau fill); light tone (PINCH_ROSE-family) used for the wings.
//     Preserved at Jason's direction (2026-05-20, bd ai-engineer-0h05) "in case
//     I change my mind" — can be toggled per-node in the designer.
export const RIBBON_SCHEME_COLORS = {
  neutral: FLOW_BAND,
  red:     CONSTRAINT_INK,
  green:   '#3FAE6B',
  rose:    CONSTRAINT_ROSE,
}

/**
 * Mix a `#rrggbb` hex colour toward a target hex by fraction t ∈ [0,1].
 * t=0 returns `hex` unchanged; t=1 returns `target`. Per-channel linear blend.
 */
export function mixHex(hex, target, t) {
  const parse = (h) => {
    const s = h.replace('#', '')
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
    ]
  }
  const [r1, g1, b1] = parse(hex)
  const [r2, g2, b2] = parse(target)
  const tc = Math.max(0, Math.min(1, t))
  const mix = (a, b) => Math.round(a + (b - a) * tc)
  const hx = (n) => n.toString(16).padStart(2, '0')
  return `#${hx(mix(r1, r2))}${hx(mix(g1, g2))}${hx(mix(b1, b2))}`
}

/**
 * Lighter tone for each scheme colour — the transition-curve "wing" fill
 * (bd ai-engineer-0sdz, v1.1 spec §8.4). Each scheme colour mixed 45% toward
 * white, mirroring the locked-v2 PINCH_ROSE-vs-CONSTRAINT_ROSE two-tone
 * grammar: the curve reads lighter than the straight plateau.
 */
export const RIBBON_SCHEME_COLOR_MIX = 0.45
export const RIBBON_SCHEME_COLORS_LIGHT = {
  neutral: mixHex(RIBBON_SCHEME_COLORS.neutral, '#ffffff', RIBBON_SCHEME_COLOR_MIX),
  red:     mixHex(RIBBON_SCHEME_COLORS.red,     '#ffffff', RIBBON_SCHEME_COLOR_MIX),
  green:   mixHex(RIBBON_SCHEME_COLORS.green,   '#ffffff', RIBBON_SCHEME_COLOR_MIX),
  rose:    mixHex(RIBBON_SCHEME_COLORS.rose,    '#ffffff', RIBBON_SCHEME_COLOR_MIX),
}

// ---- Pinch-around-constraint width function (locked-v2) -------------------

export const DEFAULT_BAND_WIDTH       = 70  // full-width plateau (viewBox units)
export const DEFAULT_CONSTRAINT_WIDTH = 22  // constraint-segment plateau

/**
 * Cubic Hermite smoothstep: t² × (3 - 2t). Zero slope at t=0 and t=1; smooth
 * monotonic in between. The S-curve we need for the wineglass pinch.
 */
function smoothstep(t) {
  const tc = Math.max(0, Math.min(1, t))
  return tc * tc * (3 - 2 * tc)
}

/**
 * Project each anchor onto the centerline and return its arc-length position.
 * Geometric anchor positions (one value per anchor; N entries for N anchors).
 * Used by physics gates in useFlowSimulation.js (cap=1 walls, capacity
 * boundaries) where the agent must queue at the actual node geometric
 * position on the centerline.
 */
function anchorArcLengths(branch) {
  const cl = branch.centerline
  const anchors = branch.anchors
  const positions = []
  for (let i = 0; i < anchors.length; i++) {
    // 100-sample linear search — branch centerlines are short (<2000 units)
    // and this only runs once per branch at build time, not per frame.
    let bestS = 0, bestD2 = Infinity
    for (let j = 0; j <= 100; j++) {
      const s = (j / 100) * cl.totalLength
      const p = cl.pointAtArcLength(s)
      const d2 = (p.x - anchors[i].x) ** 2 + (p.y - anchors[i].y) ** 2
      if (d2 < bestD2) { bestD2 = d2; bestS = s }
    }
    positions.push(bestS)
  }
  return positions
}

/**
 * Latency-distributed per-node segment boundaries on the centerline.
 *
 * Returns an array of N+1 arc-length values for N nodes: entry[i] = start
 * of node i's segment, entry[N] = totalLength (= end of last node's segment).
 * Each segment is sized PROPORTIONAL TO LATENCY (slow stages own a longer
 * stretch of arc, fast stages a shorter stretch).
 *
 * This is the SAME segmentation FlowGraph.vue's `branchLatencyArc()` uses
 * to place per-node labels. The constraint plateau MUST use this scheme
 * (not the geometric anchor scheme) so the narrowest band falls under the
 * constraint label's marker — see bead ai-engineer-agc and the
 * §Geometric-correctness invariant in simulation-engineer.md.
 *
 * Why two schemes coexist:
 *   - Geometric anchorArcLengths(): used by physics gates (cap=1 walls,
 *     capacity boundaries) — agents must queue at the actual node anchor.
 *   - Latency-distributed segmentBoundsByLatency(): used by visual pinch
 *     + labels — slow stages SHOULD visually occupy more arc, the way
 *     Tufte's "the figure is the argument" requires.
 */
export function segmentBoundsByLatency(branch, flow) {
  const cl = branch.centerline
  const latencies = branch.nodeIds.map(id => {
    const n = flow.nodes.find(nn => nn.id === id)
    return n ? n.latency : 1
  })
  const sumL = latencies.reduce((a, b) => a + b, 0)
  const total = cl.totalLength
  const segLens = latencies.map(l => (l / sumL) * total)
  // bounds[i] = arc-length where node i's segment STARTS
  // bounds[N] = totalLength (end of last segment)
  const bounds = [0]
  for (let i = 0; i < segLens.length; i++) {
    bounds.push(bounds[i] + segLens[i])
  }
  return bounds
}

// ---- Smooth segmented width profile (non-pinch flows) ---------------------
//
// bd ai-engineer-0sdz. The locked-v2 pinch register (buildPinchWidthFn) gives
// a single kind:'constraint' a smooth wineglass taper; every OTHER flow used a
// hard STEP function — adjacent node-width segments jumped abruptly. v1.1
// removed node kinds, so no flow takes the pinch path any more. This
// generalises the smoothstep wineglass treatment to ANY interior boundary
// where the two adjacent node widths differ.

/**
 * Transition fraction for smooth segmented width curves. At an interior
 * boundary between two different-width segments, the smoothstep transition
 * zone spans this fraction of the SHORTER adjacent segment (centred on the
 * boundary). 0.45 mirrors buildPinchWidthFn's transitionFraction default and
 * guarantees the two zones inside any one segment never overlap — a
 * constant-width plateau always survives in the middle of every segment.
 */
export const TRANSITION_FRACTION = 0.45

/**
 * Build the smooth segmented ribbon profile for a non-pinch branch.
 *
 * Each node owns a constant-width PLATEAU; at every interior boundary where
 * the two adjacent node widths DIFFER, a cubic smoothstep transition zone
 * replaces the hard step. Boundaries between equal-width segments stay flat
 * (zero-length transition — "a curve only between *different* widths").
 *
 * This is the single source of truth for the non-pinch ribbon width: BOTH
 * FlowGraph.vue's visual `branchWidthFn` and useFlowSimulation.js's physics
 * `branch.widthFn` call it, so the renderer and the wall-clamp engine agree
 * by construction — the no-escape invariant cannot drift.
 *
 * @param {object} branch — a branch from buildBranches() ({ nodeIds, centerline })
 * @param {object} flow   — the flow config (for per-node latency)
 * @param {{[id:string]: number}} widths — per-node width map (computeNodeWidths)
 * @returns {{
 *   widthFn: (s:number)=>number,
 *   segments: Array<{ nodeId:string, plateau:{sStart,sEnd},
 *                     leftWing:{sStart,sEnd}|null, rightWing:{sStart,sEnd}|null }>
 * }}
 */
export function segmentedRibbonLayout(branch, flow, widths) {
  const bounds = segmentBoundsByLatency(branch, flow)   // length N+1
  const N = branch.nodeIds.length
  const total = branch.centerline.totalLength
  const segWidths = branch.nodeIds.map(
    id => (typeof widths[id] === 'number' ? widths[id] : MIN_RIBBON_WIDTH),
  )

  // Interior-boundary transition half-widths. transHalf has length N+1; index
  // k is the boundary at bounds[k]. The two open ends (k=0, k=N) and every
  // boundary between equal-width segments stay 0 (flat — no curve).
  const transHalf = new Array(N + 1).fill(0)
  for (let k = 1; k < N; k++) {
    if (segWidths[k - 1] === segWidths[k]) continue
    const leftLen  = bounds[k]     - bounds[k - 1]
    const rightLen = bounds[k + 1] - bounds[k]
    const shorter  = Math.min(leftLen, rightLen)
    transHalf[k] = (TRANSITION_FRACTION * shorter) / 2
  }

  // widthFn: constant plateau, smoothstep across each interior transition zone
  // [bounds[k] - transHalf[k], bounds[k] + transHalf[k]].
  const widthFn = (s) => {
    const sc = Math.max(0, Math.min(total, s))
    let i = 0
    while (i < N - 1 && sc > bounds[i + 1]) i++
    // Inside this segment's LEFT transition zone (boundary i)?
    if (transHalf[i] > 0 && sc < bounds[i] + transHalf[i]) {
      const zStart = bounds[i] - transHalf[i]
      const t = (sc - zStart) / (2 * transHalf[i])
      return segWidths[i - 1] + (segWidths[i] - segWidths[i - 1]) * smoothstep(t)
    }
    // Inside this segment's RIGHT transition zone (boundary i+1)?
    if (transHalf[i + 1] > 0 && sc > bounds[i + 1] - transHalf[i + 1]) {
      const zStart = bounds[i + 1] - transHalf[i + 1]
      const t = (sc - zStart) / (2 * transHalf[i + 1])
      return segWidths[i] + (segWidths[i + 1] - segWidths[i]) * smoothstep(t)
    }
    return segWidths[i]
  }

  // Per-node plateau + transition-wing arc-ranges, for the renderer's tonal
  // overlay. A wing is null when the adjacent boundary has no transition.
  const segments = []
  for (let i = 0; i < N; i++) {
    const segStart = bounds[i]
    const segEnd   = bounds[i + 1]
    const plateauStart = segStart + transHalf[i]
    const plateauEnd   = segEnd   - transHalf[i + 1]
    segments.push({
      nodeId: branch.nodeIds[i],
      plateau:   { sStart: plateauStart, sEnd: plateauEnd },
      leftWing:  transHalf[i]     > 0 ? { sStart: segStart, sEnd: plateauStart } : null,
      rightWing: transHalf[i + 1] > 0 ? { sStart: plateauEnd, sEnd: segEnd }     : null,
    })
  }
  return { widthFn, segments }
}

/**
 * Build the constraint-only pinch profile for a branch.
 *
 * The returned function maps arc-length s → width:
 *   - Far from the constraint: width = bandWidth (full plateau)
 *   - Inside the constraint segment: width = constraintWidth (narrow plateau)
 *   - In the upstream/downstream transition zone: smoothstep S-curve easing
 *
 * If the branch contains no constraint node, returns a constant bandWidth
 * function (i.e. the branch renders as a flat ribbon).
 *
 * Flow-level overrides:
 *   flow.bandWidth          — default DEFAULT_BAND_WIDTH (70)
 *   flow.constraintWidth    — default DEFAULT_CONSTRAINT_WIDTH (22)
 *   flow.transitionFraction — default 0.45 of the adjacent segment length;
 *                              the upstream/downstream S-curve occupies this
 *                              fraction of the *adjacent* segment.
 *
 * Per visuals.md §3.0.3.LOCKED-V2: "Implement with cubic Béziers, not
 * straight diagonals — every transition is organic."
 */
export function buildPinchWidthFn(branch, flow) {
  const bandWidth       = flow.bandWidth        ?? DEFAULT_BAND_WIDTH
  const constraintWidth = flow.constraintWidth  ?? DEFAULT_CONSTRAINT_WIDTH
  const transFrac       = flow.transitionFraction ?? 0.45

  // Find which node-index in this branch carries kind:'constraint'.
  const constraintIdx = branch.nodeIds.findIndex(id => {
    const n = flow.nodes.find(nn => nn.id === id)
    return n && n.kind === 'constraint'
  })

  if (constraintIdx < 0) {
    return () => bandWidth
  }

  // ── Centered-plateau mode (flow.constraintPlateauWidth set) ──────────────
  //
  // Bead ai-engineer-dbg: "The implementation bottleneck is taking up a huge
  // part of the horizontal space. Let's try to have each of the 5 stages take
  // up equal width." With latency-distributed segmentation (the default),
  // implementation (latency=1.6 out of total 4.2) occupies 38% of arc —
  // nearly double the 20% equal share. The user-visible effect: one stage
  // dominates horizontal space.
  //
  // Fix (approach b from the bead): when constraintPlateauWidth is set, center
  // a fixed-width (W) plateau on the constraint anchor's GEOMETRIC arc-length
  // rather than spanning its entire latency-distributed segment. The plateau
  // and its transition wings stay compact (~W + 2×transFrac×W ≈ 1.9W arc-
  // units), so every stage reads as roughly equal horizontal width.
  //
  // The geometric-correctness invariant is preserved: for N4 the constraint
  // anchor sits at x≈830, which is at ~52.5% of arc — well inside the
  // latency-distributed label segment [33.3%, 71.4%]. The narrowest band
  // still coincides with the Implementation label as the invariant requires.
  //
  // Latency-distributed segmentation (the pre-dbg default) is left as the
  // fallback so flows without constraintPlateauWidth remain unaffected.
  const plateauW = flow.constraintPlateauWidth ?? null
  const cl = branch.centerline

  if (plateauW !== null) {
    // Locate the constraint anchor on the centerline geometrically.
    const anchorS = anchorArcLengths(branch)
    const cAnchorS = anchorS[constraintIdx]

    // bd ai-engineer-v8ra: when the constraint is a MERGE TARGET (declared as
    // the `to` of a flow.merges entry), the centerline geometry produces an
    // asymmetric visual: the FORWARD half of the plateau (cAnchorS → cAnchorS
    // + halfW) extends along the post-merge straight segment (all branches
    // overlap on the same horizontal track), while the BACKWARD half
    // (cAnchorS - halfW → cAnchorS) extends along each branch's DIVERGING
    // merge wedge (top branch curves up to y=180, bottom curves down to y=720).
    //
    // Forward extension renders as a single dense block of dark rose (3×
    // overlap), backward extension renders as three diverging diagonals of
    // dark rose. The rendered visual centroid in xy-space shifts RIGHTWARD of
    // the merge anchor — audience reads "things explode AFTER the bottleneck"
    // rather than the intended "the merge IS the bottleneck."
    //
    // Fix: when the constraint is a merge target, shift the plateau range
    // BACKWARD by halfW so the merge node xy sits at the DOWNSTREAM EDGE of
    // the plateau, not the centre. Plateau extension is now ENTIRELY into the
    // convergence wedge where the three lanes physically meet — the merge
    // node sits at the dense convergence tip of the dark rose, not past it.
    const mergeTargetIds = new Set((flow.merges || []).map(m => m.to))
    const constraintNodeId = branch.nodeIds[constraintIdx]
    const isMergeTarget = mergeTargetIds.has(constraintNodeId)
    const plateauShift = isMergeTarget ? (plateauW / 2) : 0

    const halfW = plateauW / 2
    const sCstart = Math.max(0, cAnchorS - halfW - plateauShift)
    const sCend   = Math.min(cl.totalLength, cAnchorS + halfW - plateauShift)
    // Transition zones: proportional to the plateau width (not to adjacent
    // segment lengths). Bead dbg spec: total narrow region ≈ W + 2×transFrac×W.
    const transLen = transFrac * plateauW
    const sUpStart = Math.max(0, sCstart - transLen)
    const sDownEnd = Math.min(cl.totalLength, sCend + transLen)

    return (s) => {
      if (s <= sUpStart)              return bandWidth
      if (s >= sDownEnd)              return bandWidth
      if (s >= sCstart && s <= sCend) return constraintWidth

      if (s < sCstart) {
        const t = transLen > 0 ? (s - sUpStart) / transLen : 1
        return bandWidth + (constraintWidth - bandWidth) * smoothstep(t)
      }
      const t = transLen > 0 ? (s - sCend) / transLen : 1
      return constraintWidth + (bandWidth - constraintWidth) * smoothstep(t)
    }
  }

  // ── Default mode: latency-distributed segmentation ───────────────────────
  //
  // GEOMETRIC-CORRECTNESS FIX (bd ai-engineer-agc): use latency-distributed
  // segmentation, NOT geometric anchor positions. This matches FlowGraph's
  // branchLatencyArc which positions the per-node labels — the constraint
  // plateau now coincides with the implementation LABEL's arc-range, not
  // the implementation-to-test geometric anchor span. The pre-fix scheme
  // placed the plateau centre at x≈980 while the implementation label sat
  // at x≈828, a 152-unit offset that Jason flagged as "the bottleneck is
  // not aligning to the Implementation stage segment" (run-2026-05-17b).
  const bounds = segmentBoundsByLatency(branch, flow)
  const N = branch.nodeIds.length

  // Constraint segment: bounds[constraintIdx] → bounds[constraintIdx + 1].
  // Each node OWNS its own segment under the latency-distributed scheme,
  // so there is no terminal-node special case (unlike the geometric scheme).
  const sCstart = bounds[constraintIdx]
  const sCend   = bounds[constraintIdx + 1]

  // Transition-zone half-widths: a fraction of the adjacent segment's length,
  // capped at the segment length itself (can't borrow more arc than exists).
  const upstreamSegLen = constraintIdx > 0
    ? bounds[constraintIdx] - bounds[constraintIdx - 1]
    : 0
  const downstreamSegLen = constraintIdx + 1 < N
    ? bounds[constraintIdx + 2] - bounds[constraintIdx + 1]
    : 0
  const upstreamTrans   = Math.min(transFrac * upstreamSegLen,   upstreamSegLen)
  const downstreamTrans = Math.min(transFrac * downstreamSegLen, downstreamSegLen)

  // Anchor points for the S-curve boundaries.
  const sUpStart = sCstart - upstreamTrans      // band starts narrowing
  // sCstart                                       constraint plateau begins
  // sCend                                         constraint plateau ends
  const sDownEnd = sCend + downstreamTrans       // band fully re-expanded

  return (s) => {
    if (s <= sUpStart)                    return bandWidth
    if (s >= sDownEnd)                    return bandWidth
    if (s >= sCstart && s <= sCend)       return constraintWidth

    if (s < sCstart) {
      // Upstream S-curve: bandWidth → constraintWidth
      const t = upstreamTrans > 0 ? (s - sUpStart) / upstreamTrans : 1
      return bandWidth + (constraintWidth - bandWidth) * smoothstep(t)
    }
    // Downstream S-curve: constraintWidth → bandWidth
    const t = downstreamTrans > 0 ? (s - sCend) / downstreamTrans : 1
    return constraintWidth + (bandWidth - constraintWidth) * smoothstep(t)
  }
}

/**
 * Return the arc-length boundaries of the upstream and downstream pinch
 * transition zones for a branch — the regions where the band tapers from
 * full-width to constraint-width and back. The two regions are the rose-fill
 * triangles in visuals.md §3.0.3.LOCKED-V2.
 *
 * Returns { upstream: { sStart, sEnd } | null, downstream: { sStart, sEnd } | null,
 *           constraintPlateau: { sStart, sEnd } | null }
 * Each is null if the branch has no constraint OR the relevant transition
 * has zero length (e.g. constraint is the first or last node).
 */
export function pinchZoneArcRanges(branch, flow) {
  const transFrac = flow.transitionFraction ?? 0.45
  const constraintIdx = branch.nodeIds.findIndex(id => {
    const n = flow.nodes.find(nn => nn.id === id)
    return n && n.kind === 'constraint'
  })
  if (constraintIdx < 0) return { upstream: null, downstream: null, constraintPlateau: null }

  // ── Centered-plateau mode (mirrors buildPinchWidthFn) ────────────────────
  const plateauW = flow.constraintPlateauWidth ?? null
  if (plateauW !== null) {
    const cl = branch.centerline
    const anchorS = anchorArcLengths(branch)
    const cAnchorS = anchorS[constraintIdx]

    // bd ai-engineer-v8ra: mirror the merge-target shift used by
    // buildPinchWidthFn — see that function for the geometric rationale.
    // The pinch-zone outline paths MUST trace the same width profile the
    // ribbon body uses, so the rose overlays follow the same shifted
    // range. Without this mirror, rose overlays would render in the
    // pre-shift arc range while the ribbon body would render in the
    // shifted range — visible inconsistency.
    const mergeTargetIds = new Set((flow.merges || []).map(m => m.to))
    const constraintNodeId = branch.nodeIds[constraintIdx]
    const isMergeTarget = mergeTargetIds.has(constraintNodeId)
    const plateauShift = isMergeTarget ? (plateauW / 2) : 0

    const halfW = plateauW / 2
    const sCstart = Math.max(0, cAnchorS - halfW - plateauShift)
    const sCend   = Math.min(cl.totalLength, cAnchorS + halfW - plateauShift)
    const transLen = transFrac * plateauW
    const upstreamStart = Math.max(0, sCstart - transLen)
    const downstreamEnd = Math.min(cl.totalLength, sCend + transLen)
    return {
      upstream:          transLen > 0 ? { sStart: upstreamStart, sEnd: sCstart } : null,
      downstream:        transLen > 0 ? { sStart: sCend, sEnd: downstreamEnd }   : null,
      constraintPlateau: { sStart: sCstart, sEnd: sCend },
    }
  }

  // ── Default mode: latency-distributed segmentation ───────────────────────
  //
  // Latency-distributed segmentation (bd ai-engineer-agc) — see notes in
  // buildPinchWidthFn. The rose-fill triangles MUST trace the same width
  // profile the ribbon body uses; both rely on this segmentation.
  const bounds = segmentBoundsByLatency(branch, flow)
  const N = branch.nodeIds.length

  const sCstart = bounds[constraintIdx]
  const sCend   = bounds[constraintIdx + 1]

  const upstreamSegLen = constraintIdx > 0
    ? bounds[constraintIdx] - bounds[constraintIdx - 1]
    : 0
  const downstreamSegLen = constraintIdx + 1 < N
    ? bounds[constraintIdx + 2] - bounds[constraintIdx + 1]
    : 0
  const upstreamTrans   = Math.min(transFrac * upstreamSegLen,   upstreamSegLen)
  const downstreamTrans = Math.min(transFrac * downstreamSegLen, downstreamSegLen)

  return {
    upstream:          upstreamTrans   > 0 ? { sStart: sCstart - upstreamTrans, sEnd: sCstart } : null,
    downstream:        downstreamTrans > 0 ? { sStart: sCend, sEnd: sCend + downstreamTrans }    : null,
    constraintPlateau: { sStart: sCstart, sEnd: sCend },
  }
}

/**
 * Build a closed SVG path for ONE pinch zone — either the upstream or
 * downstream taper triangle. The path follows the band's outer wall from
 * sStart→sEnd on the top, then back from sEnd→sStart on the bottom.
 *
 * This is the same shape the ribbon itself produces over the arc range,
 * but rendered separately so we can fill it with a different colour (rose)
 * while the main ribbon stays wheat.
 *
 * Returns '' if the range is null or empty.
 */
export function pinchZoneOutlinePath(centerline, widthFn, range, opts = {}) {
  if (!range || range.sStart >= range.sEnd) return ''
  const step = opts.step || 3
  const arcLen = range.sEnd - range.sStart
  const samples = Math.max(6, Math.ceil(arcLen / step))

  const top = []
  const bottom = []
  for (let i = 0; i <= samples; i++) {
    const s = range.sStart + (i / samples) * arcLen
    const c = centerline.pointAtArcLength(s)
    const t = centerline.tangentAtArcLength(s)
    const nx = -t.y, ny = t.x
    const halfW = widthFn(s) / 2
    top.push({ x: c.x + nx * halfW, y: c.y + ny * halfW })
    bottom.push({ x: c.x - nx * halfW, y: c.y - ny * halfW })
  }

  const fmt = (n) => n.toFixed(2)
  let d = `M ${fmt(top[0].x)} ${fmt(top[0].y)}`
  for (let i = 1; i < top.length; i++) d += ` L ${fmt(top[i].x)} ${fmt(top[i].y)}`
  for (let i = bottom.length - 1; i >= 0; i--) d += ` L ${fmt(bottom[i].x)} ${fmt(bottom[i].y)}`
  d += ' Z'
  return d
}

/**
 * Return the local band geometry at a given arc length: the band's top-edge
 * and bottom-edge points, and the local outward normal. Used by
 * FlowSegmentMarker fence-post style to anchor vertical tick-marks above
 * and below the band edge.
 */
export function bandEdgesAt(centerline, widthFn, s) {
  const c = centerline.pointAtArcLength(s)
  const t = centerline.tangentAtArcLength(s)
  const nx = -t.y, ny = t.x
  const halfW = widthFn(s) / 2
  return {
    centre: c,
    top:    { x: c.x + nx * halfW, y: c.y + ny * halfW },
    bottom: { x: c.x - nx * halfW, y: c.y - ny * halfW },
    normal: { x: nx, y: ny },
  }
}
