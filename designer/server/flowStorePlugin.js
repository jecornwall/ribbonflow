/**
 * flowStorePlugin.js — the directory-of-files persistence layer for the
 * flow designer.
 *
 * A Vite plugin that adds Connect middleware to the dev server, exposing a
 * small REST API backed by a REAL directory of files on disk
 * (`flow/flows/` by default). This is how the designer's default persistence
 * is "a directory of files a human and a build can both read" rather than
 * opaque blob storage — see 2026-05-20-flow-persistence-design.md §2.1.
 *
 * Layout under the root:
 *   index.json                       machine-readable index (regenerated on write)
 *   <set-slug>/set.json               flow-set metadata { id, title, flows[] }
 *   <set-slug>/<flow-slug>.flow.json   the library v3 envelope
 *
 * The persistence layer is dev-server-only: the designer is an authoring tool
 * run on `vite dev`. A production `vite build` has no middleware; the index
 * page degrades gracefully when the API is absent.
 *
 * API (mounted at /__flows):
 *   GET    /__flows/index                 → regenerate + return index.json
 *   GET    /__flows/file/<set>/<flow>      → the flow envelope
 *   PUT    /__flows/file/<set>/<flow>      → write flow + upsert set.json + regen
 *   DELETE /__flows/file/<set>/<flow>      → delete flow + update set.json + regen
 *   POST   /__flows/set                   → create a set dir + set.json + regen
 *   PUT    /__flows/set/<set>             → update set metadata (title, transition) + regen
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  slugify,
  uniqueSlug,
  buildIndex,
  insertFlowAfter,
  reorderFlows,
  SLUG_RE,
} from './indexBuilder.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** Default persistence root: flow/flows/, a workspace-level peer of designer/. */
const DEFAULT_ROOT = path.resolve(HERE, '../../flows')

const API_PREFIX = '/__flows'

// ── tiny http helpers ────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(new Error(`request body is not valid JSON — ${err.message}`))
      }
    })
    req.on('error', reject)
  })
}

// ── store operations ─────────────────────────────────────────────────────────

/**
 * Create one fs-backed store rooted at `root`. Every method is async and
 * self-contained; the plugin keeps no in-memory state, so the directory on
 * disk is always the single source of truth.
 */
