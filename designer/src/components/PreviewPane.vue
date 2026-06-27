<!--
  PreviewPane.vue — the live preview.

  Renders the flow under edit through the REAL library renderer — the imperative
  mountFlow renderer (imported from @flow-designer/library/internals). This is
  the M1 package boundary proven in anger: "see what it looks like" is the actual
  renderer a slide would use, animating, not an approximation (M3 §2.2). Phase A
  (bd ai-engineer-cr1x) swapped the Vue <FlowGraph> for mountFlow so the designer
  rides the same imperative renderer the deck/site embeds do.

  It consumes `doc.previewFlow` — the normalized flow with each segment label
  anchored at its node's xy (bd ai-engineer-t173), so a label tracks its
  segment when the node is moved.

  CADENCE (preserved from the prior `:key="previewKey"` remount): `previewKey`
  bumps only on COMMITTED edits — structural edits, a drag on drop, an inspector
  field on change. Live drags/sliders mutate `state.flow` WITHOUT bumping. So we
  watch `previewKey` (NOT `previewFlow` deeply) and call `handle.update()` on each
  bump — a clean simulation rebuild on commit, no rebuild mid-drag.
-->
<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { mountFlow } from '@flow-designer/library/internals'
import { useFlowDoc } from '../state/useFlowDoc.js'

const doc = useFlowDoc()

const host = ref(null)
let handle = null

onMounted(() => {
  handle = mountFlow(host.value, doc.previewFlow.value)
})
// Rebuild the sim on every COMMITTED edit. Watching previewKey (not previewFlow)
// keeps the rebuild on commit only — watching previewFlow would rebuild the sim
// every drag-frame, a regression. update() reads the CURRENT previewFlow.
watch(
  () => doc.state.previewKey,
  () => {
    if (handle) handle.update(doc.previewFlow.value)
  },
)
onBeforeUnmount(() => {
  if (handle) handle.destroy()
  handle = null
})
</script>

<template>
  <div class="preview-pane">
    <div class="pp-header">Live preview — rendered through @flow-designer/library</div>
    <div class="pp-stage">
      <div ref="host" class="pp-host"></div>
    </div>
  </div>
</template>

<style scoped>
.preview-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fbfaf7;
}
.pp-header {
  padding: 6px 12px;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #6b7280;
  background: #f1efe9;
  border-bottom: 1px solid #e2ded3;
}
.pp-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.pp-host {
  width: 100%;
  height: 100%;
}
.pp-stage :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
