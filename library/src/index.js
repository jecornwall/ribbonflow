/**
 * @flow-designer/library — public entry point (the SLIDE FACE).
 *
 * This barrel is deliberately SMALL. It exposes only what a slide needs:
 * <FlowEmbed>, the format-abstracted component, plus the serialization
 * helpers a slide-build step might use to load a flow from disk.
 *
 * A slide that imports from here cannot reach the simulation engine, the
 * curve maths, or the raw renderer — that breadth lives behind the separate
 * `@flow-designer/library/internals` entry point, which the designer app
 * drives. The two faces are intentionally asymmetric (project charter
 * §Architecture): slides read, the designer manipulates.
 */

// The slide-facing component.
export { default as FlowEmbed } from './embed/FlowEmbed.vue'

// The format layer. Slides only read; these let a build step load and
// validate a flow file. The format is OWNED here — see src/format/index.js.
export {
  FLOW_FORMAT_VERSION,
  serializeFlow,
  deserializeFlow,
  cloneFlow,
  normalizeFlowInput,
} from './format/index.js'

// The flow-set format (M4). A slide build step may load a flow-set file the
// same way it loads a single flow; <FlowEmbed> plays either. isFlowSetEnvelope
// lets a build tell the two payloads apart. The format is OWNED in flowSet.js.
export {
  serializeFlowSet,
  deserializeFlowSet,
  isFlowSetEnvelope,
} from './format/flowSet.js'
