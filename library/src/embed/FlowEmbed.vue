<!--
  FlowEmbed.vue — the SLIDE FACE of the flow library.

  This is the small, deliberately-abstracted public component. A slide drops
  in <FlowEmbed :flow="..." /> and knows nothing of the flow format internals,
  the simulation engine, or the curve maths. Slides only ever READ a flow.

  It is the asymmetric counterpart to the internals API (src/internals.js),
  which is broad and lets the designer manipulate everything. Slide code must
  never reach past FlowEmbed into the internals — if it needs to, the boundary
  is wrong and the library should grow a prop here instead.

  The `flow` prop accepts either form transparently:
    - a plain flow object (the shape the current deck passes today), or
    - a serialized flow — the JSON envelope string OR a parsed envelope object
      produced by the library's format layer (serializeFlow).
  normalizeFlowInput() hides the distinction; the slide does not care.

  M1 scope: a clean pass-through to the copied core renderer. No behaviour
  change. The deck is NOT swapped onto this component until M5.
-->
<script setup>
import { computed } from 'vue'
import FlowGraph from '../core/FlowGraph.vue'
import { normalizeFlowInput } from '../format/index.js'

const props = defineProps({
  // A flow object, or a serialized flow (envelope string / parsed envelope).
  flow: { type: [Object, String], required: true },
  // Surface the one read-only display knob the core renderer exposes.
  // Pure cosmetics stay library defaults (charter: out of scope for v1).
  showMetrics: { type: Boolean, default: false },
})

// Resolve whatever the slide handed us into a live flow object exactly once.
const resolvedFlow = computed(() => normalizeFlowInput(props.flow))
</script>

<template>
  <FlowGraph :flow="resolvedFlow" :show-metrics="showMetrics" />
</template>
