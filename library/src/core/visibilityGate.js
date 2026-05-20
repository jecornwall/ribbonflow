/**
 * visibilityGate.js — pure visibility-gate logic (bd ai-engineer-f6pc).
 *
 * THE PROBLEM. Every <FlowEmbed> flow mounts a requestAnimationFrame loop in
 * onMounted and never stops it. Across a 20-minute talk, a flow on slide 18
 * has been simulating since the deck loaded — its constraint shows minutes of
 * piled-up backlog instead of a fresh animation when the presenter arrives.
 *
 * THE FIX. A flow simulation runs only while its embed is "running-eligible":
 * on-screen (IntersectionObserver) AND its browser tab foregrounded. When a
 * slide is opened the simulation is rebuilt from a clean initial state; when
 * the slide is left the RAF loop stops. Re-opening a slide replays fresh
 * (Jason 2026-05-20: "replay fresh every entry · build live from clean").
 *
 * THIS MODULE is the pure decision core — no Vue, no DOM. The Vue +
 * IntersectionObserver wiring lives in useVisibilityGate.js. Keeping the
 * logic pure lets it be unit-tested with `node --test`, matching the
 * library's pure-logic testing register (flowCurve / useFlowSimulation).
 */

/**
 * Running-eligibility predicate. A flow may simulate only when its embed is
 * BOTH intersecting the viewport AND the document/tab is foregrounded.
 *
 * @param {object}  inputs
 * @param {boolean} [inputs.intersecting]   IntersectionObserver isIntersecting.
 * @param {boolean} [inputs.documentHidden] document.hidden (tab backgrounded).
 * @returns {boolean} true → the flow is running-eligible.
 */
export function resolveVisible({ intersecting, documentHidden } = {}) {
  return !!intersecting && !documentHidden
}

/**
 * An edge-triggered visibility gate. Feed it the current raw inputs via
 * update(); it resolves running-eligibility and returns the TRANSITION that
 * occurred so the caller fires side effects exactly once on each edge:
 *
 *   'show' → became running-eligible  (rebuild the sim, start the RAF loop)
 *   'hide' → stopped being eligible   (stop the RAF loop)
 *   null   → no change                (do nothing)
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.initialVisible=false] starting eligibility — set true
 *   when the embed is known to mount already on-screen, to suppress a
 *   redundant first 'show'.
 */
export function createVisibilityGate({ initialVisible = false } = {}) {
  let visible = initialVisible
  return {
    get visible() {
      return visible
    },
    /**
     * @param {object} inputs — see resolveVisible.
     * @returns {'show'|'hide'|null} the edge that occurred, or null.
     */
    update(inputs) {
      const next = resolveVisible(inputs)
      if (next === visible) return null
      visible = next
      return next ? 'show' : 'hide'
    },
  }
}
