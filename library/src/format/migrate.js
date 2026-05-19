/**
 * format/migrate.js — flow-format version migration.
 *
 * The format envelope carries a `formatVersion` integer. When an older export
 * is loaded, deserializeFlow() (format/index.js) runs it through this module's
 * ordered migration chain up to the library's current version, so a v1 export
 * always loads forward losslessly.
 *
 * Each migration is a pure step: it takes a flow object at version N and
 * returns a flow object at version N+1. Steps never mutate their input.
 *
 * v1 → v2 (M2, bd ai-engineer-8aee — see spec §4):
 *   1. the v1 entry node (flow.entryId) becomes a real source node:
 *      kind:'source', rate = flow.spawnRate ?? DEFAULT_SOURCE_RATE
 *   2. top-level entryId / spawnRate are removed (sources are nodes now)
 *   3. forks[].branches: string[]            → { to, rateShare }[]  (even split)
 *   4. merges[].branches                     → merges[].from
 *   5. widthMode: 'manual'  (v1 width came from the pinch register, not rate —
 *      a conservative default that preserves v1 rendering; new v2 flows default
 *      to 'coupled')
 */

import { DEFAULT_SOURCE_RATE } from './model.js'

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Migrate a v1 flow object to the v2 data model.
 *
 * @param {object} v1 — a version-1 flow object
 * @returns {object} a version-2 flow object
 */
function migrateV1toV2(v1) {
  const flow = deepClone(v1)

  // 1 + 2 — promote the v1 entry node to a real source node.
  const spawnRate = typeof flow.spawnRate === 'number' ? flow.spawnRate : DEFAULT_SOURCE_RATE
  if (flow.entryId != null && Array.isArray(flow.nodes)) {
    const entry = flow.nodes.find(n => n.id === flow.entryId)
    if (entry) {
      entry.kind = 'source'
      if (entry.rate === undefined) entry.rate = spawnRate
    }
  }
  delete flow.entryId
  delete flow.spawnRate

  // 3 — fork branches: bare id strings become { to, rateShare } objects.
  if (Array.isArray(flow.forks)) {
    flow.forks = flow.forks.map((fork) => {
      const rawBranches = Array.isArray(fork.branches) ? fork.branches : []
      const evenShare = rawBranches.length > 0 ? 1 / rawBranches.length : 0
      return {
        ...fork,
        branches: rawBranches.map(b =>
          typeof b === 'string' ? { to: b, rateShare: evenShare } : b,
        ),
      }
    })
  }

  // 4 — merge `branches` is renamed to `from` (a merge's branches are upstream).
  if (Array.isArray(flow.merges)) {
    flow.merges = flow.merges.map((merge) => {
      if (merge.branches !== undefined && merge.from === undefined) {
        const { branches, ...rest } = merge
        return { ...rest, from: branches }
      }
      return merge
    })
  }

  // 5 — conservative width behaviour for migrated flows.
  if (flow.widthMode === undefined) flow.widthMode = 'manual'

  return flow
}

/**
 * Ordered migration registry: version N → a step producing version N+1.
 */
const MIGRATIONS = {
  1: migrateV1toV2,
}

/** The highest format version this module can migrate *to*. */
export const LATEST_MIGRATED_VERSION = 2

/**
 * Migrate a flow object from `fromVersion` up to the latest version this
 * module knows. Applies each registered step in order.
 *
 * @param {object} flow — a flow object at version `fromVersion`
 * @param {number} fromVersion — the flow's current format version
 * @returns {object} the flow object migrated to LATEST_MIGRATED_VERSION
 * @throws {Error} when no migration path exists from `fromVersion`
 */
export function migrateFlow(flow, fromVersion) {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new Error(`migrateFlow: invalid source version ${fromVersion}`)
  }
  if (fromVersion > LATEST_MIGRATED_VERSION) {
    throw new Error(
      `migrateFlow: cannot migrate from version ${fromVersion} — ` +
      `this library migrates up to version ${LATEST_MIGRATED_VERSION}`,
    )
  }
  let current = flow
  let version = fromVersion
  while (version < LATEST_MIGRATED_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) {
      throw new Error(`migrateFlow: no migration step from version ${version}`)
    }
    current = step(current)
    version += 1
  }
  return current
}