function makeStore(root) {
  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true })
  }

  /** List the set-slug subdirectories that currently exist. */
  async function listSetSlugs() {
    await ensureRoot()
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
      .map((e) => e.name)
  }

  async function readSetMeta(setSlug) {
    const file = path.join(root, setSlug, 'set.json')
    try {
      const meta = JSON.parse(await fs.readFile(file, 'utf8'))
      const result = {
        id: setSlug,
        title: typeof meta.title === 'string' ? meta.title : setSlug,
        flows: Array.isArray(meta.flows) ? meta.flows : [],
      }
      // Carry the optional transition field through so the index and the client
      // can restore the persisted transition on set-preview open.
      if (meta.transition !== undefined && typeof meta.transition === 'object') {
        result.transition = meta.transition
      }
      return result
    } catch {
      // No set.json (or unreadable): synthesize a minimal one.
      return { id: setSlug, title: setSlug, flows: [] }
    }
  }

  async function writeSetMeta(setSlug, meta) {
    const file = path.join(root, setSlug, 'set.json')
    await fs.writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf8')
  }

  /** Scan the whole store into the shape buildIndex() consumes. */
  async function scanStore() {
    const slugs = await listSetSlugs()
    const sets = []
    for (const setSlug of slugs) {
      const meta = await readSetMeta(setSlug)
      const dir = path.join(root, setSlug)
      const titleBySlug = new Map(meta.flows.map((f) => [f.slug, f.title]))
      // Flow files actually on disk.
      const diskSlugs = (await fs.readdir(dir))
        .filter((f) => f.endsWith('.flow.json'))
        .map((f) => f.replace(/\.flow\.json$/, ''))
        .filter((s) => SLUG_RE.test(s))
      const diskSet = new Set(diskSlugs)
      const metaSlugs = new Set(meta.flows.map((f) => f.slug))
      // Order: the authored set.json order first (a flow-set is an ORDERED
      // list of states — M4), then any orphan files not yet in set.json,
      // sorted, so the scan stays deterministic.
      const orderedSlugs = [
        ...meta.flows.map((f) => f.slug).filter((s) => diskSet.has(s)),
        ...diskSlugs.filter((s) => !metaSlugs.has(s)).sort(),
      ]
      const flows = []
      for (const flowSlug of orderedSlugs) {
        const full = path.join(dir, `${flowSlug}.flow.json`)
        let envelope = null
        try {
          envelope = JSON.parse(await fs.readFile(full, 'utf8'))
        } catch {
          envelope = null
        }
        const stat = await fs.stat(full)
        flows.push({
          slug: flowSlug,
          title: titleBySlug.get(flowSlug) ?? flowSlug,
          envelope,
          updatedAt: stat.mtime.toISOString(),
        })
      }
      // Include transition when present so buildIndex can carry it to the client.
      const setEntry = { id: setSlug, title: meta.title, flows }
      if (meta.transition !== undefined) setEntry.transition = meta.transition
      sets.push(setEntry)
    }
    return { sets }
  }

  /** Regenerate index.json from a fresh scan; return the index object. */
  async function regenIndex() {
    await ensureRoot()
    const scan = await scanStore()
    const index = buildIndex(scan, { generatedAt: new Date().toISOString() })
    await fs.writeFile(
      path.join(root, 'index.json'),
      JSON.stringify(index, null, 2) + '\n',
      'utf8',
    )
    return index
  }

  async function readFlow(setSlug, flowSlug) {
    const file = path.join(root, setSlug, `${flowSlug}.flow.json`)
    return JSON.parse(await fs.readFile(file, 'utf8'))
  }

  /** Write a flow envelope and upsert its title into the set's set.json. */
  async function writeFlow(setSlug, flowSlug, envelope, title) {
    const dir = path.join(root, setSlug)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, `${flowSlug}.flow.json`),
      JSON.stringify(envelope, null, 2) + '\n',
      'utf8',
    )
    const meta = await readSetMeta(setSlug)
    const entry = meta.flows.find((f) => f.slug === flowSlug)
    if (entry) {
      if (typeof title === 'string' && title) entry.title = title
    } else {
      meta.flows.push({ slug: flowSlug, title: title || flowSlug })
    }
    await writeSetMeta(setSlug, meta)
  }

  async function deleteFlow(setSlug, flowSlug) {
    await fs.rm(path.join(root, setSlug, `${flowSlug}.flow.json`), { force: true })
    const meta = await readSetMeta(setSlug)
    meta.flows = meta.flows.filter((f) => f.slug !== flowSlug)
    await writeSetMeta(setSlug, meta)
  }

  /**
   * Merge partial metadata into an existing set's set.json.
   *
   * Recognised fields: `title` (string), `transition` (object), and `flows`
   * (an array of slugs giving the new flow order — bd ai-engineer-soln).
   * Unknown fields are silently ignored so future additions stay back-compat.
   * The caller is responsible for re-running regenIndex() after this call.
   *
   * @param {string} setSlug
   * @param {{ title?: string, transition?: object, flows?: string[] }} partial
   */
  async function updateSet(setSlug, partial) {
    const meta = await readSetMeta(setSlug)
    if (typeof partial.title === 'string') meta.title = partial.title
    if (partial.transition !== undefined && typeof partial.transition === 'object') {
      meta.transition = partial.transition
    }
    if (Array.isArray(partial.flows)) {
      meta.flows = reorderFlows(meta.flows, partial.flows)
    }
    await writeSetMeta(setSlug, meta)
  }

  /**
   * Duplicate a flow within its set (bd ai-engineer-ih7q).
   *
   * Byte-copies the source flow's envelope to a fresh `<title> copy` slug and
   * inserts the new flow entry into set.json immediately AFTER the source — a
   * forked state lands next to the flow it came from rather than at the end of
   * the ordered set. Returns the new flow's id / slug / title.
   */
  async function duplicateFlow(setSlug, srcSlug) {
    // readFlow throws if the source is missing — the caller maps that to 404.
    const envelope = await readFlow(setSlug, srcSlug)
    const meta = await readSetMeta(setSlug)
    const srcEntry = meta.flows.find((f) => f.slug === srcSlug)
    const srcTitle = srcEntry?.title ?? srcSlug
    const newTitle = `${srcTitle} copy`
    const newSlug = uniqueSlug(
      slugify(newTitle),
      meta.flows.map((f) => f.slug),
    )
    await fs.writeFile(
      path.join(root, setSlug, `${newSlug}.flow.json`),
      JSON.stringify(envelope, null, 2) + '\n',
      'utf8',
    )
    meta.flows = insertFlowAfter(meta.flows, srcSlug, { slug: newSlug, title: newTitle })
    await writeSetMeta(setSlug, meta)
    return { id: `${setSlug}/${newSlug}`, slug: newSlug, title: newTitle }
  }

  /** Create a new set directory with a unique slug derived from `title`. */
  async function createSet(title) {
    const existing = await listSetSlugs()
    const setSlug = uniqueSlug(slugify(title), existing)
    await fs.mkdir(path.join(root, setSlug), { recursive: true })
    await writeSetMeta(setSlug, { id: setSlug, title: title || setSlug, flows: [] })
    return { id: setSlug, title: title || setSlug }
  }

  return {
    root,
    regenIndex,
    readFlow,
    writeFlow,
    deleteFlow,
    duplicateFlow,
    createSet,
    updateSet,
    listSetSlugs,
    readSetMeta,
  }
}

