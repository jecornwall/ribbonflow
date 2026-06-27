<!--
  MountFlowEmbed.vue — Phase-2c parity harness wrapper around the NEW imperative
  renderer. Mounts mountFlow(host, flow) (the framework-free renderer under test)
  inside a Vue host so the parity app can render the candidate side beside the
  golden <FlowEmbed> (FlowGraph). Reads only the library's public internals face;
  edits nothing. mountFlow transparently accepts the .flow.json envelope.
-->
<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { mountFlow } from '@flow-designer/library/internals'

const props = defineProps({
  flow: { type: [Object, String], required: true },
})

const host = ref(null)
let handle = null

onMounted(() => {
  handle = mountFlow(host.value, props.flow)
})
watch(
  () => props.flow,
  (f) => {
    if (handle) handle.update(f)
  },
)
onBeforeUnmount(() => {
  if (handle) handle.destroy()
  handle = null
})
</script>

<template>
  <div ref="host" class="mountflow-host"></div>
</template>

<style scoped>
.mountflow-host {
  width: 100%;
  height: 100%;
}
.mountflow-host :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
