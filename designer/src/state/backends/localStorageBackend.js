/**
 * localStorageBackend.js — the static app's in-browser persistence backend.
 *
 * Implements the same Backend interface as serverBackend.js (bd ai-engineer-zr7k
 * §7.2) so flowStore.js delegates to either one with no surface change. Where
 * the server backend is a directory of files, this is a SINGLE JSON blob in
 * localStorage, shaped EXACTLY like the server plugin's scanStore() output:
 *
 *   { sets: [ { id, title, transition?,
 *               flows: [ { slug, title, envelope, updatedAt } ] } ] }
 *
 * Because the blob matches scanStore()'s shape, refreshIndex() is literally
 * `buildIndex(blob, …)` — the same pure function the server uses — and every
 * mutating op reuses the pure indexBuilder helpers (slugify / uniqueSlug /
 * insertFlowAfter / renameFlowInSet / reorderFlows), so the produced index is
 * byte-identical to the server's. The per-op return contracts mirror the
 * server's "mutate → regenIndex" responses.
 *
 * Storage is injected (defaults to globalThis.localStorage) so it is
 * unit-testable against a plain shim.
 */

import {
  slugify,
  uniqueSlug,
  buildIndex,
  insertFlowAfter,
  renameFlowInSet,
  reorderFlows,
} from '../../../server/indexBuilder.js'

/** localStorage key for the whole designer store. Versioned for forward-compat. */
export const STORE_KEY = 'ribbonflow.designer.store.v1'

/** Deep-clone via JSON — envelopes are plain JSON, so this is faithful + cheap. */
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

/** Split a flow ID (`<set>/<flow>`) into its two slugs; throws if malformed. */
function parseId(id) {
  const parts = String(id ?? '').split('/').filter(Boolean)
  if (parts.length !== 2) {
    throw new Error(`invalid flow id "${id}" — expected <set>/<flow>`)
  }
  return { setSlug: parts[0], flowSlug: parts[1] }
}

