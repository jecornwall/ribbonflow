/**
 * n4-toc-baseline.js — N4 LOCKED-V2 linear flow (visuals.md §3.0.3.LOCKED-V2).
 *
 * Per Jason's 2026-05-17 confirmation: N4 is a single horizontal flow band,
 * intake → solution-design → implementation → test → ship. No fork. The
 * fork-merge topology lives in n9-multilane.js as the COMPLEX test case;
 * iter-1 fork-merge variants (n4-flow-a.js, n4-flow-b.js) are retained
 * unchanged as historical aesthetic candidates.
 *
 * Locked reference: assets/mockups/n4-simulation/09-pinch-jason-curved.png.
 *
 * pinchMode: 'constraint-only' — flowCurve.buildPinchWidthFn(...) produces
 * a smooth wineglass-on-its-side profile rather than the throughput-encoded
 * step function used by older flows. Band width plateau at 70 units;
 * narrows to 22 at the constraint via mirror cubic-Hermite S-curves; opens
 * back to 70 downstream.
 *
 * Labels are lowercase per the spec. talk-presenter governs the canonical
 * label set — these may move to "review" or "implementation" or another
 * term without changing the topology.
 *
 * initialAgents — 24 seeded; pending-agent promotion (useFlowSimulation.js)
 * recycles them as the entry frees so the on-screen population stays
 * continuously busy.
 */

export default {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  entryId: 'problem-definition',
  initialAgents: 24,

  // Rate-calibrated spawn (bead ai-engineer-a1m). Previous rate of 1.5/s was
  // 2.4× the constraint throughput (1/1.6 ≈ 0.625/s), causing the backlog in
  // solution-design to grow unboundedly — by t=30s the upstream was clearly
  // overcrowded, overwhelming the visual argument. Tuned to 1.0/s:
  //   - 1.0/s is 1.6× constraint throughput, producing a visible queue at the
  //     constraint while remaining more bounded than the old 1.5/s.
  //   - The constraint (drum) is still visibly the pacemaker; the upstream
  //     buffer is visible — Goldratt's drum-buffer-rope readable.
  //   - The wake-race fix (a1m; nodesWithExitsThisStep in useFlowSimulation.js)
  //     ensures queue agents wake every ~2s (one constraint-cycle) rather than
  //     staying frozen for N × 2s, keeping max continuous freeze < 5s.
  spawnRate: 1.0,

  // ── locked-v2 visual register ────────────────────────────────────────────
  pinchMode: 'constraint-only',   // smooth pinch around constraint; not throughput-encoded
  ribbonColor:    '#e8d8b0',       // --flow-band warm wheat
  pinchFillColor: '#e6c8c8',       // --pinch-rose dusty rose
  constraintFillColor: '#d8a8a8',  // --constraint-rose deeper rose
  inkWobble: true,                 // apply feTurbulence draftsman's-hand filter
  fenceMarkers: true,              // paired vertical tick-marks rather than tangent-perpendicular
  // Equal-stage horizontal widths (bead ai-engineer-dbg).
  // Default latency-distributed segmentation gave implementation (latency=1.6
  // of total 4.2) ~38% of horizontal arc — nearly double the 20% equal share.
  // constraintPlateauWidth=80 centers a fixed 80-unit plateau on the
  // implementation anchor (x=830) with 0.45-fraction transitions (36 units
  // each side). Total narrow region ≈ 152/1200 ≈ 13% — each stage visually
  // reads as ~20% of horizontal width. The geometric-correctness invariant
  // is preserved: implementation anchor at ~52.5% of arc is well within the
  // latency-distributed label segment [33.3%, 71.4%].
  constraintPlateauWidth: 80,
  // bd ai-engineer-b57i: N3 (the canonical idealised factory) drops the
  // station-box chrome in favour of vertical hairline segment dividers
  // (segmentDividers: true below). Per Jason 2026-05-18 screenshot
  // feedback on slide /4: "Don't like the squares · segment the pipes
  // with some vertical lines instead · center the label over the segment".
  // The boxes drew attention to themselves (cartoon-box outlines, visible
  // skew) and offset the labels from the segment midpoints — segments now
  // read as Tufte-minimalist marks at boundary positions, labels centre
  // cleanly above each segment's arc midpoint. N4/N5/N6 (year-walk) and
  // N7 still need their own showBoxes call — this baseline is used by
  // N3 directly (slide line 154), so the change applies to N3.
  showBoxes: false,
  // Vertical hairline ticks at INTERIOR segment boundaries (i.e. between
  // problem-definition / solution-design, solution-design / implementation,
  // implementation / test, test / ship). The open ends of the ribbon get
  // no divider. Renders at viewBox-y spanning the local band width with a
  // 4-unit margin above/below for visibility. Hairline 0.8px, mid-grey
  // #555 — marginalia weight, not figure weight.
  segmentDividers: true,
  bandWidth: 70,                   // full-width plateau
  constraintWidth: 22,             // constraint-segment plateau
  showLegend: false,               // mockup has no Minard legend strip

  // Five linear nodes, evenly spaced left-to-right at y=450.
  //
  // Capacities (bead ai-engineer-9nw): the constraint stage holds 1 — that
  // is the "one-at-a-time release behaviour" the locked spec calls for. The
  // immediate-upstream stage `solution-design` holds a large reservoir so
  // the hex-packing physics (rigid contact + rightward gravity) actually
  // has somewhere to PILE the backlog. Without that, every upstream stage's
  // cap=1 would force agents back to pending (off-canvas) when the
  // constraint blocks — visually identical to "no backlog".
  //
  // Latencies stay tuned so implementation is unambiguously the slowest
  // throughput (0.625 vs 1.25–67 for the others); the constraint stays
  // the narrowest band under both the pinch-mode and throughput-encoded
  // width functions.
  nodes: [
    { id: 'problem-definition', x:  200, y: 450, label: 'problem definition',
      capacity: 4, latency: 0.6,
      labelDx: 0, labelDy: -100,
      successors: ['solution-design'] },

    { id: 'solution-design', x:  530, y: 450, label: 'solution design',
      capacity: 30, latency: 0.8,
      labelDx: 0, labelDy: -100,
      successors: ['implementation'] },

    { id: 'implementation', x:  830, y: 450, label: 'implementation',
      capacity: 1, latency: 1.6, kind: 'constraint',
      labelDx: 0, labelDy: -100,
      successors: ['test'] },

    { id: 'test', x: 1130, y: 450, label: 'test',
      capacity: 4, latency: 0.7,
      labelDx: 0, labelDy: -100,
      successors: ['ship'] },

    { id: 'ship', x: 1400, y: 450, label: 'ship',
      capacity: 4, latency: 0.5,
      labelDx: 0, labelDy: -100,
      successors: [] },
  ],
}
