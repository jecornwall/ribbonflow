<!--
  StatusStrip.vue — surfaces validateFlow() output from the library.

  Advisory only in v1: errors and warnings are shown but block nothing. The
  designer is a sketching tool — you should be able to leave a flow briefly
  invalid (a half-drawn edge, no source yet) while you work.
-->
<script setup>
import { useFlowDoc } from '../state/useFlowDoc.js'

const doc = useFlowDoc()
</script>

<template>
  <div class="status-strip">
    <span
      class="ss-pill"
      :class="doc.validation.value.ok ? 'ok' : 'err'"
    >{{ doc.validation.value.ok ? 'valid' : 'invalid' }}</span>
    <span
      v-for="(e, i) in doc.validation.value.errors"
      :key="`e${i}`"
      class="ss-msg err"
    >{{ e }}</span>
    <span
      v-for="(w, i) in doc.validation.value.warnings"
      :key="`w${i}`"
      class="ss-msg warn"
    >{{ w }}</span>
    <span
      v-if="doc.validation.value.ok && !doc.validation.value.warnings.length"
      class="ss-msg muted"
    >no issues</span>
  </div>
</template>

<style scoped>
.status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 12px;
  background: #f1efe9;
  border-top: 1px solid #e2ded3;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ss-pill {
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 700;
  color: #fff;
}
.ss-pill.ok {
  background: #16a34a;
}
.ss-pill.err {
  background: #dc2626;
}
.ss-msg.err {
  color: #dc2626;
}
.ss-msg.warn {
  color: #b45309;
}
.ss-msg.muted {
  color: #9ca3af;
}
</style>
