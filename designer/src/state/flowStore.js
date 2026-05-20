/**
 * flowStore.js — the designer's client to the directory-of-files persistence
 * layer.
 *
 * A thin reactive `fetch` wrapper around the dev-server REST API the
 * flow-store Vite plugin exposes at /__flows (see
 * docs/superpowers/specs/2026-05-20-flow-persistence-design.md). It holds the
 * loaded machine-readable index and offers load / save / delete / create-set
 * operations. It does NOT own the editing document — that is useFlowDoc; this
 * module only moves flows between the editor and disk.
 *
 * Module singleton: one index, shared by the index page and the editor.
 */

import { reactive } from 'vue'

const API = '/__flows'

const state = reactive({
  /** The machine-readable index, or null before the first load. */
  index: null,
  /** True while a request to /__flows/index is in flight. */
  loading: false,
  /** Last error string (network / API), or null. */
  error: null,
})

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(data.error || `${method} ${url} → ${res.status}`)
  return data
}

/** Reload the index from the server. Surfaces failures on `state.error`. */
async function refreshIndex() {
  state.loading = true
  state.error = null
  try {
    state.index = await request('GET', `${API}/index`)
  } catch (err) {
    state.error = String(err.message || err)
    state.index = state.index || { indexVersion: 1, sets: [] }
  } finally {
    state.loading = false
  }
  return state.index
}

/** Fetch one flow's envelope by ID (`<set>/<flow>`). */
async function loadFlow(id) {
  return request('GET', `${API}/file/${id}`)
}

/** Write a flow envelope back to disk. `id` is `<set>/<flow>`. */
async function saveFlow(id, envelope, title) {
  return request('PUT', `${API}/file/${id}`, { envelope, title })
}

/** Delete a flow by ID. */
async function deleteFlow(id) {
  return request('DELETE', `${API}/file/${id}`)
}

/**
 * Duplicate a flow within its set (bd ai-engineer-ih7q). The server byte-copies
 * the envelope to a fresh `<title> copy` slug, inserts it right after the
 * source in the set's order, and regenerates the index. Returns
 * `{ ok, id, slug, title, index }`.
 */
async function duplicateFlow(id) {
  return request('POST', `${API}/duplicate`, { id })
}

/** Create a new flow-set directory; returns `{ id, title }`. */
async function createSet(title) {
  return request('POST', `${API}/set`, { title })
}

/**
 * Update a set's metadata (title, transition, and/or flow order).
 *
 * The server merges `partial` into the existing set.json; unknown fields are
 * ignored. `flows` is an array of slugs giving the new flow order
 * (bd ai-engineer-soln). Regenerates the index and returns `{ ok, index }`.
 *
 * @param {string} setId — the set slug (no slash)
 * @param {{ title?: string, transition?: object, flows?: string[] }} partial
 */
async function saveSetMeta(setId, partial) {
  return request('PUT', `${API}/set/${setId}`, partial)
}

export function useFlowStore() {
  return {
    state,
    refreshIndex,
    loadFlow,
    saveFlow,
    deleteFlow,
    duplicateFlow,
    createSet,
    saveSetMeta,
  }
}
