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
import { useFlowDoc } from '../state/useFlowDoc.js'
import { clientToSvg } from '../lib/svgCoords.js'
import CanvasNode from './CanvasNode.vue'
import CanvasEdge from './CanvasEdge.vue'

const doc = useFlowDoc()
const state = doc.state

const svgRef = ref(null)
// active drag: { kind: 'node'|'label', id, offX, offY } or null
let drag = null
// live pointer position in viewBox units (for the add-edge rubber-band)
const ptr = ref({ x: 0, y: 0 })

const viewBox = computed(() => {
  const v = state.flow.viewBox || { w: 1600, h: 900 }
  return `${v.x ?? 0} ${v.y ?? 0} ${v.w} ${v.h}`
})

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

const pendingFromNode = computed(() =>
  state.pendingEdgeFrom ? doc.findNode(state.pendingEdgeFrom) : null,
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

// ── edge-creation picking ────────────────────────────────────────────────────
function pickForEdge(id) {
  if (!state.pendingEdgeFrom) {
    doc.setPendingEdge(id)
  } else {
    doc.addEdge(state.pendingEdgeFrom, id)
    doc.cancelPendingEdge()
  }
}

// ── pointer handlers ─────────────────────────────────────────────────────────
function onNodeDown(e, id) {
  e.stopPropagation()
  if (state.tool === 'add-edge') {
    pickForEdge(id)
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
  if (state.tool === 'add-edge') {
    pickForEdge(id)
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
  if (state.tool === 'add-edge') return
  doc.selectEdge(edge.fromId, edge.toId)
}

function onBackgroundDown(e) {
  const p = svgPoint(e)
  if (state.tool === 'add-node') {
    doc.addNode(p.x, p.y)
  } else if (state.tool === 'add-edge') {
    doc.cancelPendingEdge()
  } else {
    doc.select(null)
  }
}

function onMove(e) {
  const p = svgPoint(e)
  ptr.value = p
  if (!drag) return
  if (drag.kind === 'node') {
    doc.moveNode(drag.id, p.x - drag.offX, p.y - drag.offY)
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
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      class="ec-svg"
      @pointermove="onMove"
      @pointerup="onUp"
    >
      <defs>
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

      <!-- background: click target for add-node / clear-selection -->
      <rect
        class="ec-bg"
        :x="0"
        :y="0"
        :width="(state.flow.viewBox && state.flow.viewBox.w) || 1600"
        :height="(state.flow.viewBox && state.flow.viewBox.h) || 900"
        fill="#fbfaf7"
        @pointerdown="onBackgroundDown"
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

      <!-- add-edge rubber-band -->
      <line
        v-if="pendingFromNode"
        :x1="pendingFromNode.x"
        :y1="pendingFromNode.y"
        :x2="ptr.x"
        :y2="ptr.y"
        stroke="#16a34a"
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
.ec-bg {
  cursor: crosshair;
}
</style>
