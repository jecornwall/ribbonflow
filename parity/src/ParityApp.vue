<!--
  ParityApp.vue — ribbonflow Phase-2c parity GATE harness (bd ai-engineer-uttb).

  Renders the canonical flow content (flow/flows/**/*.flow.json) through BOTH:
    - the GOLDEN legacy Vue renderer, <FlowEmbed> → FlowGraph, and
    - the CANDIDATE imperative renderer, mountFlow (via <MountFlowEmbed>),
  so the Phase-2c capture script can extract each side's painted SVG and diff
  them geometrically (extractScene + diffScenes). It only ever READS flow
  content + the library; it edits nothing (the golden refs stay golden).

  This SUPERSEDES the M5 harness, which globbed the now-retired deck/flows/*.js.

  URL contract (the Playwright capture drives these):
    /                                  → index: every flow case, one per row
    /?flow=<key>                       → solo, golden FlowEmbed, full-bleed
    /?flow=<key>&mode=mountflow        → solo, candidate mountFlow, full-bleed
    /?flow=<key>&compare=1             → both renderers, stacked, for extraction
    &agents=off                        → hide agents (static-scene pixel backstop)
  where <key> is the flow id, e.g. `n4-startup/before`.
-->
<script setup>
import { computed, onErrorCaptured, ref } from 'vue'
import { FlowEmbed } from '@flow-designer/library'
import { normalizeFlowInput } from '@flow-designer/library/internals'
import MountFlowEmbed from './MountFlowEmbed.vue'

// Every canonical flow definition. Eager glob — *.flow.json are plain data
// envelopes ({ formatVersion, flow }); set.json / index.json are excluded.
const modules = import.meta.glob('../../flows/**/*.flow.json', { eager: true })
// set.json manifests — for the flow-SET playback spot-check (FlowSetPlayer vs mountFlowSet).
const setModules = import.meta.glob('../../flows/**/set.json', { eager: true })

// key = flow id (dir/slug), e.g. `n4-startup/before`. Sorted for stable order.
const cases = Object.keys(modules)
  .sort()
  .map((path) => {
    const key = path.replace(/^.*\/flows\//, '').replace(/\.flow\.json$/, '')
    return { key, flow: modules[path].default }
  })

const params = new URLSearchParams(location.search)
const selectedKey = params.get('flow')
const setId = params.get('set')
const mode = params.get('mode') || 'flowgraph'
const compare = params.get('compare') === '1'
const agentsOff = params.get('agents') === 'off'

const selected = computed(() =>
  selectedKey ? cases.find((c) => c.key === selectedKey) : null,
)

// Assemble a raw flow-set ({ states:[{key,flow}], transition }) from a set.json
// manifest + its sibling .flow.json states. Each state's flow is migrated/
// normalized so both the golden FlowSetPlayer and the candidate mountFlowSet get
// render-ready states. Both renderers transparently accept the flow-set object.
const assembledSet = computed(() => {
  if (!setId) return null
  const setPath = Object.keys(setModules).find((p) => p.includes(`/flows/${setId}/set.json`))
  if (!setPath) return null
  const def = setModules[setPath].default
  const states = (def.flows || []).map((f) => {
    const fp = Object.keys(modules).find((p) => p.includes(`/flows/${setId}/${f.slug}.flow.json`))
    return { key: f.slug, flow: normalizeFlowInput(modules[fp].default) }
  })
  // &slow=1 stretches the crossfade so a mid-fade A/B frame is easy to capture
  // in sync across both players (both read this same transition).
  const transition = params.get('slow') === '1'
    ? { holdMs: 500, durationMs: 8000, easing: 'linear' }
    : def.transition
  return { id: def.id, states, transition, autoplay: true, loop: true }
})

// Per-render error capture — a 0-node / malformed flow that throws in one
// renderer is itself a parity finding, not a harness crash.
const renderError = ref(null)
onErrorCaptured((err) => {
  renderError.value = String((err && err.stack) || err)
  return false // stop propagation; keep the harness alive
})

// Static-scene capture hides agents in BOTH renderers (both stamp data-agent-id).
if (agentsOff) {
  const style = document.createElement('style')
  style.textContent = '[data-agent-id]{display:none !important}'
  document.head.appendChild(style)
}
</script>

<template>
  <!-- Flow-SET playback spot-check: FlowSetPlayer (golden) vs mountFlowSet. -->
  <div v-if="assembledSet" class="solo is-compare">
    <div v-if="renderError" class="case-error">render error: {{ renderError }}</div>
    <div class="stage-wrap">
      <div class="case-label">set:{{ setId }} · GOLDEN (FlowSetPlayer)</div>
      <div class="stage stage-flowgraph"><FlowEmbed :flow="assembledSet" /></div>
    </div>
    <div class="stage-wrap">
      <div class="case-label">set:{{ setId }} · CANDIDATE (mountFlowSet)</div>
      <div class="stage stage-mountflow"><MountFlowEmbed :flow="assembledSet" /></div>
    </div>
  </div>

  <!-- Solo / compare capture view. -->
  <div v-else-if="selected" class="solo" :class="{ 'is-compare': compare }">
    <div v-if="renderError" class="case-error">render error: {{ renderError }}</div>

    <template v-if="compare">
      <div class="stage-wrap">
        <div class="case-label">{{ selected.key }} · GOLDEN (FlowEmbed → FlowGraph)</div>
        <div class="stage stage-flowgraph"><FlowEmbed :flow="selected.flow" /></div>
      </div>
      <div class="stage-wrap">
        <div class="case-label">{{ selected.key }} · CANDIDATE (mountFlow)</div>
        <div class="stage stage-mountflow"><MountFlowEmbed :flow="selected.flow" /></div>
      </div>
    </template>

    <template v-else>
      <div class="stage" :class="`stage-${mode}`">
        <FlowEmbed v-if="mode === 'flowgraph'" :flow="selected.flow" />
        <MountFlowEmbed v-else :flow="selected.flow" />
      </div>
    </template>
  </div>

  <!-- Index. -->
  <div v-else class="index">
    <h1>ribbonflow Phase-2c parity gate — {{ cases.length }} flow states</h1>
    <p class="note">
      Open <code>/?flow=&lt;key&gt;&amp;compare=1</code> to render both renderers for one flow.
    </p>
    <ul>
      <li v-for="c in cases" :key="c.key">
        <a :href="`/?flow=${encodeURIComponent(c.key)}&compare=1`">{{ c.key }}</a>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.index { padding: 24px 32px; font-family: Georgia, serif; }
h1 { font-size: 20px; font-weight: normal; }
.note { color: #666; font-size: 14px; }
code { background: #f0ecdd; padding: 1px 4px; border-radius: 3px; }
.solo { padding: 24px; }
.solo.is-compare { display: flex; flex-direction: column; gap: 24px; }
.case-label { font-size: 13px; color: #444; margin-bottom: 6px; font-family: Georgia, serif; }
.stage {
  width: 1280px;
  height: 720px;
  border: 1px solid #ddd6c0;
  background: #fffdf5;
}
.case-error {
  color: #b03030; font-family: monospace; font-size: 13px; padding: 12px;
  border: 1px solid #e0b0b0; background: #fdf0f0; white-space: pre-wrap;
}
</style>
