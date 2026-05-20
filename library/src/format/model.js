/**
 * format/model.js — the v3 flow model: defaults, the Speed⇄Width coupling,
 * normalization (with engine-field derivation), and validation.
 *
 * This module defines what a *complete* v3 flow looks like and how a partial
 * one is filled in. It is deliberately SEPARATE from the serializer
 * (format/index.js): serialize/deserialize stay byte-faithful so the round-trip
 * invariant holds, while normalizeFlow() fills documented defaults at
 * consumption time. See docs/superpowers/specs/2026-05-20-flow-M2-design.md §2.5.
 *
 * Provenance: M2 (bd ai-engineer-8aee) introduced this layer with the v2 data
 * model. v1.1 (beads ai-engineer-t0c8 / wec5 / zesj — see
 * docs/superpowers/specs/2026-05-20-flow-v1.1-node-controls-design.md) reworks
 * the node model to three authored knobs — LENGTH / SPEED / WIDTH — drops the
 * `constraint` node type for a per-node colour scheme, and bumps the format to
 * version 3. `latency` is no longer authored: normalizeFlow() derives it from
 * `length`. `capacity` is an OPTIONAL authored override (bd ai-engineer-v9mj):
 * when a node sets it that integer is used directly; when omitted it is derived
 * from `width`. Authored capacity is the v3 model's hook for the capacity-
 * limited crisp queue — a `capacity: 1` constraint forms a tight one-at-a-time
 * pile at its entrance, and a high-capacity immediate-upstream node acts as the
 * reservoir that pile sits in. See M2 spec §4.2.
 *
 * v1.3 L2 (bd ai-engineer-otci — see flow-v1.3-large-particles-design.md §2)
 * adds the large-particle model: `source.particleSize` ('small'|'large'),
 * `node.transform` ('none'|'split'|'combine'), and the `splitCount` /
 * `combineCount` transform counts. normalizeFlow() fills their defaults;
 * validateFlow() lints the §2.4 rules (split/combine counts, large-particle
 * band-width admission). The format bumps to version 5.
 */

/** Default emit rate (particles/sec) for a source node that sets none. */
export const DEFAULT_SOURCE_RATE = 1.0

// ── The three v1.1 node controls (spec §2) ───────────────────────────────────

/** LENGTH — purely visual segment arc-share. */
export const LENGTH_RANGE = { min: 0.3, max: 2.0 }
export const DEFAULT_NODE_LENGTH = 0.8

/** SPEED — particle speed through the node. Coupled to WIDTH by default. */
export const SPEED_RANGE = { min: 0.25, max: 1.75 }
export const DEFAULT_NODE_SPEED = 1.0

/** WIDTH — visual pipe width (viewBox units). Coupled to SPEED by default. */
export const WIDTH_RANGE = { min: 20, max: 120 }
export const DEFAULT_NODE_WIDTH = 70

// ── v1.2 rejection-edge defaults (spec §2.3) ─────────────────────────────────

/** Default fraction of a node's outflow taken by a rejection edge. */
export const DEFAULT_REJECTION_RATE = 0.15

/** Default rejection-arc bow depth, in viewBox units. */
export const DEFAULT_REJECTION_BOW_DEPTH = 80

/** The per-node colour-scheme control (replaces the v2 `constraint` type). */
// 'rose' is the v1 dusty-rose constraint register (PINCH_ROSE / CONSTRAINT_ROSE),
// preserved as a selectable option per Jason's direction (2026-05-20, bd ai-engineer-0h05).
export const COLOR_SCHEMES = ['red', 'neutral', 'green', 'rose']
export const DEFAULT_COLOR_SCHEME = 'neutral'

// ── v1.3 L2 large-particle defaults (spec §2) ────────────────────────────────

/** Particle sizes a source may emit (spec §2.1). */
export const PARTICLE_SIZES = ['small', 'large']

/** Default particle size for a source that authors none. */
export const DEFAULT_PARTICLE_SIZE = 'small'

