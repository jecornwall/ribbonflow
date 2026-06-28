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

  v1.3 L5 (bead ai-engineer-dkcr): a split / combine node carries a small badge
  at its top-right showing the §4 transform glyph (a fork for split, a merge
  for combine) so the author sees which nodes transform particle size without
  opening the inspector. The glyph path geometry is the library's own
  `transformGlyphFor` (the same helper the preview renderer draws from), so the
  canvas badge and the rendered slide stay glyph-identical by construction.
-->
<script setup>
import { computed } from 'vue'
import { transformGlyphFor } from '@ribbonflow/core'
import { NODE_RADIUS } from '../lib/constants.js'

const props = defineProps({
  node: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  // node sits outside the slide frame — flagged with a warning ring
  // (bd ai-engineer-oxcq)
  outOfBounds: { type: Boolean, default: false },
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

// ── v1.3 transform badge ─────────────────────────────────────────────────────
// transformGlyphFor returns { id, kind, d, x, y } for a split/combine node, or
// null for a 'none' node — so `glyph` doubles as the v-if. The glyph path `d`
// is in glyph-local coords (spans x −8..8, y −6..6); we draw it inside a small
// badge disc pinned to the handle's top-right corner.
const glyph = computed(() => transformGlyphFor(props.node))
const BADGE_RADIUS = 12
const badgeX = computed(() => props.node.x + NODE_RADIUS)
const badgeY = computed(() => props.node.y - NODE_RADIUS)
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
    <!-- out-of-bounds warning ring: a node sitting outside the slide frame
         (bd ai-engineer-oxcq) — pointer-transparent so it never steals a click -->
    <circle
      v-if="outOfBounds"
      :cx="node.x"
      :cy="node.y"
      :r="NODE_RADIUS + 9"
      fill="none"
      stroke="#dc2626"
      stroke-width="3"
      stroke-dasharray="5 4"
      pointer-events="none"
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
    <!-- v1.3 transform badge — split (fork) / combine (merge) glyph, pinned
         to the handle's top-right. Pointer-transparent so it never steals a
         click; the glyph path comes verbatim from the library helper. -->
    <g
      v-if="glyph"
      class="cn-xform-badge"
      :data-transform="glyph.kind"
      pointer-events="none"
    >
      <circle
        :cx="badgeX"
        :cy="badgeY"
        :r="BADGE_RADIUS"
        fill="#fff"
        stroke="#15171A"
        stroke-width="1.5"
      />
      <path
        :d="glyph.d"
        :transform="`translate(${badgeX} ${badgeY})`"
        fill="none"
        stroke="#15171A"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
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
