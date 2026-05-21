<!--
  FlowSegmentMarker.vue — per-segment annotation: boundary ticks,
  italic ET Book label with hairline leader line back to the segment
  midpoint, and optional firebrick hatching above constraint segments.

  Spec §234: leader lines (hairline 0.6 px) connect labels to the segments
             they describe.
  Spec §235: boundary ticks — short perpendicular hairlines (1.0–1.2 px)
             just outside the ribbon at the start and end of each segment.
             Constraint ticks firebrick; others mid-grey (#555).
  Spec §237: agents are cream circles (handled by FlowAgent.vue, not here).

  Props:
    startPoint, endPoint     — { x, y } on the centerline at segment boundaries
    startTangent, endTangent — unit tangents at those boundaries
    label                    — string, italic ET Book set near the segment
    isConstraint             — boolean; firebrick ticks/label/hatching when true
    labelDx, labelDy         — offset from segment midpoint (viewBox units)
                               to the label anchor — caller positions to
                               avoid collisions
    hatchWidth               — width of the constraint hatching band
-->
<template>
  <g class="flow-segment-marker" :class="{ constraint: isConstraint }">
    <!-- Boundary ticks. Two visual registers:
           - perpendicular (default, iter-1): short hairlines normal to the
             local tangent, anchored on the centerline.
           - fence-post (locked-v2 + bd ai-engineer-4nb): a SINGLE vertical
             hairline directly under each label, dropping from just below
             the label baseline down to the band's TOP edge at the label's
             x-position. Matches the source-inspiration mockup
             (assets/mockups/n4-simulation/09-pinch-jason-curved.png) AND
             the original IsometricFactory Station.vue label register
             (single leader from station box edge to label). Per Jason
             2026-05-17b: "I liked the labels better in the original
             diagrams, the font seemed closer to the source inspiration
             and the vertical lines help."
             Pre-4nb the fence-post style drew paired uprights at segment
             boundaries (4 posts per segment, anchored at start/end x).
             That was a different register — never matched the mockup. -->
    <template v-if="markerStyle === 'fence-post'">
      <!-- label anchor line: vertical hairline from below label baseline
           down to the station-box top edge (when boxTopY is provided —
           see bead ai-engineer-nnm + 1pv) or to the band's top edge
           (default — pure-ribbon test page register). The line starts a
           few units below the text baseline so it doesn't crash into
           descenders (`g`, `p`, `y` in the labels) and ends just OUTSIDE
           the box / band edge so the line doesn't visually merge with
           the ribbon ink.
           bd ai-engineer-1pv: when boxTopY is set (station-box chrome
           present via FlowGraph's showBoxes — see bead nnm), the leader
           anchors to the box top instead of band top. This restores the
           original IsometricFactory Station.vue label-leader register
           (Jason image #5: italic ABOVE station box + vertical leader
           dropping to box). Per visuals.md §11.8 table row 1.
           Stroke 1.0 for parity with Station.vue's leader; the visual
           weight comes from the descent length, not from stroke ink. -->
      <line
        :x1="labelAnchor.x" :y1="labelAnchor.y + 6"
        :x2="labelAnchor.x" :y2="leaderDescentEndY"
        :stroke="tickColor" :stroke-width="1.0"
        stroke-linecap="round"
      />
    </template>
    <template v-else>
      <line
        :x1="startTick.x1" :y1="startTick.y1"
        :x2="startTick.x2" :y2="startTick.y2"
        :stroke="tickColor" :stroke-width="1.2"
        stroke-linecap="round"
      />
      <line
        :x1="endTick.x1" :y1="endTick.y1"
        :x2="endTick.x2" :y2="endTick.y2"
        :stroke="tickColor" :stroke-width="1.2"
        stroke-linecap="round"
      />
    </template>

    <!-- leader line: hairline 0.6 px from the label anchor back to the
         segment midpoint. We trim the leader's segment-side endpoint so it
         lands JUST outside the ribbon edge rather than at the centerline
         (which would draw the leader INTO the ribbon and disappear behind
         it). Trim distance = half the ribbon width plus a 4-unit gap.
         Suppressed in fence-post mode — the locked-v2 mockup has labels
         floating directly above the fence-posts with no connecting leader. -->
    <line
      v-if="markerStyle !== 'fence-post'"
      :x1="leaderStart.x" :y1="leaderStart.y"
      :x2="leaderEnd.x"   :y2="leaderEnd.y"
      :stroke="tickColor"
      stroke-width="0.6"
      stroke-linecap="round"
    />

    <!-- italic ET Book label, positioned at the label anchor (caller-driven
         offset from midpoint via labelDx / labelDy). Font sizes are
         expressed via CSS `style` rather than the SVG `font-size` attribute,
         because Slidev/UnoCSS rewrites unitless presentation attributes
         (we observed `font-size="16"` rendering at computed 64px). Using
         the CSS `font-size` declaration with explicit `px` units (in SVG
         user space) yields the marginalia register we want.
         bd ai-engineer-4nb: matches the original IsometricFactory
         Station.vue label register (24px italic, single colour
         differentiation between normal and constraint — no size diff).
         Jason 2026-05-17b: "I liked the labels better in the original
         diagrams, the font seemed closer to the source inspiration." -->
    <text
      :x="labelAnchor.x"
      :y="labelAnchor.y"
      font-family="ET Book, Georgia, serif"
      font-style="italic"
      :style="{ fontSize: '24px', textTransform: markerStyle === 'fence-post' ? 'lowercase' : 'none' }"
      :fill="tickColor"
      text-anchor="middle"
    >
      {{ label }}
    </text>

    <!-- constraint hatching: faint diagonal hairlines in a band drawn near
         the label (above when labelDy < 0, below when labelDy > 0).
         Suppressed in fence-post mode — the firebrick tick-marks and label
         already carry the constraint emphasis; the diagonal hatching would
         compete visually with the fence-posts. -->
    <g v-if="isConstraint && markerStyle !== 'fence-post'">
      <defs>
        <pattern :id="hatchId" patternUnits="userSpaceOnUse" :width="6" :height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#E2522B" stroke-width="0.6" />
        </pattern>
      </defs>
      <rect
        :x="labelAnchor.x - hatchWidth / 2"
        :y="labelAnchor.y + (labelDy < 0 ? 8 : -28)"
        :width="hatchWidth"
        :height="14"
        :fill="`url(#${hatchId})`"
        style="opacity:0.6"
      />
    </g>
  </g>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  startPoint:   { type: Object, required: true },
  endPoint:     { type: Object, required: true },
  startTangent: { type: Object, required: true },
  endTangent:   { type: Object, required: true },
  label:          { type: String, required: true },
  isConstraint:   { type: Boolean, default: false },
  hatchWidth:     { type: Number, default: 200 },
  labelDx:        { type: Number, default: 0 },
  labelDy:        { type: Number, default: -45 },
  // verticalLeader: when true, the leader line is drawn straight vertical
  // (x = midpoint.x constant) so it reads as a clean perpendicular drop
  // from the label to the ribbon — the "early diagram" register Jason
  // specified (2026-05-16: "straight vertical leader lines pointing up
  // to node names, no angled leaders").
  verticalLeader: { type: Boolean, default: false },
  // markerStyle: 'perpendicular' (default, iter-1) | 'fence-post' (4nb).
  //   fence-post renders a single vertical hairline directly under the label,
  //   from below label baseline down to the band's top edge at the label's
  //   x-position. Source-mockup register; matches the original
  //   IsometricFactory Station.vue label-leader convention.
  markerStyle: { type: String, default: 'perpendicular' },
  // Local band width at the segment boundaries (viewBox units). Retained
  // for backwards-compatibility with the legacy paired-post fence style
  // (currently unused in the active fence-post path) and for future
  // diagnostics. SAFE to ignore in flow definitions.
  bandWidthAtStart: { type: Number, default: 0 },
  bandWidthAtEnd:   { type: Number, default: 0 },
  // Local band width at the LABEL's x-position (viewBox units). Used by
  // markerStyle='fence-post' to anchor the label-drop hairline at the
  // band's top edge directly below the label. Computed in FlowGraph.vue
  // via projecting the labelAnchor.x onto the centerline + widthFn(s).
  bandWidthAtLabel: { type: Number, default: 0 },
  // Centerline y-coordinate at the LABEL's x-position. Used by fence-post
  // style to anchor the line drop endpoint on the band's actual top
  // (centerlineY - bandWidthAtLabel/2). For horizontal flows this is
  // simply the constant centerline y; for curved flows it tracks the
  // local centerline.
  labelCenterlineY: { type: Number, default: 0 },
  // bd ai-engineer-1pv: when station-box chrome is rendered (FlowGraph
  // showBoxes — see bead nnm), the leader descent ends at the box's
  // top edge instead of the band top. Pass the box-top y-coordinate
  // here; null (default) preserves the legacy band-top anchor.
  boxTopY: { type: Number, default: null },
  // bd ai-engineer-gv8u: fork/merge-aware label-anchor override.
  // When the flow declares forks: [] or merges: [], FlowGraph computes
  // a SHIFTED label position along the segment (downstream for fork-roots,
  // upstream for pre-merge nodes) instead of the segment midpoint.
  // FlowGraph passes the computed centerline-x here so the labelAnchor
  // computation uses the shifted x rather than the geometric midpoint x.
  // null (default) preserves legacy midpoint-anchored behaviour.
  labelAnchorX: { type: Number, default: null },
})

