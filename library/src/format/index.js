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
 * The envelope carries a version integer so future milestones (M2 evolves
 * the data model) can migrate older exports forward. M1 ships version 1 and
 * does NOT change the data model — the `flow` payload is exactly the shape
 * the current deck flows use (viewBox, baseSpeed, entryId, nodes[], register
 * knobs). M2 owns data-model evolution and will bump this version + add a
 * migration step here.
 *
 * The on-disk form is pretty-printed JSON. Flow definitions are pure data
 * (no functions), so JSON is a faithful, human-diffable carrier.
 */

/**
 * Current flow-format version. M1 = 1. Bumped by M2 when the data model
 * gains real multi-source nodes / first-class forks; a migration step is
 * added to deserializeFlow() at that point.
 */
export const FLOW_FORMAT_VERSION = 1

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

  if (envelope.formatVersion !== FLOW_FORMAT_VERSION) {
    throw new Error(
      `deserializeFlow: unsupported flow format version ${envelope.formatVersion} ` +
      `(this library reads version ${FLOW_FORMAT_VERSION})`,
    )
  }
  if (envelope.flow == null || typeof envelope.flow !== 'object') {
    throw new Error('deserializeFlow: envelope carries no flow payload')
  }
  return cloneFlow(envelope.flow)
}

/**
 * Normalize an arbitrary `flow`-shaped input into a live flow object.
 *
 * <FlowEmbed> accepts a flow as either a plain flow object (the shape the
 * current deck passes) or a serialized envelope (string OR parsed object).
 * This helper hides that distinction so the slide face never has to know
 * which form it was handed.
 *
 * Detection: an envelope always has a numeric `formatVersion`; a bare flow
 * object never does.
 *
 * @param {string|object} input
 * @returns {object} a live flow object
 */
export function normalizeFlowInput(input) {
  if (typeof input === 'string') {
    return deserializeFlow(input)
  }
  if (input != null && typeof input === 'object') {
    if (typeof input.formatVersion === 'number') {
      return deserializeFlow(input)
    }
    return input
  }
  throw new TypeError('normalizeFlowInput: expected a flow object or serialized flow')
}
