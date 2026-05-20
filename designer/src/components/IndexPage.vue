<!--
  IndexPage.vue — the designer's landing page (bd ai-engineer-2fcm).

  The app's MAIN page: a directory of the flow-sets and flows on disk, served
  by the flow-store dev-server plugin. Pick a flow to open it in the editor;
  create new sets and flows here. See
  docs/superpowers/specs/2026-05-20-flow-persistence-design.md §2.6.
-->
<script setup>
import { onMounted } from 'vue'
import { useFlowDoc } from '../state/useFlowDoc.js'
import { useFlowStore } from '../state/flowStore.js'
import { useFlowSetPreview } from '../state/useFlowSetPreview.js'

const doc = useFlowDoc()
const store = useFlowStore()
const preview = useFlowSetPreview()
const { state } = store

onMounted(() => store.refreshIndex())

async function newSet() {
  const title = window.prompt('New flow-set name:')
  if (!title) return
  try {
    await store.createSet(title)
    await store.refreshIndex()
  } catch (err) {
    window.alert(`Could not create set: ${err.message || err}`)
  }
}

async function newFlow(set) {
  const title = window.prompt(`New flow in “${set.title}”:`)
  if (!title) return
  try {
    await doc.createFlow(set.id, title, set.flows.map((f) => f.slug))
  } catch (err) {
    window.alert(`Could not create flow: ${err.message || err}`)
  }
}

async function open(flow) {
  try {
    await doc.openFlow(flow.id, flow.title)
  } catch (err) {
    window.alert(`Could not open flow: ${err.message || err}`)
  }
}

/** Open the M4 animated-transition preview for a whole flow-set. */
async function previewSet(set) {
  doc.goToSetPreview()
  try {
    await preview.load(set)
  } catch (err) {
    window.alert(`Could not preview set: ${err.message || err}`)
  }
}

async function removeFlow(flow) {
  if (!window.confirm(`Delete “${flow.title}”? This cannot be undone.`)) return
  try {
    await store.deleteFlow(flow.id)
    await store.refreshIndex()
  } catch (err) {
    window.alert(`Could not delete flow: ${err.message || err}`)
  }
}
</script>

<template>
  <div class="index-page">
    <header class="ix-head">
      <h1>Flow Designer</h1>
      <p class="ix-sub">
        A directory of flow-sets, persisted to <code>flow/flows/</code>. Pick a
        flow to edit — every change auto-saves.
      </p>
      <button class="ix-btn primary" @click="newSet">+ New flow-set</button>
    </header>

    <p v-if="state.loading" class="ix-note">Loading index…</p>
    <p v-if="state.error" class="ix-note ix-error">
      Persistence API unavailable — {{ state.error }}.
      The directory-of-files store needs the designer running on <code>vite dev</code>.
    </p>

    <p
      v-if="state.index && state.index.sets.length === 0 && !state.loading"
      class="ix-note"
    >
      No flow-sets yet. Create one to start authoring.
    </p>

    <section v-for="set in state.index?.sets || []" :key="set.id" class="ix-set">
      <div class="ix-set-head">
        <h2>{{ set.title }}</h2>
        <span class="ix-slug">{{ set.id }}</span>
        <button
          v-if="set.flows.length"
          class="ix-btn ix-preview"
          @click="previewSet(set)"
        >▶ Preview</button>
        <button class="ix-btn" @click="newFlow(set)">+ New flow</button>
      </div>
      <p v-if="set.flows.length === 0" class="ix-empty">No flows in this set yet.</p>
      <ul v-else class="ix-flows">
        <li v-for="flow in set.flows" :key="flow.id" class="ix-flow">
          <button class="ix-flow-open" @click="open(flow)">
            <span class="ix-flow-title">{{ flow.title }}</span>
            <span class="ix-flow-meta">
              {{ flow.nodeCount }} node{{ flow.nodeCount === 1 ? '' : 's' }}
              · <code>{{ flow.id }}</code>
            </span>
          </button>
          <button class="ix-flow-del" title="delete flow" @click="removeFlow(flow)">
            ✕
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.index-page {
  height: 100%;
  overflow: auto;
  padding: 32px 40px 64px;
  background: #f4f1e8;
  box-sizing: border-box;
}
.ix-head h1 {
  font: 700 28px/1.1 'ET Book', Georgia, serif;
  margin: 0 0 6px;
}
.ix-sub {
  margin: 0 0 14px;
  color: #5a554a;
  font-size: 14px;
  max-width: 60ch;
}
.ix-note {
  font-size: 14px;
  color: #5a554a;
}
.ix-error {
  color: #b91c1c;
}
.ix-set {
  margin-top: 26px;
  border-top: 1px solid #d8d3c6;
  padding-top: 14px;
}
.ix-set-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.ix-set-head h2 {
  font: 600 18px/1 ui-sans-serif, system-ui, sans-serif;
  margin: 0;
}
.ix-slug {
  font: 12px/1 ui-monospace, monospace;
  color: #8a8474;
}
.ix-empty {
  color: #8a8474;
  font-size: 13px;
  margin: 8px 0 0;
}
.ix-flows {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.ix-flow {
  display: flex;
  background: #fff;
  border: 1px solid #d8d3c6;
  border-radius: 7px;
  overflow: hidden;
}
.ix-flow-open {
  flex: 1;
  text-align: left;
  padding: 12px 14px;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ix-flow-open:hover {
  background: #f0ede3;
}
.ix-flow-title {
  font: 600 15px/1.2 ui-sans-serif, system-ui, sans-serif;
  color: #15171a;
}
.ix-flow-meta {
  font-size: 12px;
  color: #8a8474;
}
.ix-flow-del {
  border: none;
  border-left: 1px solid #e2ded3;
  background: #fbfaf6;
  color: #b91c1c;
  cursor: pointer;
  padding: 0 12px;
  font-size: 13px;
}
.ix-flow-del:hover {
  background: #fdeaea;
}
.ix-btn {
  padding: 6px 13px;
  font: 13px/1 ui-sans-serif, system-ui, sans-serif;
  background: #2a2d31;
  color: #f1efe9;
  border: 1px solid #2a2d31;
  border-radius: 5px;
  cursor: pointer;
}
.ix-btn:hover {
  background: #34373c;
}
.ix-btn.primary {
  background: #16a34a;
  border-color: #16a34a;
}
.ix-set-head .ix-btn:first-of-type {
  margin-left: auto;
}
.ix-set-head .ix-btn + .ix-btn {
  margin-left: 6px;
}
.ix-preview {
  background: #1d4ed8;
  border-color: #1d4ed8;
}
.ix-preview:hover {
  background: #2563eb;
}
code {
  font: 11px/1 ui-monospace, monospace;
}
</style>
