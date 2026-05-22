<!--
  SmokeApp.vue — throwaway single-flow render harness.

  Renders one flow/flows/<set>/<flow>.flow.json through @flow-designer/library's
  FlowEmbed on a cream stage, so a flow-definition change can be smoke-checked
  visually. Query: /smoke.html?set=n14-context-layer&flow=after
-->
<script setup>
import { ref, onMounted } from 'vue'
import { FlowEmbed } from '@flow-designer/library'

const flows = import.meta.glob('../../flows/**/*.flow.json')
const envelope = ref(null)
const err = ref('')

onMounted(async () => {
  const p = new URLSearchParams(location.search)
  const set = p.get('set')
  const flow = p.get('flow')
  const key = `../../flows/${set}/${flow}.flow.json`
  const loader = flows[key]
  if (!loader) {
    err.value = `no flow at ${key} — have: ${Object.keys(flows).join(', ')}`
    return
  }
  const mod = await loader()
  envelope.value = mod.default
})
</script>

<template>
  <div class="stage">
    <FlowEmbed v-if="envelope" :flow="envelope" />
    <pre v-else-if="err" class="err">{{ err }}</pre>
  </div>
</template>

<style>
html, body { margin: 0; background: #FBF8EF; }
.stage {
  width: 1280px;
  height: 720px;
  margin: 0 auto;
  background: #FBF8EF;
}
.err { padding: 24px; font: 13px/1.5 monospace; color: #a33; white-space: pre-wrap; }
</style>
