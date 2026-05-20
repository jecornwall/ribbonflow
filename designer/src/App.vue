<!--
  App.vue — designer shell + layout.

  Three-zone layout (M3 spec §3.2): the toolbar on top; below it the editing
  column (canvas + inspector) beside the live preview; a validation status
  strip along the bottom. Global keyboard: Delete removes the selection,
  Escape cancels a pending edge.
-->
<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { useFlowDoc } from './state/useFlowDoc.js'
import Toolbar from './components/Toolbar.vue'
import EditorCanvas from './components/EditorCanvas.vue'
import InspectorPanel from './components/InspectorPanel.vue'
import PreviewPane from './components/PreviewPane.vue'
import StatusStrip from './components/StatusStrip.vue'

const doc = useFlowDoc()

function onKeydown(e) {
  // Ignore when typing into a form control.
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    doc.deleteSelection()
  } else if (e.key === 'Escape') {
    doc.cancelPendingEdge()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <Toolbar />
    <div class="app-body">
      <div class="edit-col">
        <div class="canvas-zone">
          <EditorCanvas />
        </div>
        <div class="inspector-zone">
          <InspectorPanel />
        </div>
      </div>
      <div class="preview-col">
        <PreviewPane />
      </div>
    </div>
    <StatusStrip />
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #15171a;
}
.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.edit-col {
  flex: 1.1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #d8d3c6;
}
.canvas-zone {
  flex: 1.4;
  min-height: 0;
}
.inspector-zone {
  flex: 1;
  min-height: 0;
  border-top: 1px solid #e2ded3;
}
.preview-col {
  flex: 1;
  min-width: 0;
}
</style>
