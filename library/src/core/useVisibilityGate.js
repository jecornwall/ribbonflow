/**
 * useVisibilityGate.js — Vue composable: gate a flow on slide visibility.
 *
 * bd ai-engineer-f6pc. Wires an IntersectionObserver (is the embed on-screen?)
 * and the document `visibilitychange` event (is the browser tab foregrounded?)
 * to the pure edge-triggered gate in visibilityGate.js, and fires onShow /
 * onHide callbacks exactly once per transition.
 *
 * WHY IntersectionObserver, not a Slidev hook. The shared flow library must
 * stay framework-agnostic — it knows nothing of Slidev, onSlideEnter, or the
 * deck. An IntersectionObserver on the embed's own root element detects
 * visibility from the DOM alone, so the same gate works on a Slidev slide, in
 * the designer's live preview, and in the parity harness without any of them
 * importing slide-runtime APIs. (Discussed with Jason 2026-05-20.)
 *
 * Semantics the caller gets:
 *   onShow — the embed became visible: rebuild the simulation from a clean
 *            initial state and start the RAF loop.
 *   onHide — the embed left the screen (or the tab was backgrounded): stop
 *            the RAF loop.
 *
 * NON-BROWSER FALLBACK. Under jsdom / SSR (no IntersectionObserver), the gate
 * assumes the embed is visible and fires onShow once on mount — so headless
 * tests and the node test-runner see the pre-f6pc always-running behaviour.
 */

import { onMounted, onBeforeUnmount, ref } from 'vue'
import { createVisibilityGate } from './visibilityGate.js'

/**
 * @param {import('vue').Ref<Element|null>} elRef — ref to the embed root element
 *   to observe (the FlowGraph <svg>, the FlowSetPlayer container).
 * @param {object}   handlers
 * @param {Function} handlers.onShow — fired on each rising edge (became visible).
 * @param {Function} [handlers.onHide] — fired on each falling edge (left screen).
 * @returns {{ visible: import('vue').Ref<boolean> }}
 */
export function useVisibilityGate(elRef, { onShow, onHide } = {}) {
  const visible = ref(false)
  const gate = createVisibilityGate()

  // Latest raw inputs; either source (IO / visibilitychange) can change
  // independently, so we keep both and re-resolve on every signal.
  let intersecting = false

  let io = null
  let docListenerAttached = false

  function documentHidden() {
    return typeof document !== 'undefined' && document.hidden === true
  }

  function apply() {
    const edge = gate.update({ intersecting, documentHidden: documentHidden() })
    if (edge === null) return
    visible.value = gate.visible
    if (edge === 'show') onShow?.()
    else onHide?.()
  }

  function onDocVisibility() {
    apply()
  }

  onMounted(() => {
    const el = elRef.value

    // Non-browser / no IntersectionObserver support: assume visible so
    // headless contexts keep the pre-f6pc always-running behaviour.
    if (typeof IntersectionObserver === 'undefined' || !el) {
      intersecting = true
      apply()
      return
    }

    io = new IntersectionObserver(
      (entries) => {
        // A single observed element → take the last entry's state.
        for (const entry of entries) intersecting = entry.isIntersecting
        apply()
      },
      // A low threshold: the slide counts as "open" as soon as any sliver of
      // the embed is on-screen. Slidev's slide transition briefly shows two
      // slides; the incoming flow starts as it slides in, which reads well.
      { threshold: 0.01 },
    )
    io.observe(el)

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onDocVisibility)
      docListenerAttached = true
    }
  })

  onBeforeUnmount(() => {
    if (io) {
      io.disconnect()
      io = null
    }
    if (docListenerAttached) {
      document.removeEventListener('visibilitychange', onDocVisibility)
      docListenerAttached = false
    }
  })

  return { visible }
}
