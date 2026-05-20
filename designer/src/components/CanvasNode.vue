<!--
  CanvasNode.vue — one node handle on the editor canvas.

  Presentational: it draws the node circle, its label, and a faint leader from
  node to label (so the label side reads at a glance). All pointer handling is
  delegated up to EditorCanvas, which owns the drag/selection model — this
  component only emits `nodedown` / `labeldown` with the originating event.

  v1.1 (bead ai-engineer-wec5): the handle is filled by the node's per-segment
  `colorScheme` (RED / NEUTRAL / GREEN) — the constraint node *type* is gone, so
  colour is the per-node visual register. A source node keeps a distinct inner
  emitter ring so emission still reads at a glance, independent of its colour.
-->
<script setup>
import { computed } from 'vue'
import { NODE_RADIUS } from '../lib/constants.js'

const props = defineProps({
  node: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
})
const emit = defineEmits(['nodedown', 'labeldown'])

/** Editor-canvas colour for each per-segment colour scheme. */
const SCHEME_FILL = {
  red: '#e2522b',
  neutral: '#cbd5e1',
  green: '#3fae6b',
}
const fill = computed(() => SCHEME_FILL[props.node.colorScheme] || SCHEME_FILL.neutral)
const isSource = computed(() => props.node.kind === 'source')
const stroke = computed(() => {
  if (props.selected) return '#2563eb'
  if (props.pending) return '#16a34a'
  return '#15171A'
})

const labelX = computed(() => props.node.x + (props.node.labelDx || 0))
const labelY = computed(() => props.node.y + (props.node.labelDy || 0))
</script>

<template>
  <g class="canvas-node">
    <!-- leader: node center → label anchor -->
    <line
      :x1="node.x"
      :y1="node.y"
      :x2="labelX"
      :y2="labelY"
      stroke="#94a3b8"
      stroke-width="1"
      stroke-dasharray="4 4"
    />
    <!-- the node handle — filled by colour scheme -->
    <circle
      :cx="node.x"
      :cy="node.y"
      :r="NODE_RADIUS"
      :fill="fill"
      :stroke="stroke"
      :stroke-width="selected || pending ? 4 : 2"
      :data-node-id="node.id"
      class="cn-handle"
      @pointerdown="emit('nodedown', $event, node.id)"
    />
    <!-- source emitter ring: a distinct inner mark so emission reads at a
         glance, independent of the node's colour scheme -->
    <circle
      v-if="isSource"
      :cx="node.x"
      :cy="node.y"
      :r="NODE_RADIUS * 0.45"
      fill="none"
      stroke="#15171a"
      stroke-width="2.5"
      pointer-events="none"
    />
    <!-- the draggable label -->
    <text
      :x="labelX"
      :y="labelY"
      text-anchor="middle"
      dominant-baseline="middle"
      class="cn-label"
      :font-weight="selected ? 700 : 400"
      @pointerdown="emit('labeldown', $event, node.id)"
    >{{ node.label || node.id }}</text>
  </g>
</template>

<style scoped>
.cn-handle {
  cursor: grab;
}
.cn-label {
  font-family: 'ET Book', Georgia, serif;
  font-size: 26px;
  fill: #15171a;
  cursor: move;
  user-select: none;
}
</style>
