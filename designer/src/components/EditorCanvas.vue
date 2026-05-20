<!--
  EditorCanvas.vue — the static, manipulable editing surface.

  This is NOT the library renderer: it is a purpose-built editing view (M3
  spec §2.2). It draws node handles, directed edges and label handles, and
  owns the drag / selection / tool interaction model. The animated render of
  the same flow lives in PreviewPane.

  Coordinate space is the flow's own viewBox, so a node at (x, y) sits at the
  same logical point here and in the preview. Pointer coordinates are mapped
  back into viewBox units via svgCoords (M3 spec §3.3).
-->
<script setup>
import { ref, computed } from 'vue'
import {
  REJECTION_COLOR,
  computeNodeWidths,
  rejectionEdgeAnchors,
} from '@flow-designer/library/internals'
import { useFlowDoc } from '../state/useFlowDoc.js'
import { clientToSvg } from '../lib/svgCoords.js'
import { GRID_SIZE } from '../lib/constants.js'
import { slideFrame, inflateRect, viewBoxStr, GUTTER_FRAC } from '../lib/slideFrame.js'
import CanvasNode from './CanvasNode.vue'
import CanvasEdge from './CanvasEdge.vue'
import CanvasRejectionEdge from './CanvasRejectionEdge.vue'

const doc = useFlowDoc()
const state = doc.state

const svgRef = ref(null)
// active drag, one of:
//   { kind: 'node'|'label', id, offX, offY }
//   { kind: 'rejection-apex', from, to }   ← v1.2 R5 bow-depth/side drag
// or null
let drag = null
// live pointer position in viewBox units (for the add-edge rubber-band)
const ptr = ref({ x: 0, y: 0 })

// ── slide frame (bd ai-engineer-qe6d) ────────────────────────────────────────
// The slide-scope frame guide: the flow's viewBox, drawn as a 16:9 bounding box
// so authored flows are designed to fit within a deck slide. The canvas viewBox
// expands the frame by a gutter margin so content placed *outside* the slide
// stays visible against the dimmed gutter rather than being clipped away.
const frame = computed(() => slideFrame(state.flow))
const inflated = computed(() => inflateRect(frame.value, GUTTER_FRAC))
const canvasBox = computed(() => viewBoxStr(inflated.value))
// Node ids sitting outside the slide frame — flagged with a warning ring
// (bd ai-engineer-oxcq).
const outOfBounds = computed(() => new Set(doc.outOfBoundsIds.value))

// Derive the edge list from per-node successors (the library's topology
// storage). Each edge carries live references to its endpoint nodes.
const edges = computed(() => {
  const byId = new Map(state.flow.nodes.map((n) => [n.id, n]))
  const out = []
  for (const n of state.flow.nodes) {
    for (const s of n.successors || []) {
      const to = byId.get(s)
      if (to) out.push({ id: `${n.id}->${s}`, from: n, to, fromId: n.id, toId: s })
    }
  }
  return out
})

// Rejection edges (v1.2 R5) — resolve each `flow.rejections[]` entry's
// from/to ids to their live node objects so CanvasRejectionEdge can bow the
// arc between them. A dangling reference (missing endpoint) is skipped — it
// is a transient mid-edit state validateFlow flags; the canvas must not crash.
const rejectionEdges = computed(() => {
  const byId = new Map(state.flow.nodes.map((n) => [n.id, n]))
  const out = []
  for (const rej of state.flow.rejections || []) {
    if (!rej) continue
    const from = byId.get(rej.from)
    const to = byId.get(rej.to)
    if (from && to) {
      out.push({
        id: `rej:${rej.from}->${rej.to}`,
        from,
        to,
        bow: rej.bow,
        fromId: rej.from,
        toId: rej.to,
      })
    }
  }
  return out
})

