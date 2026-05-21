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
    ref="rootEl"
    :viewBox="`${flow.viewBox.x ?? 0} ${flow.viewBox.y ?? 0} ${flow.viewBox.w} ${flow.viewBox.h}`"
    preserveAspectRatio="xMidYMid meet"
    class="flow-graph"
  >
    <!-- defs: (1) per-instance clipPath — clips all diagram rendering to the
         viewBox bounds so off-canvas nodes (e.g. n9-multilane's _start at
         x=-700) don't bleed outside the SVG element when the library is used
         standalone (parity harness, <FlowEmbed>) without a parent
         overflow:hidden container. The deck provided that containment via
         .factory-frame-large{overflow:hidden} in its CSS; the library now
         provides it SVG-internally, making it context-independent.
         (2) ink-wobble draftsman's-hand filter (locked-v2, visuals.md
         §3.0.3.LOCKED-V2 line-quality discipline). Opt-in via flow.inkWobble.
         baseFrequency / scale tuned for "confident pen line, not shaky". -->
    <defs>
      <clipPath :id="clipId">
        <rect
          :x="flow.viewBox.x ?? 0"
          :y="flow.viewBox.y ?? 0"
          :width="flow.viewBox.w"
          :height="flow.viewBox.h"
        />
      </clipPath>
      <filter v-if="flow.inkWobble" :id="wobbleId" x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" :seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="1.6" />
      </filter>
    </defs>

    <!-- Clip all diagram content to the viewBox bounds (bd ai-engineer-n2k9,
         blocker 3). Prevents off-canvas node ribbons from bleeding outside the
         SVG element in standalone / parity contexts. -->
    <g :clip-path="`url(#${clipId})`">

    <!-- Decorative guides (bd ai-engineer-lrv6.3 — flow.decorations[]).
         Static, non-agent chrome the flow author places to give the audience a
         concrete *thing* to point at — e.g. the n14 context-layer spine: a thin
         vertical neutral bar the team lanes thread through. A decoration carries
         NO agents and is NOT a flow node, so the agent graph (nodes / forks /
         merges) stays topologically untouched — exactly what the §13.7
         "minimum necessary force" before/after needs (the spine appears in
         `after` only without perturbing the pinned nine-node topology).
         Drawn FIRST inside the clip group, so ribbons and agents render OVER
         it and it reads as the layer the value streams sit on. Inert for flows
         that declare no `decorations` array. -->
    <g v-if="flow.decorations?.length" class="flow-decorations">
      <template v-for="(dec, i) in flow.decorations" :key="`dec-${i}`">
        <!-- Spine stroke. `dec.color` is an explicit author override (a raw
             hex) — used for the n14 context-layer backbone, which must read as
             a high-contrast ink/charcoal element, NOT a ribbon-scheme tone
             (bead ai-engineer-lrv6.6). When absent it falls back to the
             ribbon-scheme palette keyed by `dec.colorScheme`. -->
        <line
          v-if="dec.kind === 'spine'"
          :x1="dec.x"
          :y1="dec.y1"
          :x2="dec.x"
          :y2="dec.y2"
          :stroke="dec.color
            || RIBBON_SCHEME_COLORS[dec.colorScheme || 'neutral']
            || RIBBON_SCHEME_COLORS.neutral"
          :stroke-width="dec.width ?? 14"
          :opacity="dec.opacity ?? 0.9"
          stroke-linecap="round"
        />
        <text
          v-if="dec.kind === 'spine' && dec.label"
          :x="dec.x + (dec.labelDx ?? 0)"
          :y="(dec.labelSide === 'below' ? dec.y2 : dec.y1) + (dec.labelDy ?? 0)"
          font-family="ET Book, Georgia, serif"
          font-style="italic"
          :style="{ fontSize: '24px' }"
          fill="#555555"
          text-anchor="middle"
        >{{ dec.label }}</text>
      </template>
    </g>

    <!-- main ribbons (one per branch). Filter group applies the ink-wobble
         displacement to ALL flow paint inside it (ribbon body + pinch rose
         overlays + constraint plateau). Strokes inherit the filter so the
         draftsman's-hand quality reads consistently across the whole figure. -->
    <g :filter="flow.inkWobble ? `url(#${wobbleId})` : undefined">
      <FlowRibbon
        v-for="(branch, i) in renderBranches"
        :key="`branch-${i}`"
        :centerline="branch.centerline"
        :width-fn="branchWidthFn(branch)"
        :color="flow.ribbonColor || RIBBON_SCHEME_COLORS.neutral"
      />

      <!-- Per-segment colour-scheme overlays (bd ai-engineer-3ihf, v1.1 §3).
           RED / GREEN node segments painted over the ink base ribbon so the
           live preview matches the designer's editor canvas; NEUTRAL needs
           no overlay (it IS the ink base). Drawn over the base ribbon but
           BEFORE the junction discs, so a fork-root segment overlay cannot
           re-expose the star-burst the discs are there to cover. -->
      <path
        v-for="seg in coloredSegments"
        :key="seg.key"
        :d="seg.d"
        :fill="seg.color"
      />

      <!-- Junction caps (bd ai-engineer-05yy — the star-burst fix).
           Each branch ribbon is an independent variable-width band that
           terminates with a FLAT end-cap perpendicular to its own tangent.
           At a fork or merge, several branch ribbons share one node but
           approach it at DIFFERENT tangent angles; their rotated flat caps'
           corners protrude past one another and the union renders as a
           radiating "star-burst" spike. A filled disc of the local ribbon
           half-width is a corner-free convex cover — every incident branch's
           end-cap corner sits at exactly halfWidth from the node centre, so
           the disc absorbs every protruding cap. Drawn AFTER the ribbons
           (covers the spikes) and in the ribbon colour so the junction reads
           as a smooth rounded confluence rather than a star. Inert for
           linear flows (no fork/merge → junctionDiscs is empty). -->
      <circle
        v-for="disc in junctionDiscs"
        :key="`junction-${disc.id}`"
        :cx="disc.x"
        :cy="disc.y"
        :r="disc.r"
        :fill="disc.color"
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

    <!-- Rejection-edge arcs (v1.2 R3 — spec §4). Drawn ABOVE the ribbon layer
         so the dotted back-path reads clearly over the wheat ribbon, but
         BEFORE the agents (rendered last) so the 'revising' particles travel
         visibly ON TOP of their arc. Each rejection edge is a thin dotted
         desaturated-red quadratic-Bézier arc with an arrowhead at the `to`
         end; FlowRejectionArc derives its curve from the same rejectionBowCurve
         the engine centerline uses, so arc and physics agree by construction.
         Inert for flows without `rejections` (rejectionEdges is empty). -->
    <g v-if="rejectionEdges.length" class="flow-rejection-arcs">
      <FlowRejectionArc
        v-for="rej in rejectionEdges"
        :key="rej.key"
        :from="rej.from"
        :to="rej.to"
        :bow="rej.bow"
      />
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
        :stroke="isConstraintNode(node) ? '#E2522B' : '#15171A'"
        :stroke-width="isConstraintNode(node) ? 1.8 : 1.2"
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
         to but excluding the final endpoint), draw a hairline tick that
         crosses the band at that arc position with a small margin extending
         past each ribbon edge. The first node's left boundary and the last
         node's right boundary are NOT drawn — those are the ribbon's open
         ends and need no internal divider.

         bd ai-engineer-vw07.19: the tick is drawn PERPENDICULAR to the local
         centerline tangent, not as a pure vertical. On a steeply-curved
         branch (e.g. the n14 context-layer fan-out) a vertical tick of
         height = ribbon-width, centred on a diagonal centerline, projects
         partly OUTSIDE the ribbon — the protruding ends read as stray
         vertical segments floating in the whitespace. A tangent-perpendicular
         tick crosses the ribbon cleanly. For horizontal segments the normal
         is (0,1) so the tick stays vertical — unchanged from before. -->
    <g v-if="flow.segmentDividers" class="segment-dividers">
      <line
        v-for="d in segmentDividers"
        :key="`div-${d.key}`"
        :x1="d.x + d.nx * (d.halfH + 4)" :y1="d.y + d.ny * (d.halfH + 4)"
        :x2="d.x - d.nx * (d.halfH + 4)" :y2="d.y - d.ny * (d.halfH + 4)"
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
      :is-constraint="isConstraintNode(node)"
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

    <!-- Transform-node glyphs (v1.3 L4 — spec §4). A `transform: 'split'` or
         `'combine'` node carries a small, subtle hairline glyph centred on its
         anchor so author and audience can see which nodes change particle
         size. Split = a fork (1 → N); combine = a merge (N → 1). Drawn AFTER
         the ribbon/marker chrome but BEFORE the agents, so transiting
         particles pass over the glyph — it reads as node chrome, not paint.
         Inert for flows with no transform nodes (transformGlyphs is empty).
         Geometry comes from the pure transformGlyph.js helper. -->
    <g v-if="transformGlyphs.length" class="transform-glyphs">
      <path
        v-for="g in transformGlyphs"
        :key="`xform-${g.id}`"
        :d="g.d"
        :transform="`translate(${g.x} ${g.y})`"
        fill="none"
        :stroke="TRANSFORM_GLYPH_STROKE"
        :stroke-width="TRANSFORM_GLYPH_STROKE_WIDTH"
        :opacity="TRANSFORM_GLYPH_OPACITY"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>

    <!-- agents (rendered last so they sit ON TOP of the ribbon AND the
         rejection arcs). A 'revising' agent — one riding a rejection branch
         (v1.2 R2 lifecycle) — renders as the normal particle dot tinted
         toward REJECTION_COLOR (spec §4, Jason decision B): same dot, visibly
         travelling the back-path. A `defective` agent (bd ai-engineer-s8cm) —
         emitted red by a source's redRatio — renders SOLID red. Precedence:
         revising (a routing state) wins over defective (a work property) so
         the back-path stays legible; every other agent uses the default
         cream. -->
    <FlowAgent
      v-for="agent in agentsView"
      :key="agent.id"
      :agent-id="agent.id"
      :x="agent.x"
      :y="agent.y"
      :radius="agent.radius"
      :color="agentColor(agent)"
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

    </g><!-- end clip-path group -->
  </svg>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { createFlowSimulation } from './useFlowSimulation.js'
