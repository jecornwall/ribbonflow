<!--
  FlowRejectionArc.vue — one rejection edge (v1.2 R3, spec §4).

  Renders a "failed-review back-path" as a thin, dotted, desaturated-red
  quadratic-Bézier arc with a small arrowhead at the `to` end. The arc curve
  comes from rejectionBowCurve (via flowRejectionArc.js) — the SAME curve the
  engine uses for the rejection-branch centerline (buildRejectionCenterline),
  so the visible arc and the path the 'revising' particles travel agree by
  construction.

  Props:
    from — { x, y } anchor of the node where the rejection branches (the
           review step). The arrow points AWAY from here.
    to   — { x, y } anchor of the node the rejected work returns to.
    bow  — { side: 'above'|'below', depth: number } arc geometry. Optional;
           rejectionBowCurve fills its own defaults when omitted.
    color — stroke colour; defaults to REJECTION_COLOR.

  Single-purpose: no simulation, no state. The geometry lives in the pure,
  node:test-covered flowRejectionArc.js helper; this SFC is the SVG shell.
-->
<template>
  <g class="flow-rejection-arc">
    <!-- the dotted bow arc -->
    <path
      :d="arcPath"
      fill="none"
      :stroke="color"
      :stroke-width="strokeWidth"
      :stroke-dasharray="dashArray"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <!-- small filled arrowhead at the `to` end -->
    <polygon :points="arrowPoints" :fill="color" stroke="none" />
  </g>
</template>

<script setup>
import { computed } from 'vue'
import { REJECTION_COLOR } from './flowCurve.js'
import {
  rejectionArcPath,
  rejectionArrowPointsAttr,
  REJECTION_ARC_STROKE_WIDTH,
  REJECTION_ARC_DASHARRAY,
} from './flowRejectionArc.js'

const props = defineProps({
  from: { type: Object, required: true },
  to: { type: Object, required: true },
  bow: { type: Object, default: () => ({}) },
  color: { type: String, default: REJECTION_COLOR },
})

const strokeWidth = REJECTION_ARC_STROKE_WIDTH
const dashArray = REJECTION_ARC_DASHARRAY

const arcPath = computed(() => rejectionArcPath(props.from, props.to, props.bow))
const arrowPoints = computed(() =>
  rejectionArrowPointsAttr(props.from, props.to, props.bow),
)
</script>