// ── the Vite plugin ──────────────────────────────────────────────────────────

/**
 * @param {{root?: string}} [opts] — persistence root; defaults to flow/flows/.
 * @returns {import('vite').Plugin}
 */
export function flowStorePlugin(opts = {}) {
  const root = opts.root ? path.resolve(opts.root) : DEFAULT_ROOT
  const store = makeStore(root)

  return {
    name: 'flow-store',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (!url.startsWith(API_PREFIX)) return next()

        const rest = url.slice(API_PREFIX.length) // e.g. /file/sample/intake
        const parts = rest.split('/').filter(Boolean)

        try {
          // GET /__flows/index
          if (req.method === 'GET' && parts[0] === 'index' && parts.length === 1) {
            return sendJson(res, 200, await store.regenIndex())
          }

          // POST /__flows/set
          if (req.method === 'POST' && parts[0] === 'set' && parts.length === 1) {
            const body = await readBody(req)
            const set = await store.createSet(body.title)
            await store.regenIndex()
            return sendJson(res, 201, set)
          }

          // POST /__flows/duplicate  body { id: '<set>/<flow>' }
          if (req.method === 'POST' && parts[0] === 'duplicate' && parts.length === 1) {
            const body = await readBody(req)
            const segs = String(body.id || '').split('/').filter(Boolean)
            if (segs.length !== 2 || !SLUG_RE.test(segs[0]) || !SLUG_RE.test(segs[1])) {
              return sendJson(res, 400, { error: 'duplicate needs an `id` of <set>/<flow>' })
            }
            try {
              const dup = await store.duplicateFlow(segs[0], segs[1])
              const index = await store.regenIndex()
              return sendJson(res, 201, { ok: true, ...dup, index })
            } catch {
              return sendJson(res, 404, { error: 'source flow not found' })
            }
          }

          // PUT /__flows/set/<setSlug>
          if (req.method === 'PUT' && parts[0] === 'set' && parts.length === 2) {
            const setSlug = parts[1]
            if (!SLUG_RE.test(setSlug)) {
              return sendJson(res, 400, { error: 'invalid set slug' })
            }
            const body = await readBody(req)
            await store.updateSet(setSlug, body)
            const index = await store.regenIndex()
            return sendJson(res, 200, { ok: true, index })
          }

          // .../file/<set>/<flow>
          if (parts[0] === 'file' && parts.length === 3) {
            const [, setSlug, flowSlug] = parts
            if (!SLUG_RE.test(setSlug) || !SLUG_RE.test(flowSlug)) {
              return sendJson(res, 400, { error: 'invalid set or flow slug' })
            }
            if (req.method === 'GET') {
              try {
                return sendJson(res, 200, await store.readFlow(setSlug, flowSlug))
              } catch {
                return sendJson(res, 404, { error: 'flow not found' })
              }
            }
            if (req.method === 'PUT') {
              const body = await readBody(req)
              if (!body.envelope || typeof body.envelope !== 'object') {
                return sendJson(res, 400, { error: 'PUT body needs an `envelope`' })
              }
              await store.writeFlow(setSlug, flowSlug, body.envelope, body.title)
              const index = await store.regenIndex()
              return sendJson(res, 200, { ok: true, id: `${setSlug}/${flowSlug}`, index })
            }
            if (req.method === 'DELETE') {
              await store.deleteFlow(setSlug, flowSlug)
              await store.regenIndex()
              return sendJson(res, 200, { ok: true })
            }
          }

          return sendJson(res, 404, { error: `no flow-store route for ${req.method} ${url}` })
        } catch (err) {
          return sendJson(res, 500, { error: String(err?.message || err) })
        }
      })
    },
  }
}

export default flowStorePlugin
