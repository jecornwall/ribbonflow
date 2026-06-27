// flow/library/src/render/mountFlowSet.js
/**
 * mountFlowSet.js — the vanilla imperative FLOW-SET renderer (Phase 2b).
 *
 * The framework-free twin of FlowSetPlayer.vue: plays an ordered list of flow
 * states that share topology, animating between them on a hold → transition →
 * hold timeline. TRANSITION MECHANISM is the v1 CROSSFADE (not geometry morph —
 * interpolateFlow per-frame is a separate tracked follow-up, ai-engineer-5o9w):
 * two alternating slots, each a nested single-flow renderer running its own
 * simulation; a transition mounts the incoming state into the HIDDEN slot's
 * renderer and eases its opacity in; on completion that slot becomes active. The
 * VISIBLE slot is never remounted, so its particles keep running.
 *
 * Composition: each slot is a nested single-flow mountFlow(slotEl, flow, opts).
 * The nested renderer is INJECTED via opts.mountFlow (mountFlow passes itself
 * when it delegates) — this keeps the per-flow sim/scene/loop the Phase-2a
 * renderer (not reimplemented), breaks the mountFlow↔mountFlowSet import cycle,
 * and makes the outer crossfade timeline unit-testable with a spy factory.
 *
 * The outer crossfade timeline runs its OWN visibility-gated rAF loop (the
 * scheduler is opts.raf/opts.caf, injectable for tests), separate from the two
 * nested per-flow loops. Reset-on-show / stop-on-hide (the pile-up fix,
 * ai-engineer-f6pc) is ported so a flow-set off-slide does not auto-cycle in the
 * background — opening the slide resets to the first state and (re)starts.
 *
 * Provenance: ports FlowSetPlayer.vue. Reuses format/flowSet.js (resolve +
 * defaults + easings) and render/visibilityWiring.js (the vanilla gate) whole.
 */
import {
  isFlowSet,
  isFlowSetEnvelope,
  deserializeFlowSet,
  normalizeFlowSet,
  EASINGS,
} from '../format/flowSet.js'
import { observeVisibility } from './visibilityWiring.js'

// Inline styles (UnoCSS-safe inline-style convention; readable back under linkedom).
const ROOT_STYLE = 'position:relative;width:100%;height:100%;'
const SLOT_BASE_STYLE =
  'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
const SVG_FILL_STYLE = 'width:100%;height:100%;display:block;'

// The flow-set handle's update() is mode-locked, symmetric to the single-flow
// handle's assertSingleFlow: a single flow cannot be swapped into a flow-set
// renderer (different DOM + timeline). A kind switch is a remount.
// isFlowSet is the format-layer owner in ../format/flowSet.js.
function assertFlowSet(input, where) {
  if (!isFlowSet(input)) {
    throw new Error(`${where}: this is a flow-set renderer handle; a single flow cannot be swapped in via update(). Destroy and re-mount to switch modes.`)
  }
}

/**
 * Resolve the transparent flow-set union → a normalized, render-ready set.
 * Rejects a degenerate empty set with a clear error rather than letting the
 * scaffold crash on `states[0].flow` (FlowSetPlayer.vue tolerates 0 states via
 * its `v-if="states[slot.index]"`; the imperative scaffold needs state 0).
 */
function resolveFlowSet(input) {
  const raw = isFlowSetEnvelope(input) ? deserializeFlowSet(input) : input
  const set = normalizeFlowSet(raw)
  if (!Array.isArray(set.states) || set.states.length === 0) {
    throw new Error('mountFlowSet: flow-set has no states')
  }
  return set
}

/**
 * @param {Element} el — host element to mount the flow-set player into.
 * @param {object|string} setInput — a flow-set object or serialized envelope.
 * @param {object} opts
 * @param {Function} opts.mountFlow — REQUIRED nested single-flow renderer
 *   (injected by mountFlow when it delegates; a spy in unit tests). Avoids the
 *   mountFlow↔mountFlowSet import cycle.
 * @param {boolean} [opts.autoplay] — override the set's own autoplay.
 * @param {boolean} [opts.loop] — override the set's own loop.
 * @param {Document} [opts.document]
 * @param {(cb:Function)=>number} [opts.raf]
 * @param {(id:number)=>void} [opts.caf]
 * @param {Function} [opts.IntersectionObserver]
 * @param {object} [opts.visibilityDocument]
 * @returns {{update:Function, destroy:Function, play:Function, pause:Function,
 *   toggle:Function, next:Function, prev:Function, jumpTo:Function,
 *   playing:boolean, currentIndex:number}}
 */
