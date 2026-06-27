/**
 * format/flowSet.js — the FLOW-SET format layer.
 *
 * A flow-set is an ordered list of flow *states* that share topology, plus the
 * transition metadata describing how to animate between them. before/after
 * pairs and year-walks are *instances* of this abstraction — the flow-set
 * itself is domain-name-free (charter §"A flow-set"; M4 spec).
 *
 * This module is the single owner of the flow-set format, exactly as
 * format/index.js owns the single-flow format. It is deliberately .vue-free
 * pure JS so node:test can exercise it headlessly.
 *
 * HARD INVARIANT (project charter): round-trippable. serializeFlowSet() then
 * deserializeFlowSet() must be value-lossless — see test/flowSet.test.js,
 * written test-first.
 *
 * ENVELOPE
 * --------
 *   { formatVersion: <int>, flowSet: <flow-set-object> }
 *
 * The envelope shares the single-flow envelope's `formatVersion` integer; the
 * two are discriminated by their payload key — `flow` ⇒ a single flow,
 * `flowSet` ⇒ a flow-set. isFlowSetEnvelope() does that detection so callers
 * (notably <FlowEmbed>) never have to.
 *
 * Provenance: M4 (bd ai-engineer-nawa) — see
 * docs/superpowers/specs/2026-05-20-flow-M4-design.md.
 */

import { FLOW_FORMAT_VERSION, cloneFlow } from './index.js'
import { normalizeFlow } from './model.js'

/** Easing functions, keyed by the name a `transition.easing` string carries.
 *  Stored as a name in the format so the on-disk form stays pure data. */
export const EASINGS = {
  linear: (t) => t,
  // smooth ease-in-out (cubic) — the default transition feel.
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
}

/** Default transition timeline applied by normalizeFlowSet(). */
export const TRANSITION_DEFAULTS = {
  durationMs: 900,
  holdMs: 2400,
  easing: 'easeInOut',
}

/** Flow-set-level defaults applied by normalizeFlowSet(). */
export const FLOW_SET_DEFAULTS = {
  autoplay: true,
  loop: true,
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * True when `input` is (or parses to) a flow-set envelope — a versioned
 * envelope whose payload is `flowSet`, not `flow`.
 *
 * @param {string|object} input
 * @returns {boolean}
 */
export function isFlowSetEnvelope(input) {
  let env = input
  if (typeof input === 'string') {
    try {
      env = JSON.parse(input)
    } catch {
      return false
    }
  }
  return (
    env != null &&
    typeof env === 'object' &&
    typeof env.formatVersion === 'number' &&
    env.flowSet != null &&
    typeof env.flowSet === 'object'
  )
}

/**
 * A RAW flow-set object (no envelope): a `states` array and no numeric
 * `formatVersion`. The transparent-union counterpart to a raw single flow.
 * @param {*} input
 * @returns {boolean}
 */
export function isRawFlowSet(input) {
  return (
    input != null && typeof input === 'object' &&
    typeof input.formatVersion !== 'number' && Array.isArray(input.states)
  )
}

/**
 * True when `input` is a flow-set in EITHER form — a serialized envelope or a
 * raw `states[]` object. The single owner of the kind test the renderer and
 * the framework adapters all branch on (single flow → scene path; flow-set →
 * crossfade player). Was previously duplicated in mountFlow.js + FlowEmbed.vue.
 * @param {*} input
 * @returns {boolean}
 */
export function isFlowSet(input) {
  return isFlowSetEnvelope(input) || isRawFlowSet(input)
}

/**
 * Assemble a flow-set object from an ordered list of states + a transition.
 *
 * The designer's persistence stores a set as a directory of per-flow files;
 * this turns those loaded flows into the portable, self-contained flow-set the
 * library serialises and <FlowEmbed> plays (M4 spec §2.1).
 *
 * @param {Array<{key:string,title?:string,flow:object}>} states
 * @param {object} [meta] — { id?, title?, transition?, autoplay?, loop? }
 * @returns {object} a flow-set object
 */
export function assembleFlowSet(states, meta = {}) {
  const set = {}
  if (meta.id !== undefined) set.id = meta.id
  if (meta.title !== undefined) set.title = meta.title
  set.states = (states || []).map((s) => {
    const state = { key: s.key }
    if (s.title !== undefined) state.title = s.title
    state.flow = cloneFlow(s.flow)
    return state
  })
  if (meta.transition !== undefined) set.transition = deepClone(meta.transition)
  if (meta.autoplay !== undefined) set.autoplay = meta.autoplay
  if (meta.loop !== undefined) set.loop = meta.loop
  return set
}

/**
 * Serialize a flow-set to the canonical on-disk string form.
 *
 * Byte-faithful: carries exactly the fields present, fills no defaults — so
 * the round-trip invariant holds. Default-filling is normalizeFlowSet()'s job.
 *
 * @param {object} flowSet
 * @returns {string} canonical JSON envelope
 */
export function serializeFlowSet(flowSet) {
  if (flowSet == null || typeof flowSet !== 'object') {
    throw new TypeError('serializeFlowSet: expected a flow-set object')
  }
  const envelope = {
    formatVersion: FLOW_FORMAT_VERSION,
    flowSet: deepClone(flowSet),
  }
  return JSON.stringify(envelope, null, 2)
}

/**
 * Deserialize a flow-set from its on-disk form.
 *
 * Accepts the canonical JSON string OR an already-parsed envelope object.
 * Validates the format version and the presence of a flowSet payload.
 *
 * @param {string|object} input
 * @returns {object} the flow-set object
 * @throws {Error} on malformed input or an unsupported format version
 */
export function deserializeFlowSet(input) {
  let envelope
  if (typeof input === 'string') {
    try {
      envelope = JSON.parse(input)
    } catch (err) {
      throw new Error(`deserializeFlowSet: input is not valid JSON — ${err.message}`)
    }
  } else if (input != null && typeof input === 'object') {
    envelope = input
  } else {
    throw new TypeError('deserializeFlowSet: expected a JSON string or envelope object')
  }

  const version = envelope.formatVersion
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `deserializeFlowSet: missing or invalid format version (${version})`,
    )
  }
  if (version > FLOW_FORMAT_VERSION) {
    throw new Error(
      `deserializeFlowSet: unsupported format version ${version} ` +
      `(this library reads version ${FLOW_FORMAT_VERSION})`,
    )
  }
  if (envelope.flowSet == null || typeof envelope.flowSet !== 'object') {
    throw new Error('deserializeFlowSet: envelope carries no flowSet payload')
  }
  return deepClone(envelope.flowSet)
}