// Per-node ribbon widths (bd ai-engineer-91ds) — feeds CanvasRejectionEdge so
// a rejection arc anchors on the band EDGE, not the node centerline. Re-derives
// whenever the flow's nodes / widths change.
const nodeWidths = computed(() => computeNodeWidths(state.flow))

const pendingFromNode = computed(() =>
  state.pendingEdgeFrom ? doc.findNode(state.pendingEdgeFrom) : null,
)

// The rubber-band hints at what is being drawn: green for a forward edge,
// the rejection red for an add-rejection link.
const linkColor = computed(() =>
  state.tool === 'add-rejection' ? REJECTION_COLOR : '#16a34a',
)

function svgPoint(e) {
  return clientToSvg(svgRef.value, e.clientX, e.clientY)
}

function isSelectedNode(id) {
  return state.selection.kind === 'node' && state.selection.id === id
}
function isSelectedEdge(edge) {
  const s = state.selection
  return (
    s.kind === 'edge' &&
    s.edge &&
    s.edge.from === edge.fromId &&
    s.edge.to === edge.toId
  )
}
function isSelectedRejection(edge) {
  const s = state.selection
  return (
    s.kind === 'rejection' &&
    s.edge &&
    s.edge.from === edge.fromId &&
    s.edge.to === edge.toId
  )
}

// ── two-click link tools (add-edge / add-rejection) ──────────────────────────
// Both tools work the same way: first node click chooses the `from` endpoint
// (held in pendingEdgeFrom, shown as a rubber-band), second click commits.
// The active tool decides which kind of link is created.
const linkTools = new Set(['add-edge', 'add-rejection'])
const isLinkTool = computed(() => linkTools.has(state.tool))

function pickForLink(id) {
  if (!state.pendingEdgeFrom) {
    doc.setPendingEdge(id)
  } else {
    if (state.tool === 'add-rejection') {
      doc.addRejection(state.pendingEdgeFrom, id)
    } else {
      doc.addEdge(state.pendingEdgeFrom, id)
    }
    doc.cancelPendingEdge()
  }
}

// ── pointer handlers ─────────────────────────────────────────────────────────
function onNodeDown(e, id) {
  e.stopPropagation()
  if (isLinkTool.value) {
    pickForLink(id)
    return
  }
  doc.select('node', id)
  const n = doc.findNode(id)
  const p = svgPoint(e)
  drag = { kind: 'node', id, offX: p.x - n.x, offY: p.y - n.y }
  svgRef.value.setPointerCapture(e.pointerId)
}

function onLabelDown(e, id) {
  e.stopPropagation()
  if (isLinkTool.value) {
    pickForLink(id)
    return
  }
  doc.select('node', id)
  const n = doc.findNode(id)
  const p = svgPoint(e)
  drag = {
    kind: 'label',
    id,
    offX: p.x - (n.x + (n.labelDx || 0)),
    offY: p.y - (n.y + (n.labelDy || 0)),
  }
  svgRef.value.setPointerCapture(e.pointerId)
}

function onEdgeDown(e, edge) {
  e.stopPropagation()
  if (isLinkTool.value) return
  doc.selectEdge(edge.fromId, edge.toId)
}

// ── rejection edges (v1.2 R5) ────────────────────────────────────────────────
// Selecting the arc opens the inspector on it; grabbing the apex selects it
// AND begins a depth/side drag — mirroring CanvasNode's label handle, which
// likewise selects then drags in one gesture.
function onRejectionDown(e, edge) {
  e.stopPropagation()
  if (isLinkTool.value) return
  doc.selectRejection(edge.fromId, edge.toId)
}
function onApexDown(e, edge) {
  e.stopPropagation()
  if (isLinkTool.value) return
  doc.selectRejection(edge.fromId, edge.toId)
  drag = { kind: 'rejection-apex', from: edge.fromId, to: edge.toId }
  svgRef.value.setPointerCapture(e.pointerId)
}