const tickHalf  = 8                                 // half perpendicular tick length
const leaderPad = 14                                // gap between leader end and ribbon

const tickColor = computed(() => props.isConstraint ? '#E2522B' : '#555555')

// bd ai-engineer-1pv: fence-post label-leader descent endpoint.
// When boxTopY is provided (station-box chrome present), the leader
// descends to just above the box top so it visibly anchors to the box.
// Otherwise it descends to just above the band top (legacy behaviour —
// the pure-ribbon test-page register).
const leaderDescentEndY = computed(() => {
  if (props.boxTopY != null) {
    // Land 2 px above the box top so the line and box outline don't
    // collide visually — the label "drops to" the box, doesn't pierce it.
    return props.boxTopY - 2
  }
  return props.labelCenterlineY - props.bandWidthAtLabel / 2 - 2
})

// Boundary-tick perpendiculars: rotate tangent 90° CCW for normal.
const nStart = computed(() => ({ x: -props.startTangent.y, y: props.startTangent.x }))
const nEnd   = computed(() => ({ x: -props.endTangent.y,   y: props.endTangent.x   }))

const startTick = computed(() => ({
  x1: props.startPoint.x + nStart.value.x * tickHalf,
  y1: props.startPoint.y + nStart.value.y * tickHalf,
  x2: props.startPoint.x - nStart.value.x * tickHalf,
  y2: props.startPoint.y - nStart.value.y * tickHalf,
}))
const endTick = computed(() => ({
  x1: props.endPoint.x + nEnd.value.x * tickHalf,
  y1: props.endPoint.y + nEnd.value.y * tickHalf,
  x2: props.endPoint.x - nEnd.value.x * tickHalf,
  y2: props.endPoint.y - nEnd.value.y * tickHalf,
}))

