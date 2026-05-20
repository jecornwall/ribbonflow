<!--
  InspectorPanel.vue — context property editor.

  Edits whatever is selected, through the useFlowDoc actions:
   - a node: label, label side (above/below), kind, slide-along-flow
     position, source rate, per-node width override, capacity / latency;
   - the flow: width mode, overall band width, base speed, initial agents,
     pinch preset;
   - an edge: shows from → to, with delete.

  Per-node `width` is an override: when blank, the placeholder reads "derived"
  because coupled mode computes it from the node's flow rate (M2 §2.3).
-->
<script setup>
import { computed } from 'vue'
import { useFlowDoc } from '../state/useFlowDoc.js'

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
 * it live — the editor canvas tracks reactively, the library preview does not
 * remount mid-slide; `@change` (pointer release) commits, remounting the
 * preview once. Mirrors the canvas drag-then-commit cadence.
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
          <option value="constraint">constraint</option>
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
          type="range"
          class="slider"
          :min="vb.x"
          :max="vb.x + vb.w"
          step="1"
          :value="node.x"
          title="slide this segment left / right along the flow"
          @input="slideNode('x', $event.target.value)"
          @change="doc.commitEdit()"
        />
      </div>
      <div class="row">
        <span>slide ↕</span>
        <input
          type="range"
          class="slider"
          :min="vb.y"
          :max="vb.y + vb.h"
          step="1"
          :value="node.y"
          title="slide this segment up / down"
          @input="slideNode('y', $event.target.value)"
          @change="doc.commitEdit()"
        />
      </div>

      <label v-if="node.kind === 'source'" class="row">
        <span>rate /s</span>
        <input
          type="number"
          step="0.1"
          min="0"
          :value="node.rate"
          @change="setNodeNum('rate', $event.target.value)"
        />
      </label>

      <label class="row">
        <span>width</span>
        <input
          type="number"
          step="1"
          min="0"
          placeholder="derived"
          :value="node.width ?? ''"
          @change="setNodeNum('width', $event.target.value)"
        />
      </label>
      <label class="row">
        <span>capacity</span>
        <input
          type="number"
          step="1"
          min="0"
          :value="node.capacity ?? ''"
          @change="setNodeNum('capacity', $event.target.value)"
        />
      </label>
      <label class="row">
        <span>latency</span>
        <input
          type="number"
          step="0.1"
          min="0"
          :value="node.latency ?? ''"
          @change="setNodeNum('latency', $event.target.value)"
        />
      </label>

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
        <span>width mode</span>
        <select
          :value="state.flow.widthMode || 'coupled'"
          @change="setFlow('widthMode', $event.target.value)"
        >
          <option value="coupled">coupled</option>
          <option value="manual">manual</option>
        </select>
      </label>
      <label class="row">
        <span>band width</span>
        <input
          type="number"
          step="1"
          min="1"
          :value="state.flow.bandWidth ?? ''"
          @change="setFlowNum('bandWidth', $event.target.value)"
        />
      </label>
      <label class="row">
        <span>base speed</span>
        <input
          type="number"
          step="10"
          min="1"
          :value="state.flow.baseSpeed ?? ''"
          @change="setFlowNum('baseSpeed', $event.target.value)"
        />
      </label>
      <label class="row">
        <span>initial agents</span>
        <input
          type="number"
          step="1"
          min="0"
          :value="state.flow.initialAgents ?? ''"
          @change="setFlowNum('initialAgents', $event.target.value)"
        />
      </label>
      <label class="row">
        <span>pinch preset</span>
        <select
          :value="state.flow.pinchPreset || ''"
          @change="setFlow('pinchPreset', $event.target.value || undefined)"
        >
          <option value="">(none)</option>
          <option value="constraint-pinch">constraint-pinch</option>
          <option value="throughput-encoded">throughput-encoded</option>
        </select>
      </label>
      <p class="hint">
        Select a node or edge on the canvas to edit it.
        {{ state.flow.nodes.length }} nodes.
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
