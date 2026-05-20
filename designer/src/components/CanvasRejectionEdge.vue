<!--
  CanvasRejectionEdge.vue — one rejection edge on the editor canvas (v1.2 R5).

  The designer-canvas counterpart of the library's FlowRejectionArc: a thin,
  dotted, desaturated-red bow arc representing a "failed-review back-path"
  (spec §5 — Canvas bullet). Like CanvasEdge, it reads the live positions of
  its two endpoint nodes, so dragging a node drags the arc with it.

  Two interactions, both routed up to EditorCanvas (which owns the canvas drag
  / selection model):

    • SELECT — a fat transparent overlay traces the arc and emits `edgedown`
      for a comfortable click target → doc.selectRejection.
    • APEX DRAG — a grip handle sits at the arc's apex (the Bézier t=0.5
      point). Dragging it sets bow.depth; dragging it through the chord flips
      bow.side. Same ergonomics as label positioning (CanvasNode's label
      handle): the handle emits `apexdown`, EditorCanvas runs the drag.

  Geometry is imported from the library's /internals face — the SAME
  rejectionArcCurve the engine centerline and the R3 rendered arc use, so the
  editor canvas, the live preview and the simulation all agree by construction.
-->
<script setup>
import { computed } from 'vue'
import {
  rejectionArcPath,
  rejectionArrowPointsAttr,
  rejectionArcCurve,
  quadBezierPoint,
  REJECTION_COLOR,
} from '@flow-designer/library/internals'

const props = defineProps({
  // endpoint nodes — live references, so the arc follows a dragged node
  from: { type: Object, required: true },
  to: { type: Object, required: true },
  // { side: 'above'|'below', depth: number }; rejectionArcCurve fills defaults
  bow: { type: Object, default: () => ({}) },
  selected: { type: Boolean, default: false },
})
const emit = defineEmits(['edgedown', 'apexdown'])

// Node centres are the bow anchors — matching the library renderer, which
// feeds rejectionBowCurve the raw node xy (see FlowGraph rejectionEdges).
const fromPt = computed(() => ({ x: props.from.x, y: props.from.y }))
const toPt = computed(() => ({ x: props.to.x, y: props.to.y }))

const arcPath = computed(() => rejectionArcPath(fromPt.value, toPt.value, props.bow))
const arrowPoints = computed(() =>
  rejectionArrowPointsAttr(fromPt.value, toPt.value, props.bow),
)

// The apex grip sits at the Bézier midpoint (t=0.5) — the visual peak of the
// bow, and the point the depth/side drag math in EditorCanvas reads against.
const apex = computed(() => {
  const { p0, ctrl, p1 } = rejectionArcCurve(fromPt.value, toPt.value, props.bow)
  return quadBezierPoint(p0, ctrl, p1, 0.5)
})

const color = REJECTION_COLOR
</script>

<template>
  <g class="canvas-rejection-edge">
    <!-- fat transparent overlay: a comfortable click target along the arc -->
    <path
      :d="arcPath"
      fill="none"
      stroke="transparent"
      stroke-width="20"
      class="cre-hit"
      @pointerdown="emit('edgedown', $event)"
    />

    <!-- the visible dotted red arc; thickens when selected -->
    <path
      :d="arcPath"
      fill="none"
      :stroke="color"
      :stroke-width="selected ? 3.5 : 2"
      stroke-dasharray="1 5"
      stroke-linecap="round"
      stroke-linejoin="round"
      pointer-events="none"
      class="cre-arc"
    />

    <!-- small filled arrowhead at the `to` end -->
    <polygon
      :points="arrowPoints"
      :fill="color"
      stroke="none"
      pointer-events="none"
    />

    <!-- apex drag handle: sets bow.depth, flips bow.side through the chord.
         Always grabbable (apexdown selects then drags); enlarged + opaque
         when this edge is selected so it reads as the active control. -->
    <circle
      :cx="apex.x"
      :cy="apex.y"
      :r="selected ? 9 : 6"
      :fill="color"
      :fill-opacity="selected ? 1 : 0.55"
      stroke="#fbfaf7"
      stroke-width="1.5"
      class="cre-apex"
      data-rejection-apex
      @pointerdown="emit('apexdown', $event)"
    />
  </g>
</template>

<style scoped>
.cre-hit {
  cursor: pointer;
}
.cre-apex {
  cursor: grab;
}
.cre-apex:active {
  cursor: grabbing;
}
</style>