/** Node transform behaviours (spec §2.2). */
export const NODE_TRANSFORMS = ['none', 'split', 'combine']

/** Default transform for a node that authors none. */
export const DEFAULT_NODE_TRANSFORM = 'none'

/** Default split count for a `transform:'split'` node that authors none. */
export const DEFAULT_SPLIT_COUNT = 4

/** Default combine count for a `transform:'combine'` node that authors none. */
export const DEFAULT_COMBINE_COUNT = 4

/**
 * Minimum node width (viewBox units) that comfortably admits a large particle.
 *
 * A large particle has radius 9 (PARTICLE_RADIUS 3 × LARGE_PARTICLE_SCALE 3);
 * with WALL_MARGIN it needs a band half-width ≥ ~11 (width ≥ ~22), and ~28 for
 * comfortable travel. validateFlow() lints any large-particle-carrying node
 * narrower than this — the "split before the constraint" guidance (spec §2.4 /
 * §3.1).
 */
export const MIN_LARGE_ADMITTING_WIDTH = 28

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Speed⇄Width coupling — a linear map between the two ranges (spec §2.1).
 * The ranges are sized so the defaults align: width 70 ⇄ speed 1.0, each the
 * midpoint of its own range. The designer's coupled mutation actions and the
 * v2→v3 migration both use these.
 */
export function speedFromWidth(width) {
  const t = clamp01((width - WIDTH_RANGE.min) / (WIDTH_RANGE.max - WIDTH_RANGE.min))
  const s = SPEED_RANGE.min + t * (SPEED_RANGE.max - SPEED_RANGE.min)
  return Math.round(s * 100) / 100
}
export function widthFromSpeed(speed) {
  const t = clamp01((speed - SPEED_RANGE.min) / (SPEED_RANGE.max - SPEED_RANGE.min))
  return Math.round(WIDTH_RANGE.min + t * (WIDTH_RANGE.max - WIDTH_RANGE.min))
}

/**
 * Engine capacity derived from a node's visual width (spec §4.2). A narrow
 * node holds fewer agents, so it visibly queues — the constraint reads in the
 * simulation with no engine edit.
 *
 * This is the DEFAULT only — a node may author an explicit `capacity` to
 * override it (bd ai-engineer-v9mj). The width-derived value couples capacity
 * to width too tightly to express the deck's crisp queue optic: that needs a
 * `capacity: 1` constraint (a hard one-at-a-time gate) sitting downstream of a
 * deliberately high-capacity reservoir node. Width alone cannot say both.
 */
export function capacityFromWidth(width) {
  return Math.max(1, Math.round(width / 16))
}

/** Flow-level defaults applied by normalizeFlow(). */
export const FLOW_DEFAULTS = {
  baseSpeed: 200,
  initialAgents: 0,
}

