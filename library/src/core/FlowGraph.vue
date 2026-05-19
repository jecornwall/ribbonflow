<!--
  FlowGraph.vue — top-level renderer for one flow.

  Props:
    flow — the flow config (see deck/flows/*.js)

  Mounts the simulation, drives a requestAnimationFrame loop, renders
  the ribbon for each branch, segment markers for each node, and one
  FlowAgent per agent.

  Headless-testing note: the simulation core (createFlowSimulation in
  useFlowSimulation.js) is pure JS and exposes `sim.step(dt)`. Tests and
  smoke checks should drive it deterministically via step(dt); the RAF
  loop below is only the live-render driver.
-->
<template>
  <svg
    :viewBox="`${flow.viewBox.x ?? 0} ${flow.viewBox.y ?? 0} ${flow.viewBox.w} ${flow.viewBox.h}`"
    preserveAspectRatio="xMidYMid meet"
    class="flow-graph"
  >
    <!-- defs: ink-wobble draftsman's-hand filter (locked-v2, visuals.md
         §3.0.3.LOCKED-V2 line-quality discipline). Opt-in via flow.inkWobble.
         baseFrequency / scale tuned for "confident pen line, not shaky". -->
    <defs v-if="flow.inkWobble">
      <filter :id="wobbleId" x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" :seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="1.6" />
      </filter>
    </defs>

    <!-- main ribbons (one per branch). Filter group applies the ink-wobble
         displacement to ALL flow paint inside it (ribbon body + pinch rose
         overlays + constraint plateau). Strokes inherit the filter so the
         draftsman's-hand quality reads consistently across the whole figure. -->
    <g :filter="flow.inkWobble ? `url(#${wobbleId})` : undefined">
      <FlowRibbon
        v-for="(branch, i) in branches"
        :key="`branch-${i}`"
        :centerline="branch.centerline"
        :width-fn="branchWidthFn(branch)"
        :color="flow.ribbonColor || '#15171A'"
      />

      <!-- Pinch-zone rose overlays (locked-v2). One pair per branch that
           contains a constraint: dusty-rose fill on the upstream and downstream
           transition triangles; deeper rose plateau on the constraint segment.
           Rendered after the wheat ribbon so they sit on top. -->
      <g v-if="flow.pinchMode === 'constraint-only'">
        <template v-for="(zone, i) in pinchZones" :key="`pinch-${i}`">
          <path
            v-if="zone.upstreamPath"
            :d="zone.upstreamPath"
            :fill="flow.pinchFillColor || '#e6c8c8'"
          />
          <path
            v-if="zone.downstreamPath"
            :d="zone.downstreamPath"
            :fill="flow.pinchFillColor || '#e6c8c8'"
          />
          <path
            v-if="zone.constraintPath"
            :d="zone.constraintPath"
            :fill="flow.constraintFillColor || '#d8a8a8'"
          />
        </template>
      </g>
    </g>

    <!-- station boxes (bd ai-engineer-nnm): isometric rotated-rectangle
         (parallelogram) station-box chrome matching the original
         IsometricFactory Station.vue register. Hairline outline only —
         no fill — so the cream ribbon flows visibly THROUGH the box and
         both vocabularies coexist (Jason: "Ribbon runs through boxes;
         both coexist"). Per visuals.md §11.8 table row 2.
         Rendered AFTER ribbons (sit ON TOP of the ribbon paint) so the
         outline reads cleanly over the cream ribbon fill; without "no
         fill" the box would occlude the agents transiting it. Stations
         are the talk's vocabulary — Problem definition / Solution design
         / Implementation / Test / Deploy — these are *named stations*,
         not abstract flow points, and the chrome makes that legible.
         BOX_HALF=70, skew=20 — frozen against Station.vue defaults so
         the iter-3 embed in FactoryYearRecap (q94 iter-5 propagation)
         reads at parity with the legacy IsometricFactory plate. -->
    <g v-if="flow.showBoxes" class="station-boxes-iso">
      <polygon
        v-for="node in flow.nodes"
        :key="`box-${node.id}`"
        :points="isoBoxPoints(node)"
        fill="none"
        :stroke="node.kind === 'constraint' ? '#E2522B' : '#15171A'"
        :stroke-width="node.kind === 'constraint' ? 1.8 : 1.2"
      />
    </g>

    <!-- segment dividers (bd ai-engineer-b57i): vertical hairline ticks at
         segment boundaries. Tufte-minimalist alternative to station boxes —
         the reader still SEES the segmentation (the five stages of the
         enterprise flow) but as marginalia-weight marks not cartoon-box
         outlines. Per Jason 2026-05-18 screenshot feedback on N3: "Don't
         like the squares · segment the pipes with some vertical lines
         instead".

         For each interior boundary between consecutive nodes on a branch
         (i.e. boundaries at arc=segLens[0], segLens[0]+segLens[1], ... up
         to but excluding the final endpoint), draw a vertical hairline
         spanning the band's full height at that arc position with a small
         margin extending above and below the ribbon edge. The first node's
         left boundary and the last node's right boundary are NOT drawn —
         those are the ribbon's open ends and need no internal divider. -->
    <g v-if="flow.segmentDividers" class="segment-dividers">
      <line
        v-for="d in segmentDividers"
        :key="`div-${d.key}`"
        :x1="d.x" :y1="d.y - d.halfH - 4"
        :x2="d.x" :y2="d.y + d.halfH + 4"
        stroke="#555555"
        stroke-width="0.8"
        stroke-linecap="round"
      />
    </g>

    <!-- stage-anchor notches (bd ai-engineer-m1h5 + bd ai-engineer-lofq):
         per-node vertical notch through the band at each non-constraint,
         non-_start node's xy anchor (or labelX when set). Tufte-minimalist
         segmentation grammar — the audience now SEES where each named
         stage sits on its lane. Notch pairs with the fence-post label
         leader dropping from above, so the two reads align.

         bd-lofq (Jason 2026-05-19 ~14:23): the original m1h5 fix used
         stroke-width=1.0 and opacity=0.55 — hairline notches invisible
         at projection size (4m-wide cinema viewed from 10m). Bumped to
         stroke-width=2.5 + opacity=0.85, and extended by 6 viewBox units
         above and below the band so the notch protrudes from the ribbon
         (the audience reads "this is a stage divider," not a faint mark
         buried inside the wheat). Width 2.5 reads as ~6mm at projection
         (10× the prior 0.6mm), well above the 4mm minimum for
         marginalia-weight ticks. Opacity 0.85 keeps it from competing
         with the firebrick constraint emphasis. -->
    <g v-if="flow.stageAnchors" class="stage-anchor-notches">
      <line
        v-for="node in flow.nodes.filter(
          n => n.id !== flow.entryId && n.kind !== 'constraint' && n.label
        )"
        :key="`anchor-${node.id}`"
        :x1="node.labelX ?? node.x"
        :y1="node.y - (flow.bandWidth ?? 70) / 2 - 6"
        :x2="node.labelX ?? node.x"
        :y2="node.y + (flow.bandWidth ?? 70) / 2 + 6"
        stroke="#555555"
        stroke-width="2.5"
        stroke-linecap="round"
        opacity="0.85"
      />
    </g>

    <!-- segment markers (one per node, drawn on the branch it belongs to).
         labelAnchorX (bd ai-engineer-gv8u): when the flow declares forks/merges,
         markerPropsFor returns a fork/merge-aware label-anchor x-coordinate
         that shifts fork-root labels DOWNSTREAM (toward the lane) and pre-merge
         labels UPSTREAM (away from the convergence wedge). The marker uses
         this as the anchor base for label position + leader line; unaffected
         for flows that don't declare forks/merges (labelAnchorX → undefined →
         marker falls back to segment midpoint).

         bd-lofq (Jason 2026-05-19): SKIP rendering for empty-label nodes
         (e.g. the off-canvas _start virtual node in n9-multilane.js).
         Previously the fence-post leader still drew at the empty label's
         x, producing a small "start pattern" artifact at the fork root
         that read as noise to the audience. With this guard, _start is
         truly invisible and the three lanes appear to emerge from the
         left edge of the viewBox without a visible origin marker. -->
    <FlowSegmentMarker
      v-for="node in flow.nodes.filter(n => n.label)"
      :key="`marker-${node.id}`"
      v-bind="markerPropsFor(node)"
      :label="markerLabelFor(node)"
      :is-constraint="node.kind === 'constraint'"
      :label-dx="labelOffsetFor(node).dx"
      :label-dy="labelOffsetFor(node).dy"
      :vertical-leader="!!(flow.verticalLeaders)"
      :marker-style="flow.fenceMarkers ? 'fence-post' : 'perpendicular'"
      :box-top-y="flow.showBoxes ? (node.y - BOX_HALF_ISO) : null"
    />

    <!-- Ghost markers (bd ai-engineer-2dbw): display-only labels for stages
         collapsed into a single after-state station. Not simulation nodes —
         no routing, no capacity effects. Rendered at flow.ghostOpacity
         (default 0.3) with a fence-post leader from the label toward the
         ribbon edge, matching the fence-post marker register of the live
         segment markers above.

         Positioning: ghostMarker.labelDy > 0 → label is BELOW the ribbon
         (text.y = gm.y + gm.labelDy). Leader goes from just above the
         text top (toward ribbon) upward to just below the ribbon bottom.
         labelDy < 0 → above ribbon: leader goes downward to band top.

         Used by n18-speckit-alignment-after.js to preserve the 4 collapsed
         reviewer stages (legal, sec, data, comms) visually present in the
         after-state so the crossfade reads "absorbed" not "vanished". -->
    <g
      v-if="flow.ghostMarkers?.length"
      class="ghost-markers"
      :opacity="flow.ghostOpacity ?? 0.3"
    >
      <g
        v-for="gm in flow.ghostMarkers"
        :key="`ghost-${gm.label}`"
      >
        <!-- Fence-post leader: vertical hairline from label toward ribbon.
             Below-ribbon (labelDy > 0): from (textBaseline − 10) up to
             (centerline + bandWidth/2 + 2). Mirrors fence-post style in
             FlowSegmentMarker but without the full markerPropsFor geometry. -->
        <line
          :x1="gm.x"
          :y1="gm.labelDy >= 0
            ? (gm.y + gm.labelDy) - 10
            : (gm.y + gm.labelDy) + 10"
          :x2="gm.x"
          :y2="gm.labelDy >= 0
            ? gm.y + (flow.bandWidth ?? 70) / 2 + 2
            : gm.y - (flow.bandWidth ?? 70) / 2 - 2"
          stroke="#555555"
          stroke-width="1.0"
          stroke-linecap="round"
        />
        <!-- Italic ET Book label at the ghost position.
             Same 24px / italic / mid-grey register as live segment markers.
             No colour differentiation (all 4 are equally collapsed/parallel). -->
        <text
          :x="gm.x"
          :y="gm.y + gm.labelDy"
          font-family="ET Book, Georgia, serif"
          font-style="italic"
          :style="{ fontSize: '24px' }"
          fill="#555555"
          text-anchor="middle"
        >{{ gm.label }}</text>
      </g>
    </g>

    <!-- agents (rendered last so they sit ON TOP of the ribbon) -->
    <FlowAgent
      v-for="agent in agentsView"
      :key="agent.id"
      :x="agent.x"
      :y="agent.y"
    />

    <!-- Minard-style inset legend strip — visuals.md §10.5.
         Anchored at x=40, y≈820 in the 1600×900 viewBox.
         Trapezoid swatch: left edge 4 px tall (MIN_RIBBON_WIDTH=10),
         right edge 28 px tall (MAX_RIBBON_WIDTH=70), 120 viewBox units wide.
         Heights are scaled proportionally: maxSwatchHalf=14 → left=2, right=14.
         Font-size via CSS `style` to survive Slidev/UnoCSS attribute rewriting.
         Suppressed when flow.showLegend === false (locked-v2 mockup has no
         inline legend; the constraint reads directly from the firebrick).  -->
    <g v-if="flow.showLegend !== false" class="minard-legend">
      <!-- Swatch: trapezoid morphing MIN→MAX ribbon width over 120 viewBox px. -->
      <!-- Left edge (x=40): MIN_RIBBON_WIDTH=10 → half-height 2; y=833–837.   -->
      <!-- Right edge (x=160): MAX_RIBBON_WIDTH=70 → half-height 14; y=821–849.-->
      <polygon
        points="40,833 160,821 160,849 40,837"
        fill="#15171A"
      />
      <!-- Primary legend text: encoding semantics. -->
      <text
        x="176" y="835"
        font-family="ET Book, Georgia, serif"
        font-style="italic"
        :style="{ fontSize: '18px' }"
        fill="#333333"
        dominant-baseline="middle"
      >width encodes throughput</text>
      <!-- Secondary legend text: actual numeric ratio for this flow (if derivable). -->
      <text
        v-if="legendRatioLabel"
        x="176" y="853"
        font-family="ET Book, Georgia, serif"
        font-style="italic"
        :style="{ fontSize: '14px' }"
        fill="#777777"
        dominant-baseline="middle"
      >{{ legendRatioLabel }}</text>
    </g>
  </svg>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { createFlowSimulation } from './useFlowSimulation.js'
import {
  computeNodeWidths,
  MIN_RIBBON_WIDTH,
  MAX_RIBBON_WIDTH,
  buildPinchWidthFn,
  pinchZoneArcRanges,
  pinchZoneOutlinePath,
} from './flowCurve.js'
import FlowRibbon from './FlowRibbon.vue'
import FlowSegmentMarker from './FlowSegmentMarker.vue'
import FlowAgent from './FlowAgent.vue'

// Stable per-instance id for the ink-wobble filter so multiple FlowGraph
// instances on one page don't collide on the same filter URL.
const wobbleId = `flow-wobble-${Math.floor(Math.random() * 1e9)}`

// bd ai-engineer-nnm: isometric station-box geometry, frozen against
// Station.vue's defaults (BOX_HALF=70, skew=20). Kept here as module-
// scope constants so the template's `:box-top-y` binding can reference
// BOX_HALF_ISO without re-deriving it per render.
const BOX_HALF_ISO = 70
const SKEW_ISO     = 20

/**
 * Compute the parallelogram polygon points for an isometric station box
 * centred on the given node. Mirrors Station.vue#boxPoints — top-right-
 * bottom-left vertex order with a rightward skew. Used by the showBoxes
 * render path so the iter-3 ribbon's station chrome matches the legacy
 * IsometricFactory's Station.vue chrome at parity.
 */
function isoBoxPoints(node) {
  const x = node.x
  const y = node.y
  const w = BOX_HALF_ISO
  const h = BOX_HALF_ISO
  const s = SKEW_ISO
  const top   = `${x - w},${y - h}`
  const right = `${x + w + s},${y - h + s}`
  const bot   = `${x + w},${y + h}`
  const left  = `${x - w - s},${y + h - s}`
  return `${top} ${right} ${bot} ${left}`
}

const props = defineProps({
  flow: { type: Object, required: true },
  // showMetrics — when true, segment labels include `· cap N · Ks` suffixes;
  // when false (default), labels show only the segment name. Jason 2026-05-16
  // feedback: "The numbers indicating cap and flow are too much by default.
  // We may introduce them in specific instances."
  showMetrics: { type: Boolean, default: false },
})

// Build the simulation up front; expose reactive snapshot for the template.
// initialAgents is sourced from the flow definition (fallback 8) so each flow
// owns its own seeding density — N4 uses 24 to keep the river visibly full.
const sim = createFlowSimulation(props.flow, {
  initialAgents: props.flow.initialAgents ?? 8,
})
const branches = sim.branches
const widths   = computeNodeWidths(props.flow)

// ── Minard legend strip (visuals.md §10.5) ────────────────────────────────
// Derive the constraint and widest segment labels so the secondary legend line
// can show the actual throughput ratio for this flow (e.g. "Review handles 1
// unit · Ship handles 7").  Only emitted when both nodes are unambiguously
// identifiable from the flow definition — falls back to null (no second line).
const legendConstraintNode = props.flow.nodes.find(n => n.kind === 'constraint')
const legendWidestEntry = Object.entries(widths)
  .filter(([, w]) => typeof w === 'number')
  .reduce((best, [id, w]) => (w > best[1] ? [id, w] : best), ['', 0])
const legendWidestNode = legendWidestEntry[0]
  ? props.flow.nodes.find(n => n.id === legendWidestEntry[0])
  : null
// Width ratio = widest node / constraint node (from the computed widths map).
// This is the Minard convention: ribbon widths ARE proportional to throughput,
// so the width ratio equals the throughput ratio in the display.
// Using actual computed widths (not MAX/MIN constants) so the ratio is correct
// for any flow, not just N4 where nodes happen to hit the boundary constants.
// (bead ai-engineer-usk)
const legendWidthRatio = (legendConstraintNode && legendWidestEntry[1] && widths[legendConstraintNode.id])
  ? Math.round(legendWidestEntry[1] / widths[legendConstraintNode.id])
  : Math.round(MAX_RIBBON_WIDTH / MIN_RIBBON_WIDTH)
const legendRatioLabel = (legendConstraintNode && legendWidestNode)
  ? `${legendConstraintNode.label} handles 1 unit · ${legendWidestNode.label} handles ${legendWidthRatio}`
  : null
// Filter pending agents out of the render list. Pending agents are conceptually
// "not yet started" — they pile up at a single off-canvas anchor and would
// otherwise render as a smudge near the entry. The simulation core still
// tracks them (and promotes them when entry frees); we just don't draw them.
const agentsView = ref(
  sim.agents
    .filter(a => a.lifecycle !== 'pending')
    .map(a => ({ id: a.id, x: a.x, y: a.y })),
)

/**
 * Compute the proportional arc-length occupied by each node on a branch.
 *
 * The centerline's actual totalLength is a geometric quantity (Catmull-Rom
 * path length); per-node `latency × baseSpeed` is a notional quantity that
 * does NOT generally equal the centerline length. Naively using the latter
 * for segment endpoints (as v1 did) means the last segment never reaches
 * its width — e.g. on branch [review, ship] the ribbon stayed at review's
 * width for the entire centerline because `latency × baseSpeed` summed to
 * 360 while the geometric length was ~286. Spec §289 invariant fails.
 *
 * Fix: distribute the centerline's totalLength proportionally to each
 * node's latency. Same monotone ordering, but the LAST node now actually
 * gets its share.
 */
function branchLatencyArc(branch) {
  const latencies = branch.nodeIds.map(id =>
    props.flow.nodes.find(n => n.id === id).latency
  )
  const sum = latencies.reduce((a, b) => a + b, 0)
  const total = branch.centerline.totalLength
  return latencies.map(l => (l / sum) * total)
}

function branchWidthFn(branch) {
  // Locked-v2 (visuals.md §3.0.3.LOCKED-V2): smooth wineglass pinch with
  // a single constraint plateau, regardless of per-node throughput. Used
  // by n4-toc-baseline.js and any future single-constraint flow.
  if (props.flow.pinchMode === 'constraint-only') {
    return buildPinchWidthFn(branch, props.flow)
  }

  // Legacy: per-node throughput-encoded step function. Each segment renders
  // at its node's computed width; transitions are sample-by-sample linear ramps
  // between adjacent widths. Retained for iter-1 variants (n4-flow-a/b) and
  // for the upcoming n9-multilane.js width-encodes-throughput register.
  const segLens = branchLatencyArc(branch)
  return (s) => {
    let acc = 0
    for (let i = 0; i < branch.nodeIds.length; i++) {
      if (s <= acc + segLens[i]) return widths[branch.nodeIds[i]]
      acc += segLens[i]
    }
    return widths[branch.nodeIds[branch.nodeIds.length - 1]]
  }
}

// Segment-divider tick positions for each branch (bd ai-engineer-b57i).
// For each INTERIOR boundary between consecutive nodes on a branch, sample
// the centerline at that arc position and the band's width function so the
// divider line spans the local band height. The first and last boundaries
// (ribbon open ends) are omitted — only the dividers BETWEEN segments are
// drawn. Tufte register: hairline 0.8px, 4-unit margin above and below the
// band edge.
//
// REACTIVE (bd ai-engineer-o2d9): wrapped in computed() so the dividers
// recompute when the `flow` prop changes — needed for the slide-side
// `$clicks > 0 ? after : before` toggle on N16/N17 (Invest:Local /
// Invest:Global). The IIFE form captured `props.flow` at mount and the
// after-state's dividers were drawn with stale before-state geometry.
const segmentDividers = computed(() => {
  if (!props.flow.segmentDividers) return []
  const result = []
  branches.forEach((branch, bi) => {
    const segLens = branchLatencyArc(branch)
    const wfn = branchWidthFn(branch)
    let acc = 0
    for (let i = 0; i < segLens.length - 1; i++) {
      acc += segLens[i]
      const sBoundary = Math.min(acc, branch.centerline.totalLength)
      const pt = branch.centerline.pointAtArcLength(sBoundary)
      const halfH = wfn(sBoundary) / 2
      result.push({
        key: `${bi}-${i}`,
        x: pt.x,
        y: pt.y,
        halfH,
      })
    }
  })
  return result
})

// Pinch-zone SVG paths. Each branch that contains a constraint contributes
// up to three paths: upstream rose triangle, downstream rose triangle,
// constraint-plateau deeper-rose rectangle. The width fn used to build
// these paths must match the one driving the main ribbon — that's the
// point of the smooth pinch profile, the overlays trace the same outline.
//
// REACTIVE (bd ai-engineer-o2d9): wrapped in computed() so the rose
// overlays recompute when the `flow` prop changes.
//
// Why this matters: slides N16/N17 (Invest: Local / Global) use the idiom
//   `<FlowGraph :flow="$clicks > 0 ? after : before" />`
// to morph the before/after state on click. The cream ribbon already
// updated correctly because `branchWidthFn(branch)` is invoked fresh each
// render (the template binding `:width-fn="branchWidthFn(branch)"` returns
// a new function reference per render, triggering FlowRibbon's `computed`
// d-path to recompute). But the rose-pinch overlay was previously an IIFE
// — captured at mount with the BEFORE flow def — so the after-state still
// painted the BEFORE state's pink wedge on top of the (now wider) cream
// ribbon. Audience read: "still narrow at CI/CD" — message-visual
// contradiction (Q1 fails on the audience-blink-test). Converting to
// computed() makes the rose overlay disappear cleanly when the after-state
// has no kind:'constraint' (and re-render with new geometry if a different
// constraint is set).
const pinchZones = computed(() => {
  if (props.flow.pinchMode !== 'constraint-only') return []
  return branches.map(branch => {
    const wfn = buildPinchWidthFn(branch, props.flow)
    const ranges = pinchZoneArcRanges(branch, props.flow)
    return {
      upstreamPath:   pinchZoneOutlinePath(branch.centerline, wfn, ranges.upstream),
      downstreamPath: pinchZoneOutlinePath(branch.centerline, wfn, ranges.downstream),
      constraintPath: pinchZoneOutlinePath(branch.centerline, wfn, ranges.constraintPlateau),
    }
  })
})

// ── Fork / Merge first-class primitives (bd ai-engineer-gv8u) ───────────────
// A flow may declare optional `forks: [{from, branches}]` and
// `merges: [{to, branches}]` arrays. These do NOT change ribbon geometry —
// that's already derived from `successors` via buildBranches(). The renderer
// uses these declarations ONLY as LABEL-PLACEMENT HINTS:
//
//   - A "fork-root" node (member of forks[i].branches) is the FIRST lane node
//     after a fork. Its in-branch segment SPANS from the off-canvas / pre-fork
//     prefix into the lane proper — the latency-distributed segment midpoint
//     therefore lands in the pre-fork region (off-canvas in the n9-multilane
//     case where _start sits at viewBox x=-300). Fork-root labels anchor
//     directly at the NODE's own geometric position instead.
//
//   - A "pre-merge" node (member of merges[i].branches) is the LAST lane node
//     before a merge. Its segment spans from the node into the converging
//     wedge; the latency-distributed midpoint lands close to the merge target.
//     Pre-merge labels anchor directly at the NODE's own geometric position
//     instead, keeping each lane's label attached to its own lane.
//
// Both adjustments are NO-OPs for flows that don't declare forks/merges
// (the sets stay empty; node skips into the legacy midpoint branch). Schema
// is purely additive — existing flows continue to render unchanged.
//
// Why node-position-anchor and not segment-fraction? The latency-proportioned
// branchLatencyArc() segLens do NOT correspond to where the node's anchor
// actually sits on the Catmull-Rom centerline. Anchor geometry is determined
// by chord lengths between consecutive anchors (centripetal alpha=0.5
// parameterisation). For nodes near the ends of a branch (fork-roots and
// pre-merges), the segLens-based midpoint can be hundreds of arc-units away
// from the actual node position. Anchoring directly at node.{x,y} gives a
// clean vertical leader from label to node and reads as "the label belongs
// to this node" — which is the entire point.
const forkRootIds = new Set(
  (props.flow.forks || []).flatMap(f => f.branches || [])
)
const preMergeIds = new Set(
  (props.flow.merges || []).flatMap(m => m.branches || [])
)

function markerPropsFor(node) {
  // Find the branch this node is on. If a node appears on multiple branches
  // (e.g. a merge node post-merge linear continuation seeds a new branch),
  // we pick the FIRST branch — the one whose centerline best owns the node's
  // segment for labeling purposes.
  const branch = branches.find(b => b.nodeIds.includes(node.id))
  const cl = branch.centerline
  const segLens = branchLatencyArc(branch)
  // Use the actual ribbon width function for this branch — pinch-aware in
  // locked-v2 mode, throughput-encoded otherwise — so fence-post tick-marks
  // anchor at the *visible* band edges, not at a separate stale per-node width.
  const wfn = branchWidthFn(branch)
  let sStart = 0
  for (let i = 0; i < branch.nodeIds.length; i++) {
    if (branch.nodeIds[i] === node.id) {
      const sEnd = Math.min(sStart + segLens[i], cl.totalLength)
      // Band width AT the label midpoint (bd ai-engineer-4nb). The
      // fence-post style anchors a single vertical hairline under the
      // label dropping to the band's top edge — needs band width at the
      // label's x-position (= centre of the segment in arc-length, which
      // maps via cl.pointAtArcLength to the label x).
      const sLabel = Math.min((sStart + sEnd) / 2, cl.totalLength)
      const labelPoint = cl.pointAtArcLength(sLabel)

      // bd ai-engineer-gv8u: fork-root / pre-merge label override.
      // For these nodes, anchor the label directly at the NODE's own
      // geometric position rather than at the segment midpoint. This
      // gives a clean vertical leader from label to node and ensures the
      // label sits on the lane THAT THE NODE OWNS rather than drifting
      // into pre-fork or post-merge centerline regions.
      //
      // bd ai-engineer-m1h5 (extension): the original gv8u rule only
      // covered fork-roots and pre-merges, leaving LANE-INTERIOR nodes
      // (e.g. design, design-review on the top lane of n9-multilane) to
      // fall through to the latency-distributed segment-midpoint path.
      // For composed flows whose branches include an off-canvas _start
      // → fork prefix, that prefix consumes a large fraction of the
      // branch's arc-length, and the midpoint of a lane-interior node's
      // arc-segment lands on the diagonal _start→fork-root up-ramp
      // rather than on the horizontal lane itself. Audience-POV result:
      // labels stack vertically at the left third of the lane with
      // tick-leaders pointing at almost-identical positions.
      //
      // Fix: in composed flows (forks OR merges declared), anchor ALL
      // non-_start node labels at their xy positions. Lane-interior
      // labels now sit on their own lane segments at their actual node
      // anchors; fence-post leaders drop straight down to the band at
      // each node x; the lane reads as a sequence of named stages each
      // with its own label anchored over its own segment.
      //
      // bandWidthAtLabel uses the wfn at the segment midpoint as a
      // reasonable proxy — at a single node position the band width is
      // dominated by the constraint flag and the constraintPlateauWidth,
      // not by the precise s-coordinate, so this is good enough for the
      // fence-post leader drop's length calculation.
      const hasComposition = forkRootIds.size > 0 || preMergeIds.size > 0
      const useNodeAnchor = hasComposition && node.id !== props.flow.entryId
      // bd-lofq (Jason 2026-05-19): per-node labelX/labelY override.
      // When a flow declares labelX on a node, the label anchors at that
      // x rather than at the node's geometric x. Lanes with composed
      // topologies (n9-multilane) frequently have nodes packed at one
      // end of the visible lane (e.g. top lane nodes at x=200-760 inside
      // a visible lane extent of x=-200 to x=950). Anchoring labels at
      // node.x leaves the rest of the lane unlabelled — Jason's complaint
      // "labels clustered right-half, left ~40% has no labels". Per-node
      // labelX puts label-distribution under the flow author's control;
      // see n9-multilane.js for the spread values. labelY (optional)
      // overrides the centerline-y the leader projects onto — useful when
      // the lane curves diagonally and the author wants the leader to
      // land on the horizontal portion of the band rather than the
      // diagonal arc.
      const hasLabelOverride = node.labelX !== undefined
      const finalLabelAnchorX = hasLabelOverride
        ? node.labelX
        : (useNodeAnchor ? node.x : labelPoint.x)
      const finalLabelCenterlineY = hasLabelOverride
        ? (node.labelY ?? node.y)
        : (useNodeAnchor ? node.y : labelPoint.y)

      return {
        startPoint:   cl.pointAtArcLength(sStart),
        endPoint:     cl.pointAtArcLength(sEnd),
        startTangent: cl.tangentAtArcLength(sStart),
        endTangent:   cl.tangentAtArcLength(sEnd),
        bandWidthAtStart: wfn(sStart),
        bandWidthAtEnd:   wfn(sEnd),
        bandWidthAtLabel: wfn(sLabel),
        labelCenterlineY: finalLabelCenterlineY,
        // bd ai-engineer-gv8u + ai-engineer-m1h5 + bd-lofq: expose the
        // label-anchor x so FlowSegmentMarker uses the node-anchored
        // position (composed flows) or the labelX override (lofq) rather
        // than the segment midpoint. null/undefined falls back to midpoint
        // inside the marker — preserved for non-composed flows w/o labelX.
        labelAnchorX: (useNodeAnchor || hasLabelOverride) ? finalLabelAnchorX : null,
      }
    }
    sStart += segLens[i]
  }
  // Shouldn't reach here — fall through to end of branch.
  return {
    startPoint:       cl.pointAtArcLength(0),
    endPoint:         cl.pointAtArcLength(cl.totalLength),
    startTangent:     cl.tangentAtArcLength(0),
    endTangent:       cl.tangentAtArcLength(cl.totalLength),
    bandWidthAtStart: wfn(0),
    bandWidthAtEnd:   wfn(cl.totalLength),
    bandWidthAtLabel: wfn(cl.totalLength / 2),
    labelCenterlineY: cl.pointAtArcLength(cl.totalLength / 2).y,
  }
}

function markerLabelFor(node) {
  return props.showMetrics
    ? `${node.label} · cap ${node.capacity} · ${node.latency}s`
    : node.label
}

/**
 * Per-node label offset (viewBox units) for collision-avoidance in the
 * N4 topology. Generic algorithmic placement is a follow-up; for v1 we
 * hand-tune the canonical N4 layout so labels:
 *   - sit OUTSIDE the ribbon eye (above the upper arch, below the lower
 *     arch), so the leader lines read "this label refers to that segment"
 *   - the firebrick "Review" gets extra clearance above the build/test-prep
 *     merge so it doesn't collide with "Build"
 *   - "Ship" sits below-right to clear the post-merge centerline
 * Falls back to a generic above-the-midpoint placement for non-N4 flows.
 */
function labelOffsetFor(node) {
  // Per-node override: flow definitions may carry labelDx / labelDy directly
  // on the node object. This is the preferred approach for non-N4 flows and
  // for variant layouts that need different offsets without touching this file.
  if (node.labelDx !== undefined || node.labelDy !== undefined) {
    return { dx: node.labelDx ?? 0, dy: node.labelDy ?? -60 }
  }
  // Fallback: hand-tuned N4 canonical offsets. viewBox is 1600×900. Labels sit
  // OUTSIDE the eye-shape of the build/test-prep fork-and-merge so leader lines
  // land cleanly. Offsets were tuned by inspection of the v1 review captures
  // (build+review overlap; intake+test-prep overlap). Generic algorithm is a
  // follow-up; this hand-tune is correct for N4 and any flow with the same
  // node topology.
  const offsetMap = {
    intake:      { dx: -80,  dy: 100 },  // below-left, well away from test-prep
    design:      { dx: -90,  dy: -60 },  // above-left of mid-arch
    build:       { dx: -20,  dy: -80 },  // above the upper arch
    'test-prep': { dx:  20,  dy: 100 },  // below the lower arch
    review:      { dx:  90,  dy: -90 },  // above-right of the merge, firebrick
    ship:        { dx:  60,  dy: 100 },  // below-right, away from review
  }
  return offsetMap[node.id] ?? { dx: 0, dy: -60 }
}

// RAF loop. The simulation core itself is RAF-free; this is just the
// live-render driver. Headless tests should call sim.step(dt) directly.
let rafId = null
let lastT = null
function frame(t) {
  if (lastT === null) lastT = t
  const dt = Math.min((t - lastT) / 1000, 1 / 30)
  lastT = t
  sim.step(dt)
  agentsView.value = sim.agents
    .filter(a => a.lifecycle !== 'pending')
    .map(a => ({ id: a.id, x: a.x, y: a.y }))
  rafId = requestAnimationFrame(frame)
}
onMounted(() => { rafId = requestAnimationFrame(frame) })
onBeforeUnmount(() => { if (rafId) cancelAnimationFrame(rafId) })
</script>

<style scoped>
/* SVG sizing mirrors IsometricFactory.vue's `.if-svg` rule: width fills the
   parent, height auto-derives from the viewBox aspect ratio. With
   preserveAspectRatio="xMidYMid meet" the inner content letterboxes
   inside whatever element box the browser computes.

   Why not `height: 100%`? Inside a flex container the SVG element would
   then collapse to its intrinsic 300×150 default OR overflow when the
   parent doesn't define a definite height — both produce wrong sizes.
   `height: auto` lets the SVG keep its natural aspect-derived height,
   matching how the IsometricFactory has rendered cleanly since v1.

   overflow: visible (NOT hidden): n9-multilane.js uses an off-canvas
   `_start` node at SVG x=-300 to round-robin into three lane starts.
   `overflow: hidden` on the SVG clips content to the element box,
   which also crushes the flex-computed width on two-child layouts
   (N4/N5/N6 = FlowGraph + YearReadoutChrome siblings). Clipping is
   instead handled by the parent .factory-frame-large container via
   `overflow: hidden` in deck/style.css — a CSS-level clip that is
   cleaner than SVG-internal clipping and doesn't interfere with flex
   sizing. See: bead ai-engineer-de0d (P1) + ai-engineer-gf1y (P2). */
.flow-graph {
  /* bd ai-engineer-b57i: SVG background is TRANSPARENT, not solid #F4F2ED.
     Jason 2026-05-18 N3 screenshot feedback: "Background should match with
     overall background" — the grey panel inside the figure differed from
     the slide's off-white #fffff8 (--paper). Removing the SVG background
     lets the slide's paper colour show through naturally, so FlowGraph
     instances inherit the slide bg wherever they're embedded (N3/N4/N5/N6/
     N7/N8 + N16/N17/N18). Cleaner than per-slide CSS overrides. */
  background: transparent;
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  display: block;
  overflow: visible;
}
</style>
