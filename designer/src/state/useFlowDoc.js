/**
 * useFlowDoc.js — the designer's single reactive flow document.
 *
 * Holds ONE authored v2 flow (un-normalized — exactly what export writes),
 * the current selection, and the active canvas tool. All edits go through the
 * named actions below; centralising mutation keeps the editing model auditable
 * and is the seam a later undo/redo would hook. See M3 spec §2.3 / §3.1.
 *
 * Library access is exclusively through the `/internals` face (M3 §2.4):
 * normalizeFlow / validateFlow / serializeFlow / deserializeFlow. The preview
 * renders `normalized`; export serialises the authored `flow`.
 *
 * This module is a singleton — every `useFlowDoc()` call returns the same
 * store, so the canvas, inspector, toolbar and preview all share one document.
 */

import { reactive, computed } from 'vue'
import {
  normalizeFlow,
  validateFlow,
  serializeFlow,
  deserializeFlow,
} from '@flow-designer/library/internals'
import { makeSampleFlow } from './sampleFlow.js'
import { GRID_SIZE } from '../lib/constants.js'
import * as M from './flowMutations.js'

const state = reactive({
  flow: makeSampleFlow(),
  // selection: { kind: 'node'|'edge'|'flow'|null, id?, edge?: {from,to} }
  selection: { kind: 'flow' },
  // tool: 'select' | 'add-node' | 'add-edge'
  tool: 'select',
  // when add-edge has a first endpoint chosen, its node id sits here
  pendingEdgeFrom: null,
  // optional snap-to-grid: when true, node moves / creation snap to GRID_SIZE
  snapToGrid: false,
  // bumped on STRUCTURAL edits so PreviewPane cleanly remounts the simulation
  previewKey: 0,
})

/** The authored flow with library defaults applied (normalized v2 shape). */
const normalized = computed(() => {
  try {
    return normalizeFlow(state.flow)
  } catch {
    return state.flow
  }
})

/**
 * What the live preview renders: the normalized flow with each segment label
 * anchored at its node's xy (bd ai-engineer-t173). Without this projection the
 * library renderer places labels at a latency-proportioned arc-midpoint that
 * does not track the node — so a dragged node's preview label "stays behind".
 * Preview-only: export still serialises the authored `state.flow`, never this.
 */
const previewFlow = computed(() => M.withNodeAnchoredLabels(normalized.value))

/** Advisory structural validation, surfaced in the status strip. */
const validation = computed(() => {
  try {
    return validateFlow(state.flow)
  } catch (e) {
    return { ok: false, errors: [String(e)], warnings: [] }
  }
})

/**
 * Bump the preview key, remounting the library FlowGraph.
 *
 * The library renderer builds its simulation and ribbon geometry ONCE at
 * component setup (see core/FlowGraph.vue — `createFlowSimulation` and
 * `computeNodeWidths` run in setup, not in a reactive computed). So any edit
 * that changes geometry — a node move, a width, a rate, the topology — only
 * shows in the preview on a remount. We therefore remount on every *committed*
 * edit: structural actions bump immediately; a canvas drag bumps once on drop
 * via commitEdit(); inspector fields bump on `change` (blur/Enter), not per
 * keystroke. This keeps the preview faithful without flickering mid-drag.
 */
function bumpPreview() {
  state.previewKey++
}

/** Called by the editor canvas when a drag (node/label move) is released. */
function commitEdit() {
  bumpPreview()
}

// ── selection ────────────────────────────────────────────────────────────────
function select(kind, id) {
  if (kind == null) state.selection = { kind: 'flow' }
  else state.selection = { kind, id }
}
function selectEdge(from, to) {
  state.selection = { kind: 'edge', edge: { from, to } }
}

// ── tools ────────────────────────────────────────────────────────────────────
function setTool(tool) {
  state.tool = tool
  state.pendingEdgeFrom = null
}
function setPendingEdge(id) {
  state.pendingEdgeFrom = id
}
function cancelPendingEdge() {
  state.pendingEdgeFrom = null
}