/** Per-node defaults applied by normalizeFlow() to every node. */
export const NODE_DEFAULTS = {
  kind: 'normal', // 'normal' | 'source'
  label: '',
  labelDx: 0,
  labelDy: 0,
  length: DEFAULT_NODE_LENGTH,
  speed: DEFAULT_NODE_SPEED,
  width: DEFAULT_NODE_WIDTH,
  coupleSpeedWidth: true,
  colorScheme: DEFAULT_COLOR_SCHEME,
  transform: DEFAULT_NODE_TRANSFORM, // v1.3 L2 — none | split | combine
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Auto-pick a rejection edge's bow side (spec §2.3): a rejection arc bows to
 * the side OPPOSITE the `from` node's label, so the arc and the label do not
 * collide. When the `from` node carries no `labelSide`, the arc bows `below`.
 *
 * @param {object|undefined} fromNode — the rejection edge's `from` node
 * @returns {'above'|'below'}
 */
function autoRejectionBowSide(fromNode) {
  if (fromNode && fromNode.labelSide === 'above') return 'below'
  if (fromNode && fromNode.labelSide === 'below') return 'above'
  return 'below'
}

/**
 * Return a normalized deep copy of a v3 flow with documented defaults applied
 * AND the engine-facing fields derived (spec §4.2).
 *
 * Does NOT mutate the input. Not part of the round-trip invariant — this fills
 * defaults and derives engine inputs, so normalizeFlow(x) is intentionally not
 * equal to x. The engine and <FlowEmbed> call this at consumption time; the
 * designer renders its live preview through it. Export NEVER serializes this —
 * the authored flow is what is written to disk.
 *
 * Engine derivation: the simulation engine + renderer still consume
 * `latency` / `capacity` / `widthMode`. `latency` is derived from `length` and
 * `widthMode: 'manual'` so `computeNodeWidths` honours the explicit per-node
 * `width`. `capacity` is honoured if the node authored one (the v9mj crisp-
 * queue override); otherwise it is derived from `width` via capacityFromWidth.
 *
 * @param {object} flow — a v3 flow object (possibly partial)
 * @returns {object} a normalized, engine-ready deep copy
 */
export function normalizeFlow(flow) {
  if (flow == null || typeof flow !== 'object') {
    throw new TypeError('normalizeFlow: expected a flow object')
  }
  const out = deepClone(flow)

  // ── flow-level defaults ───────────────────────────────────────────────────
  for (const [key, value] of Object.entries(FLOW_DEFAULTS)) {
    if (out[key] === undefined) out[key] = value
  }
  if (!Array.isArray(out.forks)) out.forks = []
  if (!Array.isArray(out.merges)) out.merges = []
  if (!Array.isArray(out.rejections)) out.rejections = []
  if (!Array.isArray(out.nodes)) out.nodes = []
  // Engine-facing: width is authored per node, so widths are 'manual'.
  out.widthMode = 'manual'

  // ── per-node defaults + engine-field derivation ───────────────────────────
  out.nodes = out.nodes.map((node) => {
    const n = { ...node }
    for (const [key, value] of Object.entries(NODE_DEFAULTS)) {
      if (n[key] === undefined) n[key] = value
    }
    if (!Array.isArray(n.successors)) n.successors = []
    if (n.kind === 'source' && n.rate === undefined) n.rate = DEFAULT_SOURCE_RATE
    // v1.3 L2 (spec §2.3): a source emits one particle size; a transform node
    // carries a split/combine count. transform itself is filled by NODE_DEFAULTS.
    if (n.kind === 'source' && n.particleSize === undefined) {
      n.particleSize = DEFAULT_PARTICLE_SIZE
    }
    if (n.transform === 'split' && n.splitCount === undefined) {
      n.splitCount = DEFAULT_SPLIT_COUNT
    }
    if (n.transform === 'combine' && n.combineCount === undefined) {
      n.combineCount = DEFAULT_COMBINE_COUNT
    }
    // Engine inputs derived from the v1.1 controls (spec §4.2).
    n.latency = n.length
    // capacity: an authored integer wins; otherwise derive from width.
    // The authored override is the crisp-queue hook (bd ai-engineer-v9mj).
    if (typeof n.capacity !== 'number') n.capacity = capacityFromWidth(n.width)
    return n
  })

  // ── fork branch rateShare — even split where omitted ──────────────────────
  out.forks = out.forks.map((fork) => {
    const branches = Array.isArray(fork.branches) ? fork.branches : []
    const evenShare = branches.length > 0 ? 1 / branches.length : 0
    return {
      ...fork,
      branches: branches.map(b => ({
        ...b,
        rateShare: b.rateShare === undefined ? evenShare : b.rateShare,
      })),
    }
  })

  // ── rejection-edge defaults (v1.2, spec §2.3) ─────────────────────────────
  // rate → DEFAULT_REJECTION_RATE; bow.side → auto (opposite the `from` node's
  // label side, else 'below'); bow.depth → DEFAULT_REJECTION_BOW_DEPTH.
  const nodeById = new Map(out.nodes.map(n => [n.id, n]))
  out.rejections = out.rejections.map((rej) => {
    const r = { ...rej }
    if (r.rate === undefined) r.rate = DEFAULT_REJECTION_RATE
    const bow = (r.bow != null && typeof r.bow === 'object') ? { ...r.bow } : {}
    if (bow.side === undefined) bow.side = autoRejectionBowSide(nodeById.get(r.from))
    if (bow.depth === undefined) bow.depth = DEFAULT_REJECTION_BOW_DEPTH
    r.bow = bow
    return r
  })

  return out
}

/**
 * Is `targetId` upstream of `startId` in the forward graph — i.e. can `startId`
 * be reached from `targetId` by following `successors` edges? A rejection edge
 * is *expected* to point at an upstream node (work travels back), so this backs
 * the §2.4 "to is not upstream" advisory warning.
 *
 * @param {string} targetId — the rejection edge's `to` node
 * @param {string} startId — the rejection edge's `from` node
 * @param {object[]} nodes — the flow's node list
 * @returns {boolean}
 */
function isUpstream(targetId, startId, nodes) {
  const successorsById = new Map(nodes.map(n => [n.id, n.successors || []]))
  const seen = new Set([targetId])
  const queue = [targetId]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const next of successorsById.get(current) || []) {
      if (next === startId) return true
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

/**
 * Compute the set of node ids through whose band a *large* particle travels.
 *
 * Large particles originate at a `particleSize:'large'` source and at every
 * `transform:'combine'` node (a combine fires one large from its exit). They
 * travel forward along `successors` / fork branches / merge edges. A
 * `transform:'split'` node consumes a large arrival and emits small particles,
 * so it does NOT pass large to its successors — but the split node's own band
 * still carries the large up to the split, so it is included.
 *
 * Backs the §2.4 width lint: any node in this set narrower than
 * MIN_LARGE_ADMITTING_WIDTH cannot comfortably admit a large particle.
 *
 * @param {object} flow — a flow object
 * @param {object[]} nodes — the flow's node list
 * @returns {Set<string>} ids of nodes a large particle is present in
 */
function nodesCarryingLarge(flow, nodes) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  // Forward adjacency from successors + fork branches + merge edges.
  const succ = new Map(nodes.map(n => [n.id, new Set(n.successors || [])]))
  const edge = (from, to) => {
    if (!succ.has(from)) succ.set(from, new Set())
    if (to != null) succ.get(from).add(to)
  }
  for (const fork of flow.forks || []) {
    for (const b of fork.branches || []) edge(fork.from, b && b.to)
  }
  for (const merge of flow.merges || []) {
    for (const from of merge.from || []) edge(from, merge.to)
  }

  const carries = new Set()
  // `emits` — nodes that send a large particle to their successors.
  const emits = new Set()
  const queue = []
  for (const n of nodes) {
    const isLargeSource = n.kind === 'source' && n.particleSize === 'large'
    if (isLargeSource) carries.add(n.id)
    if (isLargeSource || n.transform === 'combine') {
      if (!emits.has(n.id)) { emits.add(n.id); queue.push(n.id) }
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()
    for (const nextId of succ.get(id) || []) {
      carries.add(nextId)
      const next = byId.get(nextId)
      // A node re-emits large to its own successors unless it splits.
      if (next && next.transform !== 'split' && !emits.has(nextId)) {
        emits.add(nextId)
        queue.push(nextId)
      }
    }
  }
  return carries
}

/**
 * Validate the structural integrity of a v3 flow.
 *
 * Errors are show-stoppers (a flow that cannot render correctly); warnings are
 * advisory (a flow that renders but is probably not what the author meant).
 *
 * @param {object} flow — a v3 flow object
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateFlow(flow) {
  const errors = []
  const warnings = []

  if (flow == null || typeof flow !== 'object') {
    return { ok: false, errors: ['flow is not an object'], warnings }
  }

  const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
  const ids = new Set()
  for (const node of nodes) {
    if (ids.has(node.id)) errors.push(`duplicate node id: "${node.id}"`)
    ids.add(node.id)
  }

  const exists = id => ids.has(id)

  // edges
  for (const node of nodes) {
    for (const succ of node.successors || []) {
      if (!exists(succ)) {
        errors.push(`node "${node.id}" has a successor to a missing node "${succ}"`)
      }
    }
  }

  // forks
  for (const fork of flow.forks || []) {
    if (!exists(fork.from)) {
      errors.push(`fork references a missing "from" node "${fork.from}"`)
    }
    let shareSum = 0
    for (const branch of fork.branches || []) {
      if (!exists(branch.to)) {
        errors.push(`fork "${fork.from}" references a missing branch target "${branch.to}"`)
      }
      if (typeof branch.rateShare === 'number') shareSum += branch.rateShare
    }
    const branchCount = (fork.branches || []).length
    if (branchCount > 0 && Math.abs(shareSum - 1) > 0.01) {
      warnings.push(
        `fork "${fork.from}" rateShare values sum to ${shareSum.toFixed(3)}, not 1`,
      )
    }
  }

  // merges
  for (const merge of flow.merges || []) {
    if (!exists(merge.to)) {
      errors.push(`merge references a missing "to" node "${merge.to}"`)
    }
    for (const from of merge.from || []) {
      if (!exists(from)) {
        errors.push(`merge "${merge.to}" references a missing source node "${from}"`)
      }
    }
  }

  // rejection edges (v1.2, spec §2.4)
  const rejectionRateByFrom = new Map()
  for (const rej of flow.rejections || []) {
    if (!exists(rej.from)) {
      errors.push(`rejection edge references a missing "from" node "${rej.from}"`)
    }
    if (!exists(rej.to)) {
      errors.push(`rejection edge references a missing "to" node "${rej.to}"`)
    }
    if (typeof rej.rate === 'number') {
      if (!(rej.rate > 0 && rej.rate < 1)) {
        errors.push(
          `rejection edge "${rej.from}"→"${rej.to}" has rate ${rej.rate} — `
          + 'expected a fraction strictly between 0 and 1',
        )
      }
      rejectionRateByFrom.set(
        rej.from, (rejectionRateByFrom.get(rej.from) || 0) + rej.rate,
      )
    }
    if (rej.from === rej.to) {
      warnings.push(
        `rejection edge on "${rej.from}" returns to itself (self-rejection) — `
        + 'a degenerate single-node loop',
      )
    } else if (exists(rej.from) && exists(rej.to)
               && !isUpstream(rej.to, rej.from, nodes)) {
      warnings.push(
        `rejection edge "${rej.from}"→"${rej.to}": "${rej.to}" is not upstream `
        + `of "${rej.from}" in the forward graph (probably an authoring error)`,
      )
    }
  }
  for (const [from, rateSum] of rejectionRateByFrom) {
    if (rateSum >= 1) {
      errors.push(
        `node "${from}" rejection rates sum to ${rateSum.toFixed(3)} — must `
        + 'stay below 1 (no outflow would proceed forward)',
      )
    }
  }

  // sources
  const sources = nodes.filter(n => n.kind === 'source')
  if (sources.length === 0) {
    warnings.push('flow has no source node — nothing will emit particles')
  }
  for (const src of sources) {
    if (src.rate !== undefined && !(src.rate > 0)) {
      warnings.push(`source "${src.id}" has a non-positive rate (${src.rate})`)
    }
  }

  // v1.1 controls — advisory range / enum checks
  for (const node of nodes) {
    if (node.colorScheme !== undefined && !COLOR_SCHEMES.includes(node.colorScheme)) {
      warnings.push(`node "${node.id}" has an unknown colorScheme "${node.colorScheme}"`)
    }
    if (node.capacity !== undefined
        && !(Number.isInteger(node.capacity) && node.capacity >= 1)) {
      warnings.push(
        `node "${node.id}" has an invalid capacity (${node.capacity}) — `
        + 'expected a positive integer',
      )
    }
    if (node.kind === 'constraint') {
      warnings.push(
        `node "${node.id}" uses the removed kind:'constraint' — v3 has no `
        + `constraint type (use a narrow width + the 'red' colorScheme)`,
      )
    }

    // v1.3 L2 (spec §2.4) — transform enum + split/combine count rules.
    if (node.transform !== undefined && !NODE_TRANSFORMS.includes(node.transform)) {
      warnings.push(
        `node "${node.id}" has an unknown transform "${node.transform}" — `
        + `expected one of ${NODE_TRANSFORMS.join(' / ')}`,
      )
    }
    if (node.transform === 'split' && node.splitCount !== undefined
        && !(Number.isInteger(node.splitCount) && node.splitCount >= 2)) {
      errors.push(
        `node "${node.id}" is a split node with splitCount ${node.splitCount} — `
        + 'expected an integer >= 2',
      )
    }
    if (node.transform === 'combine' && node.combineCount !== undefined
        && !(Number.isInteger(node.combineCount) && node.combineCount >= 2)) {
      errors.push(
        `node "${node.id}" is a combine node with combineCount ${node.combineCount} — `
        + 'expected an integer >= 2',
      )
    }
    // A combine node holds inbound smalls until combineCount accumulate, then
    // fires one large. Occupancy is size-agnostic and counts held agents, so a
    // combine node whose capacity is below combineCount deadlocks: smalls hit
    // the capacity gate before the pile reaches combineCount and the combine
    // never fires. Warn (not error) — transient over-capacity is otherwise
    // legal per the large-particle spec §3.2.
    if (node.transform === 'combine') {
      const effCombineCount = (Number.isInteger(node.combineCount)
        && node.combineCount >= 2)
        ? node.combineCount
        : DEFAULT_COMBINE_COUNT
      const effCapacity = typeof node.capacity === 'number'
        ? node.capacity
        : capacityFromWidth(node.width)
      if (Number.isInteger(effCapacity) && effCapacity >= 1
          && effCapacity < effCombineCount) {
        warnings.push(
          `node "${node.id}" is a combine node with capacity ${effCapacity} `
          + `below its combineCount ${effCombineCount} — inbound agents will `
          + 'deadlock at the capacity gate before the combine can fire; '
          + `raise capacity to at least ${effCombineCount}`,
        )
      }
    }
  }

  // v1.3 L2 (spec §2.4) — large particles vs band width.
  // particleSize is a source-only enum; warn on an unknown value.
  for (const node of nodes) {
    if (node.kind === 'source' && node.particleSize !== undefined
        && !PARTICLE_SIZES.includes(node.particleSize)) {
      warnings.push(
        `source "${node.id}" has an unknown particleSize "${node.particleSize}" — `
        + `expected one of ${PARTICLE_SIZES.join(' / ')}`,
      )
    }
  }
  const emitsLarge = nodes.some(
    n => n.kind === 'source' && n.particleSize === 'large',
  )
  if (emitsLarge) {
    const carrying = nodesCarryingLarge(flow, nodes)
    const hasSplit = nodes.some(n => n.transform === 'split')
    const tooNarrow = []
    for (const node of nodes) {
      if (carrying.has(node.id) && typeof node.width === 'number'
          && node.width < MIN_LARGE_ADMITTING_WIDTH) {
        tooNarrow.push(node)
        warnings.push(
          `node "${node.id}" is on a large-particle path but its width `
          + `(${node.width}) is too narrow to admit one `
          + `(min ~${MIN_LARGE_ADMITTING_WIDTH}) — `
          + 'consider a split node upstream',
        )
      }
    }
    if (!hasSplit && tooNarrow.length > 0) {
      warnings.push(
        `flow emits large particles but has no split node, and `
        + `${tooNarrow.length === 1 ? 'node' : 'nodes'} `
        + tooNarrow.map(n => `"${n.id}"`).join(', ')
        + ` downstream ${tooNarrow.length === 1 ? 'is' : 'are'} too narrow `
        + 'to admit them — likely an authoring miss',
      )
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
