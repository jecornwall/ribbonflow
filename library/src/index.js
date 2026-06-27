/**
 * @flow-designer/library — public entry point (the SLIDE FACE).
 *
 * This barrel is deliberately SMALL. It exposes only what a slide's build
 * step needs: the serialization helpers to load and validate a flow from disk.
 * The slide-facing component <FlowEmbed> has moved to @flow-designer/vue.
 *
 * A slide that imports from here cannot reach the simulation engine, the
 * curve maths, or the raw renderer — that breadth lives behind the separate
 * `@flow-designer/library/internals` entry point, which the designer app
 * drives. The two faces are intentionally asymmetric (project charter
 * §Architecture): slides read, the designer manipulates.
 */

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
