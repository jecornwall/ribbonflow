// flow/library/src/render/visibilityWiring.js
/**
 * visibilityWiring.js — framework-free visibility gate wiring.
 *
 * The vanilla equivalent of useVisibilityGate.js (the Vue composable): wires an
 * IntersectionObserver (is the embed on-screen?) + the document visibilitychange
 * event (is the tab foregrounded?) to the pure edge-triggered createVisibilityGate
 * (core/visibilityGate.js), firing onShow/onHide exactly once per transition.
 *
 * onShow → rebuild the sim from a clean state + (re)start the rAF loop (the
 * pile-up fix, ai-engineer-f6pc). onHide → stop the loop. The browser env
 * (IntersectionObserver, document) is injected so this is unit-testable under
 * node --test; in production the caller passes the real globals.
 */
import { createVisibilityGate } from '@ribbonflow/core'

/**
 * @param {Element|object} el — the element to observe (the renderer's <svg>).
 * @param {{onShow?: Function, onHide?: Function}} handlers
 * @param {{IntersectionObserver?: Function, document?: object}} [env]
 *   defaults to the browser globals.
 * @returns {{disconnect: () => void}}
 */
export function observeVisibility(el, { onShow, onHide } = {}, env = {}) {
  const IO = 'IntersectionObserver' in env ? env.IntersectionObserver
    : (typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : undefined)
  const doc = 'document' in env ? env.document
    : (typeof document !== 'undefined' ? document : undefined)

  const gate = createVisibilityGate()
  let intersecting = false

  const documentHidden = () => !!(doc && doc.hidden === true)

  function apply() {
    const edge = gate.update({ intersecting, documentHidden: documentHidden() })
    if (edge === null) return
    if (edge === 'show') onShow?.()
    else onHide?.()
  }

  // Non-browser / no IntersectionObserver: assume visible, fire onShow once
  // (matches useVisibilityGate.js:68-74 — headless contexts keep running).
  if (!IO || !el) {
    intersecting = true
    apply()
    return { disconnect() {} }
  }

  const io = new IO((entries) => {
    for (const entry of entries) intersecting = entry.isIntersecting
    apply()
  }, { threshold: 0.01 })
  io.observe(el)

  const onDocVisibility = () => apply()
  if (doc) doc.addEventListener('visibilitychange', onDocVisibility)

  return {
    disconnect() {
      io.disconnect()
      if (doc) doc.removeEventListener('visibilitychange', onDocVisibility)
    },
  }
}
