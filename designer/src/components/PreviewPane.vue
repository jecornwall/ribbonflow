<!--
  PreviewPane.vue — the live preview.

  Renders the flow under edit through the REAL library renderer (FlowGraph,
  imported from @flow-designer/library/internals). This is the M1 package
  boundary proven in anger: "see what it looks like" is the actual library
  component a slide would use, animating, not an approximation (M3 §2.2).

  It consumes `doc.normalized` — the authored flow with library defaults
  applied — so the preview sees exactly what a normalized consumer sees.
  `previewKey` remounts the simulation cleanly on structural edits.
-->
<script setup>
import { useFlowDoc } from '../state/useFlowDoc.js'
import { FlowGraph } from '@flow-designer/library/internals'

const doc = useFlowDoc()
</script>

<template>
  <div class="preview-pane">
    <div class="pp-header">Live preview — rendered through @flow-designer/library</div>
    <div class="pp-stage">
      <FlowGraph
        :key="doc.state.previewKey"
        :flow="doc.normalized.value"
      />
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
.pp-stage :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
