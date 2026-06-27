// flow/library/src/render/mountFlowAuto.js
/**
 * mountFlowAuto.js — the auto-remount controller the framework adapters share.
 *
 * mountFlow(el, flow, opts) routes a single flow vs a flow-set internally, but
 * its update() is deliberately mode-locked: swapping a flow-SET into a
 * single-flow handle (or vice-versa) throws, because the two have different DOM
 * and handle shapes. The framework adapters need the swap to "just work" across
 * a kind switch — so mountFlowAuto wraps mountFlow and, on a kind change,
 * destroys and re-mounts instead of forwarding update(). Within a kind it
 * forwards update() straight through (rebuilds the static scene, keeps the
 * visibility gate — Phase 2 semantics, the deck's click idiom).
 *
 * This is the ONLY adapter-specific logic; isolating it here keeps the Vue and
 * React shells logic-free and lets the kind-switch behaviour be unit-tested
 * headlessly (the components themselves are browser-smoked).
 *
 * @param {Element} el — host element.
 * @param {object|string} flow — the transparent union (single flow / serialized
 *   flow / flow-set object / serialized flow-set).
 * @param {object} [opts] — forwarded verbatim to mountFlow (showMetrics; and in
 *   tests the injected document/raf/caf/IntersectionObserver/visibilityDocument).
 * @returns {{ update: (nextFlow: object|string) => void, destroy: () => void }}
 */
import { mountFlow } from './mountFlow.js'
import { isFlowSet } from '../format/flowSet.js'

export function mountFlowAuto(el, flow, opts = {}) {
  let handle = mountFlow(el, flow, opts)
  let mountedIsSet = isFlowSet(flow)

  return {
    update(nextFlow) {
      if (isFlowSet(nextFlow) === mountedIsSet) {
        handle.update(nextFlow)            // same kind — in-place rebuild
      } else {
        handle.destroy()                   // kind switch — remount
        handle = mountFlow(el, nextFlow, opts)
        mountedIsSet = isFlowSet(nextFlow)
      }
    },
    destroy() {
      handle.destroy()
    },
  }
}