const midpoint = computed(() => ({
  x: (props.startPoint.x + props.endPoint.x) / 2,
  y: (props.startPoint.y + props.endPoint.y) / 2,
}))

// bd ai-engineer-gv8u: anchorBase replaces midpoint as the label-positioning
// origin when FlowGraph passes labelAnchorX (computed from a fork/merge-
// declared fraction along the segment instead of the geometric midpoint).
// y still tracks labelCenterlineY (the centerline y at the shifted x) so the
// label sits above/below the actual ribbon at the shifted x. Falls back to
// midpoint for any flow that doesn't use fork/merge declarations.
const anchorBase = computed(() => {
  if (props.labelAnchorX != null) {
    return { x: props.labelAnchorX, y: props.labelCenterlineY || midpoint.value.y }
  }
  return midpoint.value
})

// labelAnchor: when verticalLeader, x is pinned to anchorBase.x (ignore labelDx).
// The label sits directly above or below the ribbon at the anchor base for the
// clean "early diagram" register — no lateral drift.
const labelAnchor = computed(() => ({
  x: props.verticalLeader ? anchorBase.value.x : anchorBase.value.x + props.labelDx,
  y: anchorBase.value.y + props.labelDy,
}))

// Leader line: from a point just BELOW the label baseline (so the leader
// doesn't crash into the text) to a point just OUTSIDE the ribbon (so the
// leader doesn't disappear into the ink).
const leaderStart = computed(() => {
  // Anchor slightly below the label baseline if label is above, above if below.
  const dirY = props.labelDy < 0 ? 6 : -16   // text baseline correction
  return { x: labelAnchor.value.x, y: labelAnchor.value.y + dirY }
})
const leaderEnd = computed(() => {
  // bd ai-engineer-gv8u: leader lines anchor at anchorBase (the shifted
  // fork/merge label-anchor), NOT the geometric segment midpoint. Without
  // this, fork-root and pre-merge labels have leader lines that point at
  // the segment midpoint while the label itself sits at the 85% / 20%
  // mark — producing the very "crossing leaders" failure mode bd-w9nh
  // describes. With this, each leader line drops cleanly to the ribbon
  // directly below its label, no diagonal cross-talk.
  if (props.verticalLeader) {
    // Straight vertical drop/rise: x is constant at anchorBase.x.
    const signY = props.labelDy < 0 ? -1 : 1
    return { x: anchorBase.value.x, y: anchorBase.value.y + signY * leaderPad }
  }
  // Default: vector from anchorBase toward label anchor, normalised, then
  // back off leaderPad units from the anchorBase along that vector.
  const dx = labelAnchor.value.x - anchorBase.value.x
  const dy = labelAnchor.value.y - anchorBase.value.y
  const mag = Math.hypot(dx, dy)
  if (mag < 1e-6) return { x: anchorBase.value.x, y: anchorBase.value.y }
  return {
    x: anchorBase.value.x + (dx / mag) * leaderPad,
    y: anchorBase.value.y + (dy / mag) * leaderPad,
  }
})

// Unique pattern id per instance so multiple constraint markers don't clash.
const hatchId = `flow-hatch-${Math.floor(Math.random() * 1e9)}`
</script>