/**
 * Apply an apex drag: the pointer position sets the rejection edge's bow.
 *
 * The arc's apex sits at the chord midpoint displaced perpendicular by
 * bow.depth/2 (the Bézier t=0.5 point — control point is mid + n·depth, apex
 * is mid + n·depth/2). So the signed perpendicular offset of the pointer from
 * the chord midpoint IS depth/2: depth = 2·|offset|, and the offset's sign
 * picks the side. Dragging the apex across the chord (offset crosses 0) flips
 * bow.side. Depth is live (no remount); side flips bump immediately — R4's
 * documented contract. commitEdit() on pointer release bumps the preview.
 */
function applyApexDrag(d, p) {
  const from = doc.findNode(d.from)
  const to = doc.findNode(d.to)
  if (!from || !to) return
  // bd ai-engineer-91ds: the arc is bowed off the band EDGE anchors, not the
  // node centerlines — so the apex drag must measure against the SAME chord
  // the rendered curve uses, or the handle would jump under the pointer.
  const rejNow = doc.findRejection(d.from, d.to)
  const { fromPt, toPt } = rejectionEdgeAnchors(
    from, to, rejNow && rejNow.bow, nodeWidths.value,
  )
  const mid = { x: (fromPt.x + toPt.x) / 2, y: (fromPt.y + toPt.y) / 2 }
  const dx = toPt.x - fromPt.x
  const dy = toPt.y - fromPt.y
  const len = Math.hypot(dx, dy) || 1
  // Canonical chord normal oriented to 'below' (+y) — matches rejectionBowCurve.
  let nx = -dy / len
  let ny = dx / len
  if (ny < 0) {
    nx = -nx
    ny = -ny
  }
  const offset = (p.x - mid.x) * nx + (p.y - mid.y) * ny
  const side = offset >= 0 ? 'below' : 'above'
  const depth = 2 * Math.abs(offset)
  if (rejNow && rejNow.bow && rejNow.bow.side !== side) {
    doc.setRejectionBowSide(d.from, d.to, side)
  }
  doc.setRejectionBowDepth(d.from, d.to, depth)
}

function onBackgroundDown(e) {
  const p = svgPoint(e)
  if (state.tool === 'add-node') {
    // y is snapped to the flow centerline for symmetry — see useFlowDoc.addNode.
    doc.addNode(p.x)
  } else if (isLinkTool.value) {
    doc.cancelPendingEdge()
  } else {
    doc.select(null)
  }
}

// The dimmed gutter is OUTSIDE the slide frame — clicking it clears the
// selection or cancels a pending edge, but never places a node off-slide.
function onGutterDown() {
  if (isLinkTool.value) doc.cancelPendingEdge()
  else doc.select(null)
}

function onMove(e) {
  const p = svgPoint(e)
  ptr.value = p
  if (!drag) return
  if (drag.kind === 'node') {
    doc.moveNode(drag.id, p.x - drag.offX, p.y - drag.offY)
  } else if (drag.kind === 'rejection-apex') {
    applyApexDrag(drag, p)
  } else {
    const n = doc.findNode(drag.id)
    doc.moveLabel(drag.id, p.x - drag.offX - n.x, p.y - drag.offY - n.y)
  }
}

function onUp(e) {
  if (drag) {
    if (svgRef.value?.hasPointerCapture?.(e.pointerId)) {
      svgRef.value.releasePointerCapture(e.pointerId)
    }
    // The drag mutated node/label position reactively for the editor canvas;
    // commit it so the library-rendered preview remounts with the new geometry.
    doc.commitEdit()
  }
  drag = null
}
</script>

