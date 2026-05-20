<!--
  FlowSetPlayer.vue — plays a FLOW-SET.

  A flow-set is an ordered list of flow states that share topology, with
  transition metadata. This component animates between them on a
  hold → transition → hold … timeline (M4 spec §2.4).

  TRANSITION MECHANISM — v1 crossfade. The outgoing and incoming states each
  render through the real library <FlowGraph> (their own running simulation);
  the transition is an opacity crossfade eased by the flow-set's
  `transition.easing`. A geometry morph (interpolateFlow per frame) is a
  tracked follow-up — it needs FlowGraph's geometry to be reactive (M4 §2.4).

  Two render slots alternate so the *visible* graph is never remounted: a
  transition mounts the next state into the hidden slot and fades it in; on
  completion that slot simply becomes the active one. Only the slot receiving
  a NEW state ever remounts — the running one keeps its particles.

  Slide-facing: <FlowEmbed> delegates here when handed a flow-set. The designer
  drives it directly off the /internals face for the set-preview.
-->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import FlowGraph from '../core/FlowGraph.vue'
import { normalizeFlowSet, EASINGS } from '../format/flowSet.js'

const props = defineProps({
  // A flow-set object (raw or normalized — normalizeFlowSet is idempotent-safe).
  flowSet: { type: Object, required: true },
  // Optional overrides of the flow-set's own autoplay / loop.
  autoplay: { type: Boolean, default: undefined },
  loop: { type: Boolean, default: undefined },
})

const set = computed(() => normalizeFlowSet(props.flowSet))
const states = computed(() => set.value.states)
const transition = computed(() => set.value.transition)
const easingFn = computed(() => EASINGS[transition.value.easing] || EASINGS.linear)
const loopEnabled = computed(() => props.loop ?? set.value.loop)

// ── timeline state ───────────────────────────────────────────────────────────
// Two slots so the visible graph is never remounted. `slots[active]` is the
// state currently shown; during a transition `slots[1-active]` holds the
// incoming state and fades in over it.
const slots = ref([
  { key: 'slot-a', index: 0 },
  { key: 'slot-b', index: 0 },
])
const active = ref(0)
const phase = ref('hold') // 'hold' | 'transition'
const elapsed = ref(0) // ms into the current phase
const playing = ref(false)

const currentIndex = computed(() => slots.value[active.value].index)
const incomingIndex = computed(() => slots.value[1 - active.value].index)

/** Crossfade opacity of the incoming slot — 0 in hold, eased ramp in transition. */
const fadeT = computed(() => {
  if (phase.value !== 'transition') return 0
  const d = transition.value.durationMs || 1
  return easingFn.value(Math.min(1, elapsed.value / d))
})

function slotOpacity(slotIdx) {
  if (slotIdx === active.value) return 1
  return phase.value === 'transition' ? fadeT.value : 0
}
function slotVisible(slotIdx) {
  return slotIdx === active.value || phase.value === 'transition'
}

// ── transition control ───────────────────────────────────────────────────────
function nextIndex(from) {
  const n = states.value.length
  if (from + 1 < n) return from + 1
  return loopEnabled.value ? 0 : -1
}
function prevIndex(from) {
  const n = states.value.length
  if (from - 1 >= 0) return from - 1
  return loopEnabled.value ? n - 1 : -1
}

/** Begin a crossfade from the active state to state `target`. */
function beginTransition(target) {
  if (phase.value === 'transition') return
  if (target < 0 || target >= states.value.length || target === currentIndex.value) return
  const hidden = 1 - active.value
  // Re-key the hidden slot so its FlowGraph remounts onto the incoming state.
  slots.value[hidden] = { key: `slot-${slotSeq++}`, index: target }
  phase.value = 'transition'
  elapsed.value = 0
}

function finishTransition() {
  active.value = 1 - active.value
  phase.value = 'hold'
  elapsed.value = 0
}

let slotSeq = 2

// ── public manual controls (the designer set-preview drives these) ───────────
function play() { playing.value = true }
function pause() { playing.value = false }
function toggle() { playing.value = !playing.value }
function next() { if (phase.value === 'hold') beginTransition(nextIndex(currentIndex.value)) }
function prev() { if (phase.value === 'hold') beginTransition(prevIndex(currentIndex.value)) }
/** Jump straight to a state with no crossfade (used by the scrub controls). */
function jumpTo(index) {
  if (index < 0 || index >= states.value.length) return
  phase.value = 'hold'
  elapsed.value = 0
  slots.value[active.value] = { key: `slot-${slotSeq++}`, index }
}
defineExpose({ play, pause, toggle, next, prev, jumpTo, playing, currentIndex })

// ── RAF timeline driver ──────────────────────────────────────────────────────
let rafId = null
let lastTs = 0

function tick(ts) {
  const dt = lastTs ? ts - lastTs : 0
  lastTs = ts
  rafId = requestAnimationFrame(tick)

  if (!playing.value || states.value.length < 2) return
  elapsed.value += dt

  if (phase.value === 'hold') {
    if (elapsed.value >= transition.value.holdMs) {
      const target = nextIndex(currentIndex.value)
      if (target < 0) { playing.value = false; return } // end of a non-looping set
      beginTransition(target)
    }
  } else if (phase.value === 'transition') {
    if (elapsed.value >= transition.value.durationMs) {
      finishTransition()
    }
  }
}

onMounted(() => {
  playing.value = props.autoplay ?? set.value.autoplay ?? true
  lastTs = 0
  rafId = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  if (rafId != null) cancelAnimationFrame(rafId)
})

// A fresh flow-set resets the timeline to the first state.
watch(
  () => props.flowSet,
  () => {
    slots.value = [
      { key: `slot-${slotSeq++}`, index: 0 },
      { key: `slot-${slotSeq++}`, index: 0 },
    ]
    active.value = 0
    phase.value = 'hold'
    elapsed.value = 0
  },
)
</script>

<template>
  <div class="flow-set-player">
    <div
      v-for="(slot, i) in slots"
      :key="slot.key"
      class="fsp-slot"
      :style="{ opacity: slotOpacity(i), zIndex: i === active ? 1 : 2 }"
    >
      <FlowGraph
        v-if="slotVisible(i) && states[slot.index]"
        :key="slot.key"
        :flow="states[slot.index].flow"
      />
    </div>
  </div>
</template>

<style scoped>
.flow-set-player {
  position: relative;
  width: 100%;
  height: 100%;
}
.fsp-slot {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fsp-slot :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