/**
 * Return a normalized deep copy of a flow-set: transition + flow-set defaults
 * filled, and EVERY state's flow run through normalizeFlow() so the player
 * renders engine-ready flows.
 *
 * Does NOT mutate the input. Not part of the round-trip invariant — it fills
 * defaults, so normalizeFlowSet(x) is intentionally not equal to x.
 *
 * @param {object} flowSet
 * @returns {object} a normalized, render-ready deep copy
 */
export function normalizeFlowSet(flowSet) {
  if (flowSet == null || typeof flowSet !== 'object') {
    throw new TypeError('normalizeFlowSet: expected a flow-set object')
  }
  const out = deepClone(flowSet)

  for (const [key, value] of Object.entries(FLOW_SET_DEFAULTS)) {
    if (out[key] === undefined) out[key] = value
  }

  const t = out.transition && typeof out.transition === 'object' ? out.transition : {}
  out.transition = { ...TRANSITION_DEFAULTS, ...t }

  out.states = (Array.isArray(out.states) ? out.states : []).map((s) => ({
    ...s,
    flow: normalizeFlow(s.flow),
  }))

  return out
}

/**
 * Validate the structural integrity of a flow-set.
 *
 * Errors are show-stoppers; warnings are advisory. The shared-topology check
 * is a *warning*: a flow-set whose states differ in node set still plays
 * (crossfade playback tolerates it) but is probably not what the author meant,
 * and interpolateFlow() will refuse it.
 *
 * @param {object} flowSet
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateFlowSet(flowSet) {
  const errors = []
  const warnings = []

  if (flowSet == null || typeof flowSet !== 'object') {
    return { ok: false, errors: ['flow-set is not an object'], warnings }
  }

  const states = Array.isArray(flowSet.states) ? flowSet.states : []
  if (states.length === 0) {
    errors.push('flow-set has no states')
  }

  const keys = new Set()
  for (const [i, state] of states.entries()) {
    if (state == null || typeof state !== 'object') {
      errors.push(`state ${i} is not an object`)
      continue
    }
    if (!state.key) {
      errors.push(`state ${i} has no key`)
    } else if (keys.has(state.key)) {
      errors.push(`duplicate state key: "${state.key}"`)
    }
    if (state.key) keys.add(state.key)
    if (state.flow == null || typeof state.flow !== 'object') {
      errors.push(`state "${state.key ?? i}" carries no flow`)
    }
  }

  // shared-topology check — node-id sets compared against the first state
  const withFlows = states.filter((s) => s && s.flow && Array.isArray(s.flow.nodes))
  if (withFlows.length > 1) {
    const idSet = (flow) => new Set(flow.nodes.map((n) => n.id))
    const base = idSet(withFlows[0].flow)
    for (const state of withFlows.slice(1)) {
      const here = idSet(state.flow)
      const sameSize = here.size === base.size
      const sameMembers = [...here].every((id) => base.has(id))
      if (!sameSize || !sameMembers) {
        warnings.push(
          `state "${state.key}" does not share node topology with the first ` +
          `state — it will crossfade but not interpolate`,
        )
      }
    }
  }

  // transition checks
  const tr = flowSet.transition
  if (tr != null && typeof tr === 'object') {
    if (tr.durationMs !== undefined && !(tr.durationMs >= 0)) {
      errors.push(`transition.durationMs is not a non-negative number (${tr.durationMs})`)
    }
    if (tr.holdMs !== undefined && !(tr.holdMs >= 0)) {
      errors.push(`transition.holdMs is not a non-negative number (${tr.holdMs})`)
    }
    if (tr.easing !== undefined && !(tr.easing in EASINGS)) {
      warnings.push(`transition.easing "${tr.easing}" is unknown — falling back to linear`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

// ── interpolation engine ─────────────────────────────────────────────────────

function lerp(a, b, t) {
  return a + (b - a) * t
}

/** Numeric per-node fields interpolated by interpolateFlow(). */
const NODE_LERP_FIELDS = ['x', 'y', 'width', 'speed', 'length', 'labelDx', 'labelDy', 'rate']

