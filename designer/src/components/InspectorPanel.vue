<!--
  InspectorPanel.vue — context property editor.

  Edits whatever is selected, through the useFlowDoc actions:
   - a node: label, kind, label side, slide-along-flow position, source rate,
     the three v1.1 node controls (LENGTH / SPEED / WIDTH) as sliders, the
     Speed⇄Width coupling toggle, and the per-segment colour scheme;
   - the flow: base speed, initial agents;
   - an edge: shows from → to, with delete.

  v1.1 (beads ai-engineer-t0c8 / wec5 / zesj): LENGTH / SPEED / WIDTH replace
  the old width/capacity/latency fields and are driven by SLIDERS, not numeric
  entry. Speed and Width are coupled by default — moving one drives the other.
  The `constraint` node type is gone; a node reads as a constraint from a low
  speed/width, and the colour scheme (RED / NEUTRAL / GREEN) is authored per
  node. Sliders drag live and commit the preview on release (`@change`).
-->
<script setup>
import { computed } from 'vue'
import { useFlowDoc } from '../state/useFlowDoc.js'
import {
  LENGTH_RANGE,
  SPEED_RANGE,
  WIDTH_RANGE,
} from '@flow-designer/library/internals'

const doc = useFlowDoc()
const state = doc.state

const node = computed(() =>
  state.selection.kind === 'node' ? doc.findNode(state.selection.id) : null,
)
const edge = computed(() =>
  state.selection.kind === 'edge' ? state.selection.edge : null,
)

/** Normalised viewBox — bounds for the slide-along-flow sliders. */
const vb = computed(() => {
  const v = state.flow.viewBox || {}
  return { x: v.x ?? 0, y: v.y ?? 0, w: v.w ?? 1600, h: v.h ?? 900 }
})

/**
 * Slide the selected node along the flow (bd ai-engineer-1dr8). `@input` moves
 * it live; `@change` (pointer release) commits, remounting the preview once.
 */
function slideNode(axis, value) {
  if (!node.value) return
  const v = Number(value)
  if (!Number.isFinite(v)) return
  if (axis === 'x') doc.moveNode(node.value.id, v, node.value.y)
  else doc.moveNode(node.value.id, node.value.x, v)
}

