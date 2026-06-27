<!--
  FlowEmbed.vue — the SLIDE FACE of the flow library.

  This is the small, deliberately-abstracted public component. A slide drops
  in <FlowEmbed :flow="..." /> and knows nothing of the flow format internals,
  the simulation engine, or the curve maths. Slides only ever READ a flow.

  It is the asymmetric counterpart to the internals API (src/internals.js),
  which is broad and lets the designer manipulate everything. Slide code must
  never reach past FlowEmbed into the internals — if it needs to, the boundary
  is wrong and the library should grow a prop here instead.

  The `flow` prop accepts any of these transparently:
    - a plain flow object (the shape the current deck passes today),
    - a serialized single flow — the JSON envelope string OR a parsed object,
    - a flow-SET — an ordered set of flow states with animated transitions,
      again either a flow-set object or a serialized flow-set envelope.
  The slide does not have to know which it handed in: mountFlow resolves the
  input (migrate + normalize, Finding-0) and routes a single flow to the scene
  renderer and a flow-set to mountFlowSet's crossfade player.

  Phase 2d (ribbonflow, bd ai-engineer-bu5t): this is now a THIN Vue wrapper
  around the framework-free imperative renderer `mountFlow` — the deck's slide
  face renders through the new engine. The legacy Vue FlowGraph / FlowSetPlayer
  remain in the library (the designer's PreviewPane / SetPreview still consume
  them via /internals) but are off the slide path. mountFlow owns input
  resolution, the visibility-gated rAF loop, and the remount-on-identity rebuild.
-->
<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { mountFlow } from '../render/mountFlow.js'
import { isFlowSetEnvelope } from '../format/flowSet.js'

const props = defineProps({
  // A flow object / serialized flow, OR a flow-set / serialized flow-set.
  flow: { type: [Object, String], required: true },
  // Surface the one read-only display knob the renderer exposes. Pure cosmetics
  // stay library defaults (charter: out of scope for v1).
  showMetrics: { type: Boolean, default: false },
})

// A raw flow-set object (no envelope) — `states` array, no `formatVersion`.
function isRawFlowSet(input) {
  return (
    input != null &&
    typeof input === 'object' &&
    typeof input.formatVersion !== 'number' &&
    Array.isArray(input.states)
  )
}
// Which face of the transparent union an input is — single flow vs flow-set.
// Used ONLY to decide update() (same kind, in-place) vs remount (kind switch).
const isFlowSet = (input) => isFlowSetEnvelope(input) || isRawFlowSet(input)

const rootEl = ref(null)
let handle = null
let mountedIsSet = false

function mount(flow) {
  mountedIsSet = isFlowSet(flow)
  handle = mountFlow(rootEl.value, flow, { showMetrics: props.showMetrics })
}

onMounted(() => mount(props.flow))

// The deck's click idiom swaps the WHOLE `flow` prop to a different imported
// object (`:flow="$clicks > 0 ? after : before"` — S4/S5/S11/S12, S6's state
// walk). On that identity change, handle.update() re-runs buildFlowScene and
// rebuilds the static scene wholesale (the faithful match for the old
// remount-on-identity key bump), keeping the ONE visibility observer over the
// stable host el so the gate survives the svg swap. If the input changes KIND
// (single ↔ flow-set — the transparent union across renders), update() is
// mode-locked, so we destroy + re-mount instead, exactly as the old key bump
// remounted the child regardless of kind. (No deck slide changes kind; this
// preserves the documented contract for other consumers.)
watch(
  () => props.flow,
  (next) => {
    if (!handle) return
    if (isFlowSet(next) === mountedIsSet) {
      handle.update(next)
    } else {
      handle.destroy()
      mount(next)
    }
  },
)

onBeforeUnmount(() => {
  if (handle) handle.destroy()
  handle = null
})
</script>

<template>
  <div ref="rootEl" class="flow-embed"></div>
</template>

<style scoped>
.flow-embed {
  width: 100%;
  height: 100%;
}
.flow-embed :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
