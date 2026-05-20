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

import { reactive, computed, watch } from 'vue'
import {
  normalizeFlow,
  validateFlow,
  serializeFlow,
  deserializeFlow,
  speedFromWidth,
  widthFromSpeed,
} from '@flow-designer/library/internals'
import { makeSampleFlow } from './sampleFlow.js'
import { GRID_SIZE } from '../lib/constants.js'
import * as M from './flowMutations.js'
import { useFlowStore } from './flowStore.js'
import { slugify, uniqueSlug } from '../../server/indexBuilder.js'

const store = useFlowStore()

/** Debounce (ms) between the last edit and an auto-save PUT — see persistence
 *  spec §2.5: above the canvas/inspector commit cadence, below per-keystroke. */
const AUTOSAVE_DEBOUNCE_MS = 800

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
  // ── persistence (bd ai-engineer-2fcm) ──────────────────────────────────────
  // which view the app shows: the landing page, the flow editor, or the
  // flow-set animated-transition preview (M4, bd ai-engineer-nawa)
  view: 'index', // 'index' | 'editor' | 'set-preview'
  // the flow-ID (`<set>/<flow>`) backing the open doc, or null when ephemeral
  currentId: null,
  // the open flow's human title (mirrors set.json), '' when ephemeral
  title: '',
  // auto-save lifecycle: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  saveState: 'idle',
  // internal guard: true right after a load so the auto-save watcher does not
  // immediately re-save a flow the designer just opened
  justLoaded: false,
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

// ── v1.1 node controls: Length / Speed / Width + colour scheme ───────────────
// The three sliders are dragged live: their setters mutate the reactive doc
// (the editor canvas tracks it) but do NOT bump the preview — the inspector
// commits once on `@change` (pointer release) via commitEdit(), mirroring the
// canvas drag-then-commit cadence (M3 §3.3). Speed and Width are coupled by
// default: moving one drives the other through the library's coupling maps.

/** Set a node's LENGTH (purely visual segment proportion). Live — no bump. */
function setNodeLength(id, value) {
  M.setNodeField(state.flow, id, 'length', value)
}

/** Set a node's WIDTH; when coupled, drive SPEED to match. Live — no bump. */
function setNodeWidth(id, value) {
  const n = M.findNode(state.flow, id)
  if (!n) return
  M.setNodeField(state.flow, id, 'width', value)
  if (n.coupleSpeedWidth !== false && typeof value === 'number') {
    M.setNodeField(state.flow, id, 'speed', speedFromWidth(value))
  }
}

/** Set a node's SPEED; when coupled, drive WIDTH to match. Live — no bump. */
function setNodeSpeed(id, value) {
  const n = M.findNode(state.flow, id)
  if (!n) return
  M.setNodeField(state.flow, id, 'speed', value)
  if (n.coupleSpeedWidth !== false && typeof value === 'number') {
    M.setNodeField(state.flow, id, 'width', widthFromSpeed(value))
  }
}

/** Toggle the Speed⇄Width coupling. Re-coupling snaps speed to width. */
function setCoupleSpeedWidth(id, on) {
  M.setNodeField(state.flow, id, 'coupleSpeedWidth', !!on)
  if (on) {
    const n = M.findNode(state.flow, id)
    if (n && typeof n.width === 'number') {
      M.setNodeField(state.flow, id, 'speed', speedFromWidth(n.width))
    }
  }
  bumpPreview()
}

/** Set a node's per-segment colour scheme ('red' | 'neutral' | 'green'). */
function setColorScheme(id, scheme) {
  M.setNodeField(state.flow, id, 'colorScheme', scheme)
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
  // justLoaded swallows the watcher fire from this replacement, so a manual
  // import does not auto-save by itself; a subsequent edit will persist it
  // into the open slot (if one is open).
  state.justLoaded = true
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

// ── directory-of-files persistence + auto-save (bd ai-engineer-2fcm) ──────────
// The designer's default persistence is the directory of files served by the
// flow-store dev-server plugin. A doc opened from the index is *backed* by a
// flow-ID; every edit then auto-saves (debounced) to its file on disk. See
// docs/superpowers/specs/2026-05-20-flow-persistence-design.md.

let saveTimer = null

/** Serialize and PUT the current doc to its backing file. */
async function doSave() {
  if (!state.currentId) return
  saveTimer = null
  state.saveState = 'saving'
  try {
    await store.saveFlow(state.currentId, JSON.parse(serializeFlow(state.flow)), state.title)
    state.saveState = 'saved'
  } catch (err) {
    state.saveState = 'error'
    // eslint-disable-next-line no-console
    console.error('auto-save failed:', err)
  }
}

/** Force an immediate save, cancelling any pending debounce. */
function saveNow() {
  if (saveTimer) clearTimeout(saveTimer)
  return doSave()
}

// Auto-save watcher: any deep edit to the authored flow schedules a debounced
// save. The justLoaded guard swallows the one watcher fire caused by a load /
// import replacing the document, so opening a flow does not re-save it.
watch(
  () => state.flow,
  () => {
    if (state.justLoaded) {
      state.justLoaded = false
      return
    }
    if (!state.currentId) return
    state.saveState = 'dirty'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(doSave, AUTOSAVE_DEBOUNCE_MS)
  },
  { deep: true },
)

/** Show the index landing page. Flushes any pending save first. */
async function goToIndex() {
  if (saveTimer) await saveNow()
  state.view = 'index'
}

/** Switch to the flow-set animated-transition preview (M4). The preview's set
 *  data is loaded separately by useFlowSetPreview — this only flips the view. */
function goToSetPreview() {
  state.view = 'set-preview'
}

/**
 * Open an existing flow from the store into the editor.
 * @param {string} id — `<set>/<flow>`
 * @param {string} title — the flow's human title (from the index)
 */
async function openFlow(id, title) {
  const envelope = await store.loadFlow(id)
  const flow = deserializeFlow(envelope)
  state.justLoaded = true
  state.flow = flow
  state.currentId = id
  state.title = title || id
  state.selection = { kind: 'flow' }
  state.pendingEdgeFrom = null
  state.saveState = 'saved'
  state.view = 'editor'
  bumpPreview()
}

/**
 * Create a fresh flow inside an existing set, persist it, and open it.
 * The slug is derived from the title, de-duplicated against the set's flows.
 * @param {string} setId
 * @param {string} title
 * @param {string[]} existingSlugs — slugs already in that set
 */
async function createFlow(setId, title, existingSlugs = []) {
  const slug = uniqueSlug(slugify(title), existingSlugs)
  const id = `${setId}/${slug}`
  const flow = makeSampleFlow()
  await store.saveFlow(id, JSON.parse(serializeFlow(flow)), title)
  state.justLoaded = true
  state.flow = flow
  state.currentId = id
  state.title = title || id
  state.selection = { kind: 'flow' }
  state.pendingEdgeFrom = null
  state.saveState = 'saved'
  state.view = 'editor'
  bumpPreview()
  return id
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
  setNodeLength,
  setNodeWidth,
  setNodeSpeed,
  setCoupleSpeedWidth,
  setColorScheme,
  setLabelSide,
  setFlowField,
  deleteSelection,
  findNode,
  exportFlow,
  importFlow,
  newFlow,
  goToIndex,
  goToSetPreview,
  openFlow,
  createFlow,
  saveNow,
}

export function useFlowDoc() {
  return api
}
