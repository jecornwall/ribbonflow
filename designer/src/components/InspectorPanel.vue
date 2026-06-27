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
import { framePreset } from '../lib/slideFrame.js'
import {
  LENGTH_RANGE,
  SPEED_CONTROL_RANGE,
  WIDTH_RANGE,
  CAPACITY_CONTROL_RANGE,
  RED_RATIO_RANGE,
  capacityFromWidth,
} from '@flow-designer/library/internals'

const doc = useFlowDoc()
const state = doc.state

const node = computed(() =>
  state.selection.kind === 'node' ? doc.findNode(state.selection.id) : null,
)
const edge = computed(() =>
  state.selection.kind === 'edge' ? state.selection.edge : null,
)

// ── v1.2 rejection edge (spec §5) ────────────────────────────────────────────
// The live rejection-edge object behind a 'rejection' selection, or null.
const rejection = computed(() =>
  state.selection.kind === 'rejection' && state.selection.edge
    ? doc.findRejection(state.selection.edge.from, state.selection.edge.to)
    : null,
)
/** Stored rate (a 0.01–0.99 fraction) shown to the author as a rejection %. */
const ratePct = computed(() =>
  rejection.value ? Math.round((rejection.value.rate ?? 0.15) * 100) : 0,
)
const bowSide = computed(() => rejection.value?.bow?.side ?? 'below')
const bowDepth = computed(() => rejection.value?.bow?.depth ?? 80)

/** Move the rejection-% slider — convert the % back to the stored fraction. */
function setRejectionPct(pct) {
  if (!rejection.value) return
  const rate = Number(pct) / 100
  if (Number.isFinite(rate)) {
    doc.setRejectionRate(rejection.value.from, rejection.value.to, rate)
  }
}
/** Move the bow-depth slider. */
function setRejectionDepth(value) {
  if (!rejection.value) return
  const d = Number(value)
  if (Number.isFinite(d)) {
    doc.setRejectionBowDepth(rejection.value.from, rejection.value.to, d)
  }
}

// ── fork authoring (bead ai-engineer-kcmj) ───────────────────────────────────
// When the selected node has >1 successor it is a FORK — the rate-split editor
// shows one slider per branch. forkBranchesFor returns an even split when no
// forks[] entry exists and the stored shares when one does; dragging a slider
// materialises / updates the entry and rebalances the siblings (spec §3).
const forkBranches = computed(() =>
  node.value ? doc.forkBranchesFor(node.value.id) : [],
)
const isFork = computed(() => forkBranches.value.length > 1)
/** True when the fork carries a non-even rate split (a forks[] entry exists). */
const forkHasEntry = computed(() =>
  node.value
    ? (state.flow.forks || []).some((f) => f.from === node.value.id)
    : false,
)
// A node with >1 predecessor is a MERGE — shown read-only (merges carry no
// authored rate parameter; effectiveNodeRates sums inbound flow from topology).
const mergePreds = computed(() =>
  node.value ? doc.predecessorsOf(node.value.id) : [],
)
const isMerge = computed(() => mergePreds.value.length > 1)

/** A node's display label (falls back to its id). */
function nodeLabel(id) {
  const n = doc.findNode(id)
  return n ? n.label || n.id : id
}
/** A rate share (0–1 fraction) as a whole-number percentage. */
function pct(share) {
  return Math.round((Number(share) || 0) * 100)
}
/** Move a fork branch's slider — convert the % back to the stored fraction. */
function setForkShare(branchTo, value) {
  if (!node.value) return
  const share = Number(value) / 100
  if (Number.isFinite(share)) {
    doc.setForkRateShare(node.value.id, branchTo, share)
  }
}

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

// ── flow FRAME / aspect ratio (bd ai-engineer-zr7k §7.1) ─────────────────────
// The frame is the flow's own viewBox; presets are height-anchored at 900 so
// 16:9 stays 1600×900. Picking a preset or editing W/H rewrites the viewBox via
// doc.setFrame — no node is rescaled or moved (the out-of-bounds ring + the
// status-strip "bring in bounds" action handle nodes the reshape pushes out).
const FRAME_PRESET_NAMES = ['16:9', '4:3', '1:1']

/** Commit a new frame WIDTH, keeping the current height. */
function setFrameW(value) {
  const w = num(value)
  if (Number.isFinite(w) && w > 0) {
    doc.setFrame({ x: 0, y: 0, w, h: doc.frameViewBox.value.h })
  }
}
/** Commit a new frame HEIGHT, keeping the current width. */
function setFrameH(value) {
  const h = num(value)
  if (Number.isFinite(h) && h > 0) {
    doc.setFrame({ x: 0, y: 0, w: doc.frameViewBox.value.w, h })
  }
}

