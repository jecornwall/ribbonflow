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
  The single-flow forms render through <FlowGraph>; a flow-set plays through
  <FlowSetPlayer>. The slide does not have to know which it handed in.

  M1 scope: a clean pass-through to the copied core renderer. M4 (bd
  ai-engineer-nawa): flow-set playback added — see
  docs/superpowers/specs/2026-05-20-flow-M4-design.md §2.5. The deck is NOT
  swapped onto this component until M5.
-->
<script setup>
import { computed, ref, watch } from 'vue'
import FlowGraph from '../core/FlowGraph.vue'
import FlowSetPlayer from './FlowSetPlayer.vue'
import { normalizeFlowInput } from '../format/index.js'
import { isFlowSetEnvelope, deserializeFlowSet } from '../format/flowSet.js'

const props = defineProps({
  // A flow object / serialized flow, OR a flow-set / serialized flow-set.
  flow: { type: [Object, String], required: true },
  // Surface the one read-only display knob the core renderer exposes.
  // Pure cosmetics stay library defaults (charter: out of scope for v1).
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

// Resolve whatever the slide handed us into { kind, value } exactly once.
const resolved = computed(() => {
  const f = props.flow
  if (isFlowSetEnvelope(f)) {
    return { kind: 'flow-set', value: deserializeFlowSet(f) }
  }
  if (isRawFlowSet(f)) {
    return { kind: 'flow-set', value: f }
  }
  return { kind: 'flow', value: normalizeFlowInput(f) }
})

// Remount key (bd ai-engineer-5ws4). <FlowGraph> builds its branches / widths /
// simulation ONCE at setup — deterministic geometry it deliberately does NOT
// rebuild on a `flow` prop change (see FlowGraph.vue §buildSim). That holds
// while a slide keeps one flow per <FlowEmbed>, but the deck's click idiom
// swaps the `flow` prop on a SINGLE embed (`$clicks > 0 ? after : before` —
// S4/S5/S11/S12). Without a remount FlowGraph keeps the previous flow's
// topology: a width-only swap renders stale geometry, and a topology swap
// (solo→team) throws on a stale node id. Bumping a key whenever the input
// flow identity changes remounts the child with a clean build, so a slide
// never has to remember its own `:key`.
const remountKey = ref(0)
watch(() => props.flow, () => { remountKey.value++ })
</script>

<template>
  <FlowSetPlayer
    v-if="resolved.kind === 'flow-set'"
    :key="remountKey"
    :flow-set="resolved.value"
  />
  <FlowGraph
    v-else
    :key="remountKey"
    :flow="resolved.value"
    :show-metrics="showMetrics"
  />
</template>
