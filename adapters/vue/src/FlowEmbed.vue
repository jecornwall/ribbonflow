<!--
  FlowEmbed.vue — @flow-designer/vue. The Vue slide face of the flow library.

  A thin <script setup> shell over @flow-designer/library/render's
  mountFlowAuto: mount on init, update() on flow-prop swap, destroy() on
  unmount. The kind-switch remount (single ↔ flow-set) and the visibility-gated
  rAF loop live in the library; this component only wires lifecycle. Public
  surface (flow, showMetrics) matches the Phase 2 embed so the deck/site
  wrappers barely change. Becomes @ribbonflow/vue at the repo split.
-->
<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { mountFlowAuto } from '@flow-designer/library/render'

const props = defineProps({
  flow: { type: [Object, String], required: true },
  showMetrics: { type: Boolean, default: false },
})

const rootEl = ref(null)
let handle = null

onMounted(() => {
  handle = mountFlowAuto(rootEl.value, props.flow, { showMetrics: props.showMetrics })
})

// The deck's click idiom swaps the WHOLE `flow` prop (S4/S5/S11/S12). On that
// identity change, mountFlowAuto.update() rebuilds the scene (same kind) or
// remounts (kind switch) — the controller decides.
watch(
  () => props.flow,
  (next) => { if (handle) handle.update(next) },
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
.flow-embed { width: 100%; height: 100%; }
.flow-embed :deep(svg) { width: 100%; height: 100%; }
</style>
