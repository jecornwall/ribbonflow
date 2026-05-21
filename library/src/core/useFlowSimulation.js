/**
 * useFlowSimulation.js — 2D physics simulation for flow-animation agents.
 *
 * Headless core (`createFlowSimulation`) is pure JS, Vue-free, fully testable
 * via node:test. The Vue composable wrapper (`useFlowSimulation`) is added
 * later for reactive integration with the components.
 *
 * See docs/superpowers/specs/2026-05-16-flow-animation-redesign-design.md.
 */

import {
  buildBranches,
  buildPinchWidthFn,
  segmentedRibbonLayout,
  segmentBoundsByLatency,
  computeNodeWidths,
  DEFAULT_BAND_WIDTH,
  MIN_RIBBON_WIDTH,
  PARTICLE_RADIUS,
  LARGE_PARTICLE_SCALE,
  WALL_MARGIN,
  REJECTION_BAND_WIDTH,
  REJECTION_SPEED_MULTIPLIER,
} from './flowCurve.js'
import { resolveRng } from './rng.js'

// ── Per-agent radius (v1.3 L1 — spec §3.1) ────────────────────────────────
// The engine historically hard-coded a single global PARTICLE_RADIUS (3).
// v1.3 introduces a second particle size, so every radius-dependent site
// must read a PER-AGENT radius instead. L1 is a behaviour-preserving
// refactor: every agent is created with `radius: PARTICLE_RADIUS`, so all
// the per-agent / per-pair expressions below reduce EXACTLY to their former
// global values. Large particles (L3) will create agents with
// radius = PARTICLE_RADIUS * LARGE_PARTICLE_SCALE.
//
// `agentRadius()` falls back to PARTICLE_RADIUS for any agent object that
// lacks the field — e.g. agents a test pushes straight onto `sim.agents`.
// That keeps the refactor invisible to the existing engine suite.
const DEFAULT_AGENT_RADIUS = PARTICLE_RADIUS
export function agentRadius(agent) {
  return agent.radius ?? PARTICLE_RADIUS
}

// ── Particle size (v1.3 L3 — spec §1) ─────────────────────────────────────
// An agent's `radius` derives from its `size`: a large particle is
// LARGE_PARTICLE_SCALE× the small radius. radiusForSize is the single
// derivation point; the format layer's particleSize values map straight in.
export function radiusForSize(size) {
  return PARTICLE_RADIUS * (size === 'large' ? LARGE_PARTICLE_SCALE : 1)
}
// A node's emitted particle size. A `particleSize:'large'` source emits large
// agents; everything else emits small. Defends against an un-normalized flow
// (the engine takes raw flow configs — see the linearFlow test fixtures).
const particleSizeOf = (node) =>
  node && node.particleSize === 'large' ? 'large' : 'small'
// A node's red-particle ratio (bd ai-engineer-s8cm) — the fraction of its
// emitted particles that are RED (defective work). Source-only; clamped to
// [0,1]; absent / non-numeric → 0 (all black — the historical behaviour).
// Defends against an un-normalized flow, exactly as particleSizeOf does.
const redRatioOf = (node) => {
  const r = node && typeof node.redRatio === 'number' ? node.redRatio : 0
  return r < 0 ? 0 : r > 1 ? 1 : r
}
// Transform-count defaults — inlined so the engine carries no format-layer
// dependency (mirrors DEFAULT_SOURCE_RATE below; format/model.js owns the
// canonical DEFAULT_SPLIT_COUNT / DEFAULT_COMBINE_COUNT).
const DEFAULT_SPLIT_COUNT = 4
const DEFAULT_COMBINE_COUNT = 4

// Per-agent wall margin: an agent's *centre* must stay this far from the
// ribbon wall so its circle (radius `agentRadius`) sits fully inside, with
// WALL_MARGIN of visible gap. Replaces the former global PHYS_WALL_MARGIN
// constant; for a small agent this is PARTICLE_RADIUS + WALL_MARGIN =
// 3 + 2 = 5 viewBox units — byte-identical to the old constant.
export function physWallMargin(agent) {
  return agentRadius(agent) + WALL_MARGIN
}

// Per-pair comfortable centre-to-centre gap when one agent is stopped
// behind another. The former global DESIRED_SEP was 2.5 × PARTICLE_RADIUS
// = 7.5 — i.e. 1.25 × the contact distance (2 × PARTICLE_RADIUS). Restated
// per-pair as DESIRED_SEP_FACTOR × (rᵢ + rⱼ); with both radii ==
// PARTICLE_RADIUS this is 1.25 × 6 = 7.5, byte-identical to the old value.
export const DESIRED_SEP_FACTOR = 1.25
export function desiredSep(a, b) {
  return DESIRED_SEP_FACTOR * (agentRadius(a) + agentRadius(b))
}

// Projection numerical-noise floor — adds a sub-unit tolerance to the
// ribbon-polygon clamp's Euclidean check (bd ai-engineer-0ld, 2026-05-18).
//
// At the constraint plateau the per-node halfW collapses to MIN_RIBBON_WIDTH/2
// = 5, exactly equal to PHYS_WALL_MARGIN, so maxEuclid = halfW - PHYS_WALL_MARGIN
// = 0. With zero tolerance, ANY positive distance from the projected centerline
// point triggers an Euclidean snap, including the bisection projection's
// residual ~0.1-unit floating-point noise. At low rAF rates the per-frame
// integration delta (vx·dt) easily exceeds that noise; at high rAF rates
// (~1440 fps in headless playwright) the integration delta becomes
// comparable to or smaller than the noise, and the agent's net forward
// progress goes to zero — the slidev rendering visibly stalls.
//
// 0.75 unit tolerance is well under the visual perception threshold on a
// 1920×1080 viewport (≈ 0.75–0.9 display pixels of escape) and large enough
// to absorb the bisection floor (~0.5 units after the running-best fix).
// Tier-1 no-escape invariants still hold to their 0.1-unit assertion
// tolerance because the in-loop lateral clamps (Phase 1 of each polygon
// clamp) remain TIGHT — only the Euclidean Phase-2 fall-through is
// loosened, and only at sites where it produced the freeze pin.
const PROJECTION_NOISE_TOL = 0.75

let nextAgentId = 0
const freshAgentId = () => `agent-${nextAgentId++}`

// Default source emit rate (particles/sec) — mirrors format/model.js's
// DEFAULT_SOURCE_RATE. Inlined so the engine carries no format-layer
// dependency (M2 spec §5.1).
const DEFAULT_SOURCE_RATE = 1.0

// ──────────────────────────────────────────────────────────────────────────
// Centerline projection — coarse-to-fine bisection (bead ai-engineer-1al).
//
// Replaces the old "200 linear samples" projection at three call sites. We
// do a 12-sample coarse pass to find the bracketing segment, then refine
// with 10 ternary-search iterations to sub-unit accuracy. Roughly 12 + 20
// = 32 pointAtArcLength evaluations per call vs. 200 for the old scan,
// and the bisection result has accuracy proportional to (1/3)^10 of the
// initial bracket — typically <0.05 viewBox units, versus the old method's
// floor of (totalLength / 200) ≈ 6 units between samples.
//
// Returns { s, distance2 }.
// ──────────────────────────────────────────────────────────────────────────

const PROJ_COARSE = 12
const PROJ_REFINE = 10

export function projectToCenterline(cl, x, y) {
  const L = cl.totalLength
  if (L <= 0) {
    const p = cl.pointAtArcLength(0)
    return { s: 0, distance2: (p.x - x) ** 2 + (p.y - y) ** 2 }
  }
  // Track the globally-best (s, d²) across every evaluation. Ternary search
  // narrows the bracket but can drop the true optimum on the final midpoint
  // when the distance landscape is not strictly unimodal in floating point —
  // returning the running best instead of the final midpoint is the
  // standard fix (bd ai-engineer-0ld, 2026-05-18). Pre-fix the projection
  // could miss the true minimum by ~0.5–0.8 viewBox units even on a
  // perfectly straight centerline; that error pinned agents against the
  // ribbon-polygon clamp at the constraint plateau (per-node halfW=5,
  // PHYS_WALL_MARGIN=5 → maxEuclid=0 → any sub-unit projection error
  // snaps the agent back, locking forward progress at high rAF rates).
  let bestS = 0, bestD2 = Infinity
  function probe(s) {
    const p = cl.pointAtArcLength(s)
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d2 < bestD2) { bestS = s; bestD2 = d2 }
    return d2
  }
  // Phase 1: coarse linear pass — find best sample index.
  let bestI = 0
  for (let i = 0; i <= PROJ_COARSE; i++) {
    const s = (i / PROJ_COARSE) * L
    const d2 = probe(s)
    if (d2 === bestD2 && s === bestS) bestI = i
  }
  // Phase 2: ternary search in the bracket [bestI-1, bestI+1] (clamped).
  let sLo = Math.max(0, (bestI - 1) / PROJ_COARSE) * L
  let sHi = Math.min(1, (bestI + 1) / PROJ_COARSE) * L
  for (let iter = 0; iter < PROJ_REFINE; iter++) {
    const span = sHi - sLo
    if (span < 1e-6) break
    const s1 = sLo + span / 3
    const s2 = sHi - span / 3
    const d1 = probe(s1)
    const d2 = probe(s2)
    if (d1 < d2) sHi = s2; else sLo = s1
  }
  // Probe the final midpoint too in case the running-best fell out of the
  // narrowed bracket and the midpoint is now the true minimum.
  probe((sLo + sHi) / 2)
  return { s: bestS, distance2: bestD2 }
}

// ──────────────────────────────────────────────────────────────────────────
// Branch selection with fork tiebreaker (bead ai-engineer-1al).
//
// The old code used the first Array.find() match, which silently picked one
// of multiple candidate branches when an agent sat on a fork parent or
// merge node (node id present in two-or-more branch nodeIds lists). When
// physics noise put the agent slightly off the active branch's centerline,
// the wrong branch could win — its tangent pointing backwards relative to
// the agent's velocity, snapping the agent onto the sibling lane and
// frequently violating the no-escape invariant.
//
// New behaviour:
//   1. Filter branches that contain BOTH currentNodeId and targetNodeId
//      (or just currentNodeId if target is null).
//   2. If no match, fall back to any branch containing currentNodeId.
//   3. If 0 or 1 candidates remain, return that result.
//   4. If multiple candidates, prefer the branch whose unit tangent at the
//      agent's projected arc-length has the largest dot-product with the
//      agent's velocity vector. If the agent is at rest (speed² < 1e-6),
//      fall back to the candidate with the smallest projection distance.
// ──────────────────────────────────────────────────────────────────────────

export function selectBranch(agent, branches) {
  // v1.2 R2: a 'revising' agent rides a rejection branch; every other agent
  // rides a forward branch. Partition the pool by branch.kind up front so the
  // two never cross-select (a rejection branch and a forward branch can share
  // both the `from` and `to` node ids).
  const wantRejection = agent.lifecycle === 'revising'
  const pool = branches.filter(b =>
    wantRejection ? b.kind === 'rejection' : b.kind !== 'rejection',
  )
  let candidates = pool.filter(b =>
    b.nodeIds.includes(agent.currentNodeId) &&
    (agent.targetNodeId === null || b.nodeIds.includes(agent.targetNodeId)),
  )
  if (candidates.length === 0) {
    candidates = pool.filter(b => b.nodeIds.includes(agent.currentNodeId))
  }
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const speed2 = agent.vx * agent.vx + agent.vy * agent.vy
  if (speed2 < 1e-6) {
    // No velocity → pick the branch whose centerline the agent is closest to.
    let best = candidates[0], bestD2 = Infinity
    for (const b of candidates) {
      const proj = projectToCenterline(b.centerline, agent.x, agent.y)
      if (proj.distance2 < bestD2) { bestD2 = proj.distance2; best = b }
    }
    return best
  }
  // Pick the branch whose forward tangent best agrees with the agent's velocity.
  let best = candidates[0], bestDot = -Infinity
  for (const b of candidates) {
    const proj = projectToCenterline(b.centerline, agent.x, agent.y)
    const tan = b.centerline.tangentAtArcLength(proj.s)
    const dot = tan.x * agent.vx + tan.y * agent.vy
    if (dot > bestDot) { bestDot = dot; best = b }
  }
  return best
}

/**
 * Create a simulation instance for a flow config.
 *
 * Returns an object exposing:
 *   - agents:  array of agent records (mutated in place each step)
 *   - flow:    the original flow config
 *   - branches, widths: precomputed structural data
 *   - step(dt): advance the simulation by dt seconds
 *   - traces: { entries, exits, escapes, revisions } — instrumentation for Tier 1 assertions
 */