import { useVisibilityGate } from './useVisibilityGate.js'
import {
  computeNodeWidths,
  MIN_RIBBON_WIDTH,
  MAX_RIBBON_WIDTH,
  buildPinchWidthFn,
  segmentedRibbonLayout,
  pinchZoneArcRanges,
  pinchZoneOutlinePath,
  junctionNodeIds,
  RIBBON_SCHEME_COLORS,
  RIBBON_SCHEME_COLORS_LIGHT,
  REJECTION_PARTICLE_COLOR,
  DEFECTIVE_PARTICLE_COLOR,
  rejectionEdgeAnchors,
} from './flowCurve.js'
import {
  transformGlyphsFor,
  TRANSFORM_GLYPH_STROKE,
  TRANSFORM_GLYPH_STROKE_WIDTH,
  TRANSFORM_GLYPH_OPACITY,
} from './transformGlyph.js'
import { renderRadiusForAgent } from './agentRender.js'
import { isConstraintNode } from './nodeKind.js'
import FlowRibbon from './FlowRibbon.vue'
import FlowSegmentMarker from './FlowSegmentMarker.vue'
import FlowAgent from './FlowAgent.vue'
import FlowRejectionArc from './FlowRejectionArc.vue'

// Stable per-instance ids so multiple FlowGraph instances on one page don't
// collide on the same filter / clipPath URL references.
const wobbleId = `flow-wobble-${Math.floor(Math.random() * 1e9)}`
const clipId   = `flow-clip-${Math.floor(Math.random() * 1e9)}`

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
//
// `let`, not `const` (bd ai-engineer-f6pc): the visibility gate rebuilds the
// simulation from a clean initial state each time the slide is opened, so
// `sim` is a swappable binding. `branches` / `widths` below are NOT rebuilt —
// they are deterministic geometry derived from `props.flow`, identical across
// rebuilds, and the render-side computeds close over the `branches` const.
function buildSim() {
  return createFlowSimulation(props.flow, {
    initialAgents: props.flow.initialAgents ?? 8,
  })
}
let sim = buildSim()
const branches = sim.branches
const widths   = computeNodeWidths(props.flow)

