/**
 * flowStore.js — the designer's thin reactive shell over a pluggable
 * persistence backend.
 *
 * Holds the loaded machine-readable index and offers load / save / delete /
 * create-set operations, delegating each to a chosen Backend (bd ai-engineer-zr7k
 * §7.2). Two backends implement the same interface: `serverBackend` (the
 * dev-server directory-of-files API) and `localStorageBackend` (the static-app
 * in-browser store). The PUBLIC SURFACE of `useFlowStore()` is frozen —
 * `{ state, refreshIndex, loadFlow, saveFlow, deleteFlow, duplicateFlow,
 * renameFlow, createSet, saveSetMeta }` with identical return contracts — so
 * useFlowDoc.js and useFlowSetPreview.js consume it unchanged on either backend.
 *
 * It does NOT own the editing document — that is useFlowDoc; this module only
 * moves flows between the editor and the store.
 *
 * Module singleton: one index + one backend, shared by the index page and the
 * editor.
 */

import { reactive } from 'vue'
import { makeServerBackend } from './backends/serverBackend.js'

const state = reactive({
  /** The machine-readable index, or null before the first load. */
  index: null,
  /** True while a refreshIndex request is in flight. */
  loading: false,
  /** Last error string (network / API), or null. */
  error: null,
  /** Which backend is active: 'server' | 'local'. Set at B3; 'server' here. */
  backend: 'server',
})

// B1 hard-wires the server backend; B3 replaces this with selectBackend().
const backend = makeServerBackend()

/** Reload the index from the backend. Surfaces failures on `state.error`. */
async function refreshIndex() {
  state.loading = true
  state.error = null
  try {
    state.index = await backend.refreshIndex()
  } catch (err) {
    state.error = String(err.message || err)
    state.index = state.index || { indexVersion: 1, sets: [] }
  } finally {
    state.loading = false
  }
  return state.index
}

/** Fetch one flow's envelope by ID (`<set>/<flow>`). */
function loadFlow(id) {
  return backend.loadFlow(id)
}

/** Write a flow envelope back to the store. `id` is `<set>/<flow>`. */
function saveFlow(id, envelope, title) {
  return backend.saveFlow(id, envelope, title)
}

/** Delete a flow by ID. */
function deleteFlow(id) {
  return backend.deleteFlow(id)
}

/** Duplicate a flow within its set; returns `{ ok, id, slug, title, index }`. */
function duplicateFlow(id) {
  return backend.duplicateFlow(id)
}

/** Rename a flow's display title; returns `{ ok, id, title, index }`. */
function renameFlow(id, title) {
  return backend.renameFlow(id, title)
}

/** Create a new flow-set; returns `{ id, title }`. */
function createSet(title) {
  return backend.createSet(title)
}

/** Update a set's metadata (title / transition / order); returns `{ ok, index }`. */
function saveSetMeta(setId, partial) {
  return backend.saveSetMeta(setId, partial)
}

export function useFlowStore() {
  return {
    state,
    refreshIndex,
    loadFlow,
    saveFlow,
    deleteFlow,
    duplicateFlow,
    renameFlow,
    createSet,
    saveSetMeta,
  }
}