export function createFlowSimulation(flow, opts = {}) {
  // ── Source resolution (M2 spec §5.1 — real multi-source) ──────────────────
  // v2: real source nodes — every `kind:'source'` node emits independently at
  //     its own `rate` (default DEFAULT_SOURCE_RATE).
  // v1: a single top-level `entryId`, rate-limited only if `spawnRate` is set;
  //     otherwise legacy bulk-fill. Kept as a back-compat adapter so the v1
  //     fixtures (n4 / n9 / synthetic) run unchanged on the evolved engine.
  const sourceNodes = flow.nodes.filter(n => n.kind === 'source')
  let sources
  if (sourceNodes.length > 0) {
    sources = sourceNodes.map(n => ({
      id: n.id,
      node: n,
      rate: typeof n.rate === 'number' ? n.rate : DEFAULT_SOURCE_RATE,
    }))
  } else {
    if (!flow.entryId) {
      throw new Error(
        "createFlowSimulation: flow needs a source node (kind:'source') "
        + 'or a legacy entryId',
      )
    }
    const entry = flow.nodes.find(n => n.id === flow.entryId)
    if (!entry) {
      throw new Error(`createFlowSimulation: entryId "${flow.entryId}" not found`)
    }
    sources = [{
      id: entry.id,
      node: entry,
      rate: typeof flow.spawnRate === 'number' ? flow.spawnRate : null,
    }]
  }
  // Rate-limited when every source declares a numeric rate. v2 source nodes
  // always do (default applied above); a v1 entryId with no spawnRate stays in
  // legacy bulk-fill mode.
  const rateLimited = sources.every(s => s.rate !== null)
  const sourceIdSet = new Set(sources.map(s => s.id))

  const initialAgents = opts.initialAgents ?? 8

  // Optional seeded RNG (bd ai-engineer-4ext). The engine draws random numbers
  // at two timing-sensitive sites — spawnPosition lateral jitter and the
  // revise-probability roll. Unseeded (`opts.seed` absent) `rand` IS
  // `Math.random`, so production playback is byte-identical to before. Passing
  // `{ seed: <int> }` swaps in a deterministic mulberry32 generator, making the
  // whole run reproducible — used by probabilistic engine tests so realised
  // rejection/split frequencies no longer drift run to run.
  const rand = resolveRng(opts.seed)

  const { branches } = buildBranches(flow)
  const widths = computeNodeWidths(flow)

  // Topology classifiers for the junction-cross check (bd ai-engineer-qmti).
  //
  // A *junction* is a node where the agent's inbound branch terminates and a
  // SEPARATELY SEEDED outbound branch begins — the two meeting only at the
  // node anchor. buildBranches seeds exactly two such cases:
  //   - a MERGE  (>1 predecessor): the post-merge continuation is its own
  //     branch, seeded fresh at the merge node;
  //   - a FORK   (>1 successor):   each fork-child branch is seeded fresh
  //     with the fork node prepended.
  // Crossing into either EARLY (well upstream of the anchor, at segHoldBounds)
  // re-seats the agent on the outbound branch and the post-gate clamp snaps it
  // forward to that branch's start — the e0cj teleport. The two-stage cross
  // defers the physical crossing to the anchor.
  //
  // This pair of explicit predecessor-/successor-map checks replaces the old
  // structural-coincidence proxy `target === branch.nodeIds[last]`, which was
  // branch-relative and also fired for a plain LEAF terminus (a leaf has no
  // outbound branch, so it never needs the two-stage cross). Mirrors
  // buildBranches' own internal `isMerge` / `isFork`.
  const predCount = new Map()
  for (const n of flow.nodes) {
    for (const s of n.successors || []) {
      predCount.set(s, (predCount.get(s) || 0) + 1)
    }
  }
  const succCountById = new Map(
    flow.nodes.map(n => [n.id, (n.successors || []).length]))
  const isMergeNode = (id) => (predCount.get(id) || 0) > 1
  const isForkNode = (id) => (succCountById.get(id) || 0) > 1
  const isJunctionNode = (id) => isMergeNode(id) || isForkNode(id)

  // Per-node SPEED multipliers (v1.1 §7, bd ai-engineer-06e7). The v1.1 node
  // model carries an authored SPEED knob; this is the engine's physical hook
  // for it. Default 1.0 so legacy fixtures with no `speed` field run
  // unchanged. branch.speedFn(s) (built in the branch loop below) is the
  // per-node step function the main loop multiplies into targetSpeed.
  const nodeSpeeds = Object.fromEntries(
    flow.nodes.map(n => [n.id, typeof n.speed === 'number' ? n.speed : 1.0]),
  )

  // DEPRECATED iter-1/2 hex-pack support — superseded by anticipatory
  // deceleration + speed-from-width (commits aa307e0 "gravity removed",
  // 50c6d82, e47e1fc "2ip", 90538c5 "98q final"). The original iter-2 model
  // identified the constraint node here and applied a constant rightward
  // gravity to upstream agents so they piled against the pinch; iter-3
  // replaced that mechanism with `branch.widthFn`-driven speed slowdown
  // + lookahead-distance deceleration. `constraintNode` is no longer
  // referenced anywhere in this file; kept here (commented) for archaeology
  // so a reader tracing bd-9nw / bd-aa307e0 can see what was removed.
  // See toc-diagrams.md §Iter-3-k01 for the full deprecation rationale.
  //   const constraintNode = flow.nodes.find(n => n.kind === 'constraint') ?? null

  // Precompute each branch's anchor arc-lengths once. The forward-boundary
  // clamp (when an agent's target is full, the agent must not advance past
  // the target's anchor on the centerline) needs anchorS per branch per
  // node; deriving it from projectToCenterline per frame per blocked agent
  // would be wasteful. Centerlines are immutable so this stays valid.
  //
  // Also precompute branch.widthFn(s) — the local *visible* band width at
  // arc-length s. Drives the speed-from-width slowdown introduced in Step
  // 4 (bead ai-engineer-r7r), Jason's design pivot: agents slow down as
  // the band narrows toward the constraint, naturally producing an
  // orderly queue without rigid jostling. For pinch-mode flows we use
  // buildPinchWidthFn (smooth wineglass curve). For throughput-encoded
  // flows the visible width is a per-node step function matching what
  // FlowGraph.vue's branchLatencyArc renders.
  let maxVisibleWidth = MIN_RIBBON_WIDTH
  let minVisibleWidth = Infinity
  for (const branch of branches) {
    branch.anchorS = branch.anchors.map(
      a => projectToCenterline(branch.centerline, a.x, a.y).s,
    )
    // ── Rejection branches (v1.2 R2 — spec §3.1) ────────────────────────────
    // A thin fixed-width branch: REJECTION_BAND_WIDTH everywhere, no pinch,
    // no per-node speed scaling. Excluded from the maxVisibleWidth /
    // minVisibleWidth normalisation below so the forward-flow speed ramp is
    // numerically untouched by the presence of rejection edges. segHoldBounds
    // = [≈0, ≈totalLength] so the agent only ever holds at the `to` anchor.
    if (branch.kind === 'rejection') {
      branch.widthFn = () => REJECTION_BAND_WIDTH
      branch.segBounds = [0, branch.centerline.totalLength]
      branch.segHoldBounds = [...branch.anchorS]
      branch.speedFn = () => 1.0
      continue
    }
    // Latency-distributed per-node segment boundaries (length N+1).
    // segBounds[i] is the arc-length where node i's RIBBON SEGMENT starts —
    // the upstream edge of the visible band (orange constraint band + its
    // pink transition wing all sit inside [segBounds[i], segBounds[i+1]]).
    branch.segBounds = segmentBoundsByLatency(branch, flow)
    // segHoldBounds[i] is the arc-length of node i's PLATEAU start — the
    // curve→plateau boundary where the narrowing transition curve ends and
    // the constant-width plateau begins. bd ai-engineer-blqz: capacity-
    // blocked agents hold HERE (front-of-queue at the entrance to the narrow
    // orange plateau), so the queue body FILLS the pinch curve back through
    // the narrowing transition; only overflow spills into the upstream flat
    // band. (c42z held at segBounds[i] — the segment's upstream edge — which
    // overshot: the pile sat in the flat wheat BEFORE the curve.) For an
    // interior boundary between equal-width segments transHalf=0, so
    // plateau.sStart === segBounds[i] and the hold point is unchanged.
    if (flow.pinchMode === 'constraint-only') {
      branch.widthFn = buildPinchWidthFn(branch, flow)
      // Pinch-mode flows have no segmentedRibbonLayout segments[]; fall back
      // to the segment edge (c42z behaviour). No real flow uses pinchMode.
      branch.segHoldBounds = branch.segBounds
    } else {
      // bd ai-engineer-0sdz: the non-pinch ribbon profile is the SMOOTH
      // segmented width function — a constant-width plateau per node with
      // smoothstep transition curves at every interior boundary where the
      // adjacent widths differ. This is the SAME segmentedRibbonLayout
      // FlowGraph.vue's `branchWidthFn` uses, so the physics wall-clamp and
      // the rendered ribbon agree by construction (the no-escape invariant
      // cannot drift). It replaces a hard per-node STEP function; a smooth
      // profile is strictly gentler than the step (intermediate widths, no
      // jumps), so the clamp only ever tightens monotonically.
      const layout = segmentedRibbonLayout(branch, flow, widths)
      branch.widthFn = layout.widthFn
      // plateau.sStart per node — the same segmentation the renderer draws,
      // so the engine's hold point IS the visual curve→plateau boundary.
      branch.segHoldBounds = layout.segments.map(seg => seg.plateau.sStart)
    }
    // Per-node SPEED step function (v1.1 §7, bd ai-engineer-06e7). The
    // segments are latency-proportioned — exactly the segmentation widthFn's
    // legacy branch uses and FlowGraph's branchLatencyArc renders — so
    // speedFn(s) returns the authored SPEED of whichever node owns the ribbon
    // segment at arc-length s. The main per-agent loop multiplies targetSpeed
    // by speedFn(bestS) so a node's SPEED physically changes how fast
    // particles cross it (was inert pre-06e7 — see v1.1 spec §2.2).
    {
      const speedLatencies = branch.nodeIds.map(
        id => flow.nodes.find(n => n.id === id).latency,
      )
      const speedSumL = speedLatencies.reduce((a, b) => a + b, 0) || 1
      const speedTotalLen = branch.centerline.totalLength
      const speedSegLens = speedLatencies.map(
        l => (l / speedSumL) * speedTotalLen,
      )
      branch.speedFn = (s) => {
        let acc = 0
        for (let i = 0; i < branch.nodeIds.length; i++) {
          if (s <= acc + speedSegLens[i]) return nodeSpeeds[branch.nodeIds[i]]
          acc += speedSegLens[i]
        }
        return nodeSpeeds[branch.nodeIds[branch.nodeIds.length - 1]]
      }
    }

    // Sample widthFn for max/min-width normalization.
    const SAMPLES = 32  // bumped from 16 to better sample the constraint plateau
    const L = branch.centerline.totalLength
    for (let i = 0; i <= SAMPLES; i++) {
      const w = branch.widthFn((i / SAMPLES) * L)
      if (w > maxVisibleWidth) maxVisibleWidth = w
      if (w < minVisibleWidth) minVisibleWidth = w
    }
  }
  if (!isFinite(minVisibleWidth)) minVisibleWidth = MIN_RIBBON_WIDTH

  // Speed-from-width parameters (bead ai-engineer-r7r → ai-engineer-98q).
  //
  // What we want (iter-3 bd-98q): the bottleneck (narrow band) is the SLOWEST
  // point in the simulation. Agents approach at full speed, slow down AS THEY
  // ENTER the narrow zone, and the queue forms tightly immediately upstream
  // of the constraint — not smeared across the upstream half of the ribbon.
  //
  // SLOW_THRESHOLD: width fraction below which agents start to decelerate.
  //   Above threshold → baseSpeed; below → ramp toward MIN_FACTOR. Threshold
  //   stays at 0.5 of maxVisibleWidth so the wide upstream plateau still
  //   reads as free-flow.
  // MIN_SPEED_FACTOR: speed at the NARROWEST visible width. The previous
  //   formula floored at width=0, but real widths bottom out at the constraint
  //   plateau (~22 of 70 for N4 → 22/35 = 63% of the ramp range), so the
  //   agent's effective minimum speed was ~83% of baseSpeed (essentially as
  //   fast as the wide band — no visible slowdown, no queue formation).
  //
  // Iter-3 fix (bd-98q): MIN=0.70 (constraint runs at 70% baseSpeed = 140
  // px/s vs 200 px/s wide-band — a 30% slowdown that reads as "slower" but
  // doesn't collapse throughput) AND remap the ramp endpoints to
  // [minVisibleWidth, SLOW_THRESHOLD_W] so MIN_FACTOR is exactly reached at
  // the constraint plateau (not just an unreachable floor at width=0).
  // Lower values (0.30–0.55) tested as "more aggressive slowdown" per the
  // dispatch hint, but the resulting throughput drop (5–8 exits/30s vs 11
  // at MIN=0.70) breaks the throughput-test invariants AND visually thins
  // out the queue at the constraint (because slower constraint → longer
  // cycle → queue stretches further back into solution-design rather than
  // tightening AT the constraint). 0.70 is the sweet spot per sweep
  // /tmp/iter3-98q-sweep3.mjs (slowest agent reliably AT_C, tight=4 in
  // [770,830] zone at t=30s, 11 leaf exits/30s).
  const SLOW_THRESHOLD_FRAC = 0.5
  const MIN_SPEED_FACTOR    = 0.70
  const SLOW_THRESHOLD_W    = SLOW_THRESHOLD_FRAC * maxVisibleWidth
  const NARROW_W            = minVisibleWidth

  // Anticipatory-deceleration parameters (bead ai-engineer-2ip → ai-engineer-98q).
  //
  // LOOKAHEAD_DIST: how far ahead along the centerline an agent "sees".
  //   Iter-2 used 200 viewBox units (≈1.0s of warning at baseSpeed=200) —
  //   visually this smeared the deceleration across the upstream half of
  //   the ribbon, so agents started slowing long before the bottleneck and
  //   the queue never formed AT the constraint. Iter-3 (bd-98q) drops this
  //   to 70 units (≈0.35s of warning) — agents only react to a blocker
  //   they're about to bump into, so the upstream zone reads more as
  //   free-flow and the queue tightens at the constraint zone. Tested
  //   range: 30–120 (sweep /tmp/iter3-98q-test-sweep.mjs). Values < 60 fail
  //   the single-file invariant (agents pile two-abreast laterally because
  //   deceleration starts too late to maintain DESIRED_SEP). Values > 90
  //   thin the cluster at the constraint and revert toward the iter-2
  //   smearing pattern. 70 is the empirical sweet spot.
  // DESIRED_SEP: comfortable centre-to-centre gap when one agent is stopped
  //   behind another. Now PER-PAIR — see desiredSep() at module scope: for
  //   two small agents it is 2.5 × PARTICLE_RADIUS = 7.5 viewBox units,
  //   unchanged from the former global constant.
  // K_SPEED: proportional gain on tangential speed error (1/s). With
  //   K_SPEED=4, exponential convergence τ=0.25s. Combined with
  //   LOOKAHEAD_DIST=70 and constraint-floor MIN_SPEED_FACTOR=0.70, agents
  //   approaching a slow-moving queue decelerate smoothly through the
  //   look-ahead zone.
  // ACCEL_CAP: maximum per-frame tangential acceleration (px/s²). 800 over
  //   1/60s = 13 px/s velocity change per frame. With LOOKAHEAD=70 and
  //   baseSpeed=200 → constraint-speed 140, a worst-case 60 px/s decel
  //   needs ~170 px/s² over 0.35s — comfortably inside the cap, so braking
  //   remains smooth and the bounded-acceleration invariant holds.
  const LOOKAHEAD_DIST = 70
  const K_SPEED        = 4.0
  const ACCEL_CAP      = 800

  // Compute the ribbon's geometric bounding box — the union of every branch's
  // centerline samples expanded by the local max half-width. This is the
  // bound the teleport backstop checks against, not the viewBox: a flow may
  // legitimately place geometry (a label leader, a source spawn jitter
  // envelope) marginally outside the authored viewBox, and a strict viewBox
  // check would teleport otherwise-valid spawns.
  // Max agent radius "in play" — the teleport backstop's BB is expanded by
  // this so a legitimately-near-the-wall agent's circle is never read as an
  // escape (spec §3.1). v1.3 L3: large agents exist whenever a source emits
  // large OR a combine node fires one, so the BB must admit the large radius.
  const anyLargeInPlay = flow.nodes.some(
    n => particleSizeOf(n) === 'large' || n.transform === 'combine',
  )
  const maxAgentRadius = anyLargeInPlay
    ? radiusForSize('large')
    : radiusForSize('small')
  const ribbonBB = (() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const b of branches) {
      let branchMaxHalfW = MIN_RIBBON_WIDTH / 2
      for (const id of b.nodeIds) {
        const w = widths[id] ?? MIN_RIBBON_WIDTH
        if (w / 2 > branchMaxHalfW) branchMaxHalfW = w / 2
      }
      // Expand by the max agent radius so a large particle riding near the
      // wall stays inside the BB (the backstop checks the agent CENTRE).
      const branchHalfW = branchMaxHalfW + maxAgentRadius
      const STEPS = 32
      const L = b.centerline.totalLength
      for (let i = 0; i <= STEPS; i++) {
        const p = b.centerline.pointAtArcLength((i / STEPS) * L)
        if (p.x - branchHalfW < minX) minX = p.x - branchHalfW
        if (p.x + branchHalfW > maxX) maxX = p.x + branchHalfW
        if (p.y - branchHalfW < minY) minY = p.y - branchHalfW
        if (p.y + branchHalfW > maxY) maxY = p.y + branchHalfW
      }
    }
    return { minX, maxX, minY, maxY }
  })()

  // ── Fork routing (M2 §2.2 + §5.2 — rateShare-weighted) ────────────────────
  // A first-class `fork` declares how a node's inflow splits across its
  // successor branches. When the flow declares a fork for a node, agents are
  // routed in PROPORTION to each branch's `rateShare` — so agent traffic
  // matches the same split the §5.2 width coupling carries *visually*. Without
  // a declared fork (or for a branch with no `rateShare`) the share is even,
  // which degrades exactly to plain round-robin — so flows with no `forks`
  // (the synthetic `forkFlow`, etc.) are unaffected.
  //
  // The proportional distribution uses a deterministic lowest-ratio picker
  // (assigned-count / share) — the same scheme as pickSourceWeighted — so the
  // long-run branch counts track the declared rateShare. rateShare values do
  // not need to sum to 1: the picker normalises by ratio.
  const forkShares = {}  // nodeId → { successorId: share }
  for (const fork of flow.forks || []) {
    if (!fork || fork.from == null) continue
    const fbranches = fork.branches || []
    const n = fbranches.length || 1
    const shares = {}
    for (const b of fbranches) {
      const to = typeof b === 'string' ? b : (b && b.to)
      if (to == null) continue
      shares[to] = (b && typeof b === 'object' && typeof b.rateShare === 'number')
        ? b.rateShare
        : 1 / n  // omitted rateShare → even share (M2 §2.2)
    }
    forkShares[fork.from] = shares
  }
  // even round-robin counters (nodes with no declared fork)
  const forkCounters = Object.fromEntries(flow.nodes.map(n => [n.id, 0]))
  // weighted-routing assignment counts (nodes with a declared fork)
  const forkAssign = {}  // nodeId → { successorId: count }

  function nextSuccessor(node) {
    const succ = node.successors || []
    if (succ.length === 0) return null
    if (succ.length === 1) return succ[0]
    const shares = forkShares[node.id]
    if (shares) {
      // rateShare-weighted: pick the successor with the lowest
      // assigned-count / share ratio. A successor the fork does not list
      // falls back to an even share so it still receives traffic.
      let counts = forkAssign[node.id]
      if (!counts) { counts = {}; forkAssign[node.id] = counts }
      let best = succ[0]
      let bestScore = Infinity
      for (const id of succ) {
        const share = typeof shares[id] === 'number' ? shares[id] : 1 / succ.length
        const w = share > 0 ? share : 1e-9
        const score = (counts[id] || 0) / w
        if (score < bestScore) { bestScore = score; best = id }
      }
      counts[best] = (counts[best] || 0) + 1
      return best
    }
    // even round-robin (no declared fork)
    const i = forkCounters[node.id] % succ.length
    forkCounters[node.id] = (forkCounters[node.id] + 1) % succ.length
    return succ[i]
  }

  // ── Rejection routing (v1.2 R2 — spec §3.2) ───────────────────────────────
  // A rejection edge sends a fraction of a node's outflow BACKWARD to an
  // earlier node, where the work is re-done. `flow.rejections[]` is keyed by
  // `from` node here. The routing decision at a from-node exit is a
  // DETERMINISTIC stratified picker over {forward, edge_0, edge_1, …} weighted
  // {1−Σrate, rate_0, rate_1, …} — the same lowest-ratio scheme as
  // nextSuccessor's fork routing and pickSourceWeighted. A deterministic
  // picker (rather than a raw Math.random() draw) makes each edge's long-run
  // share of from-node exits track its `rate` to within ±1 count — that is
  // exactly the §7 frequency invariant the engine tests assert against.
  // Decision recorded as an apply-default: spec §3.2 describes the conceptual
  // "draw u∈[0,1)" semantics; the deterministic realisation matches the
  // codebase idiom (fork routing is deterministic despite §2.2's probability
  // language) and is what makes the frequency test robust.
  const rejectionsByFrom = new Map()
  for (const r of flow.rejections || []) {
    if (r == null || r.from == null || r.to == null) continue
    if (!rejectionsByFrom.has(r.from)) rejectionsByFrom.set(r.from, [])
    rejectionsByFrom.get(r.from).push(r)
  }
  // nodeId → { __forward__: count, r<i>: count } — assignment tally per outcome.
  const rejectAssign = {}

  // Roll the rejection decision for an agent leaving `nodeId`. Returns the
  // chosen rejection edge, or null to proceed forward via nextSuccessor.
  function rollRejection(nodeId) {
    const edges = rejectionsByFrom.get(nodeId)
    if (!edges || edges.length === 0) return null
    let counts = rejectAssign[nodeId]
    if (!counts) { counts = { __forward__: 0 }; rejectAssign[nodeId] = counts }
    const sumRate = edges.reduce((a, e) => a + (e.rate > 0 ? e.rate : 0), 0)
    const forwardWeight = Math.max(0, 1 - sumRate)
    // Lowest count/weight wins; ties go to the earlier candidate (forward
    // first), matching nextSuccessor's strict-`<` comparison.
    let bestKey = '__forward__'
    let bestEdge = null
    let bestScore = forwardWeight > 0
      ? (counts.__forward__ || 0) / forwardWeight
      : Infinity
    edges.forEach((e, i) => {
      const key = `r${i}`
      const w = e.rate > 0 ? e.rate : 1e-9
      const score = (counts[key] || 0) / w
      if (score < bestScore) { bestScore = score; bestKey = key; bestEdge = e }
    })
    counts[bestKey] = (counts[bestKey] || 0) + 1
    return bestEdge
  }

  // Decide an agent's onward route after it has entered `node`: roll the
  // rejection edges first (spec §3.2 step 1), else advance forward (step 2).
  // A rejected agent becomes 'revising' and targets the edge's `to` node; it
  // keeps currentNodeId === `node` so selectBranch can seat it on the
  // matching rejection branch, and holds `node`'s occupancy slot until it
  // physically crosses into `to` (apply-default: extra recirculation
  // backpressure, consistent with spec §3.4 — see the R2 milestone notes).
  function routeAfterNode(node, agent) {
    const rejEdge = rollRejection(node.id)
    if (rejEdge) {
      agent.lifecycle = 'revising'
      agent.targetNodeId = rejEdge.to
      traces.revisions.push({
        t: agent.age, agentId: agent.id, from: rejEdge.from, to: rejEdge.to,
      })
    } else {
      agent.targetNodeId = nextSuccessor(node)
      agent.lifecycle = 'in-process'
    }
  }

  // An agent is "active" — physically on a branch and subject to the
  // wall/no-escape clamps — when it is in-process OR a revising agent that is
  // travelling a rejection branch (currentNodeId set). The legacy off-canvas
  // 'revising' state (reviseTo, currentNodeId === null) is NOT active.
  const isActiveAgent = (a) =>
    a.lifecycle === 'in-process' ||
    (a.lifecycle === 'revising' && a.currentNodeId != null)

  // Primary source — the fallback used by the legacy bulk-fill seeding and
  // the escape-teleport backstop, both of which only ever apply to a single-
  // source (v1) flow or treat "some source" as good enough.
  const entryNode = sources[0].node

  // Weighted source assignment (M2 §5.1). Every pending agent — initially
  // seeded or recycled after completing a leaf — is assigned to a source in
  // proportion to that source's rate, so each source's long-run promotion
  // count tracks its rate. Picks the source with the lowest assigned/rate
  // ratio. For a single-source (v1) flow this trivially always returns it.
  const sourceAssignCount = Object.fromEntries(sources.map(s => [s.id, 0]))
  function pickSourceWeighted() {
    let best = sources[0]
    let bestScore = Infinity
    for (const s of sources) {
      const r = s.rate > 0 ? s.rate : 1e-9
      const score = sourceAssignCount[s.id] / r
      if (score < bestScore) { bestScore = score; best = s }
    }
    sourceAssignCount[best.id] += 1
    return best.node
  }

  // Spawn position helper (bead ai-engineer-bnp, surfaced by n9-multilane).
  //
  // The old code jittered spawn position in cartesian (dx, dy) space bounded
  // by `halfW - PHYS_WALL_MARGIN`. For entries whose centerline tangent is
  // horizontal (e.g. N4's problem-definition node) this is fine — cartesian
  // dy maps directly to lateral offset and the bound holds. For entries
  // whose tangent is DIAGONAL (n9-multilane's _start fork, whose successor
  // branches dive 270 units vertically over their first segment) the
  // cartesian jitter projects onto the local lateral up to a factor of √2
  // larger, pushing newly-spawned agents OUTSIDE the ribbon wall before the
  // physics has a chance to clamp them. The Tier-1 no-escape invariant
  // surfaced this at frame 10 of the n9-multilane fixture.
  //
  // Fix: compute the spawn point's branch tangent, then jitter only along
  // the local normal (perpendicular to tangent) bounded by maxLateral.
  // Cartesian jitter for horizontal entries reduces to the same envelope
  // (normal = vertical) so existing tests stay valid.
  function spawnPosition(node, targetId, radius = PARTICLE_RADIUS) {
    const halfW = (widths[node.id] ?? MIN_RIBBON_WIDTH) / 2
    // Per-agent wall margin (spec §3.1): jitter envelope shrinks for a
    // larger particle. `radius` defaults to PARTICLE_RADIUS, so small
    // particles get the former `halfW - PHYS_WALL_MARGIN` envelope exactly.
    const maxLateral = Math.max(0, halfW - (radius + WALL_MARGIN))
    if (maxLateral === 0) return { x: node.x, y: node.y }
    let branch = null
    if (targetId) {
      branch = branches.find(b =>
        b.nodeIds.includes(node.id) && b.nodeIds.includes(targetId),
      )
    }
    if (!branch) {
      branch = branches.find(b => b.nodeIds.includes(node.id))
    }
    if (!branch) return { x: node.x, y: node.y }
    const proj = projectToCenterline(branch.centerline, node.x, node.y)
    const t = branch.centerline.tangentAtArcLength(proj.s)
    const nx = -t.y, ny = t.x   // unit normal (perpendicular to tangent)
    const k = (rand() - 0.5) * 2 * maxLateral
    return { x: node.x + nx * k, y: node.y + ny * k }
  }

  // Rate-limited source spawn (bead ai-engineer-y70; M2 §5.1 multi-source).
  //
  // In rate-limited mode each source is a "1:1 source": agents enter it one at
  // a time at the source's configured rate, rather than the legacy bulk-fill
  // behaviour that primed initialAgents up to entry capacity at t=0. This
  // eliminates the visible t=0 spike at the constraint.
  //
  // Semantics:
  //   - no source declares a rate (v1 entryId, no spawnRate) → legacy bulk
  //     behaviour (preserves the synthetic linearFlow / cycleFlow / forkFlow
  //     used by older tests).
  //   - every source declares a rate → all initialAgents start in 'pending'
  //     off-canvas EXCEPT one seeded in-process per source (so each source's
  //     band is non-empty on the first frame); subsequent promotions are gated
  //     PER SOURCE by a spawn accumulator that accrues at that source's rate.
  //
  // M2: one accumulator per source (was a single scalar in v1).
  const spawnAccumulators = Object.fromEntries(sources.map(s => [s.id, 0]))

  // Hard population ceiling for the true-emitter model (bd ai-engineer-2igc).
  //
  // A rate-limited source is a genuine emitter: it creates NEW agents at its
  // `rate` and agents that finish the flow LEAVE the system (they are not
  // recycled). Population is normally self-bounding — backpressure from a
  // constraint stops creation once the pipe is physically full — but a flow
  // with no constraint (fast drain everywhere) would otherwise let the array
  // grow unbounded. MAX_AGENTS is the backstop: creation pauses here. The
  // default is generous; any real flow settles far below it via backpressure.
  const MAX_AGENTS = opts.maxAgents ?? 200

  // FIFO pending counter (bead ai-engineer-a1m).
  //
  // The original promotion loop iterated agents in array order, which
  // prioritised early-index agents. When an early agent completed and
  // returned to pending, it sat at array-index 0 and was promoted AHEAD
  // of later-index agents that had been waiting since t=0. This "array-
  // position starvation" was harmless at spawnRate=1.5/s (each wait was
  // ≤0.67s anyway) but caused 50-75s continuous freezes at lower rates.
  //
  // Fix: stamp each pending assignment with a monotonically-increasing
  // sequence number. The promotion loop sorts by this value (FIFO) rather
  // than by array position. Initial agents seeded as pending get values
  // 1, 2, ..., N in construction order; recycled agents get values N+1,
  // N+2, ... — preserving arrival order across the whole run.
  let pendingSeq = 0
  const markPending = (agent) => { agent._pendingSeq = ++pendingSeq }

  // ── Red-particle emission (bd ai-engineer-s8cm) ───────────────────────────
  //
  // A source emits a fraction (`redRatio`) of its particles RED — defective
  // work that should not pass to production. `emitDefective(node)` is called
  // EXACTLY ONCE per emitted particle, in emit order, and returns whether that
  // particle is red.
  //
  // The distribution is a deterministic ERROR-DIFFUSION accumulator (the
  // spawnAccumulators precedent): a per-node accumulator accrues `redRatio`
  // each emit and fires a red whenever it crosses 1. This gives EXACTLY the
  // authored fraction in the long run, evenly spaced (ratio 0.25 → every 4th
  // particle red), and is fully deterministic — no RNG draw — so a seeded
  // engine run stays byte-identical. Keyed lazily by node id so it also
  // covers the legacy bulk-fill entry node, which is not in `sources`.
  const redAccumulators = {}
  const emitDefective = (node) => {
    if (!node) return false
    const ratio = redRatioOf(node)
    if (ratio <= 0) return false
    const acc = (redAccumulators[node.id] || 0) + ratio
    if (acc >= 1) {
      redAccumulators[node.id] = acc - 1
      return true
    }
    redAccumulators[node.id] = acc
    return false
  }

  const occupancy = Object.fromEntries(flow.nodes.map(n => [n.id, 0]))
  const agents = []
  if (rateLimited) {
    // Rate-limited mode: seed ONE agent in-process per source (so every
    // source's band is non-empty at t=0 — for a single-source v1 flow this is
    // exactly one in-process agent, satisfying the Smoke (N4) invariant). The
    // remaining agents are pending, distributed across sources by rate.
    for (let i = 0; i < initialAgents; i++) {
      const seedSource = i < sources.length ? sources[i].node : null
      if (seedSource && occupancy[seedSource.id] < seedSource.capacity) {
        occupancy[seedSource.id]++
        const nextTarget = nextSuccessor(seedSource)
        // v1.3 L3: agent size + radius come from the emitting source.
        const size = particleSizeOf(seedSource)
        const pos = spawnPosition(seedSource, nextTarget, radiusForSize(size))
        agents.push({
          id: freshAgentId(),
          x: pos.x, y: pos.y,
          vx: 0, vy: 0,
          currentNodeId: seedSource.id,
          targetNodeId: nextTarget,
          lifecycle: 'in-process',
          age: 0,
          size,
          radius: radiusForSize(size),
          // bd ai-engineer-s8cm: red (defective) per the source's redRatio.
          defective: emitDefective(seedSource),
        })
      } else {
        // Pending — assigned to a source in proportion to that source's rate.
        const src = pickSourceWeighted()
        // v1.3 L3: a pending agent's size is fixed by its assigned source.
        const size = particleSizeOf(src)
        const a = {
          id: freshAgentId(),
          x: src.x - 100, y: src.y,
          vx: 0, vy: 0,
          currentNodeId: null,
          targetNodeId: src.id,
          lifecycle: 'pending',
          age: 0,
          size,
          radius: radiusForSize(size),
          // bd ai-engineer-s8cm: red (defective) per the source's redRatio —
          // fixed at seed time, like size, by the assigned source.
          defective: emitDefective(src),
        }
        markPending(a)
        agents.push(a)
      }
    }
  } else {
    // DEPRECATED iter-1 bulk-fill mode (kept for test-fixture compat).
    // Superseded by the rate-limited source (bd ai-engineer-y70, commit
    // 55333df). All production flows (n4-toc-baseline, n4-flow-a, n4-flow-b,
    // n9-multilane) set `spawnRate`, so this branch is exercised only by
    // synthetic linearFlow / cycleFlow / forkFlow test fixtures in
    // useFlowSimulation.test.js. New flow definitions MUST set spawnRate.
    for (let i = 0; i < initialAgents; i++) {
      const startNode = (occupancy[entryNode.id] < entryNode.capacity)
        ? entryNode
        : null  // overflow: agent stays in 'pending' lifecycle off-canvas
      // v1.3 L3: legacy bulk-fill is single-source — size is the entry's.
      const legacySize = particleSizeOf(entryNode)
      // bd ai-engineer-s8cm: one redRatio roll per iteration (one agent
      // created either way), so emit order stays 1:1 with particles.
      const legacyDefective = emitDefective(entryNode)
      if (startNode) {
        occupancy[startNode.id]++
        const nextTarget = nextSuccessor(startNode)
        const pos = spawnPosition(startNode, nextTarget, radiusForSize(legacySize))
        agents.push({
          id: freshAgentId(),
          x: pos.x, y: pos.y,
          vx: 0, vy: 0,
          currentNodeId: startNode.id,
          targetNodeId: nextTarget,
          lifecycle: 'in-process',
          age: 0,
          size: legacySize,
          radius: radiusForSize(legacySize),
          defective: legacyDefective,
        })
      } else {
        agents.push({
          id: freshAgentId(),
          x: entryNode.x - 100, y: entryNode.y,  // off-canvas waiting
          vx: 0, vy: 0,
          currentNodeId: null,
          targetNodeId: entryNode.id,
          lifecycle: 'pending',
          age: 0,
          size: legacySize,
          radius: radiusForSize(legacySize),
          defective: legacyDefective,
        })
      }
    }
  }

  // v1.3 L3 (spec §3.5): `splits` / `combines` channels record every
  // decomposition / composition event for the §7 conservation tests.
  const traces = {
    entries: [], exits: [], escapes: [], revisions: [], splits: [], combines: [],
  }

  // Deferred-spawn buffer (v1.3 L3 §6). Split children and combine-fired
  // larges are created mid-step (inside the per-agent loop / the combine
  // pass); buffering them and flushing AFTER the loop keeps the per-agent
  // iteration deterministic — a new agent is never stepped in its birth
  // frame. occupancy is updated eagerly at create time so backpressure is
  // unaffected by the deferral.
  const pendingSpawns = []
  const flushPendingSpawns = () => {
    while (pendingSpawns.length) agents.push(pendingSpawns.shift())
  }
  // Monotonic arrival stamp for held (combining) agents — gives the combine
  // pass a stable FIFO order ("first N to arrive fire", spec §3.4).
  let heldSeq = 0

  // ════════════════════════════════════════════════════════════════════════
  // step() decomposition (bd ai-engineer-wq6h).
  //
  // step(dt) is a thin orchestrator that runs a fixed sequence of named
  // passes. Each pass below is a behaviour-preserving extraction of a slab of
  // the original monolithic step(); they are nested inside createFlowSimulation
  // so they close over the structural state (flow, branches, widths,
  // occupancy, agents, traces, sources, …) and the tuned constants, exactly
  // as the inline code did. No simulation logic, ordering, or numeric result
  // changed in the extraction — only the call structure.
  //
  // Per-step pass order (see step() at the bottom):
  //   accrueSpawnTokens → computeAgentFrame → stepAgent (per agent) →
  //   flushPendingSpawns → processCombines → flushPendingSpawns →
  //   resolveRigidContacts → enforceRibbonPolygon → teleportEscapees →
  //   promoteWaitingAgents → createSourceAgents → wakeQueueVacancies →
  //   reapDoneAgents
  //
  // Per-agent (stepAgent) pass order:
  //   computeForwardBlocker → updateFreezeState → integrateAgentPhysics →
  //   clampAgentToRibbon → processAgentTransitions
  // ════════════════════════════════════════════════════════════════════════

  // ── Rate-limited source spawn-token accrual ───────────────────────────────
  // Accrue spawn tokens PER SOURCE at that source's rate. The promotion pass
  // and the true-emitter creation pass each decrement one token per agent
  // placed into a source (bd y70; M2 §5.1). The accumulator is NOT clamped: a
  // source backed up behind a constraint banks tokens, but the per-step
  // occupancy gate on both promotion and creation serialises consumption to
  // the source node's drain rate — so banked credit can never produce a burst
  // faster than the pipe physically accepts (bd ai-engineer-2igc).
  function accrueSpawnTokens(dtc) {
    if (rateLimited) {
      for (const s of sources) spawnAccumulators[s.id] += dtc * s.rate
    }
  }

  // ── Lookahead pre-pass (bead ai-engineer-2ip + ai-engineer-ebv) ────
  // Compute each in-process agent's branch + arc-length ONCE per step.
  // The forward-blocker lookahead in stepAgent then reads from this cache
  // instead of doing O(N²) projections per frame. Same cache is also reused
  // by stepAgent's projection call, saving roughly 50% of total projection
  // work per step.
  //
  // ebv addition: also cache the LATERAL OFFSET (signed distance along
  // the local normal). The lookahead uses this to skip "ahead" agents that
  // are in a different lateral corridor — fixing the iter-3 regression where
  // the 1D arc-length lookahead serialized the queue along the centerline.
  // With corridor-aware lookahead, two agents at the same arc-length but
  // lateral-displaced by 2×PR no longer block each other, so they can
  // hex-pack across the band.
  function computeAgentFrame() {
    const agentBranch = new Map()
    const agentS      = new Map()
    const agentLat    = new Map()
    for (const a of agents) {
      if (a.lifecycle !== 'in-process') continue
      const b = selectBranch(a, branches)
      if (!b) continue
      const p = projectToCenterline(b.centerline, a.x, a.y)
      const cp = b.centerline.pointAtArcLength(p.s)
      const tan = b.centerline.tangentAtArcLength(p.s)
      const norm = { x: -tan.y, y: tan.x }
      const lat = (a.x - cp.x) * norm.x + (a.y - cp.y) * norm.y
      agentBranch.set(a, b)
      agentS.set(a, p.s)
      agentLat.set(a, lat)
    }
    return { agentBranch, agentS, agentLat }
  }

  // ── Forward-blocker scan / anticipatory deceleration (bead ai-engineer-2ip) ─
  // Compute distance along the centerline to the nearest forward "blocker" —
  // either (a) the closest agent ahead on the same branch or (b) the
  // forward-boundary advisory point if our target node is at capacity — and
  // convert it via a smoothstep ramp into a multiplicative lookFactor: full
  // speed when far, zero at the blocker. Smoothstep ensures C¹ continuity
  // (no acceleration jolts on either side of the LOOKAHEAD threshold).
  // Returns { frontDist, lookFactor }.
  function computeForwardBlocker(agent, branch, cl, bestS, frame) {
    const { agentBranch, agentS, agentLat } = frame
    let frontDist = Infinity
    // (a) Forward-boundary blocker — target node is full OR is a cap=1
    // "narrow bridge" that funnels all inbound lanes through a single
    // slot.
    //
    // ebv expansion: previously this only fired when target was AT
    // capacity. With corridor-aware lookahead (the iter-3-ebv hex-pack
    // fix), lateral agents no longer see the in-target occupant as a
    // peer-blocker — so a 1-frame "empty" window between exits and
    // entries let agents fly past the boundary at full speed. The
    // "Anticipatory: agents do not overshoot" test pinned this at
    // overshoot=15.9 (limit 6).
    //
    // Solution: cap=1 stages (constraints) ALWAYS present a wall at
    // their boundary. The capacity gate (ENTRY_DIST=30) still lets the
    // closest agent through when the slot is empty — they decelerate
    // approaching the wall, enter, then accelerate downstream. This is
    // the "boats queueing at the narrow bridge" optic.
    if (agent.targetNodeId) {
      const targetNode = flow.nodes.find(n => n.id === agent.targetNodeId)
      // bd ai-engineer-e0cj: an agent that has already RESERVED its
      // target's slot (`_slotClaim`, set by the two-stage junction cross
      // below) is no longer queued — it owns the slot and must be free to
      // flow the last stretch to the junction anchor. Lifting the hold for
      // a claimant is what lets a merge-bound agent physically traverse
      // the constraint plateau instead of being teleported across it.
      const shouldGate = targetNode &&
        agent._slotClaim !== targetNode.id && (
          occupancy[targetNode.id] >= targetNode.capacity ||
          targetNode.capacity === 1
        )
      if (shouldGate) {
        const tIdx = branch.nodeIds.indexOf(agent.targetNodeId)
        if (tIdx >= 0) {
          // bd ai-engineer-blqz: hold the queue at the CURVE→PLATEAU
          // boundary (segHoldBounds[tIdx] = plateau.sStart), the entrance
          // to the narrow orange plateau — not at the segment's upstream
          // edge (c42z) and not at the node anchor. Front-of-queue stops
          // here; the queue body stacks back THROUGH the narrowing pinch
          // curve, filling it; only overflow spills into the upstream
          // flat band. The constraint's plateau stays sparse — only the
          // ~capacity agents actively being processed occupy it.
          const blockerS = branch.segHoldBounds
            ? branch.segHoldBounds[tIdx]
            : Math.max(0, branch.anchorS[tIdx] - agentRadius(agent))
          const d = blockerS - bestS
          if (d < frontDist) frontDist = d
        }
      }
    }
    // (a') Leaf-end blocker — agent has no next target, so the branch
    // endpoint itself acts as a stop point. Without this, leaf-bound
    // agents flow at baseSpeed all the way to the centerline endpoint
    // and the longitudinal endpoint clamp (below) snaps them to v=0
    // in a single frame, producing a 199.9 px/s jolt visible to the
    // bounded-acceleration test.
    if (agent.targetNodeId === null) {
      // v1.3 L3: per-agent stop-offset — a large particle (r=9) stopped only
      // PARTICLE_RADIUS short of the terminus would overhang it by 6 units.
      const endS = cl.totalLength - agentRadius(agent)
      const d = endS - bestS
      if (d < frontDist) frontDist = d
    }
    // (b) Nearest agent ahead on same branch (uses pre-pass cache).
    //
    // Corridor-aware: only treat peers in our lateral corridor as
    // tangential blockers — agents whose lateral offset differs from
    // ours by more than CORRIDOR_HALF aren't physically in our path,
    // so they don't gate our tangential speed. This is the iter-3-ebv
    // fix for the "queue collapsed to single-file along centerline"
    // regression: with the prior 1D-arc-length lookahead, ANY agent
    // ahead anywhere on the band blocked us; now only agents in our
    // lane do. Combined with anisotropic repulsion below, agents
    // hex-pack laterally across the visible band.
    //
    // EXCEPTION (universal wall): an agent that is currently AT our
    // target stage (other.currentNodeId === agent.targetNodeId) acts
    // as a wall for ALL inbound lanes, not just the corridor mates.
    // Without this, lateral agents would fly past the in-target
    // occupant at full speed because the corridor check skipped them.
    // The "Anticipatory: agents do not overshoot the constraint
    // boundary" test pinned this: max overshoot jumped from 3 → 12.7
    // when corridor-aware lookahead was added without the wall
    // exception.
    const myLat = agentLat.get(agent) ?? 0
    // Corridor half-width — lateral band within which a peer counts as a
    // tangential blocker. Per-agent (spec §3.1): scales with this agent's
    // radius; for a small agent this is PARTICLE_RADIUS = ±3 viewBox units.
    const CORRIDOR_HALF = agentRadius(agent)
    for (const other of agents) {
      if (other === agent) continue
      if (agentBranch.get(other) !== branch) continue
      const oS = agentS.get(other)
      if (oS === undefined) continue
      // Skip agents queued at the same node this agent is already inside.
      // Scenario: the implementation agent (currentNodeId='implementation')
      // enters at x≈815. Queue agents targeting 'implementation' are
      // pressed at the cap=1 wall at x≈820-827, physically AHEAD of the
      // implementation agent in arc-length. Without this guard, those
      // queue agents appear as forward-blockers (d=2-12 units) and
      // drive the implementation agent's lookFactor to near-zero, stalling
      // it for up to N × constraint-traversal-time (≈20–40s with 24
      // agents). The fix: agents still trying to enter a node the current
      // agent has already entered are NOT forward-blockers — they're
      // at the wrong side of the gate. (bead ai-engineer-a1m).
      if (agent.currentNodeId && other.targetNodeId === agent.currentNodeId) continue
      const isOccupantAhead = other.currentNodeId === agent.targetNodeId
      if (!isOccupantAhead) {
        const oLat = agentLat.get(other) ?? 0
        if (Math.abs(oLat - myLat) > CORRIDOR_HALF) continue  // different lane peer
      }
      const d = oS - bestS - desiredSep(agent, other)
      if (d >= 0 && d < frontDist) frontDist = d
    }
    let lookFactor = 1.0
    if (frontDist < LOOKAHEAD_DIST) {
      // Smoothstep: u² (3 - 2u) on [0, 1]. Zero at the blocker,
      // unity at LOOKAHEAD_DIST. C¹-continuous on both sides — no
      // acceleration discontinuities when crossing either boundary.
      const u = Math.max(0, frontDist / LOOKAHEAD_DIST)
      lookFactor = u * u * (3 - 2 * u)
    }
    return { frontDist, lookFactor }
  }

  // ── Freeze-when-stable + queue-vacancy wake (bd ai-engineer-ebv → 5kk) ─
  // Jason 2026-05-17 (ebv): queued agents in steady-state should NOT
  // bounce around. P-control overshoots in steady state, producing
  // visible 1–2 px/s oscillation. Hard-freeze fixes this: zero
  // velocity and skip the entire force-application + integration
  // block when an agent is genuinely queued.
  //
  // Jason 2026-05-17 (5kk): "particles seem to get stuck at some
  // point, and not let anything through." Liveness probe confirmed
  // throughput is preserved (exits in every 10s window) but
  // individual freeze runs lasted up to 31.9s, because the wake wave
  // propagates one chain link per constraint cycle (~1.7s) — a
  // back-of-queue position-N agent stays frozen N × 1.7s.
  //
  // Two-part 5kk fix:
  //   (1) Lower FREEZE_WAKE_DELTA from 8 → 3 — wake on much smaller
  //       blocker advances, propagating the wake wave faster through
  //       the chain.
  //   (2) Queue-vacancy wake (downstream, in wakeQueueVacancies()):
  //       when any constraint slot frees, force-wake all frozen agents
  //       on the same branch targeting that node.
  //
  // Frame-vs-time fix (bd ai-engineer-0ld, 2026-05-17): the idle
  // accumulator is a wall-clock-time threshold (FREEZE_IDLE_TIME
  // seconds, accumulating dtc per step), so the freeze trigger fires
  // after the same simulated-time duration of idle at any rAF rate.
  //
  // Returns physicsFrozen — whether the agent is frozen this step (and,
  // as a side effect, zeroes its velocity when it is).
  function updateFreezeState(agent, frontDist, dtc) {
    const FREEZE_SPEED_EPS = 2.0      // |v| below this is "at rest"
    const FREEZE_DIST_NEAR = 25       // frontDist below this means we're queued
    const FREEZE_WAKE_DELTA = 3       // blocker-advance that wakes us (was 8 in ebv)
    const FREEZE_IDLE_TIME = 0.2      // sim seconds of idle before freeze (was 12 frames @ 60fps)
    // bd ai-engineer-a3w / dzjv (Jason 2026-05-19): chain-freeze safety net.
    // After 4s of continuous frozen state the agent force-wakes regardless
    // of blocker advance. The wake-cascade can die mid-chain when each
    // link's wake-and-re-freeze cycle never accumulates the
    // FREEZE_WAKE_DELTA=3 units of blocker advance fast enough; this
    // bounds individual freeze runs at ~4s instead of letting them
    // accumulate to 30s+ (the user-visible "particles get stuck" pattern
    // Jason flagged on N6/N8). The agent will re-evaluate freeze
    // conditions next idle period; if it's still truly queued behind a
    // stationary blocker it re-freezes after FREEZE_IDLE_TIME=0.2s, so
    // the cost of a spurious wake is ≤0.2s of integration work.
    const FREEZE_MAX_DURATION = 4.0
    const currentV = Math.hypot(agent.vx, agent.vy)
    if (agent._frozen) {
      // Track total frozen duration for the safety-net wake.
      agent._frozenDuration = (agent._frozenDuration ?? 0) + dtc
      // Wake when the blocker has advanced by FREEZE_WAKE_DELTA
      // compared to where it was when WE froze.
      const frozenAtDist = agent._frozenAtDist ?? 0
      if (frontDist > frozenAtDist + FREEZE_WAKE_DELTA) {
        agent._frozen = false
        agent._idleTime = 0
        agent._frozenAtDist = undefined
        agent._frozenDuration = 0
      } else if (agent._frozenDuration > FREEZE_MAX_DURATION) {
        // Safety-net wake: chain-freeze cascade died before propagating.
        agent._frozen = false
        agent._idleTime = 0
        agent._frozenAtDist = undefined
        agent._frozenDuration = 0
      }
    } else {
      // Idle accumulator → freeze trigger. Accumulates simulated
      // SECONDS, not frames, so the trigger is frame-rate independent.
      const idleConditions =
        currentV < FREEZE_SPEED_EPS &&
        frontDist < FREEZE_DIST_NEAR
      if (idleConditions) {
        agent._idleTime = (agent._idleTime ?? 0) + dtc
        if (agent._idleTime > FREEZE_IDLE_TIME) {
          agent._frozen = true
          agent._frozenAtDist = frontDist  // capture freeze-time blocker dist
          agent._frozenDuration = 0        // reset duration tally
        }
      } else {
        agent._idleTime = 0
      }
    }
    // Use a local flag rather than `continue` so the capacity gate +
    // completion check below still run (leaf-end agents must be able
    // to complete-and-recycle even when their "blocker" is the leaf
    // endpoint and they'd otherwise be frozen).
    const physicsFrozen = !!agent._frozen
    if (physicsFrozen) {
      agent.vx = 0
      agent.vy = 0
    }
    return physicsFrozen
  }

  // ── Agent physics integration (beads ai-engineer-2ip, ai-engineer-ebv) ────
  // Symmetric tangential P-control, anisotropic peer repulsion, river-current
  // wall behaviour, soft speed cap, and Euler integration. Called only for
  // NON-frozen agents — frozen agents skip this entire block (their position
  // stays as-is, velocity stays 0). The wall reclamps + capacity / completion
  // checks still run (they're geometric backstops and lifecycle gates, not
  // force application).
  function integrateAgentPhysics(agent, cl, bestS, tangent, targetSpeed, lookFactor, dtc) {
    const tangentialSpeed = agent.vx * tangent.x + agent.vy * tangent.y
    const speedError = targetSpeed - tangentialSpeed
    // P-control with K_SPEED → exponential convergence with τ=1/K_SPEED.
    let accel = speedError * K_SPEED
    // Cap per-frame impulse: ACCEL_CAP px/s². At 1/60s, max
    // velocity change per frame = ACCEL_CAP/60 ≈ 13 px/s.
    if (accel >  ACCEL_CAP) accel =  ACCEL_CAP
    if (accel < -ACCEL_CAP) accel = -ACCEL_CAP
    agent.vx += tangent.x * accel * dtc
    agent.vy += tangent.y * accel * dtc

    // (Iter-2's "velocity ceiling after forward force" clip is removed
    // in iter-3 — the P-control above brakes to targetSpeed gradually,
    // and the trailing "cap speed at 1.2× target" clip at the end of
    // the force-accumulation block (after repulsion + wall-damping)
    // still guards against runaway accumulation. Running both clips
    // double-counted the deceleration and produced a 3×-larger
    // per-frame |dv| than ACCEL_CAP allows.)

    // ── Anisotropic peer repulsion (bead ai-engineer-ebv) ──────────────
    // Iter-3 had isotropic radial repulsion (push directly away from each
    // neighbour). Combined with the 1D arc-length lookahead, this
    // serialized the queue — when two agents stacked tangentially, the
    // back agent was pushed BACK and the front agent FORWARD, and the
    // lookahead then re-compressed the tangential gap. Net: agents never
    // explored the lateral dimension of the band.
    //
    // ebv decomposes the repulsion into tangential and normal components
    // (using the local flow frame at THIS agent's arc-length) and
    // SCALES THEM ASYMMETRICALLY:
    //   - Tangential component scaled DOWN to TAN_SCALE (lookahead
    //     handles tangential separation; piling on a second mechanism
    //     just produces oscillation).
    //   - Normal (lateral) component scaled UP to NORM_SCALE (drives
    //     agents into the lateral hex-pack pattern).
    // With these scales, two tangentially-stacked agents primarily slide
    // sideways rather than pushing each other along arc. They settle
    // into a 2D hex pattern across the visible band.
    //
    // r0 bumped from 14 → 18 so the effective lateral range covers
    // ~3 PARTICLE_RADIUS — far enough to "see" neighbours in adjacent
    // lanes and steer into available slots.
    const r0 = 18
    const kRepulse = 6000
    const TAN_SCALE  = 0.30
    const NORM_SCALE = 1.50
    const normal_ = { x: -tangent.y, y: tangent.x }
    let fpx = 0, fpy = 0
    for (const other of agents) {
      if (other === agent) continue
      // Skip agents queued to enter a node this agent is already inside.
      // Queue agents at x≈819-828 (targeting 'implementation') are within
      // r0=18 units of the impl agent at x≈815. Without this guard they
      // exert a backward repulsion of ~800 px/s² each (×4-5 agents) that
      // completely overwhelms the forward P-control (max 560 px/s²) and
      // causes the impl agent to oscillate indefinitely at x≈815.
      // Same gate-crossing rationale as the peer-blocker and rigid-contact
      // fixes (bead ai-engineer-a1m).
      if (agent.currentNodeId && other.targetNodeId === agent.currentNodeId) continue
      const dx = agent.x - other.x, dy = agent.y - other.y
      const r2 = dx * dx + dy * dy
      if (r2 > r0 * r0 || r2 < 1e-3) continue
      const r = Math.sqrt(r2)
      const mag = kRepulse * (1 / r2 - 1 / (r0 * r0))
      fpx += (dx / r) * mag
      fpy += (dy / r) * mag
    }
    // Decompose into local frame and rescale.
    const fTan  = fpx * tangent.x  + fpy * tangent.y
    const fNorm = fpx * normal_.x  + fpy * normal_.y
    let tunedTan  = fTan  * TAN_SCALE
    let tunedNorm = fNorm * NORM_SCALE
    // Clamp per-frame repulsion delta to ACCEL_CAP * dtc per component
    // (ebv fix): agents that transiently overlap (r < PARTICLE_RADIUS)
    // produce repulsion forces of thousands of px/s², which after
    // NORM_SCALE amplification produced single-frame |dv| spikes of
    // 100+ px/s — far above the bounded-acceleration invariant. The
    // clamp keeps individual frame impulses inside the brake envelope;
    // sustained overlap still gets resolved over multiple frames.
    const REPULSE_PER_FRAME = ACCEL_CAP * dtc
    if (Math.abs(tunedTan)  > REPULSE_PER_FRAME) tunedTan  = Math.sign(tunedTan)  * REPULSE_PER_FRAME / dtc
    if (Math.abs(tunedNorm) > REPULSE_PER_FRAME) tunedNorm = Math.sign(tunedNorm) * REPULSE_PER_FRAME / dtc
    agent.vx += (tunedTan * tangent.x + tunedNorm * normal_.x) * dtc
    agent.vy += (tunedTan * tangent.y + tunedNorm * normal_.y) * dtc

    // River-current wall behaviour (Jason 2026-05-16 feedback: agents
    // should look like particles in a flowing river, not bouncing balls).
    //
    // The previous wall-force was a strong impulsive Hookean push that
    // produced visible bouncing off the ribbon walls. We replace it with
    // two cooperating effects:
    //
    //   (a) A gentle continuous restoring force toward the centerline —
    //       proportional to lateral offset. This is the "river current
    //       pulling toward the middle" effect: a soft spring, never
    //       impulsive, that gradually steers drifting agents back to the
    //       stream. kRestore is tuned so far-from-center agents return
    //       over ~0.5–1.0s rather than snapping back in a frame.
    //
    //   (b) Aggressive viscous damping of the normal-to-wall velocity
    //       component when the agent is near a wall AND its velocity is
    //       pushing INTO the wall. This kills the bounce: instead of
    //       reflecting elastically, the agent simply loses its outward
    //       velocity component. Tangential velocity is preserved — agents
    //       keep flowing forward along the ribbon. Damping factor scales
    //       from 1.0 (no damping) at the soft-range edge to 0.2 (heavy)
    //       right at the wall.
    const myHalfW = (widths[agent.currentNodeId] ?? MIN_RIBBON_WIDTH) / 2
    const centerlinePoint = cl.pointAtArcLength(bestS)
    const normal = { x: -tangent.y, y: tangent.x }
    // Signed distance from centerline along normal: positive = on one side.
    const offsetX = agent.x - centerlinePoint.x
    const offsetY = agent.y - centerlinePoint.y
    const lateral = offsetX * normal.x + offsetY * normal.y
    const distFromWall = myHalfW - Math.abs(lateral)

    // (a) Continuous restoring force toward centerline.
    const kRestore = 5  // px/s^2 per unit of lateral offset
    agent.vx -= normal.x * lateral * kRestore * dtc
    agent.vy -= normal.y * lateral * kRestore * dtc

    // (b) Near-wall viscous damping of inward-pushing normal velocity.
    // ebv: dampDelta is bounded to ACCEL_CAP * dtc so the bounded-
    // acceleration invariant holds even when a fast lateral agent
    // arrives at the wall. Sustained wall-pressed agents still get
    // damped to zero over a few frames.
    const wallSoftRange = 6
    if (distFromWall < wallSoftRange) {
      const vNormal = agent.vx * normal.x + agent.vy * normal.y
      if (lateral !== 0 && Math.sign(vNormal) === Math.sign(lateral)) {
        const proximity = Math.max(0, 1 - distFromWall / wallSoftRange)  // 0..1
        const damp = 1 - 0.8 * proximity  // 1.0 at edge, 0.2 at wall
        let dampDelta = vNormal * (1 - damp)
        const dampCap = ACCEL_CAP * dtc
        if (Math.abs(dampDelta) > dampCap) dampDelta = Math.sign(dampDelta) * dampCap
        agent.vx -= normal.x * dampDelta
        agent.vy -= normal.y * dampDelta
      }
    }

    // Soft cap at 1.2× the LOCAL target (bd ai-engineer-2ip — softened
    // from iter-2 hard clip). Brakes at ACCEL_CAP per second so an
    // agent carrying surplus velocity from repulsion / wall-damping
    // contributions sheds it over multiple frames, not in one snap.
    //
    // ebv fix: the 0.2*baseSpeed floor (≈40 px/s) prevented agents from
    // braking to a complete stop at walls — they drifted into the
    // constraint boundary at 40 px/s and overshot by up to 18 units.
    // The floor is now SCALED by lookFactor: at the wall (lookFactor=0)
    // the floor goes to 0 so the agent can truly stop; in free flow
    // (lookFactor=1) the floor preserves its original purpose
    // (don't pin agents to near-zero when no wall is present).
    const sp = Math.hypot(agent.vx, agent.vy)
    const speedFloor = flow.baseSpeed * 0.2 * lookFactor
    const vMax = Math.max(targetSpeed * 1.2, speedFloor)
    if (sp > vMax) {
      const maxDecel = ACCEL_CAP * dtc
      const vAfter   = Math.max(vMax, sp - maxDecel)
      const scale    = vAfter / sp
      agent.vx *= scale
      agent.vy *= scale
    }

    // Integrate.
    agent.x += agent.vx * dtc
    agent.y += agent.vy * dtc
  }

  // ── Ribbon wall backstop + longitudinal endpoint clamp ────────────────────
  // Hard geometric backstops applied after force integration: enforce that no
  // agent drifts more than the local visible halfWidth from its branch
  // centerline (lateral + Euclidean phases), then pin a leaf-bound agent to
  // the branch endpoint so it cannot run past the visible terminus.
  function clampAgentToRibbon(agent, branch, cl, dtc) {
    // Hard backstop: enforce that no agent drifts more than halfWidth from
    // the branch centerline. Two phases:
    //   1. Lateral clamp: project the lateral offset back inside the ribbon wall.
    //   2. Euclidean clamp: after branch transitions the nearest point may be
    //      the branch start/end, and the agent may be BEHIND it longitudinally
    //      (e.g. the ENTRY_DIST gate fires before the agent physically reaches
    //      the branch start). In that case the lateral-only clamp is insufficient;
    //      snap the agent to the nearest centerline point outright.
    // Project onto centerline via bisection (sub-unit accuracy — Phase 1
    // lateral and Phase 2 Euclidean checks both depend on this being tight).
    //
    // VISIBLE-WALL fix (bead ai-engineer-ebv): clamp to the LOCAL visible
    // band width (branch.widthFn(s) / 2) — not the per-node static width.
    // For pinch-mode flows the visible band narrows smoothly through the
    // constraint approach, so an agent sitting inside the wide per-node
    // envelope could be VISUALLY outside the narrower pinch curve. The
    // probe at /tmp/escape-probe2.mjs showed circle-edge escapes of up to
    // 8.7 viewBox units on n4-toc-baseline before this fix.
    const projClamp = projectToCenterline(cl, agent.x, agent.y)
    const clampS = projClamp.s
    let clampDist2 = projClamp.distance2
    const visHalfWClamp = branch.widthFn(clampS) / 2
    const nodeHalfWClamp = (widths[agent.currentNodeId] ?? MIN_RIBBON_WIDTH) / 2
    // Use the TIGHTER of (visible local halfW, per-node static halfW). At
    // branch endpoints (behind-start case) widthFn may return the
    // adjacent-node width while the per-node width is smaller — the
    // tighter bound keeps the agent inside both envelopes.
    const myHalfWClamp = Math.min(visHalfWClamp, nodeHalfWClamp)
    // Phase 1 lateral limit: agent centre must be at least physWallMargin
    // from the wall so the circle (radius=agentRadius) stays fully inside.
    // This is the primary fix for the visual edge-clipping bug (bd ai-engineer-on9).
    const maxLateral = Math.max(0, myHalfWClamp - physWallMargin(agent))
    // Phase 2 Euclidean limit: also use the visible-band tightening.
    // Tolerance is physWallMargin so circle stays WALL_MARGIN inside the
    // visible wall — matching what Phase 1 enforces.
    const maxEuclid = Math.max(0, myHalfWClamp - physWallMargin(agent))
    // Phase 1 — lateral backstop (handles mid-ribbon drift, visual clipping fix).
    const cpClamp = cl.pointAtArcLength(clampS)
    const tangentClamp = cl.tangentAtArcLength(clampS)
    const normalClamp = { x: -tangentClamp.y, y: tangentClamp.x }
    const lateralClamp = (agent.x - cpClamp.x) * normalClamp.x + (agent.y - cpClamp.y) * normalClamp.y
    if (Math.abs(lateralClamp) > maxLateral) {
      const correction = (Math.abs(lateralClamp) - maxLateral) * Math.sign(lateralClamp)
      agent.x -= normalClamp.x * correction
      agent.y -= normalClamp.y * correction
      // Kill any lateral velocity component so physics can't immediately
      // push the agent back through the wall next frame.
      const vLateral = agent.vx * normalClamp.x + agent.vy * normalClamp.y
      if (Math.sign(vLateral) === Math.sign(lateralClamp)) {
        agent.vx -= normalClamp.x * vLateral
        agent.vy -= normalClamp.y * vLateral
      }
      // Recompute clampDist2 after lateral correction for phase 2 check.
      clampDist2 = (agent.x - cpClamp.x) ** 2 + (agent.y - cpClamp.y) ** 2
    }
    // Phase 2 — Euclidean backstop: catches agents that are "behind" the branch
    // start (a longitudinal overshoot that the lateral clamp cannot fix).
    // Uses maxEuclid (≈ halfW) not maxLateral, so normal forward motion between
    // samples never triggers this safety net.
    // 0ld fix: add PROJECTION_NOISE_TOL so sub-unit bisection-projection noise
    // doesn't snap-back agents on every frame at the constraint plateau (where
    // maxEuclid collapses to 0).
    const maxEuclidTol = maxEuclid + PROJECTION_NOISE_TOL
    if (clampDist2 > maxEuclidTol * maxEuclidTol) {
      const clampDist = Math.sqrt(clampDist2)
      const scale = maxEuclid / clampDist
      agent.x = cpClamp.x + (agent.x - cpClamp.x) * scale
      agent.y = cpClamp.y + (agent.y - cpClamp.y) * scale
      // Kill any velocity component pointing away from the nearest centerline point.
      // Guard maxEuclid against zero at the constraint plateau (halfW=PHYS_WALL_MARGIN);
      // without the guard, awayX/Y become NaN and propagate into the velocity.
      const awayDenom = Math.max(1e-6, maxEuclid)
      const awayX = (agent.x - cpClamp.x) / awayDenom
      const awayY = (agent.y - cpClamp.y) / awayDenom
      const vAway = agent.vx * awayX + agent.vy * awayY
      if (vAway > 0) {
        agent.vx -= awayX * vAway
        agent.vy -= awayY * vAway
      }
    }

    // Longitudinal endpoint clamp: when an agent is waiting in a leaf node
    // (targetNodeId === null) it has no next destination and must not run
    // past the end of the branch centerline. Pin POSITION to the
    // endpoint; brake velocity at ACCEL_CAP rather than zeroing it
    // instantly (bd ai-engineer-2ip — the iter-2 hard-zero was the
    // second-largest single-frame jolt at 199.9 px/s, visible as a
    // visible "thump" when an agent reached the leaf at full speed).
    // With the leaf-end blocker added to the lookahead above, agents
    // approach the endpoint at near-zero speed and this clamp rarely
    // has work to do — but it remains the structural guarantee that
    // the agent doesn't drift past the visible terminus.
    if (agent.targetNodeId === null && clampS >= cl.totalLength - 0.1) {
      const endPt = cl.pointAtArcLength(cl.totalLength)
      agent.x = endPt.x
      agent.y = endPt.y
      const vMag = Math.hypot(agent.vx, agent.vy)
      if (vMag > 1e-6) {
        const maxDecel = ACCEL_CAP * dtc
        const vAfter   = Math.max(0, vMag - maxDecel)
        const scale    = vAfter / vMag
        agent.vx *= scale
        agent.vy *= scale
      }
    }
  }

  // ── Queue-geometry transitions: forward-boundary advisory, capacity gate,
  //    two-stage junction cross, revise gate, and leaf completion ────────────
  // The capacity / queue-geometry layering (segHoldBounds — v9mj/c42z/blqz/
  // e0cj) lives here as one coherent pass: it decides where an agent holds,
  // when it crosses a node boundary, when it is sent back via the revise
  // gate, and when it completes a leaf. Kept intact — only named.
  function processAgentTransitions(agent, branch, bestS, tangent, dtc, nodesWithExitsThisStep) {
    // Forward-boundary advisory (bead ai-engineer-2ip; supersedes the
    // hard-clamp behaviour from bead ai-engineer-9nw).
    //
    // The anticipatory deceleration block above already drives the
    // agent's targetSpeed toward zero as it approaches a full target —
    // so in normal operation the agent stops just upstream of the
    // boundary on its own. This block is the LAST-RESORT advisory:
    // if an agent has overshot the boundary (e.g. fast spawn into an
    // already-blocked queue, or integration noise), we kill its
    // forward-along-tangent velocity component so it doesn't ghost
    // through the constraint. NO position snap — preserving the
    // "natural queue formation" optic Jason wants. The cap=1
    // structural invariant still holds: the capacity gate further
    // down only opens if the target has room, regardless of where
    // the agent's geometric centre is.
    if (agent.targetNodeId) {
      const targetNode = flow.nodes.find(n => n.id === agent.targetNodeId)
      // bd ai-engineer-e0cj: a slot-claimant (see the two-stage junction
      // cross below) owns the target's slot and must NOT be braked at the
      // plateau boundary — it has to physically reach the junction anchor.
      if (occupancy[targetNode.id] >= targetNode.capacity
          && agent._slotClaim !== targetNode.id) {
        const tIdx = branch.nodeIds.indexOf(agent.targetNodeId)
        if (tIdx >= 0) {
          // bd ai-engineer-blqz: arrest an overshooting agent at the
          // CURVE→PLATEAU boundary (segHoldBounds[tIdx] = plateau.sStart),
          // the same boundary the queue holds at — not the segment edge
          // (c42z) and not the node anchor.
          const limit = branch.segHoldBounds
            ? branch.segHoldBounds[tIdx]
            : Math.max(0, branch.anchorS[tIdx] - agentRadius(agent))
          if (bestS > limit) {
            // Past advisory boundary. Brake forward-along-tangent
            // velocity component at ACCEL_CAP per second (ebv fix —
            // was instant zero, which produced 100+ px/s single-frame
            // jolts visible to the bounded-acceleration test).
            const fv = agent.vx * tangent.x + agent.vy * tangent.y
            if (fv > 0) {
              const brake = Math.min(fv, ACCEL_CAP * dtc)
              agent.vx -= tangent.x * brake
              agent.vy -= tangent.y * brake
            }
          }
        }
      }
    }

    // Capacity gate: check if we've crossed into our targetNode.
    if (agent.targetNodeId) {
      const targetNode = flow.nodes.find(n => n.id === agent.targetNodeId)
      const distToTarget = Math.hypot(targetNode.x - agent.x, targetNode.y - agent.y)
      const ENTRY_DIST = 30
      // bd ai-engineer-blqz: a capacity-gated target admits its front
      // agent at the CURVE→PLATEAU boundary (segHoldBounds[gateIdx]) —
      // the same boundary the queue (anticipatory-decel blocker, above)
      // holds at. Without this the queue would deadlock: agents stopped
      // at segHoldBounds never reach the Euclidean node-anchor gate.
      // ENTRY_DIST of arc-length slack covers the freeze zone
      // (FREEZE_DIST_NEAR=25) so a frozen front agent still gets admitted
      // when its slot opens. The admitted agent immediately becomes the
      // occupant and moves downstream into the plateau; the queue behind
      // it stays piled in the pinch curve.
      const gateIdx = branch.segHoldBounds
        ? branch.nodeIds.indexOf(agent.targetNodeId)
        : -1
      const segGated = gateIdx >= 0 && (
        occupancy[targetNode.id] >= targetNode.capacity ||
        targetNode.capacity === 1
      )
      const atSegmentEdge = segGated
        && bestS >= branch.segHoldBounds[gateIdx] - ENTRY_DIST
      // Arc-length anchor-pass crossing (bd ai-engineer-4pce). The Euclidean
      // `distToTarget < ENTRY_DIST` gate is lateral-offset-sensitive: on a
      // WIDE band a centerline-following agent can pass the target node's
      // anchor while still further than ENTRY_DIST from it *laterally* (its
      // y-offset alone exceeds 30), miss the gate entirely, and ride the
      // branch all the way off to its leaf end — a large overshooting a
      // split node, then permanently holding a source-capacity slot and
      // slowly deadlocking the flow. `bestS` is the agent's projected
      // arc-length along the branch: lateral-offset-independent. Once it
      // reaches the target node's anchor arc-length the agent HAS arrived
      // longitudinally and must be allowed to cross. This is a pure safety
      // net — a centered agent still trips the Euclidean gate ~ENTRY_DIST
      // earlier; atAnchorArc only catches the off-centre agents that gate
      // misses. Junction targets keep the physical-arrival gate (the
      // two-stage teleport fix below depends on `distToTarget`).
      const atAnchorArc = gateIdx >= 0 && bestS >= branch.anchorS[gateIdx]
      // ── Two-stage junction cross (bd ai-engineer-e0cj — TELEPORT FIX) ──
      // When the cap-gated target is the LAST node of the agent's current
      // branch, the post-cross branch is a DIFFERENT branch that meets
      // this one only at the junction node's anchor (a merge/fan-out
      // point). Crossing EARLY (atSegmentEdge — up to several hundred
      // viewBox units upstream of the anchor) would re-seat the agent on
      // that outbound branch, and the post-gate Euclidean clamp would
      // SNAP it forward to the outbound branch's start: a visible
      // teleport (the symptom Jason saw in the N17 set).
      //
      // Fix — decouple the slot reservation from the physical crossing:
      //   Stage 1: reserve the slot early (occupancy++, `_slotClaim` set)
      //            so queueing / backpressure is byte-for-byte unchanged,
      //            but DON'T touch currentNodeId / targetNodeId / branch.
      //            The hold + overshoot-brake above release a claimant so
      //            it flows the last stretch to the anchor.
      //   Stage 2: once the agent physically reaches the anchor
      //            (distToTarget < ENTRY_DIST), do the real cross. The
      //            inbound and outbound branches coincide here, so the
      //            post-gate clamp has nothing to snap.
      // Non-junction targets keep the legacy single-stage cross.
      //
      // bd ai-engineer-qmti: the junction condition is checked explicitly via
      // the predecessor / successor maps — the target is a MERGE or a FORK
      // (see isJunctionNode above). The old proxy `target ===
      // branch.nodeIds[last]` was a branch-relative structural coincidence:
      // a branch terminates at a merge, a fork, OR a leaf, and the proxy
      // fired for all three — including the leaf case, which has no outbound
      // branch and so never needs the two-stage cross.
      const targetIsJunction = isJunctionNode(agent.targetNodeId)
      const junctionCross = targetIsJunction && segGated
      if (distToTarget < ENTRY_DIST || atSegmentEdge || atAnchorArc) {
        // Stage 1 — junction only: reserve the slot without crossing.
        if (junctionCross
            && agent._slotClaim !== targetNode.id
            && occupancy[targetNode.id] < targetNode.capacity) {
          occupancy[targetNode.id]++
          agent._slotClaim = targetNode.id
        }
        const claimed = agent._slotClaim === targetNode.id
        // A junction agent crosses only on physical arrival at the anchor;
        // a non-junction agent crosses as soon as the slot is free.
        const doCross = junctionCross
          ? (claimed && distToTarget < ENTRY_DIST)
          : (occupancy[targetNode.id] < targetNode.capacity)
        if (doCross) {
          // Cross the boundary.
          if (agent.currentNodeId) {
            occupancy[agent.currentNodeId]--
            nodesWithExitsThisStep.add(agent.currentNodeId)
          }
          // Claimants already incremented occupancy in stage 1.
          if (!claimed) occupancy[targetNode.id]++
          agent._slotClaim = undefined
          agent.currentNodeId = targetNode.id
          agent._enteredAt = agent.age
          traces.entries.push({ id: agent.id, nodeId: targetNode.id, t: agent.age })
          // Pick next target: revise OR advance.
          const nextRev = targetNode.reviseTo && rand() < (targetNode.reviseProb ?? 0)
          if (nextRev) {
            // Revise: the agent has been kicked BACK to the reviseTo node.
            // The flow graph is a DAG of forward branches — there is no
            // branch from a constraint back to an upstream node, so an
            // in-flight revising agent has no centerline to follow and
            // would deadlock at the constraint (blocking everything
            // behind it). Instead: free the constraint immediately, park
            // the agent off-canvas, and let the pending/revising
            // promotion loop place it back at reviseTo when capacity
            // opens. Visually this is "the work was sent back" — it
            // disappears from the constraint and reappears in the
            // upstream queue.
            occupancy[targetNode.id]--
            nodesWithExitsThisStep.add(targetNode.id)
            const reviseNode = flow.nodes.find(n => n.id === targetNode.reviseTo)
            agent.currentNodeId = null
            agent.targetNodeId = targetNode.reviseTo
            agent.lifecycle = 'revising'
            agent.x = (reviseNode?.x ?? entryNode.x) - 100
            agent.y = (reviseNode?.y ?? entryNode.y)
            agent.vx = 0
            agent.vy = 0
            traces.revisions.push({ t: agent.age, agentId: agent.id, from: targetNode.id, to: targetNode.reviseTo })
          } else if (targetNode.transform === 'combine'
                     && agent.size === 'small') {
            // ── Combine (v1.3 L3 §3.4) ────────────────────────────────────
            // A SMALL agent entering a combine node is HELD at it; the
            // combine pass fires one large once combineCount are held. A
            // LARGE arrival passes through unchanged (falls to the `else`).
            holdAtCombine(agent, targetNode)
            return
          } else {
            // v1.2 R2: roll the rejection edges (spec §3.2) before forward
            // routing. A rejected agent becomes 'revising' here and rides the
            // rejection branch back to its `to` node; otherwise it advances
            // forward via nextSuccessor. routeAfterNode handles both.
            routeAfterNode(targetNode, agent)

            // ── Split (v1.3 L3 §3.3 — fix bd ai-engineer-4pce) ────────────
            // A LARGE agent that has just crossed INTO a transform:'split'
            // node and was NOT rejection-rolled back decomposes AT that node:
            // it despawns and splitCount small children spawn at the split
            // node, each targeting nextSuccessor(splitNode) and flowing
            // FORWARD to the node's successor.
            //
            // The split is performed HERE — on the cross-INTO frame, the
            // moment the large reaches the split node's anchor — so the
            // children spawn where the large physically IS. The previous
            // build keyed performSplit on the cross-OUT of the split node:
            // the large entered the split node, then traversed the ENTIRE
            // split→successor segment as a large particle, despawned at the
            // SUCCESSOR's anchor, and only THEN spawned the children back at
            // the split node — a visible backward teleport (Jason
            // 2026-05-21, "Test explosion": split fires late, then jumps
            // back). Splitting at-the-node is forward-only.
            //
            // Ordering: AFTER routeAfterNode so the rejection roll still
            // wins — a rejected large revises and never splits
            // (lifecycle === 'revising'). A SMALL arrival is unaffected
            // (gated on size === 'large'). A leaf split node never fires
            // (spec §2 — no exit transition).
            if (agent.lifecycle !== 'revising'
                && targetNode.transform === 'split'
                && agent.size === 'large'
                && (targetNode.successors || []).length > 0) {
              performSplit(agent, targetNode, nodesWithExitsThisStep)
              return
            }
          }
          // Post-gate Euclidean clamp: the capacity gate fires ENTRY_DIST units
          // before the physical node, so the agent's physical position may be
          // outside the new branch's ribbon at the moment of crossing. Snap it
          // back immediately so the Tier 1 escape invariant holds on the very
          // frame the boundary is crossed.
          const newBranch = selectBranch(agent, branches)
          if (newBranch) {
            const newCl = newBranch.centerline
            const newHalfW = (widths[agent.currentNodeId] ?? MIN_RIBBON_WIDTH) / 2
            // Euclidean safety net only — raw halfW so inter-sample gaps don't trigger it.
            const newMax = newHalfW - 0.1
            const projPost = projectToCenterline(newCl, agent.x, agent.y)
            const nearS = projPost.s
            const nearD2 = projPost.distance2
            if (nearD2 > newMax * newMax) {
              const nearPt = newCl.pointAtArcLength(nearS)
              const nearDist = Math.sqrt(nearD2)
              const scale = newMax / nearDist
              agent.x = nearPt.x + (agent.x - nearPt.x) * scale
              agent.y = nearPt.y + (agent.y - nearPt.y) * scale
              // Kill velocity away from nearest point.
              const awayX = (agent.x - nearPt.x) / newMax
              const awayY = (agent.y - nearPt.y) / newMax
              const vAway = agent.vx * awayX + agent.vy * awayY
              if (vAway > 0) {
                agent.vx -= awayX * vAway
                agent.vy -= awayY * vAway
              }
            }
          }
        }
        // Not crossing this frame — either blocked (slot full) or a
        // junction claimant still flowing toward the anchor. Either way
        // physics holds / advances the agent; no state change needed.
      }
    }

    // Completion check: did the agent finish a leaf node?
    if (agent.currentNodeId && agent.targetNodeId === null) {
      const currentNode = flow.nodes.find(n => n.id === agent.currentNodeId)
      // Has the agent finished traversing this leaf segment? Approximate by
      // checking if it's been in this node for at least its latency.
      // (For v1 we use a simple time-based check; refinement to arc-length
      // position is a loop concern.)
      if (agent.age - (agent._enteredAt ?? 0) >= currentNode.latency) {
        occupancy[currentNode.id]--
        nodesWithExitsThisStep.add(currentNode.id)
        traces.exits.push({ id: agent.id, nodeId: currentNode.id, t: agent.age })
        if (rateLimited) {
          // True-emitter model (bd ai-engineer-2igc): a completed agent
          // LEAVES the system. It is marked 'done' and spliced from the
          // agents array at the end of step(). It is NOT recycled into a
          // pending pool.
          //
          // Why: under the old recycle model the total agent count was
          // conserved, so source emission was structurally clamped to the
          // recycle return rate — the intake could never run at its own
          // `rate`, surplus agents parked off-canvas invisibly, and a flow
          // seeded with 0 initial agents was permanently dead. Jason
          // flagged the visible symptom: "the particle flow from the
          // intake ... seem to stop." With completion = removal, the
          // source-creation pass at the end of step() is free to keep
          // emitting NEW particles at the configured `rate`, so the intake
          // is a genuine, continuous tap (M2 §5.1, revised).
          agent.lifecycle = 'done'
          agent.currentNodeId = null
          agent.targetNodeId = null
          agent.vx = 0; agent.vy = 0
        } else if (occupancy[entryNode.id] < entryNode.capacity) {
          // Legacy mode: respawn at entry if there's room.
          occupancy[entryNode.id]++
          const nextTarget = nextSuccessor(entryNode)
          const pos = spawnPosition(entryNode, nextTarget, agentRadius(agent))
          agent.x = pos.x; agent.y = pos.y
          agent.vx = 0; agent.vy = 0
          agent.currentNodeId = entryNode.id
          agent.targetNodeId = nextTarget
          agent.lifecycle = 'in-process'
          agent._enteredAt = agent.age
        } else {
          // Legacy mode, no room — go pending.
          agent.currentNodeId = null
          agent.targetNodeId = entryNode.id
          agent.lifecycle = 'pending'
          agent.x = entryNode.x - 100; agent.y = entryNode.y
          markPending(agent)  // FIFO stamp (bead a1m)
        }
      }
    }
  }

  // ── Split / combine transform mechanics (v1.3 L3 — spec §3.3 / §3.4) ──────
  // performSplit: a LARGE agent reaching a `transform:'split'` node
  // decomposes — the large despawns (its slot at its current node freed, any
  // reserved junction `_slotClaim` released), and `splitCount` small agents
  // are spawned AT the split node (deferred via pendingSpawns — spec §6),
  // each routed via nextSuccessor so a forking split distributes its
  // children. Called from the doCross block at the cross-INTO moment, so the
  // children spawn where the large physically is — no backward teleport
  // (bd ai-engineer-4pce).
  function performSplit(largeAgent, splitNode, nodesWithExitsThisStep) {
    if (largeAgent.currentNodeId) {
      occupancy[largeAgent.currentNodeId] =
        Math.max(0, occupancy[largeAgent.currentNodeId] - 1)
      nodesWithExitsThisStep.add(largeAgent.currentNodeId)
    }
    // Release any junction slot the large reserved (stage-1 cross) so the
    // despawn cannot leak a downstream node's occupancy.
    if (largeAgent._slotClaim) {
      occupancy[largeAgent._slotClaim] =
        Math.max(0, occupancy[largeAgent._slotClaim] - 1)
      nodesWithExitsThisStep.add(largeAgent._slotClaim)
      largeAgent._slotClaim = undefined
    }
    largeAgent.lifecycle = 'done'
    largeAgent.currentNodeId = null
    largeAgent.targetNodeId = null
    largeAgent.vx = 0; largeAgent.vy = 0
    const count =
      Number.isInteger(splitNode.splitCount) && splitNode.splitCount >= 2
        ? splitNode.splitCount : DEFAULT_SPLIT_COUNT
    const agentIds = []
    for (let i = 0; i < count; i++) {
      const nextTarget = nextSuccessor(splitNode)
      const pos = spawnPosition(splitNode, nextTarget, radiusForSize('small'))
      const a = {
        id: freshAgentId(),
        x: pos.x, y: pos.y,
        vx: 0, vy: 0,
        currentNodeId: splitNode.id,
        targetNodeId: nextTarget,
        lifecycle: 'in-process',
        age: largeAgent.age,
        _enteredAt: largeAgent.age,
        size: 'small',
        radius: radiusForSize('small'),
        // bd ai-engineer-s8cm: red is a property of the WORK — split children
        // inherit the parent large particle's defective flag.
        defective: !!largeAgent.defective,
      }
      occupancy[splitNode.id]++
      pendingSpawns.push(a)
      agentIds.push(a.id)
      traces.entries.push({ id: a.id, nodeId: splitNode.id, t: a.age })
    }
    traces.splits.push({
      t: largeAgent.age, nodeId: splitNode.id, agentIds, sourceId: largeAgent.id,
    })
  }

  // holdAtCombine: a SMALL agent entering a `transform:'combine'` node is
  // parked at the node anchor — lifecycle stays 'in-process', `_held` flags
  // it, `_heldSeq` stamps arrival order. processCombines fires the large.
  function holdAtCombine(agent, combineNode) {
    agent._held = combineNode.id
    agent._heldSeq = ++heldSeq
    agent.targetNodeId = null   // no onward route while held
    agent.vx = 0; agent.vy = 0
    // Snap to the node anchor with lateral jitter so the pile reads as a heap.
    const pos = spawnPosition(combineNode, null, agentRadius(agent))
    agent.x = pos.x
    agent.y = pos.y
  }

  // processCombines: per step, every combine node holding ≥combineCount small
  // agents despawns the first combineCount (FIFO by _heldSeq — "first N to
  // arrive fire", no provenance) and spawns ONE large agent at the node exit
  // (deferred via pendingSpawns). Runs as its own pass after the agent loop.
  function processCombines(nodesWithExitsThisStep) {
    for (const node of flow.nodes) {
      if (node.transform !== 'combine') continue
      const count =
        Number.isInteger(node.combineCount) && node.combineCount >= 2
          ? node.combineCount : DEFAULT_COMBINE_COUNT
      let held = agents
        .filter(a => a._held === node.id)
        .sort((a, b) => (a._heldSeq ?? 0) - (b._heldSeq ?? 0))
      while (held.length >= count) {
        const consumed = held.slice(0, count)
        held = held.slice(count)
        for (const a of consumed) {
          a.lifecycle = 'done'
          a._held = undefined
          a.currentNodeId = null
          a.targetNodeId = null
          a.vx = 0; a.vy = 0
          occupancy[node.id] = Math.max(0, occupancy[node.id] - 1)
        }
        nodesWithExitsThisStep.add(node.id)
        const t = consumed[0]?.age ?? 0
        const large = {
          id: freshAgentId(),
          x: node.x, y: node.y,
          vx: 0, vy: 0,
          currentNodeId: node.id,
          targetNodeId: null,
          lifecycle: 'in-process',
          age: t,
          _enteredAt: t,
          size: 'large',
          radius: radiusForSize('large'),
          // bd ai-engineer-s8cm: red is a property of the WORK — a combine
          // fires a defective large if ANY consumed piece was defective.
          defective: consumed.some(a => !!a.defective),
        }
        // bd ai-engineer-zq54: the combine-fired large IS the combine node's
        // output — so it is subject to the same rejection roll as any other
        // agent leaving the node. routeAfterNode rolls flow.rejections keyed
        // on the combine node: a rejected large becomes 'revising', bound for
        // the edge's `to` node, and rides the thin rejection branch back;
        // otherwise it advances forward via nextSuccessor (the previous
        // hard-wired behaviour). Before this fix a designer-drawn rejection
        // edge whose `from` is a combine node was a silent no-op — the held
        // smalls `return` from holdAtCombine before the roll point, and the
        // fired large was deferred-spawned past it with a fixed nextSuccessor
        // target. Rolling on the large is the correct, complete coverage:
        // the combine node's only exit event is the large firing, so no
        // validateFlow warning is needed (the edge now fires).
        routeAfterNode(node, large)
        const pos = spawnPosition(node, large.targetNodeId, radiusForSize('large'))
        large.x = pos.x; large.y = pos.y
        occupancy[node.id]++
        pendingSpawns.push(large)
        traces.combines.push({
          t, nodeId: node.id,
          agentIds: consumed.map(a => a.id), largeId: large.id,
        })
      }
    }
  }

  // ── Per-agent step (the main loop body) ───────────────────────────────────
  // Advance one in-process agent through the full per-agent pipeline. Reuses
  // the precomputed branch + arc-length from computeAgentFrame() when
  // available. selectBranch() implements the fork tiebreaker: when multiple
  // candidate branches share the currentNodeId, prefer the one whose forward
  // tangent agrees with the agent's velocity — this eliminates the class of
  // escapes where a fork-parent agent was incorrectly snapped onto a sibling
  // lane.
  function stepAgent(agent, dtc, frame, nodesWithExitsThisStep) {
    // v1.3 L3 (spec §3.4): a HELD agent is parked at a combine node — it
    // skips physics + transitions entirely (so the leaf-completion check
    // never fires on it), but still ages.
    if (agent._held) { agent.age += dtc; return }
    const branch = frame.agentBranch.get(agent) ?? selectBranch(agent, branches)
    if (!branch) return
    const cl = branch.centerline
    const bestS = frame.agentS.get(agent) ?? projectToCenterline(cl, agent.x, agent.y).s
    const tangent = cl.tangentAtArcLength(bestS)
    const localBandWidth = branch.widthFn(bestS)
    // Per-node SPEED multiplier (v1.1 §7, bd ai-engineer-06e7) — the
    // authored velocity scaling for the node whose ribbon segment the
    // agent currently occupies. Folded into targetSpeed below.
    const localNodeSpeed = branch.speedFn ? branch.speedFn(bestS) : 1.0

    // ── Width-based speed fraction (bead ai-engineer-r7r → ai-engineer-98q) ─
    // Above SLOW_THRESHOLD_W: baseSpeed (free flow in the wide plateau).
    // Below: smooth ramp (smoothstep, C¹-continuous at both endpoints)
    // from baseSpeed down to MIN_SPEED_FACTOR at the narrowest visible
    // width (the constraint plateau). The ramp endpoints are pinned to
    // [NARROW_W, SLOW_THRESHOLD_W] — so when an agent sits on the
    // constraint plateau, speedFraction = MIN_SPEED_FACTOR EXACTLY
    // (not the iter-2 behaviour of 0.83 at the plateau, which made the
    // constraint visually as fast as the wide band).
    let speedFraction
    if (branch.kind === 'rejection') {
      // A rejection branch is a back-path, not a constraint (bd
      // ai-engineer-yzjh). Its thin fixed REJECTION_BAND_WIDTH would
      // otherwise drop the agent into the width-ramp slowdown below and
      // make a 'revising' particle CRAWL. Instead apply a >1 multiplier so
      // the rejected unit snaps back visibly faster than forward flow.
      speedFraction = REJECTION_SPEED_MULTIPLIER
    } else if (localBandWidth >= SLOW_THRESHOLD_W) {
      speedFraction = 1.0
    } else if (localBandWidth <= NARROW_W || SLOW_THRESHOLD_W <= NARROW_W) {
      speedFraction = MIN_SPEED_FACTOR
    } else {
      const u = (localBandWidth - NARROW_W) / (SLOW_THRESHOLD_W - NARROW_W)
      // smoothstep for C¹ continuity at both endpoints
      const s = u * u * (3 - 2 * u)
      speedFraction = MIN_SPEED_FACTOR + (1 - MIN_SPEED_FACTOR) * s
    }

    const { frontDist, lookFactor } = computeForwardBlocker(agent, branch, cl, bestS, frame)

    const physicsFrozen = updateFreezeState(agent, frontDist, dtc)

    // Final target speed: per-node SPEED × width-floor × lookahead. When
    // unobstructed in a wide band, targetSpeed = baseSpeed × the node's
    // authored SPEED. When approaching a stopped queue, lookFactor
    // smoothly ramps to 0 — the agent decelerates to a stop without ever
    // hitting a hard gate.
    //
    // localNodeSpeed (v1.1 §7) and speedFraction are independent factors:
    // localNodeSpeed is the AUTHORED per-node velocity knob; speedFraction
    // is the legacy width-ramp queue-formation slowdown. With the default
    // Speed⇄Width coupling on, a node made narrow is both narrow (→ width
    // ramp) and slow (→ low SPEED), so the two compound — intended: a
    // narrow-and-slow constraint should read as decisively slow. With the
    // coupling broken, SPEED moves independently of width as the author
    // expects.
    const targetSpeed =
      flow.baseSpeed * localNodeSpeed * speedFraction * lookFactor

    // FROZEN agents (ebv) skip the entire force-application + integration
    // block. Their position stays as-is, velocity stays 0. The wall
    // reclamps + capacity / completion checks still run further down
    // (they're geometric backstops and lifecycle gates, not force
    // application). Wake-up happens inside updateFreezeState when the
    // blocker moves (frontDist increases by FREEZE_WAKE_DELTA).
    if (!physicsFrozen) {
      integrateAgentPhysics(agent, cl, bestS, tangent, targetSpeed, lookFactor, dtc)
    }
    agent.age += dtc  // always advance age, even if frozen

    clampAgentToRibbon(agent, branch, cl, dtc)

    processAgentTransitions(agent, branch, bestS, tangent, dtc, nodesWithExitsThisStep)
  }

  // ──────────────────────────────────────────────────────────────────────
  // Rigid-contact post-pass — backstop only (bead ai-engineer-2ip;
  // supersedes the heavier 5-iteration hex-pack from bead 9nw).
  //
  // With anticipatory deceleration in place (the lookahead block in
  // stepAgent), agents almost never overlap in normal operation — they
  // settle into a queue with DESIRED_SEP=7.5 unit gaps and the soft
  // repulsion handles steady-state spacing. The rigid-contact pass
  // remains as a one-iteration safety net: it catches the residual
  // overlaps that surface at convergence pinches (multiple lanes
  // arriving at the same constraint anchor in N9) and on the rare
  // frame where a fast-arriving agent slips inside the soft-repulsion
  // equilibrium gap. Five iterations were the source of the "visible
  // jostle" Jason flagged — one iteration with a softer push factor
  // resolves catastrophic overlap (< 1.0 × PARTICLE_RADIUS) without
  // the impulsive snap-apart that read as a jolt.
  //
  // The wall re-clamp inside the iteration is preserved verbatim —
  // pair-push can still drive an agent through the ribbon wall in a
  // tight jam and the Tier-1 no-escape invariant depends on the
  // re-clamp.
  // ──────────────────────────────────────────────────────────────────────
  function resolveRigidContacts() {
    // Minimum centre-to-centre separation is PER-PAIR (spec §3.1): the sum
    // of the two agents' radii (their contact distance). For two small
    // agents this is 2 × PARTICLE_RADIUS = 6 viewBox units, unchanged.
    const RIGID_ITERATIONS = 1
    for (let iter = 0; iter < RIGID_ITERATIONS; iter++) {
      // Pair-push to resolve overlaps.
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i]
        if (a.lifecycle !== 'in-process') continue
        if (a._held) continue   // held agents are parked — never pushed (L3)
        for (let j = i + 1; j < agents.length; j++) {
          const b = agents[j]
          if (b.lifecycle !== 'in-process') continue
          if (b._held) continue
          // Skip rigid contact between agents on opposite sides of a
          // capacity gate (same rationale as the peer-blocker fix: an
          // agent that has entered a node should not be physically pushed
          // backward by agents still queued to enter that node).
          // (bead ai-engineer-a1m)
          if (a.currentNodeId && b.targetNodeId === a.currentNodeId) continue
          if (b.currentNodeId && a.targetNodeId === b.currentNodeId) continue
          const minSep = agentRadius(a) + agentRadius(b)  // per-pair contact distance
          const dx = b.x - a.x, dy = b.y - a.y
          const r2 = dx * dx + dy * dy
          if (r2 >= minSep * minSep) continue
          if (r2 < 1e-9) {
            // Numerically co-located — push apart along a fallback axis.
            a.x -= 0.5 * minSep; b.x += 0.5 * minSep
            continue
          }
          const r = Math.sqrt(r2)
          const overlap = minSep - r
          const ux = dx / r, uy = dy / r
          a.x -= 0.5 * overlap * ux
          a.y -= 0.5 * overlap * uy
          b.x += 0.5 * overlap * ux
          b.y += 0.5 * overlap * uy
        }
      }
      // Wall re-clamp: snap each agent back inside its branch ribbon.
      // Uses LOCAL visible halfW (branch.widthFn(s) / 2) — see VISIBLE-WALL
      // fix note in stepAgent (bead ai-engineer-ebv).
      for (const agent of agents) {
        if (agent.lifecycle !== 'in-process') continue
        if (agent._held) continue   // held agents are parked at the anchor (L3)
        const branch = selectBranch(agent, branches)
        if (!branch) continue
        const cl = branch.centerline
        const proj = projectToCenterline(cl, agent.x, agent.y)
        const cp = cl.pointAtArcLength(proj.s)
        const tan = cl.tangentAtArcLength(proj.s)
        const normal = { x: -tan.y, y: tan.x }
        const visHalfW = branch.widthFn(proj.s) / 2
        const nodeHalfW = (widths[agent.currentNodeId] ?? MIN_RIBBON_WIDTH) / 2
        const halfW = Math.min(visHalfW, nodeHalfW)
        const maxLateral = Math.max(0, halfW - physWallMargin(agent))
        const maxEuclid = Math.max(0, halfW - physWallMargin(agent))
        const lateral = (agent.x - cp.x) * normal.x + (agent.y - cp.y) * normal.y
        if (Math.abs(lateral) > maxLateral) {
          const correction = (Math.abs(lateral) - maxLateral) * Math.sign(lateral)
          agent.x -= normal.x * correction
          agent.y -= normal.y * correction
        }
        const newD2 = (agent.x - cp.x) ** 2 + (agent.y - cp.y) ** 2
        // 0ld fix: add PROJECTION_NOISE_TOL to absorb sub-unit bisection noise
        // at the constraint plateau (maxEuclid=0). See PROJECTION_NOISE_TOL note.
        const maxEuclidPgTol = maxEuclid + PROJECTION_NOISE_TOL
        if (newD2 > maxEuclidPgTol * maxEuclidPgTol) {
          const d = Math.sqrt(newD2)
          const scale = maxEuclid / d
          agent.x = cp.x + (agent.x - cp.x) * scale
          agent.y = cp.y + (agent.y - cp.y) * scale
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Ribbon-polygon clamp — IRONCLAD BACKSTOP (bead ai-engineer-ebv).
  //
  // Jason 2026-05-17: 'particles exiting the pipe should be an immediate
  // fail'. This pass runs LAST, after all forces, integrations, gates,
  // rigid-contact resolution, and the teleport backstop. It enforces the
  // visible-wall invariant absolutely:
  //
  //   For every in-process agent, project onto its branch centerline at
  //   arc-length s. Use the LOCAL visible band halfW = widthFn(s) / 2.
  //   Enforce: |lateral offset| ≤ halfW - PHYS_WALL_MARGIN. If outside,
  //   project the centre back onto the boundary. Also kill any velocity
  //   component pushing further outward so next-frame physics can't
  //   re-violate immediately.
  //
  // This is the geometric clamp the dispatch brief calls for. The earlier
  // wall-reclamps inside stepAgent and the rigid-contact pass do most
  // of the work; this is the no-particle-EVER-visible-outside guarantee.
  // ──────────────────────────────────────────────────────────────────────
  function enforceRibbonPolygon(dtc) {
    for (const agent of agents) {
      // v1.2 R2: revising agents ride a (thin) rejection branch and the
      // no-escape invariant must hold on it too — include them via isActiveAgent.
      if (!isActiveAgent(agent)) continue
      const branch = selectBranch(agent, branches)
      if (!branch) continue
      const cl = branch.centerline
      const proj = projectToCenterline(cl, agent.x, agent.y)
      const cp = cl.pointAtArcLength(proj.s)
      const tan = cl.tangentAtArcLength(proj.s)
      const normal = { x: -tan.y, y: tan.x }
      const visHalfW = branch.widthFn(proj.s) / 2
      const nodeHalfW = (widths[agent.currentNodeId] ?? MIN_RIBBON_WIDTH) / 2
      const halfW = Math.min(visHalfW, nodeHalfW)
      const maxAllowed = Math.max(0, halfW - physWallMargin(agent))
      const lateral = (agent.x - cp.x) * normal.x + (agent.y - cp.y) * normal.y
      // Lateral projection: snap position back inside the wall, then bound-
      // brake the outward lateral velocity component (was instant-zero;
      // ebv softened to ACCEL_CAP-bounded so the bounded-acceleration
      // invariant isn't violated by the polygon clamp itself).
      if (Math.abs(lateral) > maxAllowed) {
        const correction = (Math.abs(lateral) - maxAllowed) * Math.sign(lateral)
        agent.x -= normal.x * correction
        agent.y -= normal.y * correction
        const vLat = agent.vx * normal.x + agent.vy * normal.y
        if (Math.sign(vLat) === Math.sign(lateral)) {
          const brake = Math.min(Math.abs(vLat), ACCEL_CAP * dtc)
          agent.vx -= normal.x * brake * Math.sign(vLat)
          agent.vy -= normal.y * brake * Math.sign(vLat)
        }
      }
      // Euclidean catch (behind-branch-start case where lateral projection misses).
      // 0ld fix: add PROJECTION_NOISE_TOL to absorb sub-unit bisection noise
      // at the constraint plateau (maxAllowed=0). See PROJECTION_NOISE_TOL note.
      const recheck2 = (agent.x - cp.x) ** 2 + (agent.y - cp.y) ** 2
      const maxAllowedTol = maxAllowed + PROJECTION_NOISE_TOL
      if (recheck2 > maxAllowedTol * maxAllowedTol) {
        const d = Math.sqrt(recheck2)
        const scale = maxAllowed / d
        agent.x = cp.x + (agent.x - cp.x) * scale
        agent.y = cp.y + (agent.y - cp.y) * scale
        const awayX = (agent.x - cp.x) / Math.max(1e-6, maxAllowed)
        const awayY = (agent.y - cp.y) / Math.max(1e-6, maxAllowed)
        const vAway = agent.vx * awayX + agent.vy * awayY
        if (vAway > 0) {
          const brake = Math.min(vAway, ACCEL_CAP * dtc)
          agent.vx -= awayX * brake
          agent.vy -= awayY * brake
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Last-resort teleport backstop (bead ai-engineer-1al).
  //
  // After the per-agent loop, sweep for any in-flight agent that has
  // drifted outside the RIBBON bounding box (geometric extent of every
  // branch's centerline ± local halfWidth) by more than ESCAPE_MARGIN.
  //
  // Using the ribbon BB rather than the viewBox is important for flows
  // with off-canvas entries (e.g. n9-multilane's `_start` at x=-300):
  // the viewBox starts at x=0, so a viewBox-based check would fire on
  // every legitimate spawn. The ribbon BB tracks where particles are
  // actually allowed to be.
  //
  // With bisection projection and the fork tiebreaker landing, this
  // should never fire — but it is the no-particle-ever-visible-outside
  // guarantee. Every fire is recorded in traces.escapes so the Tier 1
  // invariant test can assert escapes.length === 0.
  // ──────────────────────────────────────────────────────────────────────
  function teleportEscapees(nodesWithExitsThisStep) {
    const ESCAPE_MARGIN = 50
    for (const agent of agents) {
      if (agent.lifecycle === 'pending') continue
      const outside =
        agent.x < ribbonBB.minX - ESCAPE_MARGIN || agent.x > ribbonBB.maxX + ESCAPE_MARGIN ||
        agent.y < ribbonBB.minY - ESCAPE_MARGIN || agent.y > ribbonBB.maxY + ESCAPE_MARGIN
      if (!outside) continue
      traces.escapes.push({
        id: agent.id,
        x: agent.x, y: agent.y,
        currentNodeId: agent.currentNodeId,
        targetNodeId: agent.targetNodeId,
        t: agent.age,
      })
      // bd ai-engineer-e0cj: release any junction slot the escapee had
      // reserved, so a re-seated agent can't leak a constraint's occupancy.
      if (agent._slotClaim) {
        occupancy[agent._slotClaim] = Math.max(0, occupancy[agent._slotClaim] - 1)
        nodesWithExitsThisStep.add(agent._slotClaim)
        agent._slotClaim = undefined
      }
      // Release whatever node the agent thought it occupied and re-seat at entry.
      if (agent.currentNodeId && agent.currentNodeId !== entryNode.id) {
        occupancy[agent.currentNodeId] = Math.max(0, occupancy[agent.currentNodeId] - 1)
        nodesWithExitsThisStep.add(agent.currentNodeId)
      }
      if (occupancy[entryNode.id] < entryNode.capacity) {
        // Entry has room — drop the agent in cleanly.
        if (agent.currentNodeId !== entryNode.id) {
          occupancy[entryNode.id]++
        }
        agent.x = entryNode.x
        agent.y = entryNode.y
        agent.vx = 0; agent.vy = 0
        agent.currentNodeId = entryNode.id
        agent.targetNodeId = nextSuccessor(entryNode)
        agent.lifecycle = 'in-process'
        agent._enteredAt = agent.age
      } else {
        // Entry full — park off-canvas, promotion loop will pick it up.
        if (agent.currentNodeId === entryNode.id) {
          occupancy[entryNode.id] = Math.max(0, occupancy[entryNode.id] - 1)
          nodesWithExitsThisStep.add(entryNode.id)
        }
        agent.x = entryNode.x - 100; agent.y = entryNode.y
        agent.vx = 0; agent.vy = 0
        agent.currentNodeId = null
        agent.targetNodeId = entryNode.id
        agent.lifecycle = 'pending'
        markPending(agent)  // FIFO stamp (bead a1m)
      }
    }
  }

  // ── Pending- and revising-agent promotion (bd ai-engineer-j3c) ────────────
  // Without this pass, any agent that completes the leaf while the entry
  // is occupied — or is sent back from a constraint via the revise gate —
  // drifts into an off-canvas waiting state and never returns to the
  // ribbon. Over time the visible population drains. The fix: after each
  // physics step, walk waiting agents (pending OR revising with
  // currentNodeId=null) and promote any whose target node has spare
  // capacity. Only one promotion can succeed per cap=1 node per step —
  // which matches the node's natural pacing.
  //
  // FIFO ordering (bead ai-engineer-a1m): sort waiting agents by
  // _pendingSeq before iterating. Without FIFO, early-index agents cycle
  // back to pending and get promoted AHEAD of later-index agents that have
  // been waiting longer — "array-position starvation". At spawnRate=1.5/s
  // this was masked (each wait ≤0.67s), but at 0.8/s it caused 50-75s
  // continuous freezes on the last 23% of initial pending agents.
  function promoteWaitingAgents() {
    const waitingAgentsSorted = agents
      .filter(a =>
        a.lifecycle === 'pending' ||
        (a.lifecycle === 'revising' && a.currentNodeId === null)
      )
      .sort((a, b) => (a._pendingSeq ?? 0) - (b._pendingSeq ?? 0))
    for (const agent of waitingAgentsSorted) {
      const targetId = agent.targetNodeId
      if (!targetId) continue
      const targetNode = flow.nodes.find(n => n.id === targetId)
      if (!targetNode) continue
      if (occupancy[targetId] >= targetNode.capacity) continue
      // Rate-limited source gate (bd ai-engineer-y70; M2 §5.1): only a
      // SOURCE node's promotion is throttled, each by its OWN accumulator.
      // Revising agents returning to a mid-stream reviseTo target are NOT
      // subject to the spawn rate — they're already in the system and are
      // simply being repositioned. This matches the visual intent:
      // "particles come from the source 1:1", not "the entire flow is 1:1".
      if (rateLimited && sourceIdSet.has(targetId)) {
        if (spawnAccumulators[targetId] < 1) continue
        spawnAccumulators[targetId] -= 1
      }
      occupancy[targetId]++
      // Centerline-aligned spawn jitter (see spawnPosition() above).
      const nextTarget = nextSuccessor(targetNode)
      const pos = spawnPosition(targetNode, nextTarget, agentRadius(agent))
      agent.x = pos.x
      agent.y = pos.y
      agent.vx = 0
      agent.vy = 0
      agent.currentNodeId = targetId
      agent.targetNodeId = nextTarget
      agent.lifecycle = 'in-process'
      agent._enteredAt = agent.age
      traces.entries.push({ id: agent.id, nodeId: targetId, t: agent.age })
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // True-emitter source creation (bd ai-engineer-2igc; M2 §5.1 revised).
  //
  // A rate-limited source is a genuine particle TAP, not a recycler. The
  // promotion pass above first places any waiting agents (the initial
  // seed's pending pool). AFTER that, every source still holding a spawn
  // token (accumulator ≥ 1) and with physical room (occupancy < capacity)
  // CREATES a brand-new agent. This is what makes the intake emit
  // "constant according to the speed set" — its output rate is its own
  // `rate`, independent of how many agents are downstream.
  //
  // Backpressure is preserved and is the natural population bound: when a
  // constraint backs the queue up to the source, occupancy[source] sits at
  // capacity and creation simply waits. The accumulator is clamped at
  // SPAWN_ACCUMULATOR_CAP, so no burst fires when the queue clears. The
  // population settles at what the pipe physically holds; MAX_AGENTS is a
  // hard backstop for constraint-free flows.
  //
  // Per step a source either promotes ONE pending agent (above) or creates
  // ONE new agent (here) — never both — because the accumulator is capped
  // at 1.0 and the promotion pass consumes the token first.
  // ────────────────────────────────────────────────────────────────────
  function createSourceAgents() {
    if (rateLimited) {
      for (const s of sources) {
        if (agents.length >= MAX_AGENTS) break
        if (spawnAccumulators[s.id] < 1) continue
        const srcNode = s.node
        if (occupancy[s.id] >= srcNode.capacity) continue
        spawnAccumulators[s.id] -= 1
        occupancy[s.id]++
        const nextTarget = nextSuccessor(srcNode)
        // v1.3 L3: emitted agent size + radius come from the source.
        const size = particleSizeOf(srcNode)
        const pos = spawnPosition(srcNode, nextTarget, radiusForSize(size))
        const a = {
          id: freshAgentId(),
          x: pos.x, y: pos.y,
          vx: 0, vy: 0,
          currentNodeId: s.id,
          targetNodeId: nextTarget,
          lifecycle: 'in-process',
          age: 0,
          _enteredAt: 0,
          size,
          radius: radiusForSize(size),
          // bd ai-engineer-s8cm: the true-emitter path — a brand-new agent is
          // red per the source's redRatio (deterministic error diffusion).
          defective: emitDefective(srcNode),
        }
        agents.push(a)
        traces.entries.push({ id: a.id, nodeId: s.id, t: a.age })
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Queue-vacancy wake (bd ai-engineer-5kk).
  //
  // Any node whose occupancy DROPPED during this step (an agent exited
  // or moved out) just freed a slot. Wake all frozen agents whose target
  // is that node — they should re-engage physics on the next frame and
  // start advancing toward the freed slot, rather than waiting for the
  // freeze-wake-delta to fire (which depends on the in-front blocker
  // physically moving by FREEZE_WAKE_DELTA units, a delay that
  // compounded N times for back-of-queue agents and produced 30s+
  // single freeze runs Jason flagged as "particles get stuck".
  //
  // This is the "(2) capacity gate would fire" wake hinted in the
  // iter-3-ebv comments but never implemented. Combined with the
  // FREEZE_WAKE_DELTA reduction (8 → 3 above), individual freeze runs
  // now cap at ~3-5s for default queue depths (was up to 31.9s).
  //
  // Wake-race fix (bead ai-engineer-a1m): use nodesWithExitsThisStep
  // instead of the net-occupancy-drop check. When a frozen front-of-
  // queue agent enters a node in the SAME step as the previous occupant
  // exits, occupancy is net-unchanged (drop + rise = 0) and the old
  // check would NOT fire — leaving back-queue agents frozen indefinitely
  // (up to N × constraint-traversal-time ≈ 52s with 24 agents). The
  // exit-tracking Set fires on any exit, regardless of whether the slot
  // was immediately refilled, ensuring every departure propagates a wake
  // to the rest of the chain.
  // ────────────────────────────────────────────────────────────────────
  function wakeQueueVacancies(nodesWithExitsThisStep) {
    for (const nodeId of nodesWithExitsThisStep) {
      // Slot freed this step. Wake all frozen agents whose target is
      // this node — they're the chain queueing for this slot.
      for (const a of agents) {
        if (a._frozen && a.targetNodeId === nodeId) {
          a._frozen = false
          a._idleTime = 0
          a._frozenAtDist = undefined
          a._frozenDuration = 0
        }
      }
    }
  }

  // ── Reap completed agents (true-emitter model, bd ai-engineer-2igc) ───────
  // Agents that finished a leaf node this step were marked 'done' in the
  // completion check; splice them out now, after every pass that iterates
  // `agents` for the step has run. Iterate back-to-front so splices do not
  // disturb unvisited indices.
  function reapDoneAgents() {
    for (let i = agents.length - 1; i >= 0; i--) {
      if (agents[i].lifecycle === 'done') agents.splice(i, 1)
    }
  }

  return {
    flow, branches, widths, agents, occupancy, traces,
    // forkAssign — per fork-node routing-decision tally: nodeId →
    // { successorId: count }. Every nextSuccessor() call at a node with a
    // declared `fork` increments this. Unlike realised lane traffic
    // (traces.entries), the assignment tally is a DETERMINISTIC consequence
    // of the lowest-ratio stratified picker, so it tracks each branch's
    // rateShare to within ±1 count regardless of downstream capacity /
    // backpressure timing. Exposed for M2 §2.2 fork-routing assertions
    // (bd ai-engineer-xwzc — the realised-traffic assertion was flaky).
    forkAssign,
    step(dt) {
      const dtc = Math.min(dt, 1 / 30)  // clamp to avoid integration blow-up

      // Snapshot occupancy at start-of-step (kept for diagnostics /
      // future net-change queries; the wake sweep now uses
      // nodesWithExitsThisStep instead of a net-drop check — see
      // bd ai-engineer-a1m wake-race fix note below).
      const occupancyAtStepStart = { ...occupancy }  // eslint-disable-line no-unused-vars
      // Exit-tracking Set (bead ai-engineer-a1m wake-race fix):
      // records every node that had an agent exit during this step.
      // The wake sweep at step-end uses this instead of the net-occupancy
      // drop check so the wake fires even when an exit and a same-step
      // entry cancel out (occupancy unchanged). Without this, frozen queue
      // agents could stay frozen for up to N × constraint-traversal-time
      // because the cap=1 front agent always entered in the same step as
      // the previous occupant exited, keeping net occupancy = 0.
      const nodesWithExitsThisStep = new Set()

      accrueSpawnTokens(dtc)

      const frame = computeAgentFrame()

      for (const agent of agents) {
        stepAgent(agent, dtc, frame, nodesWithExitsThisStep)
      }

      // v1.3 L3 (spec §6): flush split children, run the combine pass, flush
      // the combine-fired larges — all before the geometry / lifecycle passes
      // so the new agents are clamped + reaped consistently this step.
      flushPendingSpawns()
      processCombines(nodesWithExitsThisStep)
      flushPendingSpawns()

      resolveRigidContacts()

      enforceRibbonPolygon(dtc)

      teleportEscapees(nodesWithExitsThisStep)

      promoteWaitingAgents()

      createSourceAgents()

      wakeQueueVacancies(nodesWithExitsThisStep)

      reapDoneAgents()
    },
  }
}
