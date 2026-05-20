<!--
  CanvasNode.vue — one node handle on the editor canvas.

  Presentational: it draws the node circle, its label, and a faint leader from
  node to label (so the label side reads at a glance). All pointer handling is
  delegated up to EditorCanvas, which owns the drag/selection model — this
  component only emits `nodedown` / `labeldown` with the originating event.
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

const fill = computed(() => {
  switch (props.node.kind) {
    case 'source':
      return '#34d399'
    case 'constraint':
      return '#E2522B'
    default:
      return '#cbd5e1'
  }
})
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
    <!-- the node handle -->
    <circle
      :cx="node.x"
      :cy="node.y"
      :r="NODE_RADIUS"
      :fill="fill"
      :stroke="stroke"
      :stroke-width="selected || pending ? 4 : 2"
      class="cn-handle"
      @pointerdown="emit('nodedown', $event, node.id)"
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
