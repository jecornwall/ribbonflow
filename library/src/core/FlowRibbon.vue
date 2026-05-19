<!--
  FlowRibbon.vue — variable-width ribbon (closed filled SVG path).

  Props:
    centerline — { sample, pointAtArcLength, tangentAtArcLength, totalLength }
                 from flowCurve.buildCenterline()
    widthFn    — (s: number) => number — width in viewBox units at arc length s
    color      — defaults to '#15171A' (ink)
-->
<template>
  <path :d="d" :fill="color" />
</template>

<script setup>
import { computed } from 'vue'
import { ribbonOutlinePath } from './flowCurve.js'

const props = defineProps({
  centerline: { type: Object, required: true },
  widthFn:    { type: Function, required: true },
  color:      { type: String, default: '#15171A' },
})

const d = computed(() => ribbonOutlinePath(props.centerline, props.widthFn))
</script>
