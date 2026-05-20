/**
 * indexBuilder.js — pure logic for the directory-of-files persistence layer.
 *
 * Two concerns, both pure (no fs, no Vite, no Vue) so they are unit-testable
 * headless and reusable by both the dev-server plugin and, later, an M5 deck
 * build step:
 *
 *   - slug derivation — turning a human title into a filesystem-safe,
 *     traversal-safe path segment;
 *   - buildIndex() — assembling the machine-readable `index.json` that lets a
 *     slide reference a flow BY ID instead of copy-pasting the flow file.
 *
 * See docs/superpowers/specs/2026-05-20-flow-persistence-design.md.
 */

/** Version of the index.json schema. Bumped if the index shape changes. */
export const INDEX_VERSION = 1

/** A flow / set slug must be lowercase alphanumerics + hyphens — and nothing
 *  else, which also makes path traversal structurally impossible. */
export const SLUG_RE = /^[a-z0-9-]+$/

/**
 * Turn an arbitrary human title into a filesystem-safe slug: lowercase, with
 * every run of non-alphanumeric characters collapsed to a single hyphen and
 * stray leading/trailing hyphens trimmed. Empty / symbol-only input falls back
 * to `'untitled'` so a slug is always non-empty and SLUG_RE-valid.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

/**
 * Return a slug that does not collide with any in `existing`, appending a
 * numeric counter (`-2`, `-3`, …) when the base is already taken.
 *
 * @param {string} base — a slug (already slugify()'d)
 * @param {string[]} existing — slugs already in use
 * @returns {string}
 */
export function uniqueSlug(base, existing) {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * Assemble the machine-readable index from a scan of the persistence root.
 *
 * Sets are sorted by `id`. Flows, however, are kept in the order the scan
 * supplied them — which is the authored `set.json` `flows[]` order (see
 * flowStorePlugin.js#scanStore). A flow-set is an *ordered* list of states
 * (M4), so the index must preserve that order rather than re-sort by slug;
 * the scan is itself deterministic, so the index still diffs cleanly.
 *
 * @param {{sets: Array<{id,title,flows: Array<{slug,title,envelope,updatedAt}>}>}} scan
 * @param {{generatedAt: string}} opts — ISO timestamp, injected for testability
 * @returns {object} the index.json object
 */
export function buildIndex(scan, { generatedAt }) {
  const sets = [...(scan?.sets ?? [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((set) => ({
      id: set.id,
      title: set.title ?? set.id,
      flows: [...(set.flows ?? [])]
        .map((flow) => ({
          id: `${set.id}/${flow.slug}`,
          slug: flow.slug,
          title: flow.title ?? flow.slug,
          file: `${set.id}/${flow.slug}.flow.json`,
          formatVersion: flow.envelope?.formatVersion ?? null,
          nodeCount: flow.envelope?.flow?.nodes?.length ?? 0,
          updatedAt: flow.updatedAt ?? null,
        })),
    }))
  return { indexVersion: INDEX_VERSION, generatedAt, sets }
}
