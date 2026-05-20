<!--
  SetPreview.vue — the flow-SET preview view (M4, bd ai-engineer-nawa).

  Plays a flow-set's animated transitions through the REAL library
  <FlowSetPlayer> (the /internals face — the designer never imports the slide
  face, M3 §2.4). Live transition controls tune the running preview; play /
  pause / step drive the player's exposed timeline methods.

  v1 transition controls are LIVE-ONLY — they are mutated in place on the
  reactive flow-set so the player picks them up without a timeline reset;
  persisting transition metadata into set.json is a tracked follow-up
  (M4 spec §2.6 / §7).
-->
<script setup>
import { ref, computed } from 'vue'
import { FlowSetPlayer, EASINGS } from '@flow-designer/library/internals'
import { useFlowDoc } from '../state/useFlowDoc.js'
import { useFlowSetPreview } from '../state/useFlowSetPreview.js'

const doc = useFlowDoc()
const preview = useFlowSetPreview()
const { state } = preview

const player = ref(null)
const easings = Object.keys(EASINGS)

const stateList = computed(() => state.flowSet?.states ?? [])
const transition = computed(() => state.flowSet?.transition ?? null)

function back() {
  preview.clear()
  doc.goToIndex()
}
</script>

<template>
  <div class="set-preview">
    <header class="sp-bar">
      <button class="sp-btn" @click="back">← Index</button>
      <strong class="sp-title">
        {{ state.setMeta?.title || 'Flow-set' }}
        <span class="sp-slug">{{ state.setMeta?.id }}</span>
      </strong>
      <span class="sp-tag">animated transition preview</span>
    </header>

    <p v-if="state.loading" class="sp-note">Loading flow-set…</p>
    <p v-if="state.error" class="sp-note sp-error">
      Could not load the set — {{ state.error }}
    </p>

    <div v-if="state.flowSet && !state.error" class="sp-body">
      <div class="sp-stage">
        <p v-if="stateList.length < 2" class="sp-note sp-thin">
          This set has {{ stateList.length }} state — add a second flow to the
          set to see an animated transition.
        </p>
        <FlowSetPlayer
          ref="player"
          :key="state.setMeta?.id"
          :flow-set="state.flowSet"
        />
      </div>

      <aside class="sp-panel">
        <section>
          <h3>States ({{ stateList.length }})</h3>
          <ol class="sp-states">
            <li v-for="s in stateList" :key="s.key">
              {{ s.title || s.key }}
            </li>
          </ol>
        </section>

        <section v-if="transition">
          <h3>Transition</h3>
          <label class="sp-ctl">
            <span>Hold {{ transition.holdMs }} ms</span>
            <input
              type="range" min="0" max="6000" step="100"
              v-model.number="transition.holdMs"
            />
          </label>
          <label class="sp-ctl">
            <span>Crossfade {{ transition.durationMs }} ms</span>
            <input
              type="range" min="0" max="3000" step="50"
              v-model.number="transition.durationMs"
            />
          </label>
          <label class="sp-ctl">
            <span>Easing</span>
            <select v-model="transition.easing">
              <option v-for="e in easings" :key="e" :value="e">{{ e }}</option>
            </select>
          </label>
        </section>

        <section>
          <h3>Playback</h3>
          <div class="sp-transport">
            <button class="sp-btn" @click="player?.prev()">‹ Prev</button>
            <button class="sp-btn" @click="player?.toggle()">Play / Pause</button>
            <button class="sp-btn" @click="player?.next()">Next ›</button>
          </div>
        </section>

        <section v-if="state.validation.warnings.length">
          <h3>Notes</h3>
          <ul class="sp-warnings">
            <li v-for="(w, i) in state.validation.warnings" :key="i">{{ w }}</li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.set-preview {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: ui-sans-serif, system-ui, sans-serif;
  background: #f4f1e8;
}
.sp-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #f1efe9;
  border-bottom: 1px solid #d8d3c6;
}
.sp-title {
  font-size: 15px;
}
.sp-slug {
  font: 11px/1 ui-monospace, monospace;
  color: #8a8474;
  margin-left: 6px;
}
.sp-tag {
  margin-left: auto;
  font: 12px/1 ui-monospace, monospace;
  color: #6b7280;
}
.sp-note {
  padding: 16px;
  color: #5a554a;
  font-size: 14px;
}
.sp-thin {
  padding: 8px 0;
}
.sp-error {
  color: #b91c1c;
}
.sp-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.sp-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #fbfaf7;
}
.sp-panel {
  width: 280px;
  border-left: 1px solid #d8d3c6;
  padding: 14px 16px;
  overflow: auto;
  background: #f4f1e8;
}
.sp-panel h3 {
  font: 600 13px/1 ui-sans-serif, system-ui, sans-serif;
  margin: 16px 0 8px;
  color: #15171a;
}
.sp-panel section:first-child h3 {
  margin-top: 0;
}
.sp-states {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: #3a3a3a;
}
.sp-ctl {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #5a554a;
}
.sp-ctl input[type='range'] {
  width: 100%;
}
.sp-transport {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.sp-warnings {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #92700a;
}
.sp-btn {
  padding: 5px 11px;
  font: 12px/1 ui-sans-serif, system-ui, sans-serif;
  background: #2a2d31;
  color: #f1efe9;
  border: 1px solid #2a2d31;
  border-radius: 5px;
  cursor: pointer;
}
.sp-btn:hover {
  background: #34373c;
}
</style>