export function makeLocalStorageBackend(storage = globalThis.localStorage) {
  /** Read the store blob, defaulting to an empty store when unset / unreadable. */
  function readBlob() {
    try {
      const raw = storage?.getItem?.(STORE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && Array.isArray(parsed.sets)) return parsed
    } catch {
      // fall through to the empty store
    }
    return { sets: [] }
  }

  /** Persist the store blob. */
  function writeBlob(blob) {
    storage?.setItem?.(STORE_KEY, JSON.stringify(blob))
  }

  function findSet(blob, setSlug) {
    return blob.sets.find((s) => s.id === setSlug) || null
  }

  /**
   * Return the set entry for `setSlug`, creating an empty one if absent. The
   * implicit title defaults to the slug — matching the server's writeFlow,
   * where a missing set.json synthesizes `{ title: setSlug }`.
   */
  function ensureSet(blob, setSlug) {
    let set = findSet(blob, setSlug)
    if (!set) {
      set = { id: setSlug, title: setSlug, flows: [] }
      blob.sets.push(set)
    }
    return set
  }

  /** Build the index from the current blob — the same shape the server emits. */
  function indexNow(blob) {
    return buildIndex(blob, { generatedAt: new Date().toISOString() })
  }

  return {
    /** Return the machine-readable index over the current store. */
    async refreshIndex() {
      return indexNow(readBlob())
    },

    /** Return a flow's stored envelope; throws `flow not found` when absent. */
    async loadFlow(id) {
      const { setSlug, flowSlug } = parseId(id)
      const blob = readBlob()
      const set = findSet(blob, setSlug)
      const flow = set?.flows.find((f) => f.slug === flowSlug)
      if (!flow) throw new Error('flow not found')
      return clone(flow.envelope)
    },

    /**
     * Upsert a flow into its set (creating the set entry if absent — matches
     * the server's mkdir -p). Stamps updatedAt; returns `{ ok, id, index }`.
     */
    async saveFlow(id, envelope, title) {
      const { setSlug, flowSlug } = parseId(id)
      const blob = readBlob()
      const set = ensureSet(blob, setSlug)
      const now = new Date().toISOString()
      const existing = set.flows.find((f) => f.slug === flowSlug)
      if (existing) {
        existing.envelope = clone(envelope)
        if (typeof title === 'string' && title) existing.title = title
        existing.updatedAt = now
      } else {
        set.flows.push({
          slug: flowSlug,
          title: title || flowSlug,
          envelope: clone(envelope),
          updatedAt: now,
        })
      }
      writeBlob(blob)
      return { ok: true, id, index: indexNow(blob) }
    },

    /** Remove a flow from its set; returns `{ ok }`. */
    async deleteFlow(id) {
      const { setSlug, flowSlug } = parseId(id)
      const blob = readBlob()
      const set = findSet(blob, setSlug)
      if (set) set.flows = set.flows.filter((f) => f.slug !== flowSlug)
      writeBlob(blob)
      return { ok: true }
    },

    /**
     * Byte-copy a flow to a fresh `<title> copy` slug inserted right after the
     * source (bd ai-engineer-ih7q). Returns `{ ok, id, slug, title, index }`;
     * throws when the source is missing.
     */
    async duplicateFlow(id) {
      const { setSlug, flowSlug } = parseId(id)
      const blob = readBlob()
      const set = findSet(blob, setSlug)
      const src = set?.flows.find((f) => f.slug === flowSlug)
      if (!src) throw new Error('source flow not found')
      const newTitle = `${src.title ?? flowSlug} copy`
      const newSlug = uniqueSlug(slugify(newTitle), set.flows.map((f) => f.slug))
      const entry = {
        slug: newSlug,
        title: newTitle,
        envelope: clone(src.envelope),
        updatedAt: new Date().toISOString(),
      }
      set.flows = insertFlowAfter(set.flows, flowSlug, entry)
      writeBlob(blob)
      return {
        ok: true,
        id: `${setSlug}/${newSlug}`,
        slug: newSlug,
        title: newTitle,
        index: indexNow(blob),
      }
    },

    /**
     * Rename a flow's display title (slug / file untouched). Returns
     * `{ ok, id, title, index }`; throws when the flow is absent.
     */
    async renameFlow(id, title) {
      const { setSlug, flowSlug } = parseId(id)
      const blob = readBlob()
      const set = findSet(blob, setSlug)
      if (!set || !set.flows.some((f) => f.slug === flowSlug)) {
        throw new Error('flow not found')
      }
      set.flows = renameFlowInSet(set.flows, flowSlug, title)
      writeBlob(blob)
      return { ok: true, id, title, index: indexNow(blob) }
    },

    /** Create a new flow-set with a unique slug; returns `{ id, title }`. */
    async createSet(title) {
      const blob = readBlob()
      const setSlug = uniqueSlug(slugify(title), blob.sets.map((s) => s.id))
      blob.sets.push({ id: setSlug, title: title || setSlug, flows: [] })
      writeBlob(blob)
      return { id: setSlug, title: title || setSlug }
    },

    /**
     * Merge partial metadata into a set (title / transition / flow order),
     * creating the set if absent. Returns `{ ok, index }`.
     *
     * @param {string} setId
     * @param {{ title?: string, transition?: object, flows?: string[] }} partial
     */
    async saveSetMeta(setId, partial = {}) {
      const blob = readBlob()
      const set = ensureSet(blob, setId)
      if (typeof partial.title === 'string') set.title = partial.title
      if (partial.transition !== undefined && typeof partial.transition === 'object') {
        set.transition = clone(partial.transition)
      }
      if (Array.isArray(partial.flows)) {
        set.flows = reorderFlows(set.flows, partial.flows)
      }
      writeBlob(blob)
      return { ok: true, index: indexNow(blob) }
    },
  }
}
