/**
 * serverBackend.js — the dev-server (directory-of-files) persistence backend.
 *
 * A thin `fetch` client to the REST API the flow-store Vite plugin exposes at
 * /__flows (see docs/superpowers/specs/2026-05-20-flow-persistence-design.md).
 * This is the maintainer's authoring backend: flows persist to `flow/flows/` on
 * disk, where a human and a build can both read them. It is the SERVER half of
 * the pluggable-backend split (bd ai-engineer-zr7k §7.2) — the request() helper
 * and the eight operation bodies are lifted verbatim from the old flowStore.js,
 * so the dev-server path is byte-for-byte unchanged.
 *
 * The Backend interface every backend implements (and flowStore delegates to):
 *
 *   refreshIndex()                 → Promise<Index>
 *   loadFlow(id)                   → Promise<Envelope>
 *   saveFlow(id, envelope, title)  → Promise<{ ok, id, index }>
 *   deleteFlow(id)                 → Promise<{ ok }>
 *   duplicateFlow(id)              → Promise<{ ok, id, slug, title, index }>
 *   renameFlow(id, title)          → Promise<{ ok, id, title, index }>
 *   createSet(title)               → Promise<{ id, title }>
 *   saveSetMeta(setId, partial)    → Promise<{ ok, index }>
 *
 * Unlike the old flowStore.refreshIndex, this one only RETURNS the index — the
 * reactive loading/error/fallback handling stays in flowStore.js.
 */

const API = '/__flows'

/**
 * Create a server backend.
 *
 * @param {typeof fetch} [fetchImpl] — injectable for testing; defaults to a
 *   wrapper over globalThis.fetch so the default keeps the correct `this`
 *   (a bare `const f = window.fetch; f(...)` throws "Illegal invocation").
 * @returns {object} a Backend (see module docs)
 */
export function makeServerBackend(fetchImpl) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args))

  async function request(method, url, body) {
    const res = await doFetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : {}
    if (!res.ok) throw new Error(data.error || `${method} ${url} → ${res.status}`)
    return data
  }

  return {
    /** Reload the index from the server. Returns the index object. */
    refreshIndex() {
      return request('GET', `${API}/index`)
    },

    /** Fetch one flow's envelope by ID (`<set>/<flow>`). */
    loadFlow(id) {
      return request('GET', `${API}/file/${id}`)
    },

    /** Write a flow envelope back to disk. `id` is `<set>/<flow>`. */
    saveFlow(id, envelope, title) {
      return request('PUT', `${API}/file/${id}`, { envelope, title })
    },

    /** Delete a flow by ID. */
    deleteFlow(id) {
      return request('DELETE', `${API}/file/${id}`)
    },

    /**
     * Duplicate a flow within its set (bd ai-engineer-ih7q). The server
     * byte-copies the envelope to a fresh `<title> copy` slug, inserts it right
     * after the source in the set's order, and regenerates the index. Returns
     * `{ ok, id, slug, title, index }`.
     */
    duplicateFlow(id) {
      return request('POST', `${API}/duplicate`, { id })
    },

    /**
     * Rename a flow's display title (bd ai-engineer-h507). Only the title shown
     * on the index card and in the set's set.json changes — the slug and the
     * file path on disk are the stable references and are never touched.
     * Returns `{ ok, id, title, index }`.
     */
    renameFlow(id, title) {
      return request('POST', `${API}/rename`, { id, title })
    },

    /** Create a new flow-set directory; returns `{ id, title }`. */
    createSet(title) {
      return request('POST', `${API}/set`, { title })
    },

    /**
     * Update a set's metadata (title, transition, and/or flow order). `flows`
     * is an array of slugs giving the new order (bd ai-engineer-soln).
     * Regenerates the index and returns `{ ok, index }`.
     *
     * @param {string} setId — the set slug (no slash)
     * @param {{ title?: string, transition?: object, flows?: string[] }} partial
     */
    saveSetMeta(setId, partial) {
      return request('PUT', `${API}/set/${setId}`, partial)
    },
  }
}