export function mountFlowSet(el, setInput, opts = {}) {
  const mount = opts.mountFlow
  if (typeof mount !== 'function') {
    throw new Error(
      'mountFlowSet: requires opts.mountFlow — the nested single-flow renderer ' +
        'injected by mountFlow.',
    )
  }
  const doc = opts.document || el.ownerDocument

  // ── resolved set (re-resolved by update()) ──────────────────────────────────
  let set = resolveFlowSet(setInput)
  let states = set.states
  let transition = set.transition
  let easingFn = EASINGS[transition.easing] || EASINGS.linear

  // ── timeline state ──────────────────────────────────────────────────────────
  let active = 0 // index into `slots` of the currently-visible slot
  let phase = 'hold' // 'hold' | 'transition'
  let elapsed = 0 // ms into the current phase

  // ── DOM scaffold: root + two slot hosts, each a nested single-flow renderer ──
  const root = doc.createElement('div')
  root.setAttribute('class', 'flow-set-player')
  root.setAttribute('style', ROOT_STYLE)
  el.appendChild(root)

  function makeSlot(index) {
    const slotEl = doc.createElement('div')
    slotEl.setAttribute('class', 'fsp-slot')
    root.appendChild(slotEl)
    const renderer = mount(slotEl, states[index].flow, opts)
    return { el: slotEl, renderer, index }
  }
  // Two slots, both on state 0 (matches FlowSetPlayer's initial slots[0..1]=index 0).
  const slots = [makeSlot(0), makeSlot(0)]

  /** The state index the visible slot currently shows. */
  const currentIndex = () => slots[active].index

  // Crossfade opacity of the incoming (hidden) slot — 0 in hold, an eased ramp
  // during a transition. fadeT runs elapsed/durationMs through the set's easing.
  function fadeT() {
    if (phase !== 'transition') return 0
    const d = transition.durationMs || 1
    return easingFn(Math.min(1, elapsed / d))
  }
  function slotOpacity(i) {
    if (i === active) return 1
    return phase === 'transition' ? fadeT() : 0
  }
  function sizeSlotSvg(slot) {
    const svg = slot.el.querySelector('svg.flow-graph')
    if (svg && svg.setAttribute) svg.setAttribute('style', SVG_FILL_STYLE)
  }
  function applySlotStyles() {
    for (let i = 0; i < slots.length; i++) {
      const z = i === active ? 1 : 2
      slots[i].el.setAttribute(
        'style',
        `${SLOT_BASE_STYLE}opacity:${slotOpacity(i)};z-index:${z};`,
      )
      sizeSlotSvg(slots[i])
    }
  }
  applySlotStyles()

  // ── crossfade timeline (its own visibility-gated rAF loop) ───────────────────
  const raf = opts.raf || ((cb) => requestAnimationFrame(cb))
  const caf = opts.caf || ((id) => cancelAnimationFrame(id))
  let playing = false
  let timelineRafId = null
  let lastTs = 0

  function loopEnabled() {
    return opts.loop ?? set.loop
  }
  function nextIndex(from) {
    const n = states.length
    if (from + 1 < n) return from + 1
    return loopEnabled() ? 0 : -1
  }
  function prevIndex(from) {
    const n = states.length
    if (from - 1 >= 0) return from - 1
    return loopEnabled() ? n - 1 : -1
  }

  // Begin a crossfade from the active state to state `target`. Remounts ONLY the
  // hidden slot's nested renderer (FlowSetPlayer's slot re-key) — the visible
  // slot is untouched, so its particles keep running.
  function beginTransition(target) {
    if (phase === 'transition') return
    if (target < 0 || target >= states.length || target === currentIndex()) return
    const hidden = 1 - active
    slots[hidden].index = target
    slots[hidden].renderer.update(states[target].flow)
    sizeSlotSvg(slots[hidden])
    phase = 'transition'
    elapsed = 0
    applySlotStyles()
  }

  function finishTransition() {
    active = 1 - active
    phase = 'hold'
    elapsed = 0
    applySlotStyles()
  }

  // The outer timeline frame. Derives dt from the rAF timestamp (FlowSetPlayer's
  // tick): hold counts up to holdMs then crossfades to the next state;
  // transition counts up to durationMs then finishes. Reschedules every frame
  // (idle while !playing) so play()/pause() just gate advancement.
  function tick(ts) {
    const dt = lastTs ? ts - lastTs : 0
    lastTs = ts
    timelineRafId = raf(tick)
    if (!playing || states.length < 2) return
    elapsed += dt
    if (phase === 'hold') {
      if (elapsed >= transition.holdMs) {
        const target = nextIndex(currentIndex())
        if (target < 0) {
          playing = false // end of a non-looping set
          return
        }
        beginTransition(target)
      }
    } else if (phase === 'transition') {
      if (elapsed >= transition.durationMs) finishTransition()
      else applySlotStyles()
    }
  }

  // Reset the crossfade timeline to the first state (both slots remounted onto
  // state 0). The visibility-gate reset on every slide entry (the pile-up fix).
  function resetTimeline() {
    active = 0
    phase = 'hold'
    elapsed = 0
    for (const slot of slots) {
      slot.index = 0
      slot.renderer.update(states[0].flow)
      sizeSlotSvg(slot)
    }
    applySlotStyles()
  }

  function stopLoop() {
    if (timelineRafId != null) {
      caf(timelineRafId)
      timelineRafId = null
    }
    playing = false
  }

  function startFresh() {
    stopLoop()
    resetTimeline()
    playing = opts.autoplay ?? set.autoplay ?? true
    lastTs = 0
    timelineRafId = raf(tick)
  }

  // The outer gate observes the stable root (never swapped). onShow resets to
  // state 0 + (re)starts; onHide stops — so a flow-set off-slide does not
  // auto-cycle in the background. The nested per-slot renderers gate their own
  // particle sims independently through their own Phase-2a gates.
  const visibility = observeVisibility(
    root,
    { onShow: startFresh, onHide: stopLoop },
    { IntersectionObserver: opts.IntersectionObserver, document: opts.visibilityDocument },
  )

  return {
    /**
     * Swap the rendered flow-set. Re-resolves the new set, then resets onto its
     * state 0 (both slots remounted) — if it was running (visible) it restarts
     * fresh, else it stays idle until the next onShow. The two slot hosts +
     * nested renderers are reused (no leaked slots), mirroring how FlowEmbed
     * remounts a FlowSetPlayer on a flow-set identity change.
     */
    update(nextSet) {
      assertFlowSet(nextSet, 'mountFlowSet.update') // mode-lock before any mutation
      set = resolveFlowSet(nextSet)
      states = set.states
      transition = set.transition
      easingFn = EASINGS[transition.easing] || EASINGS.linear
      if (timelineRafId !== null) {
        startFresh() // was visible/running → restart fresh on the new set
      } else {
        stopLoop()
        resetTimeline() // idle → reset onto the new set's state 0
      }
    },
    destroy() {
      stopLoop()
      visibility.disconnect()
      for (const slot of slots) slot.renderer.destroy()
      if (root.parentNode) root.parentNode.removeChild(root)
    },
    /**
     * Live-tune the running transition WITHOUT a reset or remount. Merges
     * `nextTransition` into the closure `transition` and recomputes `easingFn`
     * in place — the next tick() naturally reads the new holdMs/durationMs and
     * fadeT() the new easingFn. Does NOT touch active / phase / elapsed / the
     * slots / the rAF loop.
     *
     * This is what the designer's set-preview sliders drive: update() would
     * deep-re-resolve and reset the timeline (jarring on every slider tick),
     * so transition tuning gets its own no-reset path. (Geometry / topology
     * still change only via update().)
     */
    setTransition(nextTransition) {
      transition = { ...transition, ...nextTransition }
      easingFn = EASINGS[transition.easing] || EASINGS.linear
    },
    // ── manual controls (the designer set-preview drives these) ──────────────
    play() {
      playing = true
    },
    pause() {
      playing = false
    },
    toggle() {
      playing = !playing
    },
    next() {
      if (phase === 'hold') beginTransition(nextIndex(currentIndex()))
    },
    prev() {
      if (phase === 'hold') beginTransition(prevIndex(currentIndex()))
    },
    /** Jump straight to a state with no crossfade — remounts the active slot. */
    jumpTo(index) {
      if (index < 0 || index >= states.length) return
      phase = 'hold'
      elapsed = 0
      slots[active].index = index
      slots[active].renderer.update(states[index].flow)
      sizeSlotSvg(slots[active])
      applySlotStyles()
    },
    get playing() {
      return playing
    },
    get currentIndex() {
      return currentIndex()
    },
  }
}
