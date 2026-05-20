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
 * version 3. capacity / latency are no longer authored: normalizeFlow() derives
 * them as engine inputs so the simulation engine and renderer run unchanged.
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

/** The per-node colour-scheme control (replaces the v2 `constraint` type). */
// 'rose' is the v1 dusty-rose constraint register (PINCH_ROSE / CONSTRAINT_ROSE),
// preserved as a selectable option per Jason's direction (2026-05-20, bd ai-engineer-0h05).
export const COLOR_SCHEMES = ['red', 'neutral', 'green', 'rose']
export const DEFAULT_COLOR_SCHEME = 'neutral'

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
 * simulation with no engine edit. capacity is no longer an authored field.
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
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
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
 * `latency` / `capacity` / `widthMode`. Those are no longer authored, so they
 * are derived here — `latency` from `length`, `capacity` from `width`, and
 * `widthMode: 'manual'` so `computeNodeWidths` honours the explicit per-node
 * `width`.
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
    // Engine inputs derived from the v1.1 controls (spec §4.2).
    n.latency = n.length
    n.capacity = capacityFromWidth(n.width)
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

  return out
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
    if (node.kind === 'constraint') {
      warnings.push(
        `node "${node.id}" uses the removed kind:'constraint' — v3 has no `
        + `constraint type (use a narrow width + the 'red' colorScheme)`,
      )
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
