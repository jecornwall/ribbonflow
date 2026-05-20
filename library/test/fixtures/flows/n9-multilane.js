/**
 * n9-multilane.js — N9 enterprise factory: three upstream lanes converging
 * on a single cross-team-review constraint, then one downstream lane to
 * change-board.
 *
 * Locked spec: visuals.md §3.0.5.LOCKED-V2. Reference frames:
 *   - assets/mockups/n9-simulation/01-three-lane-converge.png (Reference A)
 *   - assets/mockups/n9-simulation/02-tickmarks-throughput-encoded.png
 *     (Reference B — the structural backbone)
 *
 * Topology:
 *
 *   Top:    discovery → design → design-review → build-feature ↘
 *   Middle: triage → build-bug ────────────────────────────────→ cross-team-review → change-board
 *   Bottom: architecture → build-platform ─────────────────────↗
 *
 * ── M2 multi-source re-author (bd ai-engineer-dxgu, 2026-05-20) ────────────
 *
 * Three independent lanes, no shared root in the visible band. This fixture
 * is the M2 §5.1 demonstration that RETIRES the off-canvas `_start` hack.
 *
 * Previously the three lanes shared one virtual `_start` source at x=-700 — a
 * long invisible runway ~900 units left of the visible band. Agents crawled
 * that off-canvas runway before ever entering the frame, throttling
 * slide-window throughput to ~0-1 exits in 30s (confirmed bd ai-engineer-v9mj
 * — relevant to Jason's M5 parity review). The `_start` node, the
 * `flow.entryId`/`spawnRate` v1 fields, and the `_start` fork are all gone.
 *
 * Each lane now begins at a REAL `kind:'source'` node, positioned inside the
 * visible band: `discovery`, `triage`, `architecture` each emit independently
 * at their own `rate` (~0.33/s each → ~1.0/s aggregate, the same total the
 * `_start` round-robin produced). Agents enter the visible band immediately
 * and flow at proper throughput within the slide window; the bottleneck at
 * `cross-team-review` (cap 1) is now the only thing throttling exits — which
 * is exactly the optic the slide title demands.
 *
 * No `forks` declaration: three independent sources are not a fork (a fork
 * splits ONE node's inflow; these are three separate taps). The `merges`
 * declaration is kept — the three lanes genuinely converge.
 *
 * Width register: PINCH (pinchMode: 'constraint-only'). `widthMode` is left
 * unset → legacy throughput-encoded width (capacity / latency), the register
 * this fixture has always used. See bd-els9 header history below.
 *
 * Per bd ai-engineer-els9 (Jason 2026-05-18 screenshot feedback on slide /8):
 * "Missing bottleneck shape. Cross-team review bottleneck isn't obvious."
 * Diagnosis: throughput-encoded width put cross-team-review at MIN_RIBBON_
 * WIDTH=10, an invisibly thin line at the convergence point. Fix: switch to
 * constraint-only pinch register (matching n4-toc-baseline et al.) — the
 * wineglass pinch wedge + rose-tint plateau make the constraint shape
 * immediately legible.
 *
 * Latency choices (kept for simulation throughput tuning):
 *   - cross-team-review: latency 2.0, capacity 1  ← THE CONSTRAINT
 *   - design-review:     1.0
 *   - design, architecture, build-platform: mid throughputs
 *   - everything else: high throughputs
 *
 * Visual register inherits the locked N4 style:
 *   - ribbonColor wheat, pinch fills rose-tinted via per-segment computeWidth
 *   - inkWobble on, fenceMarkers on, no legend strip
 *
 * ── Fork/merge declarations history (bd ai-engineer-gv8u, 2026-05-19) ──────
 *
 * The original fork declaration anchored the off-canvas-`_start` lane-start
 * labels back inside the viewBox. With `_start` retired the lane starts are
 * real on-canvas source nodes, so their labels anchor at the node directly —
 * the fork-root label hack is no longer needed. The `merges` declaration is
 * still load-bearing for pre-merge label placement (anchors build-* labels at
 * 20% to keep them off the convergence wedge).
 */

