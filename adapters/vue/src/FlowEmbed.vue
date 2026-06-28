<!--
  FlowEmbed.vue — @ribbonflow/vue. The Vue slide face of the flow library.

  A thin <script setup> shell over ribbonflow's
  mountFlowAuto: mount on init, update() on flow-prop swap, destroy() on
  unmount. The kind-switch remount (single ↔ flow-set) and the visibility-gated
  rAF loop live in the library; this component only wires lifecycle. Public
  surface (flow, showMetrics) matches the Phase 2 embed so the deck/site
  wrappers barely change. Becomes @ribbonflow/vue at the repo split.
-->
<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { mountFlowAuto } from 'ribbonflow'

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
  <!--
    Sizing is INLINE (not a scoped <style>) on purpose: a Vite lib build extracts
    SFC <style> into a separate dist/index.css that consumers don't auto-import,
    which silently collapsed the embed to 0×0 (flows invisible) after the repo
    split. The container fills its host here; the svg fills the container via
    mountFlow's inline SVG_FILL_STYLE — so @ribbonflow/vue needs no CSS file.
  -->
  <div ref="rootEl" class="flow-embed" style="width: 100%; height: 100%;"></div>
</template>
