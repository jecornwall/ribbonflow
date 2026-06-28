/**
 * ribbonflow — the vanilla SVG flow renderer + headline package.
 *
 * `mountFlow(el, flow, opts) → { update, destroy }` materialises a flow's
 * static scene into SVG once, then runs a visibility-gated requestAnimationFrame
 * loop that moves only the agent circles each frame. No framework: the Vue and
 * React adapters are thin wrappers over this, and a no-framework consumer
 * imports `mountFlow` / `mountFlowAuto` directly.
 *
 *   import { mountFlowAuto } from 'ribbonflow'
 *   const handle = mountFlowAuto(el, flow)   // single flow OR flow-set
 *   handle.update(nextFlow)                  // the deck's click idiom
 *   handle.destroy()
 *
 * This package re-exports all of `@ribbonflow/core` (the pure scene model,
 * simulation, geometry, and flow format), so `ribbonflow` is the single
 * import most consumers need.
 */

// Re-export the pure core — scene model, simulation, geometry, format layer.
export * from '@ribbonflow/core'

// The vanilla imperative renderer (single flow, flow-set, and the auto-routing
// controller the adapters share).
export { mountFlow, mountFlowSet, mountFlowAuto } from './render/index.js'