<template>
  <div class="editor-canvas">
    <svg
      ref="svgRef"
      :viewBox="canvasBox"
      preserveAspectRatio="xMidYMid meet"
      class="ec-svg"
      @pointermove="onMove"
      @pointerup="onUp"
    >
      <defs>
        <!-- snap-to-grid lattice: faint dots at every grid intersection,
             shown only while snap mode is enabled (bd ai-engineer-esx8). -->
        <pattern
          id="ec-grid"
          :width="GRID_SIZE"
          :height="GRID_SIZE"
          patternUnits="userSpaceOnUse"
        >
          <!-- dot at the tile origin: tiling places one at every grid
               intersection — exactly the coordinates a node snaps to. -->
          <circle cx="0" cy="0" r="2.4" fill="#b2bac6" />
        </pattern>
        <marker
          id="designer-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
        </marker>
      </defs>

      <!-- dimmed gutter: the area OUTSIDE the slide frame. Clicking it clears
           the selection / cancels a pending edge — it never places a node
           off-slide (bd ai-engineer-qe6d). -->
      <rect
        class="ec-gutter"
        :x="inflated.x"
        :y="inflated.y"
        :width="inflated.w"
        :height="inflated.h"
        fill="#e7e3d8"
        @pointerdown="onGutterDown"
      />

      <!-- the slide frame: a 16:9 bounding box at the deck's slide scope
           (1920×1080). The click target for add-node / clear-selection. -->
      <rect
        class="ec-frame"
        :x="frame.x"
        :y="frame.y"
        :width="frame.w"
        :height="frame.h"
        fill="#fbfaf7"
        stroke="#8a8474"
        stroke-width="2"
        @pointerdown="onBackgroundDown"
      />
      <!-- frame caption: a quiet reminder of the slide scope -->
      <text
        class="ec-frame-label"
        :x="frame.x + 14"
        :y="frame.y + 30"
        pointer-events="none"
      >16:9 slide · {{ frame.w }}×{{ frame.h }}</text>

      <!-- snap grid overlay (only while snap mode is on; pointer-transparent
           so it does not steal the add-node / clear-selection click) -->
      <rect
        v-if="state.snapToGrid"
        :x="frame.x"
        :y="frame.y"
        :width="frame.w"
        :height="frame.h"
        fill="url(#ec-grid)"
        pointer-events="none"
      />

      <!-- edges (under nodes) -->
      <CanvasEdge
        v-for="edge in edges"
        :key="edge.id"
        :from="edge.from"
        :to="edge.to"
        :selected="isSelectedEdge(edge)"
        @edgedown="onEdgeDown($event, edge)"
      />

      <!-- rejection edges (v1.2 R5): dotted red bow arcs, drawn above the
           forward edges so their apex handles stay grabbable -->
      <CanvasRejectionEdge
        v-for="rej in rejectionEdges"
        :key="rej.id"
        :from="rej.from"
        :to="rej.to"
        :bow="rej.bow"
        :widths="nodeWidths"
        :selected="isSelectedRejection(rej)"
        @edgedown="onRejectionDown($event, rej)"
        @apexdown="onApexDown($event, rej)"
      />

      <!-- two-click link rubber-band (add-edge / add-rejection) -->
      <line
        v-if="pendingFromNode"
        :x1="pendingFromNode.x"
        :y1="pendingFromNode.y"
        :x2="ptr.x"
        :y2="ptr.y"
        :stroke="linkColor"
        stroke-width="2.5"
        stroke-dasharray="8 6"
      />

      <!-- nodes -->
      <CanvasNode
        v-for="node in state.flow.nodes"
        :key="node.id"
        :node="node"
        :selected="isSelectedNode(node.id)"
        :pending="state.pendingEdgeFrom === node.id"
        :out-of-bounds="outOfBounds.has(node.id)"
        @nodedown="onNodeDown"
        @labeldown="onLabelDown"
      />
    </svg>
  </div>
</template>

<style scoped>
.editor-canvas {
  width: 100%;
  height: 100%;
  background: #f1efe9;
}
.ec-svg {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}
.ec-gutter {
  cursor: default;
}
.ec-frame {
  cursor: crosshair;
}
.ec-frame-label {
  font: 22px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  fill: #8a8474;
  user-select: none;
}
</style>
