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
 * Three independent lanes, no shared root in the visible band. To fit the
 * single-entryId data model the lanes share an off-canvas `_start` node at
 * x=-300 that round-robins into the three lane starts. The `_start` segment
 * is outside the viewBox (viewBox.x = 0) and is clipped out of the visible
 * frame; the audience reads three independent lanes.
 *
 * Width register: PINCH (pinchMode: 'constraint-only').
 *
 * Previously throughput-encoded (per visuals.md §3.0.5.LOCKED-V2 first draft).
 * Per bd ai-engineer-els9 (Jason 2026-05-18 screenshot feedback on slide /8):
 * "Missing bottleneck shape. Cross-team review bottleneck isn't obvious."
 *
 * Diagnosis: throughput-encoded width put cross-team-review at MIN_RIBBON_
 * WIDTH=10, which on the converging-lanes topology read as an invisibly
 * thin line at the convergence point — not a recognizable BOTTLENECK
 * SHAPE. The constraint label was firebrick but the geometry didn't
 * announce "this is the constraint" to a reader who didn't already know.
 *
 * Fix: switch to constraint-only pinch register (matching n4-toc-baseline,
 * n4-year-walk, n17-build-and-test-*, n17-review-turnaround-*). The
 * wineglass pinch wedge + rose-tint plateau + smooth S-curve transitions
 * make the constraint shape *immediately* legible — same visual vocabulary
 * the rest of the deck uses. constraintWidth=22 (default) still gives the
 * narrowest geometry at cross-team-review, but with a recognizable
 * bottleneck-funnel shape instead of an indeterminate thin line.
 *
 * Latency choices unchanged (kept for simulation throughput tuning):
 *   - cross-team-review: 1/2.0 = 0.50  ← THE CONSTRAINT
 *   - design-review:     1/1.0 = 1.00
 *   - design, architecture, build-platform: mid throughputs (~1.25–1.43)
 *   - everything else: high throughputs
 *
 * Visual register inherits the locked N4 style:
 *   - ribbonColor wheat, pinch fills rose-tinted via per-segment computeWidth
 *   - inkWobble on, fenceMarkers on, no legend strip
 *
 * Animation: hex-pack physics (bead ai-engineer-9nw, landing in Step 3 of
 * the iter-3 dispatch) will produce visible backlog stacking at the
 * convergence pinch where all three upstream lanes feed the constraint.
 *
 * ── Fork/merge declarations (bd ai-engineer-gv8u, 2026-05-19) ─────────────
 *
 * Note on slide numbering: this flow renders on current slide N8
 * ("Enterprise — exploded view of Implementation"). The original
 * jason-feedback (bd-w9nh) labelled the slide N18/N19 — those labels
 * pre-date the xgx-renumber and refer to this same topology. The current
 * N18 is the speckit-alignment LINEAR ladder (n18-speckit-alignment-*),
 * not a fork/merge topology — no port needed there.
 *
 * The fork/merge schema is purely additive: it declares the convergence
 * structure to the renderer for LABEL-PLACEMENT purposes (FlowGraph
 * anchors fork-root labels at 85% along their segment to keep them on
 * their owning lane, and pre-merge labels at 20% to keep them off the
 * convergence wedge). Ribbon geometry is unchanged — buildBranches still
 * derives lane geometry from `successors`. Without these declarations the
 * lane-start labels (discovery, triage, architecture) were placed at the
 * midpoint of their prefix-bearing segment, which lies in the off-canvas
 * _start→lane-start span at x ≈ -180 to -220 — clipped at the viewBox
 * edge (Jason 2026-05-19: "labels scattered across canvas with crossing
 * leader lines"). With the declarations, those labels anchor at 85% of
 * the segment instead, putting them at x ≈ 80–120 — comfortably inside
 * the viewBox and visibly attached to their lane-start node.
 */

export default {
  // ViewBox expanded leftward (bd-els9): the previous viewBox.x=-40 was
  // still clipping lane-start labels because segment-midpoint label
  // placement puts the first-on-lane node's label at the geometric centre
  // of the _start→lane-start segment, which lands at x ≈ -180 to -220
  // (off-canvas with viewBox.x=-40). Probe via .tmp-labels.mjs:
  //   discovery   label x = -215.7  (clipped)
  //   triage      label x = -179.1  (clipped)
  //   architecture label x = -143.0  (only "...cture" visible — Jason's
  //                                   exact symptom in the slide /8 screenshot)
  // Shifting viewBox.x to -300 (full _start coverage) + w=1900 gives ~95px
  // clearance left of architecture's label and reveals the off-canvas
  // _start ribbon segment — which actually IMPROVES the read since the
  // ribbon now visibly fans from a single shared upstream into three
  // lanes, reinforcing "three independent lanes converging on the
  // constraint." The _start node itself has empty label so no visual
  // noise added. Right edge x=1600 unchanged (change-board at x=1380 +
  // ~220 right margin).
  // ViewBox right edge expanded 1900 → 2050 (bd ai-engineer-tgs1, 2026-05-19
   // end-of-run audit): the cross-team-review pinch + post-constraint
   // change-board section needs more horizontal extent to give the constraint
   // the visual weight the slide title ("Your bottleneck isn't coding. It's
   // coordination.") demands. See constraintPlateauWidth note + change-board
   // node x-position note for the geometry shifts.
  viewBox: { x: -300, y: 0, w: 2050, h: 900 },
  baseSpeed: 200,
  entryId: '_start',
  initialAgents: 35,

  // 1:1 source — three-lane round-robin entry at 1.0/s total, so each of the
  // top/middle/bottom lanes gets ~0.33 spawns per second (bead ai-engineer-y70).
  // Slightly slower than N4's 1.5/s because N9 has three parallel lanes
  // feeding the same constraint — at the convergence the effective arrival
  // rate is 1.0/s, comparable to the linear N4. The pending pool fills the
  // upstream lanes as their entry capacity allows.
  spawnRate: 1.0,

  // ── locked-v2 visual register (inherited from N4) ────────────────────────
  // pinchMode='constraint-only' (bd-els9): switched from throughput-encoded
  // so the constraint at cross-team-review renders as a recognizable
  // wineglass pinch wedge instead of an invisibly thin line. See header
  // note for full diagnosis.
  pinchMode: 'constraint-only',
  ribbonColor:    '#e8d8b0',       // --flow-band warm wheat
  pinchFillColor: '#e6c8c8',       // --pinch-rose dusty rose
  constraintFillColor: '#d8a8a8',  // --constraint-rose deeper rose
  inkWobble: true,                 // feTurbulence draftsman's-hand filter
  fenceMarkers: true,              // paired vertical tick-marks at segment bounds
  bandWidth: 70,
  // constraintWidth 22 → 28 (bd ai-engineer-tgs1): a 22-unit constraint at
  // bandWidth=70 read as nearly invisible at slide scale — the 30px pinch
  // failed to register as the slide's natural eye-target. Bumping to 28
  // keeps the funnel shape strongly narrow (28/70 ≈ 0.4 ratio, still a
  // dramatic pinch) while giving the constraint plateau enough vertical
  // mass to read at podium distance.
  constraintWidth: 28,
  // constraintPlateauWidth 80 → 260 (bd ai-engineer-tgs1, end-of-run audit):
  // 80 units of plateau collapsed the pinch into a momentary narrowing
  // — viewers read it as detail rather than as the focal point the slide
  // title demands. 260 units gives the constraint a substantial horizontal
  // extent (plateau spans ~x=970→1230, ramps extend to ~x=890 and x=1310);
  // the post-constraint expansion ramp then runs to change-board at x=1550.
  // The pinch now reads as the centre of gravity of the diagram.
  constraintPlateauWidth: 260,
  showLegend: false,               // mockup has no Minard legend strip

  // bd ai-engineer-m1h5 (stage-segment grammar): without per-stage anchors
  // the three lanes read as uniform wheat from anchor to merge; the
  // audience can't tell where 'design' ends and 'discovery' begins. With
  // stageAnchors, FlowGraph renders a 1.0px mid-grey hairline notch through
  // the band at each non-constraint non-_start node's xy. The notches pair
  // with the fence-post label leaders dropping from above — each named
  // stage now has an unambiguous anchor mark on its own lane. The firebrick
  // cross-team-review fence-post still dominates as the constraint signal;
  // the mid-grey notches sit underneath in the visual hierarchy.
  stageAnchors: true,

  // ── Fork/merge declarations (bd ai-engineer-gv8u) ───────────────────────
  // Tell the renderer about the multi-lane composition so labels anchor
  // sensibly: lane-start labels shift downstream (toward their node), and
  // pre-merge labels shift upstream (off the convergence wedge). Geometry
  // is unchanged; this is purely additive layout metadata.
  forks: [
    {
      from: '_start',
      branches: ['discovery', 'triage', 'architecture'],
    },
  ],
  merges: [
    {
      to: 'cross-team-review',
      branches: ['build-feature', 'build-bug', 'build-platform'],
    },
  ],

  nodes: [
    // ── Virtual entry (off-canvas fork into three lane starts) ────────────
    // Capacity 3 so all three lanes can be primed simultaneously; latency
    // 0.01s makes the _start segment instantaneous on the throughput map
    // (width gets capped to MAX_RIBBON_WIDTH=70 by the throughput formula,
    // and the segment is clipped out of viewBox anyway).
    //
    // bd-lofq (Jason 2026-05-19): _start moved from x=-300 → x=-700 so the
    // three-lane convergence happens well outside the viewBox (viewBox.x
    // starts at -300). Previously the convergence wedge was JUST inside
    // the viewBox left edge, producing a small "<"-shaped fan-from-point
    // artifact at the fork root that read as noise to the audience.
    // With the move, the three lanes appear to enter from the left edge
    // already separated, no visible origin. Combined with FlowGraph's new
    // empty-label-skip (also bd-lofq), no fence-post marker renders here.
    { id: '_start', x: -700, y: 450, label: '',
      // capacity 3 → 5: ported from deck commit d189387 (bd-lclu, 2026-05-20).
      // _start sits at x=-700, so an agent occupies its slot for ~4.7s of
      // transit; with capacity 3 the effective throughput (~0.64/s) throttled
      // below the configured spawnRate=1.0 — the round-robin test landed at 19
      // _start entries/30s, not the expected ~30. capacity 5 restores the
      // spawn accumulator as the binding gate (min(1.0, 5/4.7) = 1.0).
      capacity: 5, latency: 0.01,
      successors: ['discovery', 'triage', 'architecture'] },

    // ── Top lane (y=180) ──────────────────────────────────────────────────
    // Capacities: bumped on the immediate-upstream-of-constraint terminal
    // (`build-feature`, `build-bug`, `build-platform`) so hex-packed
    // backlog can pile up at the convergence pinch — per
    // visuals.md §3.0.5.LOCKED-V2: "hex-packed mixed-shape particles
    // immediately upstream of the constraint's left tick-mark — at the
    // convergence point where the three pinch funnels meet. ~15–20
    // particles." Without large capacity at the lane terminals, each
    // upstream cap=1 forces would-be backlog into off-canvas pending.
    //
    // bd-lofq (Jason 2026-05-19): added per-node `labelX` to distribute
    // labels across the full visible lane extent. Previously labels
    // anchored at node.x (200/380/560/760) — all in the RIGHT half of
    // the visible top lane (which extends from ~x=-200 to ~x=920 after
    // _start moved to -700). Jason: "left ~40% of lane has NO labels."
    // labelX values now spread the four top-lane labels evenly across
    // x=20 to x=820 — every quarter of the lane has its own label.
    //
    // The label-anchor is decoupled from the simulation-anchor: the
    // stage-anchor notch (segment-divider grammar) follows labelX, the
    // fence-post leader drops at labelX, and the simulation physics
    // (capacity gate, pack physics) continues to use node.x.
    { id: 'discovery', x: 200, y: 180, label: 'discovery',
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

    // ── Middle lane (y=450) ───────────────────────────────────────────────
    // labelX spread: 2 labels across the visible lane extent. Triage
    // anchors near the lane's left third (~x=80), build-bug near the
    // right third (~x=700) so the empty mid-section reads as a single
    // long "in-progress" travel zone.
    { id: 'triage', x: 200, y: 450, label: 'triage',
      capacity: 2, latency: 0.5,
      labelX: 80, labelDx: 0, labelDy: -60,
      successors: ['build-bug'] },

    { id: 'build-bug', x: 540, y: 450, label: 'build · bug',
      capacity: 12, latency: 0.5,
      labelX: 700, labelDx: 0, labelDy: -60,
      successors: ['cross-team-review'] },

    // ── Bottom lane (y=720) ───────────────────────────────────────────────
    // labelX matches the middle lane's distribution so the three lanes
    // read as visually-rhymed (top has 4 labels at 200-unit spacing,
    // middle/bottom have 2 labels at the same start/end x as top's
    // outermost two). The visual rhythm makes lane parallelism legible.
    { id: 'architecture', x: 240, y: 720, label: 'architecture',
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
    // change-board x 1380 → 1550 (bd ai-engineer-tgs1): the post-constraint
    // segment (cross-team-review at x=1100 → change-board) was only 280
    // units long, so the "the constraint releases work to change-board"
    // section barely registered. Extending to 450 units gives the
    // post-constraint expansion ramp room to widen back to bandWidth and
    // run a substantial change-board plateau — the section reads as the
    // visible payoff of getting past the pinch.
    { id: 'change-board', x: 1550, y: 450, label: 'change board',
      capacity: 4, latency: 0.5,
      labelDx: 0, labelDy: -60,
      successors: [] },
  ],
}