function lerpNumberField(na, nb, key, t, fallback) {
  const a = typeof na[key] === 'number' ? na[key] : fallback
  const b = typeof nb[key] === 'number' ? nb[key] : fallback
  if (a === undefined && b === undefined) return undefined
  return lerp(a ?? b, b ?? a, t)
}

/**
 * Interpolate between two flow states that share topology.
 *
 * Numeric geometry (node x, y, width, speed, length, labelDx, labelDy, rate,
 * flow viewBox + baseSpeed) is linearly interpolated; discrete fields (id, kind,
 * label, colorScheme, successors, coupleSpeedWidth, forks, merges) switch at
 * t = 0.5. The result is a fresh flow object — never an input.
 *
 * Requires `a` and `b` to have the SAME node-id set; throws otherwise. (The
 * crossfade player does not call this for non-matching topology — see M4 spec
 * §2.4.) `t` is clamped to [0,1]; t=0 ⇒ a, t=1 ⇒ b.
 *
 * @param {object} a — flow state at t=0
 * @param {object} b — flow state at t=1
 * @param {number} t — interpolation parameter
 * @returns {object} the interpolated flow
 */
export function interpolateFlow(a, b, t) {
  if (a == null || typeof a !== 'object' || b == null || typeof b !== 'object') {
    throw new TypeError('interpolateFlow: expected two flow objects')
  }
  const tt = t < 0 ? 0 : t > 1 ? 1 : t
  const pick = tt < 0.5 ? a : b

  const nodesA = Array.isArray(a.nodes) ? a.nodes : []
  const nodesB = Array.isArray(b.nodes) ? b.nodes : []
  const byIdB = new Map(nodesB.map((n) => [n.id, n]))
  if (
    nodesA.length !== nodesB.length ||
    !nodesA.every((n) => byIdB.has(n.id))
  ) {
    throw new Error(
      'interpolateFlow: the two flows must share an identical node-id set',
    )
  }

  const out = deepClone(pick)

  // flow-level numeric fields
  if (typeof a.baseSpeed === 'number' && typeof b.baseSpeed === 'number') {
    out.baseSpeed = lerp(a.baseSpeed, b.baseSpeed, tt)
  }
  if (
    a.viewBox && b.viewBox &&
    typeof a.viewBox === 'object' && typeof b.viewBox === 'object'
  ) {
    out.viewBox = { ...out.viewBox }
    for (const k of ['x', 'y', 'w', 'h']) {
      if (typeof a.viewBox[k] === 'number' && typeof b.viewBox[k] === 'number') {
        out.viewBox[k] = lerp(a.viewBox[k], b.viewBox[k], tt)
      }
    }
  }

  // per-node numeric geometry
  out.nodes = out.nodes.map((node) => {
    const na = nodesA.find((n) => n.id === node.id)
    const nb = byIdB.get(node.id)
    const merged = { ...node }
    for (const key of NODE_LERP_FIELDS) {
      const v = lerpNumberField(na, nb, key, tt)
      if (v !== undefined) merged[key] = v
    }
    return merged
  })

  return out
}