// ── per-node CAPACITY override (bd ai-engineer-ey0b) ─────────────────────────
// `capacity` is OPTIONAL: when the node authors none the library derives it
// from width. The override checkbox materialises / clears an explicit integer;
// when off, the width-derived value is shown read-only so the author still
// sees what the engine will use.
/** True when the selected node carries an explicit capacity override. */
const hasCapacityOverride = computed(() =>
  node.value ? typeof node.value.capacity === 'number' : false,
)
/** The capacity the library would derive from this node's width. */
const derivedCapacity = computed(() =>
  node.value ? capacityFromWidth(node.value.width ?? 70) : 0,
)
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

      <!-- ── v1.3 transform behaviour (spec §5) ──────────────────────────── -->
      <!-- A node may transform arriving particles: split (1 large → N small)
           or combine (N small → 1 large). Choosing split/combine reveals the
           matching count control. -->
      <label class="row">
        <span>transform</span>
        <select
          :value="node.transform || 'none'"
          @change="doc.setNodeTransform(node.id, $event.target.value)"
        >
          <option value="none">none</option>
          <option value="split">split</option>
          <option value="combine">combine</option>
        </select>
      </label>
      <label v-if="node.transform === 'split'" class="row">
        <span>split count</span>
        <input
          type="number" min="2" step="1"
          :value="node.splitCount ?? 4"
          title="how many small particles one large particle splits into"
          @change="doc.setTransformCount(node.id, num($event.target.value))"
        />
      </label>
      <label v-if="node.transform === 'combine'" class="row">
        <span>combine count</span>
        <input
          type="number" min="2" step="1"
          :value="node.combineCount ?? 4"
          title="how many small particles accumulate before one large fires"
          @change="doc.setTransformCount(node.id, num($event.target.value))"
        />
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

      <!-- ── v1.3 source particle size (spec §5) — small vs large ─────────── -->
      <div v-if="node.kind === 'source'" class="row">
        <span>particle</span>
        <div class="seg">
          <button
            :class="{ active: (node.particleSize || 'small') === 'small' }"
            @click="doc.setSourceParticleSize(node.id, 'small')"
          >small</button>
          <button
            :class="{ active: node.particleSize === 'large' }"
            @click="doc.setSourceParticleSize(node.id, 'large')"
          >large</button>
        </div>
      </div>

      <!-- ── per-emitter RED RATIO (bd ai-engineer-s8cm) ─────────────────── -->
      <!-- The fraction of this source's particles emitted RED — "bad work
           that should not pass to production" (defective work). OPTIONAL and
           source-only: 0 (the default) emits all black, the historical
           behaviour. The slider drags live and commits the preview once on
           release; a ratio of 0 clears the field so an all-black source
           round-trips with no redRatio key. -->
      <div v-if="node.kind === 'source'" class="row ctl">
        <span>red ratio</span>
        <input
          type="range" class="slider"
          :min="RED_RATIO_RANGE.min" :max="RED_RATIO_RANGE.max" step="0.05"
          :value="node.redRatio ?? 0"
          title="fraction of emitted particles that are red — defective work that should not pass to production"
          @input="doc.setNodeRedRatio(node.id, +$event.target.value)"
          @change="doc.commitEdit()"
        />
        <code class="readout">{{ pct(node.redRatio ?? 0) }}%</code>
      </div>

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
          :min="SPEED_CONTROL_RANGE.min" :max="SPEED_CONTROL_RANGE.max" step="0.05"
          :value="node.speed ?? 1.0"
          title="speed particles travel through this node — a heavily-converged node needs a high value to clear its inbound pile-up"
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

      <!-- ── per-node CAPACITY override (bd ai-engineer-ey0b) ─────────────── -->
      <!-- capacity = max particles a node processes concurrently. It is an
           OPTIONAL field — off by default, the library derives it from width.
           Turning the override on materialises an explicit integer (seeded at
           the width-derived value); the slider then drives it well past that
           ceiling to clear a heavily-converged node's inbound pile-up. The
           slider drags live and commits the preview once on release. -->
      <label class="row couple">
        <input
          type="checkbox"
          :checked="hasCapacityOverride"
          @change="doc.setCapacityOverride(node.id, $event.target.checked)"
        />
        <span>override capacity</span>
      </label>
      <div v-if="hasCapacityOverride" class="row ctl">
        <span>capacity</span>
        <input
          type="range" class="slider"
          :min="CAPACITY_CONTROL_RANGE.min" :max="CAPACITY_CONTROL_RANGE.max" step="1"
          :value="node.capacity"
          title="max particles this node processes concurrently — raise it to clear a heavily-converged node's inbound pile-up"
          @input="doc.setNodeCapacity(node.id, +$event.target.value)"
          @change="doc.commitEdit()"
        />
        <code class="readout">{{ node.capacity }}</code>
      </div>
      <p v-else class="hint">
        capacity auto {{ derivedCapacity }} (derived from width)
      </p>

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

      <!-- ── fork rate split (bead ai-engineer-kcmj) ─────────────────────── -->
      <!-- Shown when the node has >1 successor. One slider per branch; they
           rebalance so the shares sum to 1. Sliders drag live (`@input`) and
           commit the preview once on release (`@change`). -->
      <template v-if="isFork">
        <h4>fork — rate split</h4>
        <div v-for="b in forkBranches" :key="b.to" class="row ctl">
          <span class="branch" :title="nodeLabel(b.to)">→ {{ nodeLabel(b.to) }}</span>
          <input
            type="range" class="slider"
            min="0" max="100" step="1"
            :value="pct(b.rateShare)"
            title="share of this node's flow routed down this branch"
            @input="setForkShare(b.to, $event.target.value)"
            @change="doc.commitEdit()"
          />
          <code class="readout">{{ pct(b.rateShare) }}%</code>
        </div>
        <button
          v-if="forkHasEntry"
          class="reset"
          title="discard the custom split — branches share the flow evenly"
          @click="doc.resetForkToEven(node.id)"
        >Reset to even split</button>
      </template>

      <!-- ── merge (read-only — bead ai-engineer-kcmj) ───────────────────── -->
      <!-- A node with >1 predecessor merges flow; merges carry no authored
           rate parameter, so this is purely informational. -->
      <div v-if="isMerge" class="row merge">
        <span>merge</span>
        <code>{{ mergePreds.length }} inputs: {{ mergePreds.map(nodeLabel).join(', ') }}</code>
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

    <!-- ── rejection edge (v1.2 — spec §5) ──────────────────────────────── -->
    <template v-else-if="rejection">
      <h3>Rejection edge</h3>
      <div class="row"><span>from</span><code>{{ rejection.from }}</code></div>
      <div class="row"><span>to</span><code>{{ rejection.to }}</code></div>

      <!-- rate, presented to the author as a rejection % (stored 0.01–0.99).
           Drags live; commits the preview once on release (@change). -->
      <div class="row ctl">
        <span>rejection %</span>
        <input
          type="range" class="slider"
          min="1" max="99" step="1"
          :value="ratePct"
          title="fraction of work leaving this node that is rejected back"
          @input="setRejectionPct($event.target.value)"
          @change="doc.commitEdit()"
        />
        <code class="readout">{{ ratePct }}%</code>
      </div>

      <div class="row">
        <span>bow side</span>
        <div class="seg">
          <button
            :class="{ active: bowSide === 'above' }"
            @click="doc.setRejectionBowSide(rejection.from, rejection.to, 'above')"
          >above</button>
          <button
            :class="{ active: bowSide === 'below' }"
            @click="doc.setRejectionBowSide(rejection.from, rejection.to, 'below')"
          >below</button>
        </div>
      </div>

      <div class="row ctl">
        <span>bow depth</span>
        <input
          type="range" class="slider"
          min="20" max="240" step="5"
          :value="bowDepth"
          title="how far the rejection arc bows away from the chord"
          @input="setRejectionDepth($event.target.value)"
          @change="doc.commitEdit()"
        />
        <code class="readout">{{ bowDepth }}</code>
      </div>

      <button class="danger" @click="doc.deleteSelection()">
        Delete rejection edge
      </button>
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

      <!-- ── frame / aspect ratio (bd ai-engineer-zr7k §7.1) ───────────────── -->
      <!-- The flow's slide-scope frame is its viewBox. Pick a preset or set a
           custom W×H. Changing the aspect only rewrites the viewBox — no node
           moves; nodes pushed outside light up the out-of-bounds ring and can
           be pulled back via the status strip's "bring in bounds". -->
      <h4>frame</h4>
      <div class="row">
        <span>aspect</span>
        <div class="seg">
          <button
            v-for="name in FRAME_PRESET_NAMES"
            :key="name"
            :data-testid="`frame-preset-${name}`"
            :class="{ active: doc.activePreset.value === name }"
            :title="`set the frame to a ${name} aspect ratio`"
            @click="doc.setFrame(framePreset(name))"
          >{{ name }}</button>
        </div>
      </div>
      <div class="row">
        <span>size W×H</span>
        <div class="frame-size">
          <input
            type="number" min="1" step="10"
            data-testid="frame-w"
            :value="doc.frameViewBox.value.w"
            title="frame width (slide-scope units)"
            @change="setFrameW($event.target.value)"
          />
          <span class="frame-x">×</span>
          <input
            type="number" min="1" step="10"
            data-testid="frame-h"
            :value="doc.frameViewBox.value.h"
            title="frame height (slide-scope units)"
            @change="setFrameH($event.target.value)"
          />
          <code v-if="doc.activePreset.value === 'custom'" class="frame-custom">custom</code>
        </div>
      </div>

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
/* fork rate-split editor — branch label, reset button, merge read-out */
.row.ctl .branch {
  flex: 0 0 92px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button.reset {
  margin-top: 2px;
  padding: 4px 8px;
  border: 1px solid #cdc8ba;
  border-radius: 4px;
  background: #fff;
  color: #4b5563;
  cursor: pointer;
  font: inherit;
  align-self: flex-start;
}
button.reset:hover {
  background: #ece9e0;
}
.row.merge code {
  flex: 1;
  text-align: right;
  color: #6b7280;
  font-size: 11px;
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
/* frame size W×H inputs */
.frame-size {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.frame-size input {
  flex: 1;
  min-width: 0;
}
.frame-x {
  flex: 0 0 auto;
  color: #9ca3af;
}
.frame-custom {
  flex: 0 0 auto;
  color: #9ca3af;
  font-size: 11px;
}
</style>
