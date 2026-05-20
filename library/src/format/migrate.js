/**
 * format/migrate.js — flow-format version migration.
 *
 * The format envelope carries a `formatVersion` integer. When an older export
 * is loaded, deserializeFlow() (format/index.js) runs it through this module's
 * ordered migration chain up to the library's current version, so any older
 * export always loads forward.
 *
 * Each migration is a pure step: it takes a flow object at version N and
 * returns a flow object at version N+1. Steps never mutate their input.
 *
 * v1 → v2 (M2, bd ai-engineer-8aee — see flow-M2-design.md §4):
 *   1. the v1 entry node (flow.entryId) becomes a real source node
 *   2. top-level entryId / spawnRate are removed
 *   3. forks[].branches: string[]            → { to, rateShare }[]  (even split)
 *   4. merges[].branches                     → merges[].from
 *   5. widthMode: 'manual'
 *
 * v2 → v3 (v1.1, beads ai-engineer-t0c8 / wec5 — see
 *           flow-v1.1-node-controls-design.md §4.3):
 *   - per node: length ← latency ; width ← width ?? (constraint?30:70) ;
 *     speed/coupleSpeedWidth — see below ;
 *     colorScheme ← kind==='constraint' ? 'red' : 'neutral' ;
 *     kind:'constraint' → 'normal' ; drop latency/constraintKind.
 *   - SPEED (bd ai-engineer-gmj7): a v2 node never authored speed — the deck
 *     engine ran every node at the default 1.0. A non-constraint node gets
 *     speed ← speedFromWidth(width) (a no-op for the default width 70) and
 *     coupleSpeedWidth ← true. A constraint migrates to the narrow width 30,
 *     where speedFromWidth(30)=0.4 would silently throttle throughput 2.5×;
 *     so a migrated constraint is left UNCOUPLED at the engine default 1.0
 *     (coupleSpeedWidth ← false) to preserve deck-parity throughput.
 *   - `capacity` is PRESERVED (bd ai-engineer-v9mj): v3 re-admitted it as an
 *     optional authored node field (the crisp-queue override), so a v1/v2
 *     flow's authored capacity now forward-ports losslessly instead of being
 *     dropped. A v2 node that authored none simply has no capacity in v3 and
 *     normalizeFlow() derives it from width as before.
 *   - flow: drop widthMode / pinchPreset / pinchMode / ribbonColor / bandWidth /
 *     constraintWidth / constraintPlateauWidth / pinchFillColor /
 *     constraintFillColor.
 *   Migration is lossy w.r.t. the removed fields — a documented, deterministic
 *   forward-port (the round-trip invariant governs v3↔v3, not migration).
 *
 * v3 → v4 (v1.2, bd ai-engineer-086t — see
 *           flow-v1.2-rejection-edges-design.md §6):
 *   - add `flow.rejections = []` if absent. No other field changes; every v3
 *     flow migrates cleanly and losslessly.
 */

import {
  DEFAULT_SOURCE_RATE,
  DEFAULT_NODE_LENGTH,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_SPEED,
  speedFromWidth,
} from './model.js'

/** Width given to a migrated v2 `constraint` node that set no explicit width. */
const MIGRATED_CONSTRAINT_WIDTH = 30

/** v3-removed flow-level register / width-mode fields. */
const V3_REMOVED_FLOW_FIELDS = [
  'widthMode',
  'pinchPreset',
  'pinchMode',
  'ribbonColor',
  'bandWidth',
  'constraintWidth',
  'constraintPlateauWidth',
  'pinchFillColor',
  'constraintFillColor',
]

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
 * Migrate a v2 flow object to the v3 data model (v1.1 node-controls rework).
 *
 * @param {object} v2 — a version-2 flow object
 * @returns {object} a version-3 flow object
 */
function migrateV2toV3(v2) {
  const flow = deepClone(v2)

  if (Array.isArray(flow.nodes)) {
    flow.nodes = flow.nodes.map((node) => {
      const n = { ...node }
      const wasConstraint = n.kind === 'constraint'

      // LENGTH ← the v2 latency (the renderer's segment-proportion quantity).
      if (n.length === undefined) {
        n.length = typeof n.latency === 'number' ? n.latency : DEFAULT_NODE_LENGTH
      }
      // WIDTH — keep an explicit v2 width; else derive from constraint-ness.
      if (n.width === undefined) {
        n.width = wasConstraint ? MIGRATED_CONSTRAINT_WIDTH : DEFAULT_NODE_WIDTH
      }
      // SPEED (bd ai-engineer-gmj7) — a non-constraint node couples speed to
      // width via the linear map (a no-op at the default width 70). A migrated
      // constraint is left UNCOUPLED at the engine default: coupling its narrow
      // MIGRATED_CONSTRAINT_WIDTH (30) would give speed 0.4 — a 2.5× throughput
      // throttle the deck original (no speed field → engine default) never had.
      if (n.speed === undefined) {
        n.speed = wasConstraint ? DEFAULT_NODE_SPEED : speedFromWidth(n.width)
      }
      if (n.coupleSpeedWidth === undefined) n.coupleSpeedWidth = !wasConstraint
      // COLOUR — the dropped constraint type becomes the 'red' colour scheme.
      if (n.colorScheme === undefined) {
        n.colorScheme = wasConstraint ? 'red' : 'neutral'
      }
      // The constraint type is removed.
      if (wasConstraint) n.kind = 'normal'

      // capacity is PRESERVED (v9mj) — v3 re-admitted it as an optional
      // authored field. latency / constraintKind are still dropped.
      delete n.latency
      delete n.constraintKind
      return n
    })
  }

  for (const field of V3_REMOVED_FLOW_FIELDS) delete flow[field]

  return flow
}

/**
 * Migrate a v3 flow object to the v4 data model (v1.2 rejection edges — see
 * docs/superpowers/specs/2026-05-20-flow-v1.2-rejection-edges-design.md §6).
 *
 * v4 adds a first-class top-level `flow.rejections[]` array. The migration adds
 * an empty `rejections: []` when absent and changes no other field — every v3
 * flow migrates cleanly. (Per-edge defaults are normalizeFlow()'s job, not the
 * migration's; migration only ensures the array exists.)
 *
 * @param {object} v3 — a version-3 flow object
 * @returns {object} a version-4 flow object
 */
function migrateV3toV4(v3) {
  const flow = deepClone(v3)
  if (!Array.isArray(flow.rejections)) flow.rejections = []
  return flow
}

/**
 * Ordered migration registry: version N → a step producing version N+1.
 */
const MIGRATIONS = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
}

/** The highest format version this module can migrate *to*. */
export const LATEST_MIGRATED_VERSION = 4

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