// Render-side branch list (bd ai-engineer-yzjh). A rejection branch
// (kind:'rejection') is a routing artefact for the simulation ONLY — the
// 'revising' particles ride its centerline. It must NOT get a painted
// ribbon: a rejection edge's whole visual is the thin dotted FlowRejectionArc
// (drawn separately below). Every ribbon-painting computed — FlowRibbon,
// coloredSegments, segmentDividers, pinchZones, junctionDiscs — iterates
// `renderBranches`, never the raw `branches` (which the engine still needs
// in full for selectBranch routing).
const renderBranches = branches.filter(b => b.kind !== 'rejection')

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
// `radius` (v1.3 L4): the per-agent RENDER radius, derived from the agent's
// size — a large particle renders at 3× a small one (agentRender.js). Carried
// on the view object so the FlowAgent binding stays a plain prop read.
const agentsView = ref(
  sim.agents
    .filter(a => a.lifecycle !== 'pending')
    .map(a => ({
      id: a.id, x: a.x, y: a.y, lifecycle: a.lifecycle,
      radius: renderRadiusForAgent(a),
      // bd ai-engineer-s8cm — the engine's per-agent red (defective) flag.
      defective: !!a.defective,
    })),
)

/**
 * Fill colour for an agent dot. A 'revising' agent (riding a rejection
 * back-path) tints toward REJECTION_COLOR; a `defective` agent (red — emitted
 * per a source's redRatio, bd ai-engineer-s8cm) renders solid red; every other
 * agent uses FlowAgent's default cream (returned as `undefined`). Revising
 * wins over defective so the back-path stays legible.
 */
