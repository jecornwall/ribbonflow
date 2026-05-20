<!--
  CanvasEdge.vue — one directed edge on the editor canvas.

  Reads the live positions of its two endpoint nodes, so when a node is
  dragged the edge follows for free (M3 spec §3.3). A fat transparent overlay
  line gives the edge a comfortable click target for selection.
-->
<script setup>
import { computed } from 'vue'
import { NODE_RADIUS } from '../lib/constants.js'

const props = defineProps({
  from: { type: Object, required: true },
  to: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
const emit = defineEmits(['edgedown'])

// Trim the segment so it starts/ends at the node circle edges (and leaves
// room for the arrowhead at the target).
const geom = computed(() => {
  const dx = props.to.x - props.from.x
  const dy = props.to.y - props.from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    x1: props.from.x + ux * NODE_RADIUS,
    y1: props.from.y + uy * NODE_RADIUS,
    x2: props.to.x - ux * (NODE_RADIUS + 10),
    y2: props.to.y - uy * (NODE_RADIUS + 10),
  }
})
</script>

<template>
  <g class="canvas-edge" @pointerdown="emit('edgedown', $event)">
    <line
      :x1="geom.x1"
      :y1="geom.y1"
      :x2="geom.x2"
      :y2="geom.y2"
      stroke="transparent"
      stroke-width="18"
      class="ce-hit"
    />
    <line
      :x1="geom.x1"
      :y1="geom.y1"
      :x2="geom.x2"
      :y2="geom.y2"
      :stroke="selected ? '#2563eb' : '#64748b'"
      :stroke-width="selected ? 4 : 2.5"
      marker-end="url(#designer-arrow)"
    />
  </g>
</template>

<style scoped>
.ce-hit {
  cursor: pointer;
}
</style>