export default {
  // viewBox no longer needs the x=-300..-700 off-canvas `_start` coverage.
  // Leftmost content is now the `discovery` source label (labelX=20); a small
  // negative origin gives that label clearance. Right edge unchanged at 1750
  // (change-board at x=1550 + post-constraint plateau).
  viewBox: { x: -80, y: 0, w: 1830, h: 900 },
  baseSpeed: 200,

  // Pre-fill only (true-emitter model, bd ai-engineer-2igc): one agent is
  // seeded in-process per source, the rest pending and distributed across the
  // three sources by rate. Sources then emit continuously at their own rate.
  initialAgents: 12,

  // ── locked-v2 visual register (inherited from N4) ────────────────────────
  pinchMode: 'constraint-only',
  ribbonColor:    '#e8d8b0',       // --flow-band warm wheat
  pinchFillColor: '#e6c8c8',       // --pinch-rose dusty rose
  constraintFillColor: '#d8a8a8',  // --constraint-rose deeper rose
  inkWobble: true,                 // feTurbulence draftsman's-hand filter
  fenceMarkers: true,              // paired vertical tick-marks at segment bounds
  bandWidth: 70,
  constraintWidth: 28,
  constraintPlateauWidth: 260,
  showLegend: false,               // mockup has no Minard legend strip
  stageAnchors: true,

  // ── First-class merges (bd ai-engineer-gv8u) ────────────────────────────
  // The three lanes converge on cross-team-review. No `forks` — the three
  // lane starts are independent sources, not a split of one node's inflow.
  merges: [
    {
      to: 'cross-team-review',
      from: ['build-feature', 'build-bug', 'build-platform'],
    },
  ],

  nodes: [
    // ── Top lane (y=180) — source: discovery ──────────────────────────────
    // `discovery` is now a real on-canvas source node. rate ~0.33/s — one
    // third of the ~1.0/s aggregate the `_start` round-robin used to produce.
    { id: 'discovery', x: 200, y: 180, label: 'discovery',
      kind: 'source', rate: 0.34,
      capacity: 2, latency: 0.6,
      labelX: 20, labelDx: 0, labelDy: -60,
      successors: ['design'] },

    { id: 'design', x: 380, y: 180, label: 'design',
      capacity: 2, latency: 0.8,
      labelX: 280, labelDx: 0, labelDy: -60,
      successors: ['design-review'] },

    { id: 'design-review', x: 560, y: 180, label: 'design review',
      capacity: 2, latency: 1.0,
      labelX: 540, labelDx: 0, labelDy: -60,
      successors: ['build-feature'] },

    { id: 'build-feature', x: 760, y: 180, label: 'build · feature',
      capacity: 12, latency: 0.6,
      labelX: 820, labelDx: 0, labelDy: -60,
      successors: ['cross-team-review'] },

    // ── Middle lane (y=450) — source: triage ──────────────────────────────
    { id: 'triage', x: 200, y: 450, label: 'triage',
      kind: 'source', rate: 0.33,
      capacity: 2, latency: 0.5,
      labelX: 80, labelDx: 0, labelDy: -60,
      successors: ['build-bug'] },

    { id: 'build-bug', x: 540, y: 450, label: 'build · bug',
      capacity: 12, latency: 0.5,
      labelX: 700, labelDx: 0, labelDy: -60,
      successors: ['cross-team-review'] },

    // ── Bottom lane (y=720) — source: architecture ────────────────────────
    { id: 'architecture', x: 240, y: 720, label: 'architecture',
      kind: 'source', rate: 0.33,
      capacity: 2, latency: 0.8,
      labelX: 80, labelDx: 0, labelDy: 60,
      successors: ['build-platform'] },

    { id: 'build-platform', x: 540, y: 720, label: 'build · platform',
      capacity: 12, latency: 0.7,
      labelX: 700, labelDx: 0, labelDy: 60,
      successors: ['cross-team-review'] },

    // ── Constraint (convergence point) ────────────────────────────────────
    { id: 'cross-team-review', x: 1100, y: 450, label: 'cross-team review',
      capacity: 1, latency: 2.0, kind: 'constraint',
      labelDx: 0, labelDy: -60,
      successors: ['change-board'] },

    // ── Downstream (post-constraint) ──────────────────────────────────────
    { id: 'change-board', x: 1550, y: 450, label: 'change board',
      capacity: 4, latency: 0.5,
      labelDx: 0, labelDy: -60,
      successors: [] },
  ],
}
