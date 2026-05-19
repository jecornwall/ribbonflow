/**
 * @flow-designer/library/internals — the DESIGNER FACE.
 *
 * This barrel is deliberately BROAD. The designer app needs to manipulate
 * every internal of a flow: build the simulation, project onto centerlines,
 * compute ribbon geometry, render the raw graph and its parts. So the library
 * exposes them all here — behind a separate entry point from the slide face
 * (src/index.js), so slide code cannot accidentally reach in.
 *
 * If the designer ever needs something not exported here, ADD IT here — do
 * not let the designer reach around the library into ./core/* directly. The
 * package boundary is the contract; this file is its designer half.
 *
 * Provenance: everything under ./core/ is a verbatim M1 copy of the deck's
 * deck/components/flow/* code. It evolves independently from here on (M2
 * grows the data model). The deck keeps running on its own copy until M5.
 */

// ── Simulation engine ───────────────────────────────────────────────────────
export {
  createFlowSimulation,
  projectToCenterline,
  selectBranch,
} from './core/useFlowSimulation.js'

// ── Curve / geometry / width maths ──────────────────────────────────────────
export {
  // geometry primitives
  catmullRomPoint,
  buildCenterline,
  buildBranches,
  ribbonOutlinePath,
  // width model
  computeNodeWidths,
  segmentBoundsByLatency,
  buildPinchWidthFn,
  pinchZoneArcRanges,
  pinchZoneOutlinePath,
  bandEdgesAt,
  // tunable constants
  PARTICLE_RADIUS,
  WALL_MARGIN,
  MIN_RIBBON_WIDTH,
  MAX_RIBBON_WIDTH,
  WIDTH_POWER,
  DEFAULT_BAND_WIDTH,
  DEFAULT_CONSTRAINT_WIDTH,
  // palette
  FLOW_BAND,
  PINCH_ROSE,
  CONSTRAINT_ROSE,
  INK,
  CONSTRAINT_INK,
} from './core/flowCurve.js'

// ── Render components ───────────────────────────────────────────────────────
// The raw renderer and its parts. The designer drives FlowGraph directly for
// live preview; FlowRibbon / FlowAgent / FlowSegmentMarker are exposed for
// finer-grained designer surfaces (e.g. previewing a single ribbon).
export { default as FlowGraph } from './core/FlowGraph.vue'
export { default as FlowRibbon } from './core/FlowRibbon.vue'
export { default as FlowAgent } from './core/FlowAgent.vue'
export { default as FlowSegmentMarker } from './core/FlowSegmentMarker.vue'

// ── Format layer (also on the slide face) ───────────────────────────────────
// The designer reads AND writes the format; slides only read it. Both faces
// re-export the same single owner module — there is one format definition.
export {
  FLOW_FORMAT_VERSION,
  serializeFlow,
  deserializeFlow,
  cloneFlow,
  normalizeFlowInput,
} from './format/index.js'

// ── Data model (M2 — designer-only) ─────────────────────────────────────────
// The v2 model layer: default-filling, validation, named pinch presets, and
// the version-migration entry point. Designer-face only — slides receive a
// flow already normalized by <FlowEmbed> and never touch these.
export {
  normalizeFlow,
  validateFlow,
  PINCH_PRESETS,
  FLOW_DEFAULTS,
  NODE_DEFAULTS,
  DEFAULT_SOURCE_RATE,
} from './format/model.js'

export { migrateFlow } from './format/migrate.js'
