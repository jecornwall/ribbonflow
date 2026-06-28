// flow/library/src/render/index.js
/**
 * ribbonflow — the framework-free render face.
 *
 * The vanilla imperative renderer + the adapter controller. The Vue/React
 * adapter packages (@ribbonflow/vue, @ribbonflow/react) import from here;
 * external no-framework consumers use mountFlow/mountFlowAuto directly. This is
 * the seam the eventual unscoped `ribbonflow` package becomes at the repo split.
 */
export { mountFlow } from './mountFlow.js'
export { mountFlowSet } from './mountFlowSet.js'
export { mountFlowAuto } from './mountFlowAuto.js'
