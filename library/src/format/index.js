/**
 * format/index.js — the flow-format serialization layer.
 *
 * The shared flow library OWNS the flow format. This module is the single
 * place that reads and writes it. The designer writes a flow through here;
 * slides read a flow through here (via <FlowEmbed>). It is not a separately
 * negotiated contract — one definition, two consumers.
 *
 * HARD INVARIANT (project charter): round-trippable. serializeFlow() then
 * deserializeFlow() must be value-lossless, so "reload an exported flow to
 * edit it" works. See test/roundtrip.test.js — written test-first.
 *
 * FORMAT ENVELOPE
 * ---------------
 *   { formatVersion: <int>, flow: <flow-object> }
 *
 * The envelope carries a version integer so exports can be migrated forward.
 * M1 shipped version 1. M2 (bd ai-engineer-8aee) bumps it to version 2 — real
 * multi-source nodes, first-class forks, width/rate coupling, authored register
 * knobs — and adds a migration step: deserializeFlow() runs any older envelope
 * through format/migrate.js up to the current version, so a v1 export always
 * loads forward losslessly.
 *
 * serializeFlow()/deserializeFlow() stay byte-FAITHFUL — they carry exactly the
 * fields present and never fill defaults. Default-filling is normalizeFlow()'s
 * job (format/model.js), kept separate so the round-trip invariant holds.
 *
 * The on-disk form is pretty-printed JSON. Flow definitions are pure data
 * (no functions), so JSON is a faithful, human-diffable carrier.
 */

import { migrateFlow } from './migrate.js'
import { normalizeFlow } from './model.js'

/**
 * Current flow-format version. M1 = 1; M2 = 2 (multi-source nodes, first-class
 * forks); v1.1 = 3 (Length/Speed/Width node controls, per-node colour scheme,
 * the `constraint` type dropped); v1.2 = 4 (first-class `rejections[]` —
 * failed-review back-paths). deserializeFlow() migrates any lower version
 * forward via migrate.js.
 */
export const FLOW_FORMAT_VERSION = 4

/**
 * Deep structural clone of a flow object.
 *
 * Flow definitions are pure JSON-compatible data, so structuredClone-via-JSON
 * is exact and dependency-free. Used by the designer to take an editable
 * working copy without aliasing the imported source, and internally by the
 * serializer to avoid mutating a caller's object.
 *
 * @param {object} flow
 * @returns {object} an independent deep copy
 */
export function cloneFlow(flow) {
  return JSON.parse(JSON.stringify(flow))
}

/**
 * Serialize a flow object to the canonical on-disk string form.
 *
 * Output is a pretty-printed JSON envelope. Object key order follows the
 * input object's own key order (V8 preserves insertion order for string
 * keys), so serialize→deserialize→serialize is byte-stable — see the
 * idempotence test in test/roundtrip.test.js.
 *
 * @param {object} flow — a flow definition object
 * @returns {string} canonical JSON envelope
 */
export function serializeFlow(flow) {
  if (flow == null || typeof flow !== 'object') {
    throw new TypeError('serializeFlow: expected a flow object')
  }
  const envelope = {
    formatVersion: FLOW_FORMAT_VERSION,
    flow: cloneFlow(flow),
  }
  return JSON.stringify(envelope, null, 2)
}

/**
 * Deserialize a flow from its on-disk form back into a flow object.
 *
 * Accepts either the canonical JSON string produced by serializeFlow() or an
 * already-parsed envelope object (convenient when a flow is imported as a
 * pre-parsed JSON module). Validates the format version and the presence of
 * a flow payload, then returns a fresh deep copy of the flow.
 *
 * @param {string|object} input — JSON envelope string, or a parsed envelope
 * @returns {object} the flow definition object
 * @throws {Error} on malformed input or an unsupported format version
 */
export function deserializeFlow(input) {
  let envelope
  if (typeof input === 'string') {
    try {
      envelope = JSON.parse(input)
    } catch (err) {
      throw new Error(`deserializeFlow: input is not valid JSON — ${err.message}`)
    }
  } else if (input != null && typeof input === 'object') {
    envelope = input
  } else {
    throw new TypeError('deserializeFlow: expected a JSON string or envelope object')
  }

  const version = envelope.formatVersion
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `deserializeFlow: missing or invalid flow format version (${version})`,
    )
  }
  if (version > FLOW_FORMAT_VERSION) {
    throw new Error(
      `deserializeFlow: unsupported flow format version ${version} ` +
      `(this library reads version ${FLOW_FORMAT_VERSION})`,
    )
  }
  if (envelope.flow == null || typeof envelope.flow !== 'object') {
    throw new Error('deserializeFlow: envelope carries no flow payload')
  }
  // Migrate older exports forward to the current data model, then hand back a
  // fresh deep copy. A current-version envelope skips migration entirely.
  const flow = version < FLOW_FORMAT_VERSION
    ? migrateFlow(envelope.flow, version)
    : envelope.flow
  return cloneFlow(flow)
}