function agentColor(agent) {
  if (agent.lifecycle === 'revising') return REJECTION_PARTICLE_COLOR
  if (agent.defective) return DEFECTIVE_PARTICLE_COLOR
  return undefined
}

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

  // bd ai-engineer-0sdz: the non-pinch ribbon profile is the SMOOTH segmented
  // width function — a constant-width plateau per node with smoothstep
  // transition curves at every interior boundary where adjacent widths differ.
  // It replaces a hard per-node STEP function (adjacent segments jumped
  // abruptly — beige→thin-red→wide-green visibly stepped). This is the SAME
  // segmentedRibbonLayout the engine's `branch.widthFn` uses, so the rendered
  // ribbon and the physics wall-clamp agree by construction (the no-escape
  // invariant cannot drift).
  return segmentedRibbonLayout(branch, props.flow, widths).widthFn
}

// Per-segment colour-scheme overlays (bd ai-engineer-3ihf, v1.1 §3 + §7).
//
// Each v1.1 node carries a `colorScheme` ('red'|'neutral'|'green'); the live
// preview ribbon paints that node's ribbon segment in the scheme colour so
// the preview matches the designer's editor canvas (which colours node
// handles by the same scheme). NEUTRAL needs no overlay — it is the ink base
// the FlowRibbon already draws — so a default-scheme (or pre-v1.1) flow
// renders identically to before; only RED / GREEN segments contribute an
// overlay path. The overlay uses pinchZoneOutlinePath over the node's
// latency-proportioned arc-range: the exact ribbon shape over that stretch.
//
// REACTIVE: a computed() so the overlays re-derive when the `flow` prop
// changes (the before/after click-toggle idiom — see junctionDiscs / pinch).
// bd ai-engineer-0sdz §8.4 — TWO-TONE per-segment overlay. Each non-neutral
// coloured segment paints its constant-width PLATEAU in the full scheme tone
// and its transition-curve WINGS in a lighter tone (RIBBON_SCHEME_COLORS_LIGHT,
// the scheme colour mixed 45% toward white) — mirroring the locked-v2
// PINCH_ROSE-vs-CONSTRAINT_ROSE grammar so the curve reads lighter than the
// straight part. NEUTRAL segments stay un-overlaid (the wheat base ribbon).
const coloredSegments = computed(() => {
  const out = []
  // Locked-v2 pinch flows keep the legacy FLAT per-segment overlay — their
  // ribbon profile is buildPinchWidthFn, not the segmented layout, and the
  // dusty-rose pinch overlay already carries the constraint's two-tone read.
  if (props.flow.pinchMode === 'constraint-only') {
    renderBranches.forEach((branch, bi) => {
      const segLens = branchLatencyArc(branch)
      const wfn = branchWidthFn(branch)
      const total = branch.centerline.totalLength
      let acc = 0
      for (let i = 0; i < branch.nodeIds.length; i++) {
        const sStart = acc
        const sEnd = Math.min(acc + segLens[i], total)
        acc += segLens[i]
        const node = props.flow.nodes.find(n => n.id === branch.nodeIds[i])
        const scheme = (node && node.colorScheme) || 'neutral'
        if (scheme === 'neutral') continue
        const color = RIBBON_SCHEME_COLORS[scheme]
        if (!color) continue
        const d = pinchZoneOutlinePath(branch.centerline, wfn, { sStart, sEnd })
        if (d) out.push({ key: `seg-${bi}-${i}`, d, color })
      }
    })
    return out
  }
  // Non-pinch flows: smooth segmented layout → plateau + lighter wings.
  renderBranches.forEach((branch, bi) => {
    const { widthFn, segments } = segmentedRibbonLayout(branch, props.flow, widths)
    segments.forEach((seg, i) => {
      const node = props.flow.nodes.find(n => n.id === seg.nodeId)
      const scheme = (node && node.colorScheme) || 'neutral'
      if (scheme === 'neutral') return
      const full  = RIBBON_SCHEME_COLORS[scheme]
      const light = RIBBON_SCHEME_COLORS_LIGHT[scheme]
      if (!full) return
      const pd = pinchZoneOutlinePath(branch.centerline, widthFn, seg.plateau)
      if (pd) out.push({ key: `seg-${bi}-${i}-p`, d: pd, color: full })
      // Transition wings — lighter tone (only present where adjacent widths
      // differ; null at the ribbon's open ends).
      ;[['l', seg.leftWing], ['r', seg.rightWing]].forEach(([wk, wing]) => {
        if (!wing) return
        const wd = pinchZoneOutlinePath(branch.centerline, widthFn, wing)
        if (wd) out.push({ key: `seg-${bi}-${i}-w${wk}`, d: wd, color: light })
      })
    })
  })
  return out
})

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
  renderBranches.forEach((branch, bi) => {
    const segLens = branchLatencyArc(branch)
    const wfn = branchWidthFn(branch)
    let acc = 0
    for (let i = 0; i < segLens.length - 1; i++) {
      acc += segLens[i]
      const sBoundary = Math.min(acc, branch.centerline.totalLength)
      const pt = branch.centerline.pointAtArcLength(sBoundary)
      const tan = branch.centerline.tangentAtArcLength(sBoundary)
      const halfH = wfn(sBoundary) / 2
      // Unit normal = tangent rotated 90°: (-ty, tx). The divider tick is
      // drawn along this normal so it crosses the ribbon perpendicular to the
      // local flow direction (bd ai-engineer-vw07.19). Horizontal tangent
      // (1,0) → normal (0,1) → vertical tick, identical to the legacy render.
      result.push({
        key: `${bi}-${i}`,
        x: pt.x,
        y: pt.y,
        halfH,
        nx: -tan.y,
        ny: tan.x,
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
  return renderBranches.map(branch => {
    const wfn = buildPinchWidthFn(branch, props.flow)
    const ranges = pinchZoneArcRanges(branch, props.flow)
    return {
      upstreamPath:   pinchZoneOutlinePath(branch.centerline, wfn, ranges.upstream),
      downstreamPath: pinchZoneOutlinePath(branch.centerline, wfn, ranges.downstream),
      constraintPath: pinchZoneOutlinePath(branch.centerline, wfn, ranges.constraintPlateau),
    }
  })
})

// Junction caps (bd ai-engineer-05yy — the star-burst fix). One disc per
// fork/merge node. Branch ribbons that meet at a shared node terminate with
// flat end-caps perpendicular to their differing tangents; the caps' corners
// protrude past one another and render as a radiating star-burst. A disc of
// the local ribbon half-width is a corner-free convex cover that absorbs
// every protruding cap (each cap corner sits at exactly halfWidth from the
// node centre).
//
// Radius = the LARGEST band half-width among the branches incident to the
// node. A junction node is always at an endpoint of each incident branch —
// the FIRST node of every outgoing branch (fork) and the LAST node of every
// incoming branch (merge) — so the width function is sampled at s=0 or
// s=totalLength accordingly; an interior position falls back to the
// latency-distributed segment start. Taking the max keeps the disc covering
// the widest incident cap even when widths differ across the junction.
//
// REACTIVE: a computed() so the discs re-derive when the `flow` prop changes
// (the N16/N17 before/after click-toggle idiom — see pinchZones above).
const junctionDiscs = computed(() => {
  const ids = junctionNodeIds(props.flow)
  if (ids.size === 0) return []
  const discs = []
  for (const id of ids) {
    const node = props.flow.nodes.find(n => n.id === id)
    if (!node) continue
    let maxW = 0
    for (const branch of renderBranches) {
      const idx = branch.nodeIds.indexOf(id)
      if (idx < 0) continue
      const wfn = branchWidthFn(branch)
      const total = branch.centerline.totalLength
      let s
      if (idx === 0) {
        s = 0
      } else if (idx === branch.nodeIds.length - 1) {
        s = total
      } else {
        const segLens = branchLatencyArc(branch)
        let acc = 0
        for (let i = 0; i < idx; i++) acc += segLens[i]
        s = Math.min(acc, total)
      }
      const w = wfn(s)
      if (typeof w === 'number' && w > maxW) maxW = w
    }
    // Junction-disc colour follows the junction node's own colorScheme
    // (bd ai-engineer-3ihf) so the star-burst cover blends with its coloured
    // segment overlays rather than punching a contrasting hole through them.
    // A neutral junction defers to the flow's `ribbonColor` (legacy) or the
    // wheat neutral default — matching the base ribbon exactly.
    const scheme = node.colorScheme || 'neutral'
    const color = scheme === 'neutral'
      ? (props.flow.ribbonColor || RIBBON_SCHEME_COLORS.neutral)
      : (RIBBON_SCHEME_COLORS[scheme] || RIBBON_SCHEME_COLORS.neutral)
    if (maxW > 0) discs.push({ id, x: node.x, y: node.y, r: maxW / 2, color })
  }
  return discs
})

// Rejection-edge arc data (v1.2 R3 — spec §4). Resolve each rejection edge's
// `from`/`to` node ids to their geometric anchors so FlowRejectionArc can draw
// the bow. A dangling reference (missing node) is skipped — validateFlow flags
// it; the renderer must not crash on a transient mid-edit designer state.
//
// REACTIVE: a computed() so the arcs re-derive when the `flow` prop changes
// (the before/after click-toggle idiom — see junctionDiscs / pinchZones).
const rejectionEdges = computed(() => {
  const byId = new Map(props.flow.nodes.map(n => [n.id, n]))
  const out = []
  const rejList = props.flow.rejections || []
  // bd ai-engineer-91ds: anchor the arc on the band EDGE, not the node
  // centerline — so the dotted arc peels off the SIDE of the ribbon. The
  // per-node half-width comes from computeNodeWidths (re-derived here so the
  // arcs stay correct across a before/after `flow`-prop swap).
  const rejWidths = rejList.length ? computeNodeWidths(props.flow) : null
  rejList.forEach((rej, i) => {
    if (rej == null) return
    const f = byId.get(rej.from)
    const t = byId.get(rej.to)
    if (!f || !t) return
    const { fromPt, toPt } = rejectionEdgeAnchors(f, t, rej.bow, rejWidths)
    out.push({
      key: `rej-${i}`,
      from: fromPt,
      to: toPt,
      bow: rej.bow,
    })
  })
  return out
})

// Transform-node glyphs (v1.3 L4 — spec §4). One descriptor per `split` /
// `combine` node — kind + local glyph path + node anchor. A computed() so the
// glyphs re-derive when the `flow` prop changes (the before/after click-toggle
// idiom — see rejectionEdges / junctionDiscs / pinchZones). Empty for flows
// with no transform nodes, so a pre-v1.3 flow renders unchanged.
const transformGlyphs = computed(() => transformGlyphsFor(props.flow))

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
// bd ai-engineer-8aee (M2 §5.3): forks/merges are first-class v2 objects.
// A v2 fork's branches are `{ to, rateShare }` objects (the rateShare carries
// the rate split); a v2 merge's upstream nodes live under `from`. The
// `typeof b === 'string'` and `m.branches` fallbacks keep any v1-shaped flow
// (pre-migration) rendering unchanged.
const forkRootIds = new Set(
  (props.flow.forks || []).flatMap(f =>
    (f.branches || []).map(b => (typeof b === 'string' ? b : b.to))),
)
const preMergeIds = new Set(
  (props.flow.merges || []).flatMap(m => m.from || m.branches || []),
)

function markerPropsFor(node) {
  // Find the branch this node is on. If a node appears on multiple branches
  // (e.g. a merge node post-merge linear continuation seeds a new branch),
  // we pick the FIRST branch — the one whose centerline best owns the node's
  // segment for labeling purposes.
  //
  // bd ai-engineer-i84q: select from `renderBranches`, not the raw `branches`.
  // A rejection branch (kind:'rejection') is a routing artefact whose
  // centerline is a back-path bow — it must never supply a node-marker /
  // fork-merge label anchor. If a node sits ONLY on a rejection branch (it is
  // the `from`/`to` of a rejection edge and on no forward ribbon), the raw
  // `branches.find` would anchor its label off that bow; filtering to
  // renderBranches drops it to the orphan-anchor path below (anchor at the
  // node's own xy), which is the correct, geometry-free placement.
  const branch = renderBranches.find(b => b.nodeIds.includes(node.id))
  // Orphan-node guard (flow-designer M3): a node may legitimately be on NO
  // branch — e.g. a node the interactive designer has placed but not yet
  // connected with an edge. validateFlow() does not treat that as an error,
  // so the renderer must not crash on it. Anchor the marker at the node's own
  // xy with a horizontal tangent and zero band; there is no segment geometry.
  // The deck's authored flows never produce orphans, so this path is inert
  // there; it exists for the designer's transient mid-edit states.
  if (!branch) {
    return {
      startPoint:   { x: node.x, y: node.y },
      endPoint:     { x: node.x, y: node.y },
      startTangent: { x: 1, y: 0 },
      endTangent:   { x: 1, y: 0 },
      bandWidthAtStart: 0,
      bandWidthAtEnd:   0,
      bandWidthAtLabel: 0,
      labelCenterlineY: node.y,
      labelAnchorX:     node.x,
    }
  }
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

// ── visibility-gated RAF loop (bd ai-engineer-f6pc) ─────────────────────────
// THE PILE-UP FIX. The RAF loop used to start at onMounted and run forever —
// every flow simulation kept stepping in the background on every slide, so by
// slide 18 of a 20-minute talk its constraint showed minutes of piled-up
// backlog instead of a fresh animation.
//
// Now the loop runs ONLY while this embed is visible (on-screen AND the
// browser tab foregrounded — see useVisibilityGate). Each time the slide is
// opened, `startFresh()` rebuilds the simulation from a clean initial state
// (dropping any backlog from a prior visit) and restarts the loop; leaving
// the slide stops it. Every visit therefore replays fresh and the audience
// watches the bottleneck form live (Jason 2026-05-20).
//
// The simulation core itself is RAF-free; this is just the live-render
// driver. Headless tests should call sim.step(dt) directly.
const rootEl = ref(null)
let rafId = null
let lastT = null

function syncAgentsView() {
  // Filter pending agents out of the render list — see agentsView above.
  agentsView.value = sim.agents
    .filter(a => a.lifecycle !== 'pending')
    .map(a => ({
      id: a.id, x: a.x, y: a.y, lifecycle: a.lifecycle,
      radius: renderRadiusForAgent(a),
      // bd ai-engineer-s8cm — the engine's per-agent red (defective) flag.
      defective: !!a.defective,
    }))
}

function frame(t) {
  if (lastT === null) lastT = t
  const dt = Math.min((t - lastT) / 1000, 1 / 30)
  lastT = t
  sim.step(dt)
  syncAgentsView()
  rafId = requestAnimationFrame(frame)
}

function stopLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  lastT = null
}

function startFresh() {
  // Rebuild from a clean initial state, then (re)start the RAF loop.
  stopLoop()
  sim = buildSim()
  syncAgentsView()
  rafId = requestAnimationFrame(frame)
}

useVisibilityGate(rootEl, { onShow: startFresh, onHide: stopLoop })
onBeforeUnmount(stopLoop)
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
   `overflow: hidden` on the SVG would crush the flex-computed width on
   two-child layouts (N4/N5/N6 = FlowGraph + YearReadoutChrome siblings).
   Off-canvas content is clipped SVG-internally via the `<clipPath>` in
   the template `<defs>` (bd ai-engineer-n2k9 blocker 3) — a clipPath
   rect matching the viewBox keeps ribbons within the visible area without
   affecting flex sizing. The deck's .factory-frame-large{overflow:hidden}
   provides a second CSS-level containment layer on top. See: bead
   ai-engineer-de0d (P1) + ai-engineer-gf1y (P2) + ai-engineer-n2k9. */
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
