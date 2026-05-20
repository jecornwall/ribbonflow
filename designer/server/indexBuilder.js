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
    .map((set) => {
      const entry = {
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
      }
      // Carry the set-level transition metadata through from set.json so the
      // designer client can restore the persisted transition on set-preview open.
      // Only present when set.json has a transition field — consumers fall back
      // to TRANSITION_DEFAULTS when absent (back-compat with existing set.json).
      if (set.transition !== undefined) entry.transition = set.transition
      return entry
    })
  return { indexVersion: INDEX_VERSION, generatedAt, sets }
}

/**
 * Return a new `set.json` flows array with `entry` inserted immediately after
 * the entry whose slug is `afterSlug`. When `afterSlug` is absent the entry is
 * appended. Pure — the input array is not mutated.
 *
 * Used by the designer's duplicate-a-flow action (bd ai-engineer-ih7q): a
 * forked state should land right next to the flow it was copied from rather
 * than at the end of the (ordered) set.
 *
 * @param {Array<{slug:string}>} flows
 * @param {string} afterSlug
 * @param {{slug:string,title?:string}} entry
 * @returns {Array}
 */
export function insertFlowAfter(flows, afterSlug, entry) {
  const list = [...(flows ?? [])]
  const i = list.findIndex((f) => f.slug === afterSlug)
  list.splice(i >= 0 ? i + 1 : list.length, 0, entry)
  return list
}

/**
 * Return a new flows array with the title of the entry matching `slug` updated
 * to `newTitle`. Entries whose slug doesn't match are returned as-is (shallow
 * copy of those objects). Pure — the input array is not mutated.
 *
 * Used by the designer's rename-a-flow action (bd ai-engineer-h507): only the
 * display title changes; the slug / filename is the stable set-reference key
 * and is never touched by a rename.
 *
 * @param {Array<{slug:string,title?:string}>} flows
 * @param {string} slug
 * @param {string} newTitle
 * @returns {Array}
 */
export function renameFlowInSet(flows, slug, newTitle) {
  return (flows ?? []).map((f) =>
    f.slug === slug ? { ...f, title: newTitle } : f,
  )
}

/**
 * Reorder a set's `set.json` flows array to match `orderedSlugs`.
 *
 * A flow-set is an ordered list of states (M4) — the order is the animation
 * sequence — so the designer must be able to reorder it (bd ai-engineer-soln).
 * Entries whose slug appears in `orderedSlugs` are emitted first, in that
 * order; any entry NOT named is kept afterwards in its original relative
 * order, so a partial / stale order list can never silently drop a flow.
 * Pure — the input array is not mutated.
 *
 * @param {Array<{slug:string}>} flows
 * @param {string[]} orderedSlugs
 * @returns {Array}
 */
export function reorderFlows(flows, orderedSlugs) {
  const list = [...(flows ?? [])]
  const rank = new Map((orderedSlugs ?? []).map((s, i) => [s, i]))
  const named = list
    .filter((f) => rank.has(f.slug))
    .sort((a, b) => rank.get(a.slug) - rank.get(b.slug))
  const rest = list.filter((f) => !rank.has(f.slug))
  return [...named, ...rest]
}