/**
 * Detect the format version of a bare flow object (one without a `formatVersion`
 * wrapper). Called by normalizeFlowInput when the input has no envelope.
 *
 * Detection rules:
 *   v1 — top-level `entryId` is the definitive v1 marker (removed by v1→v2).
 *   v2 — EITHER any node still carries the retired `kind:'constraint'` type
 *         (a definitive pre-v3 marker — v3 dropped it for a per-node colour
 *         scheme, bd ai-engineer-bw3s), OR nodes have `capacity` (the v2
 *         engine field) but neither `length` nor `colorScheme` (both v3-only
 *         node controls). A v3 node always authors `length`; a v3 node MAY
 *         author `capacity` (the crisp-queue override, bd ai-engineer-v9mj),
 *         so the `length` check is what keeps such a flow from being misread
 *         as v2. An already-normalized v3 flow has `capacity` (re-derived)
 *         plus `length`/`colorScheme`, so it reads v3.
 *   v4 — a top-level `rejections[]` array is present (the v1.2 rejection-edge
 *         marker — added by the v3→v4 migration and never present on a v3
 *         flow). Detecting it as v4 skips a harmless no-op v3→v4 migration.
 *   v3 — everything else (including an empty-nodes flow).
 *
 * @param {object} flow — a bare flow object (no formatVersion)
 * @returns {1|2|3|4}
 */
function detectBareFlowVersion(flow) {
  // v1: top-level entryId is present (v1→v2 migration deletes it)
  if (flow.entryId !== undefined) return 1
  // v4: a top-level rejections[] array is the definitive v1.2 marker. A v3
  // flow never carries one; the v3→v4 migration adds it. (A v1 flow is caught
  // above first — entryId is the stronger, earlier marker.)
  if (Array.isArray(flow.rejections)) return 4
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
  // pre-v3: a surviving `kind:'constraint'` node is a definitive pre-v3 marker
  // (bd ai-engineer-bw3s). v3 retired the constraint type; a flow can otherwise
  // look fully v3-shaped (nodes carrying `length` / `colorScheme`, no
  // `capacity`) yet still carry a stray constraint node — e.g. a deck flow
  // hand-mixed toward v3. Without forcing the migration chain, kind:'constraint'
  // would survive to render, and both buildPinchWidthFn's constraintIdx lookup
  // and the v3 colour register would silently miss it. Treat it as v2 so the
  // v2→v3 step converts it (→ kind:'normal' + the 'red' colour scheme).
  if (nodes.some(n => n && n.kind === 'constraint')) return 2
  // v2: nodes carry `capacity` but neither v3 node control (`length` /
  // `colorScheme`). A v3 flow may author `capacity`, so `length` is the
  // discriminator — a genuine v2 node has `latency`, not `length`.
  if (nodes.some(n =>
    n.capacity !== undefined && n.length === undefined && n.colorScheme === undefined,
  )) return 2
  return 3
}

/**
 * Normalize an arbitrary `flow`-shaped input into a render-ready flow object.
 *
 * <FlowEmbed> accepts a flow as any of:
 *   - A plain flow object (the format the current deck uses — format v1 or v3)
 *   - A serialized JSON envelope string (from serializeFlow / designer export)
 *   - A parsed envelope object ({ formatVersion, flow })
 *
 * This helper hides that distinction AND ensures the result is:
 *   1. Migrated to the current format version (v3) if necessary.
 *   2. Normalized (defaults filled, engine fields derived) so <FlowGraph> can
 *      render it without any further preparation.
 *
 * Detection for bare objects: an envelope always has a numeric `formatVersion`;
 * a bare flow object never does. For bare flows the version is detected via
 * detectBareFlowVersion(), then migrateFlow() and normalizeFlow() are applied.
 * normalizeFlow() is idempotent so a v3 flow that already carries all defaults
 * is not degraded by a second pass.
 *
 * M5 fix (bd ai-engineer-n2k9): before this fix, bare flow objects were
 * returned untouched — no migration, no normalization — causing 189 console
 * errors (NaN SVG attributes) and a crash in pinchZoneOutlinePath when a
 * deck v1 flow was handed directly to <FlowEmbed>.
 *
 * @param {string|object} input
 * @returns {object} a normalized, render-ready v3 flow object
 */
export function normalizeFlowInput(input) {
  if (typeof input === 'string') {
    // JSON envelope string → deserialize (migrates if needed) → normalize
    return normalizeFlow(deserializeFlow(input))
  }
  if (input != null && typeof input === 'object') {
    if (typeof input.formatVersion === 'number') {
      // Parsed envelope → deserialize (migrates if needed) → normalize
      return normalizeFlow(deserializeFlow(input))
    }
    // Bare flow object — detect its format version, migrate forward, then
    // normalize. An already-normalized v3 flow passes through harmlessly.
    const version = detectBareFlowVersion(input)
    const v3 = version < FLOW_FORMAT_VERSION ? migrateFlow(input, version) : input
    return normalizeFlow(v3)
  }
  throw new TypeError('normalizeFlowInput: expected a flow object or serialized flow')
}
