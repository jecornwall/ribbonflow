/**
 * @ribbonflow/core — the pure, headless heart of ribbonflow.
 *
 * Simulation engine, curve/width/glyph geometry, the pure scene model
 * (buildFlowScene/agentsView), and the flow format layer (serialize /
 * deserialize / migrate / model / flow-set). NO DOM, NO framework — every
 * symbol here is unit-testable with `node --test`.
 *
 * The vanilla renderer (`mountFlow`, the rAF loop, the SVG painting) lives in
 * the sibling `ribbonflow` package, which imports the scene + sim + format
 * from here and re-exports this whole surface. The Vue/React adapters wrap
 * `ribbonflow`; the designer app drives this core directly for its inspector
 * geometry and live preview.
 *
 * This barrel is deliberately BROAD — it is the full toolkit the renderer,
 * the CLI, and the designer build on. (Provenance: extracted from the in-tree
 * @flow-designer/library at the ribbonflow repo split; the library's two faces
 * — narrow slide-read vs broad designer — collapse into this one pure package,
 * with `ribbonflow` as the headline re-export.)
 */

// ── Simulation engine ───────────────────────────────────────────────────────
export {
  createFlowSimulation,
  projectToCenterline,
  selectBranch,
} from './core/useFlowSimulation.js'

// ── Particle stream (generic motion primitive) ──────────────────────────────
// The pure, station-free foundation under ribbonflow's motion: emit particles
// along a centreline at a rate/speed and consume them at the end — no nodes,
// capacities, forks or constraints. createFlowSimulation composes the station
// pipeline on top; an embedder (e.g. a stock-and-flow pipe) drives one stream
// per pipe directly. See core/particleStream.js.
export { createParticleStream } from './core/particleStream.js'

// ── Curve / geometry / width maths ──────────────────────────────────────────
export {
  // geometry primitives
  catmullRomPoint,
  buildCenterline,
  buildBranches,
  ribbonOutlinePath,
  // v1.2 rejection-edge geometry — the SHARED bow curve (R3 imports
  // rejectionBowCurve for the rendered arc; the engine uses it for the
  // rejection-branch centerline, so physics + visuals agree by construction).
  quadBezierPoint,
  rejectionBowCurve,
  buildRejectionCenterline,
  // bd ai-engineer-91ds — band-edge anchors so a rejection arc peels off the
  // SIDE of the flow ribbon, not its centerline.
  rejectionEdgeAnchors,
  REJECTION_BAND_WIDTH,
  // width model
  computeNodeWidths,
  effectiveNodeRates,
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
  // v1.2 rejection-edge render palette (R3) — the dotted-arc colour and the
  // tinted particle colour for 'revising' agents.
  REJECTION_COLOR,
  REJECTION_PARTICLE_COLOR,
} from './core/flowCurve.js'

// ── Rejection-edge render geometry (v1.2 R3 — spec §4) ───────────────────────
// The pure render half of a rejection edge: SVG arc path + arrowhead polygon,
// derived from the SAME rejectionBowCurve the engine centerline uses. The
// designer's R5 canvas edge (CanvasRejectionEdge) draws its dotted arc from
// these.
export {
  rejectionArcCurve,
  rejectionArcPath,
  rejectionArrowPoints,
  rejectionArrowPointsAttr,
  REJECTION_ARC_STROKE_WIDTH,
  REJECTION_ARC_DASHARRAY,
  REJECTION_ARROW_LENGTH,
  REJECTION_ARROW_HALF_WIDTH,
} from './core/flowRejectionArc.js'

// ── Large-particle render geometry (v1.3 L4 — spec §4) ──────────────────────
// The pure render half of v1.3: the per-agent render radius (a large particle
// renders at 3× a small one) and the split / combine node glyph geometry. The
// designer's L5 canvas draws transform-node badges from transformGlyphsFor and
// sizes preview particles via renderRadiusForAgent.
export {
  RENDER_RADIUS_SMALL,
  renderRadiusForSize,
  renderRadiusForAgent,
} from './core/agentRender.js'
export {
  SPLIT_GLYPH_PATH,
  COMBINE_GLYPH_PATH,
  TRANSFORM_GLYPH_STROKE,
  TRANSFORM_GLYPH_STROKE_WIDTH,
  TRANSFORM_GLYPH_OPACITY,
  transformGlyphFor,
  transformGlyphsFor,
} from './core/transformGlyph.js'

