<!--
  ParityApp.vue — M5 parity harness (bd ai-engineer-h6sn).

  Imports every deck flow definition (deck/flows/*.js) and renders it through
  the NEW shared library's slide face, <FlowEmbed>. The deck flows are all
  format v1 (top-level entryId / spawnRate, capacity / latency nodes); the
  library reads v3, so each flow is run through migrateFlow(flow, 1) first —
  exactly the forward-port deserializeFlow() applies to an older export.

  URL contract (the Playwright capture drives these):
    /                       → index: every flow case, one per row
    /?flow=<key>            → a single case, full-bleed, for a clean capture
-->
<script setup>
import { computed } from 'vue'
import { FlowEmbed } from '@flow-designer/library'
import { migrateFlow, normalizeFlow } from '@flow-designer/library/internals'

// Every deck flow definition. Eager glob — deck/flows/*.js are plain data
// modules (export default <flow> | <flow[]>), no Vue, safe to import.
const modules = import.meta.glob('../../../deck/flows/*.js', { eager: true })

// Flatten into an ordered list of { key, source }. n4-year-walk exports an
// ARRAY of three frozen states; each becomes its own case.
const rawCases = []
for (const path of Object.keys(modules).sort()) {
  const name = path.split('/').pop().replace(/\.js$/, '')
  const def = modules[path].default
  if (Array.isArray(def)) {
    def.forEach((flow, i) => rawCases.push({ key: `${name}#${i}`, source: flow }))
  } else {
    rawCases.push({ key: name, source: def })
  }
}

// Migrate each v1 flow forward to v3, then normalizeFlow() (default-fill +
// engine-field derivation) so the flow is render-ready. <FlowEmbed> itself
// does NOT normalize a bare flow object (normalizeFlowInput passes it through
// untouched) — a documented M5 parity gap — so the harness does it explicitly,
// mirroring what the M5 swap will have to arrange. Capture failures per-case
// rather than crashing the harness — a failed case is itself a parity finding.
const cases = rawCases.map(({ key, source }) => {
  try {
    const flow = normalizeFlow(migrateFlow(source, 1))
    return { key, flow, error: null }
  } catch (err) {
    return { key, flow: null, error: String((err && err.message) || err) }
  }
})

const selectedKey = computed(() => new URLSearchParams(location.search).get('flow'))
const selected = computed(() =>
  selectedKey.value ? cases.find(c => c.key === selectedKey.value) : null,
)
</script>

<template>
  <!-- Single-case view: clean, full-bleed, for a Playwright capture. -->
  <div v-if="selected" class="case-solo">
    <div class="case-label">{{ selected.key }} · via @flow-designer/library &lt;FlowEmbed&gt; (v1→v3 migrated)</div>
    <div v-if="selected.error" class="case-error">migration failed: {{ selected.error }}</div>
    <div v-else class="case-stage">
      <FlowEmbed :flow="selected.flow" />
    </div>
  </div>

  <!-- Index view: every case stacked. -->
  <div v-else class="index">
    <h1>Flow M5 parity harness — {{ cases.length }} deck flow cases via the new library</h1>
    <p class="note">
      Each deck flow (format v1) migrated v1→v3 and rendered through
      <code>&lt;FlowEmbed&gt;</code>. Open <code>/?flow=&lt;key&gt;</code> for a solo capture.
    </p>
    <div v-for="c in cases" :key="c.key" class="case-row">
      <div class="case-label">
        <a :href="`/?flow=${encodeURIComponent(c.key)}`">{{ c.key }}</a>
      </div>
      <div v-if="c.error" class="case-error">migration failed: {{ c.error }}</div>
      <div v-else class="case-stage">
        <FlowEmbed :flow="c.flow" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.index { padding: 24px 32px; font-family: Georgia, serif; }
h1 { font-size: 20px; font-weight: normal; }
.note { color: #666; font-size: 14px; }
code { background: #f0ecdd; padding: 1px 4px; border-radius: 3px; }
.case-row { margin: 28px 0; }
.case-solo { padding: 40px; }
.case-label { font-size: 14px; color: #444; margin-bottom: 8px; font-family: Georgia, serif; }
.case-stage {
  width: 1280px;
  height: 720px;
  border: 1px solid #ddd6c0;
  background: #fffdf5;
}
.case-error {
  color: #b03030;
  font-family: monospace;
  font-size: 13px;
  padding: 12px;
  border: 1px solid #e0b0b0;
  background: #fdf0f0;
}
</style>
