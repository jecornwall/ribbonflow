/**
 * format/model.js — the v2 flow model: defaults, pinch presets, normalization,
 * and validation.
 *
 * This module defines what a *complete* v2 flow looks like and how a partial
 * one is filled in. It is deliberately SEPARATE from the serializer
 * (format/index.js): serialize/deserialize stay byte-faithful so the round-trip
 * invariant holds, while normalizeFlow() fills documented defaults at
 * consumption time. See docs/superpowers/specs/2026-05-20-flow-M2-design.md §2.5.
 *
 * Provenance: M2 (bd ai-engineer-8aee) introduced this layer alongside the
 * version-2 data model — real multi-source nodes, first-class forks, the
 * width/rate coupling knob, and authored register knobs.
 */

/** Default emit rate (particles/sec) for a source node that sets none. */
export const DEFAULT_SOURCE_RATE = 1.0

/**
 * Named pinch presets — bundles of register knobs an author can apply with a
 * single `flow.pinchPreset` field. normalizeFlow() expands the chosen preset
 * into the flat register fields, only filling fields the flow has NOT set
 * explicitly (an explicit flat field always beats the preset).
 */
export const PINCH_PRESETS = {
  // The locked-v2 wineglass register (n4-toc-baseline, n9-multilane, …).
  'constraint-pinch': {
    pinchMode: 'constraint-only',
    ribbonColor: '#e8d8b0',
    pinchFillColor: '#e6c8c8',
    constraintFillColor: '#d8a8a8',
    bandWidth: 70,
    constraintWidth: 22,
    constraintPlateauWidth: 80,
  },
  // The older throughput-encoded step-function register.
  'throughput-encoded': {
    pinchMode: 'throughput-encoded',
    ribbonColor: '#e8d8b0',
    bandWidth: 70,
    constraintWidth: 10,
  },
}

/** Flow-level defaults applied by normalizeFlow(). */
export const FLOW_DEFAULTS = {
  baseSpeed: 200,
  initialAgents: 0,
  widthMode: 'coupled', // 'coupled' | 'manual' — see spec §2.3
}

/** Per-node defaults applied by normalizeFlow() to every node. */
export const NODE_DEFAULTS = {
  kind: 'normal', // 'normal' | 'source' | 'constraint'
  label: '',
  labelDx: 0,
  labelDy: 0,
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Return a normalized deep copy of a v2 flow with documented defaults applied.
 *
 * Does NOT mutate the input. Not part of the round-trip invariant — this fills
 * defaults, so normalizeFlow(x) is intentionally not equal to x. The engine and
 * <FlowEmbed> call this at consumption time.
 *
 * @param {object} flow — a v2 flow object (possibly partial)
 * @returns {object} a normalized deep copy
 */
export function normalizeFlow(flow) {
  if (flow == null || typeof flow !== 'object') {
    throw new TypeError('normalizeFlow: expected a flow object')
  }
  const out = deepClone(flow)

  // ── pinch preset expansion (before flow defaults so it can be overridden) ──
  if (typeof out.pinchPreset === 'string' && PINCH_PRESETS[out.pinchPreset]) {
    const preset = PINCH_PRESETS[out.pinchPreset]
    for (const [key, value] of Object.entries(preset)) {
      if (out[key] === undefined) out[key] = value
    }
  }

  // ── flow-level defaults ───────────────────────────────────────────────────
  for (const [key, value] of Object.entries(FLOW_DEFAULTS)) {
    if (out[key] === undefined) out[key] = value
  }
  if (!Array.isArray(out.forks)) out.forks = []
  if (!Array.isArray(out.merges)) out.merges = []
  if (!Array.isArray(out.nodes)) out.nodes = []

  // ── per-node defaults ─────────────────────────────────────────────────────
  out.nodes = out.nodes.map((node) => {
    const n = { ...node }
    for (const [key, value] of Object.entries(NODE_DEFAULTS)) {
      if (n[key] === undefined) n[key] = value
    }
    if (!Array.isArray(n.successors)) n.successors = []
    if (n.kind === 'source' && n.rate === undefined) n.rate = DEFAULT_SOURCE_RATE
    if (n.kind === 'constraint' && n.constraintKind === undefined) {
      n.constraintKind = 'pinch'
    }
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
 * Validate the structural integrity of a v2 flow.
 *
 * Errors are show-stoppers (a flow that cannot render correctly); warnings are
 * advisory (a flow that renders but is probably not what the author meant).
 *
 * @param {object} flow — a v2 flow object
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

  return { ok: errors.length === 0, errors, warnings }
}