// ── grid snapping ────────────────────────────────────────────────────────────
/** Toggle the optional snap-to-grid mode (bd ai-engineer-esx8). */
function setSnapToGrid(on) {
  state.snapToGrid = !!on
}
function toggleSnap() {
  state.snapToGrid = !state.snapToGrid
}
/** Snap a coordinate pair to the grid when the mode is enabled; else pass-through. */
function snapXY(x, y) {
  if (!state.snapToGrid) return { x, y }
  return { x: M.snapToGrid(x, GRID_SIZE), y: M.snapToGrid(y, GRID_SIZE) }
}

// ── node / edge edits ────────────────────────────────────────────────────────
/**
 * Place a node. The x comes from the click; the y is SNAPPED to the flow's
 * centerline (median node y) so additions stay symmetric with the existing
 * flow line rather than landing at an arbitrary cursor height — "better
 * defaults favouring symmetry" (bd ai-engineer-1dr8). Drag the node afterwards
 * to take it off the line. When snap-to-grid is on, the placement also snaps
 * to the grid lattice (bd ai-engineer-esx8).
 */
function addNode(x) {
  const p = snapXY(x, M.flowCenterlineY(state.flow))
  const id = M.addNode(state.flow, p.x, p.y)
  select('node', id)
  bumpPreview()
  return id
}
function moveNode(id, x, y) {
  const p = snapXY(x, y)
  M.moveNode(state.flow, id, p.x, p.y)
}
function moveLabel(id, dx, dy) {
  M.moveLabel(state.flow, id, dx, dy)
}
function addEdge(from, to) {
  if (M.addEdge(state.flow, from, to)) bumpPreview()
}
function removeEdge(from, to) {
  M.removeEdge(state.flow, from, to)
  bumpPreview()
}
function setNodeField(id, key, value) {
  M.setNodeField(state.flow, id, key, value)
  bumpPreview()
}
function setNodeKind(id, kind) {
  M.setNodeKind(state.flow, id, kind)
  bumpPreview()
}
function setLabelSide(id, side) {
  M.setLabelSide(state.flow, id, side)
  bumpPreview()
}
function setFlowField(key, value) {
  M.setFlowField(state.flow, key, value)
  bumpPreview()
}

/** Delete whatever is selected (a node + its edges, or a single edge). */
function deleteSelection() {
  const sel = state.selection
  if (sel.kind === 'node' && sel.id) {
    M.removeNode(state.flow, sel.id)
    select(null)
    bumpPreview()
  } else if (sel.kind === 'edge' && sel.edge) {
    M.removeEdge(state.flow, sel.edge.from, sel.edge.to)
    select(null)
    bumpPreview()
  }
}

// ── document lifecycle / format ──────────────────────────────────────────────
function findNode(id) {
  return M.findNode(state.flow, id)
}

/** Serialize the authored flow to the library's v2 JSON envelope. */
function exportFlow() {
  return serializeFlow(state.flow)
}

/**
 * Replace the document with a deserialized flow (a string envelope or a
 * parsed envelope). v1 exports migrate forward transparently in the library.
 * Throws on malformed input — the caller surfaces the error.
 */
function importFlow(input) {
  const flow = deserializeFlow(input)
  state.flow = flow
  state.selection = { kind: 'flow' }
  state.pendingEdgeFrom = null
  bumpPreview()
}

/** Reset to the sample flow. */
function newFlow() {
  state.flow = makeSampleFlow()
  state.selection = { kind: 'flow' }
  state.pendingEdgeFrom = null
  bumpPreview()
}

const api = {
  state,
  normalized,
  previewFlow,
  validation,
  select,
  selectEdge,
  setTool,
  setPendingEdge,
  cancelPendingEdge,
  setSnapToGrid,
  toggleSnap,
  commitEdit,
  addNode,
  moveNode,
  moveLabel,
  addEdge,
  removeEdge,
  setNodeField,
  setNodeKind,
  setLabelSide,
  setFlowField,
  deleteSelection,
  findNode,
  exportFlow,
  importFlow,
  newFlow,
}

export function useFlowDoc() {
  return api
}