/** Parse a number input; empty / invalid clears the field (undefined). */
function num(value) {
  if (value === '' || value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function setNode(key, value) {
  if (node.value) doc.setNodeField(node.value.id, key, value)
}
function setNodeNum(key, value) {
  setNode(key, num(value))
}
function setFlow(key, value) {
  doc.setFlowField(key, value)
}
function setFlowNum(key, value) {
  setFlow(key, num(value))
}

/** Read-out for a slider value — short, fixed-precision. */
function fmt(v, decimals = 2) {
  return typeof v === 'number' ? v.toFixed(decimals) : '—'
}
</script>

<template>
  <div class="inspector">
    <!-- ── node ─────────────────────────────────────────────────────────── -->
    <template v-if="node">
      <h3>Node</h3>
      <label class="row">
        <span>id</span>
        <input :value="node.id" disabled />
      </label>
      <label class="row">
        <span>label</span>
        <input
          :value="node.label"
          @change="setNode('label', $event.target.value)"
        />
      </label>

      <label class="row">
        <span>kind</span>
        <select
          :value="node.kind || 'normal'"
          @change="doc.setNodeKind(node.id, $event.target.value)"
        >
          <option value="normal">normal</option>
          <option value="source">source</option>
        </select>
      </label>

      <div class="row">
        <span>label side</span>
        <div class="seg">
          <button
            :class="{ active: (node.labelSide || 'above') === 'above' }"
            @click="doc.setLabelSide(node.id, 'above')"
          >above</button>
          <button
            :class="{ active: node.labelSide === 'below' }"
            @click="doc.setLabelSide(node.id, 'below')"
          >below</button>
        </div>
      </div>

      <div class="row">
        <span>slide ⇄</span>
        <input
          type="range" class="slider"
          :min="vb.x" :max="vb.x + vb.w" step="1"
          :value="node.x"
          title="slide this segment left / right along the flow"
          @input="slideNode('x', $event.target.value)"
          @change="doc.commitEdit()"
        />
      </div>
      <div class="row">
        <span>slide ↕</span>
        <input
          type="range" class="slider"
          :min="vb.y" :max="vb.y + vb.h" step="1"
          :value="node.y"
          title="slide this segment up / down"
          @input="slideNode('y', $event.target.value)"
          @change="doc.commitEdit()"
        />
      </div>

      <label v-if="node.kind === 'source'" class="row">
        <span>rate /s</span>
        <input
          type="number" step="0.1" min="0"
          :value="node.rate"
          @change="setNodeNum('rate', $event.target.value)"
        />
      </label>

      <!-- ── the three v1.1 node controls (sliders — bd zesj) ────────────── -->
      <!-- Sliders drag live (`@input` mutates the reactive doc — the editor
           canvas tracks it) and commit the preview once on release
           (`@change` → commitEdit), mirroring the canvas drag-then-commit
           cadence. A numeric read-out sits beside each slider. -->
      <h4>controls</h4>

      <div class="row ctl">
        <span>length</span>
        <input
          type="range" class="slider"
          :min="LENGTH_RANGE.min" :max="LENGTH_RANGE.max" step="0.05"
          :value="node.length ?? 0.8"
          title="visual segment length"
          @input="doc.setNodeLength(node.id, +$event.target.value)"
          @change="doc.commitEdit()"
        />
        <code class="readout">{{ fmt(node.length ?? 0.8) }}</code>
      </div>

      <div class="row ctl">
        <span>speed</span>
        <input
          type="range" class="slider"
          :min="SPEED_RANGE.min" :max="SPEED_RANGE.max" step="0.05"
          :value="node.speed ?? 1.0"
          title="speed particles travel through this node"
          @input="doc.setNodeSpeed(node.id, +$event.target.value)"
          @change="doc.commitEdit()"
        />
        <code class="readout">{{ fmt(node.speed ?? 1.0) }}</code>
      </div>

      <div class="row ctl">
        <span>width</span>
        <input
          type="range" class="slider"
          :min="WIDTH_RANGE.min" :max="WIDTH_RANGE.max" step="1"
          :value="node.width ?? 70"
          title="visual pipe width"
          @input="doc.setNodeWidth(node.id, +$event.target.value)"
          @change="doc.commitEdit()"
        />
        <code class="readout">{{ fmt(node.width ?? 70, 0) }}</code>
      </div>

      <label class="row couple">
        <input
          type="checkbox"
          :checked="node.coupleSpeedWidth !== false"
          @change="doc.setCoupleSpeedWidth(node.id, $event.target.checked)"
        />
        <span>couple speed ⇄ width</span>
      </label>

      <!-- ── per-segment colour scheme ───────────────────────────────────── -->
      <div class="row">
        <span>colour</span>
        <div class="seg colours">
          <button
            class="c-red"
            :class="{ active: node.colorScheme === 'red' }"
            @click="doc.setColorScheme(node.id, 'red')"
          >red</button>
          <button
            class="c-neutral"
            :class="{ active: (node.colorScheme || 'neutral') === 'neutral' }"
            @click="doc.setColorScheme(node.id, 'neutral')"
          >neutral</button>
          <button
            class="c-green"
            :class="{ active: node.colorScheme === 'green' }"
            @click="doc.setColorScheme(node.id, 'green')"
          >green</button>
          <button
            class="c-rose"
            :class="{ active: node.colorScheme === 'rose' }"
            @click="doc.setColorScheme(node.id, 'rose')"
          >rose</button>
        </div>
      </div>

      <button class="danger" @click="doc.deleteSelection()">Delete node</button>
    </template>

    <!-- ── edge ─────────────────────────────────────────────────────────── -->
    <template v-else-if="edge">
      <h3>Edge</h3>
      <div class="row"><span>from</span><code>{{ edge.from }}</code></div>
      <div class="row"><span>to</span><code>{{ edge.to }}</code></div>
      <button class="danger" @click="doc.deleteSelection()">Delete edge</button>
    </template>

    <!-- ── flow ─────────────────────────────────────────────────────────── -->
    <template v-else>
      <h3>Flow</h3>
      <label class="row">
        <span>base speed</span>
        <input
          type="number" step="10" min="1"
          :value="state.flow.baseSpeed ?? ''"
          @change="setFlowNum('baseSpeed', $event.target.value)"
        />
      </label>
      <label class="row">
        <span>initial agents</span>
        <input
          type="number" step="1" min="0"
          :value="state.flow.initialAgents ?? ''"
          @change="setFlowNum('initialAgents', $event.target.value)"
        />
      </label>
      <p class="hint">
        Select a node or edge on the canvas to edit it.
        {{ state.flow.nodes.length }} nodes.
        A constraint is just a node with a low speed/width.
      </p>
    </template>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: #f7f5ef;
  border-left: 1px solid #e2ded3;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
}
h3 {
  margin: 0 0 2px;
  font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
}
h4 {
  margin: 6px 0 0;
  font: 700 11px/1 ui-sans-serif, system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9ca3af;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.row > span {
  color: #4b5563;
  flex: 0 0 92px;
}
.row input,
.row select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid #cdc8ba;
  border-radius: 4px;
  background: #fff;
  font: inherit;
}
.row input:disabled {
  background: #ece9e0;
  color: #9ca3af;
}
.row input.slider {
  padding: 0;
  border: none;
  background: transparent;
  cursor: ew-resize;
  accent-color: #2563eb;
}
.row.ctl .readout {
  flex: 0 0 36px;
  text-align: right;
}
.row.couple {
  justify-content: flex-start;
  gap: 6px;
}
.row.couple input {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
}
.row.couple span {
  flex: 1;
}
.seg {
  display: flex;
  flex: 1;
}
.seg button {
  flex: 1;
  padding: 4px 0;
  border: 1px solid #cdc8ba;
  background: #fff;
  cursor: pointer;
  font: inherit;
}
.seg button:first-child {
  border-radius: 4px 0 0 4px;
}
.seg button:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.seg button.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
/* colour-scheme segmented control — each button tints to its own scheme. */
.seg.colours button.c-red.active {
  background: #e2522b;
  border-color: #e2522b;
  color: #fff;
}
.seg.colours button.c-neutral.active {
  background: #9ca3af;
  border-color: #9ca3af;
  color: #fff;
}
.seg.colours button.c-green.active {
  background: #3fae6b;
  border-color: #3fae6b;
  color: #fff;
}
/* rose = CONSTRAINT_ROSE (#d8a8a8) — the v1 dusty-rose register (bd ai-engineer-0h05) */
.seg.colours button.c-rose.active {
  background: #d8a8a8;
  border-color: #d8a8a8;
  color: #fff;
}
code {
  font: 12px/1 ui-monospace, Menlo, monospace;
  color: #15171a;
}
button.danger {
  margin-top: 6px;
  padding: 6px 10px;
  border: 1px solid #dc2626;
  border-radius: 4px;
  background: #fff;
  color: #dc2626;
  cursor: pointer;
  font: inherit;
}
button.danger:hover {
  background: #dc2626;
  color: #fff;
}
.hint {
  margin: 4px 0 0;
  color: #9ca3af;
  font-size: 12px;
}
</style>