// ── Pure scene model (Phase 1 — ribbonflow extraction) ──────────────────────
// The framework-free render model the imperative renderer (Phase 2) and the
// designer drive. buildFlowScene(flow, sim) → static primitives; agentsView(sim)
// → the per-frame agents list. See core/buildFlowScene.js.
export { buildFlowScene, agentsView } from './core/buildFlowScene.js'

// ── Visibility gate (pure decision core — bd ai-engineer-f6pc) ───────────────
// The framework-free, DOM-free edge-triggered gate the renderer's rAF loop
// runs through (a flow simulates only while on-screen + tab-foregrounded, and
// replays fresh on re-entry). The DOM/IntersectionObserver wiring lives in the
// `ribbonflow` package's render/visibilityWiring.js, which imports this.
export { createVisibilityGate, resolveVisible } from './core/visibilityGate.js'

// ── Format layer ────────────────────────────────────────────────────────────
// The designer reads AND writes the format; slides only read it. Both faces
// re-export the same single owner module — there is one format definition.
export {
  FLOW_FORMAT_VERSION,
  serializeFlow,
  deserializeFlow,
  cloneFlow,
  normalizeFlowInput,
} from './format/index.js'

// ── Data model (M2 + v1.1 — designer-only) ──────────────────────────────────
// The v3 model layer: default-filling + engine-field derivation, validation,
// the Speed⇄Width coupling maps, and the version-migration entry point.
// Designer-face only — slides receive a flow already normalized by <FlowEmbed>
// and never touch these.
export {
  normalizeFlow,
  validateFlow,
  FLOW_DEFAULTS,
  NODE_DEFAULTS,
  DEFAULT_SOURCE_RATE,
  // v1.1 node controls — ranges, defaults, the Speed⇄Width coupling maps.
  LENGTH_RANGE,
  SPEED_RANGE,
  // bd ai-engineer-gez3 — the wider SPEED-slider range (a converged node needs
  // throughput well past the 1.75 coupling ceiling).
  SPEED_CONTROL_RANGE,
  WIDTH_RANGE,
  // bd ai-engineer-ey0b — the per-node CAPACITY-override slider range (a
  // converged node needs capacity well past the width-derived ceiling).
  CAPACITY_CONTROL_RANGE,
  // bd ai-engineer-s8cm — the per-emitter red-particle ratio (defective work):
  // the slider range + the all-black default.
  RED_RATIO_RANGE,
  DEFAULT_RED_RATIO,
  DEFAULT_NODE_LENGTH,
  DEFAULT_NODE_SPEED,
  DEFAULT_NODE_WIDTH,
  COLOR_SCHEMES,
  DEFAULT_COLOR_SCHEME,
  speedFromWidth,
  widthFromSpeed,
  capacityFromWidth,
  // v1.2 rejection-edge defaults (the designer's add-rejection tool seeds these).
  DEFAULT_REJECTION_RATE,
  DEFAULT_REJECTION_BOW_DEPTH,
  // v1.3 L2 large-particle model — enums, defaults, the width-admission lint
  // threshold (the designer's source-size + node-transform controls seed these).
  PARTICLE_SIZES,
  DEFAULT_PARTICLE_SIZE,
  NODE_TRANSFORMS,
  DEFAULT_NODE_TRANSFORM,
  DEFAULT_SPLIT_COUNT,
  DEFAULT_COMBINE_COUNT,
  MIN_LARGE_ADMITTING_WIDTH,
} from './format/model.js'

export { migrateFlow } from './format/migrate.js'

// ── Flow-set format (M4 — designer + slide) ──────────────────────────────────
// The flow-set abstraction: an ordered set of flow states with animated
// transitions. The designer assembles, validates and previews a set; the
// interpolation engine + easings back the player and future scrub UIs.
export {
  serializeFlowSet,
  deserializeFlowSet,
  isFlowSetEnvelope,
  // The canonical "is this a flow-set in EITHER form (serialized envelope OR a
  // raw states[] object)" test — the same one mountFlow/mountFlowAuto branch on
  // internally. Surfaced on the designer/tooling face so the collection-build
  // CLI (@ribbonflow/cli) routes a *.flow.json to the flow-set path without
  // reaching around the library. Additive, non-visual.
  isFlowSet,
  assembleFlowSet,
  normalizeFlowSet,
  validateFlowSet,
  interpolateFlow,
  EASINGS,
  TRANSITION_DEFAULTS,
  FLOW_SET_DEFAULTS,
} from './format/flowSet.js'
