<!--
  Toolbar.vue — tool selection + document actions.

  Tools drive the editor canvas's interaction model (select / add-node /
  add-edge). The Snap toggle enables the optional snap-to-grid mode (off by
  default — bd ai-engineer-esx8). Export serialises the authored flow to a
  .flow.json envelope via the library; import deserialises one back (v1
  exports migrate forward for free). See M3 spec §2.6.
-->
<script setup>
import { ref, computed } from 'vue'
import { useFlowDoc } from '../state/useFlowDoc.js'

const doc = useFlowDoc()
const fileInput = ref(null)

// Save-state chip — reflects the auto-save lifecycle (bd ai-engineer-2fcm).
const SAVE_LABEL = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed — click to retry',
}
const saveLabel = computed(() => SAVE_LABEL[doc.state.saveState] || '')

const TOOLS = [
  { id: 'select', label: 'Select', hint: 'select / drag nodes & labels' },
  { id: 'add-node', label: '+ Node', hint: 'click canvas to place a node' },
  { id: 'add-edge', label: '+ Edge', hint: 'click a source node then a target' },
]

function exportFlow() {
  const text = doc.exportFlow()
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'designer.flow.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  fileInput.value?.click()
}

async function onFileChosen(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    doc.importFlow(text)
  } catch (err) {
    // eslint-disable-next-line no-alert
    window.alert(`Import failed: ${err.message || err}`)
  } finally {
    e.target.value = ''
  }
}
</script>

<template>
  <div class="toolbar">
    <button class="tb-btn" title="back to the flow index" @click="doc.goToIndex()">
      ← Index
    </button>
    <span class="tb-brand">{{ doc.state.title || 'Flow Designer' }}</span>

    <span
      v-if="doc.state.currentId"
      class="tb-save"
      :class="doc.state.saveState"
      :title="doc.state.currentId"
      @click="doc.saveNow()"
    >{{ saveLabel }}</span>

    <div class="tb-group">
      <button
        v-for="t in TOOLS"
        :key="t.id"
        class="tb-btn"
        :class="{ active: doc.state.tool === t.id }"
        :title="t.hint"
        @click="doc.setTool(t.id)"
      >{{ t.label }}</button>
    </div>

    <div class="tb-group">
      <button
        class="tb-btn"
        :class="{ active: doc.state.snapToGrid }"
        title="snap node placement to a grid (optional, off by default)"
        @click="doc.toggleSnap()"
      >Snap{{ doc.state.snapToGrid ? ' ✓' : '' }}</button>
    </div>

    <div class="tb-spacer" />

    <div class="tb-group">
      <button class="tb-btn" title="import a .flow.json file" @click="triggerImport">
        Import
      </button>
      <button class="tb-btn primary" title="export this flow" @click="exportFlow">
        Export
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="tb-file"
        @change="onFileChosen"
      />
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #15171a;
  color: #f1efe9;
}
.tb-brand {
  font: 700 15px/1 'ET Book', Georgia, serif;
  letter-spacing: 0.02em;
}
.tb-group {
  display: flex;
  gap: 4px;
}
.tb-spacer {
  flex: 1;
}
.tb-save {
  font: 12px/1 ui-sans-serif, system-ui, sans-serif;
  padding: 4px 9px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}
.tb-save.saved {
  color: #4ade80;
}
.tb-save.saving {
  color: #cbd5e1;
}
.tb-save.dirty {
  color: #fbbf24;
}
.tb-save.error {
  color: #fff;
  background: #b91c1c;
}
.tb-btn {
  padding: 5px 12px;
  font: 13px/1 ui-sans-serif, system-ui, sans-serif;
  color: #d8d5cc;
  background: #2a2d31;
  border: 1px solid #3a3d42;
  border-radius: 5px;
  cursor: pointer;
}
.tb-btn:hover {
  background: #34373c;
}
.tb-btn.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.tb-btn.primary {
  background: #16a34a;
  border-color: #16a34a;
  color: #fff;
}
.tb-file {
  display: none;
}
</style>
