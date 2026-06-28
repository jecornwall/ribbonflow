/**
 * m2-coverage.v2.js — a flow-format **version 2** fixture that exercises every
 * field the M2 data-model evolution introduced. Used by the round-trip tests
 * to prove the hard losslessness invariant for the new model.
 *
 * Topology — two real source nodes, a rate-split fork, a merge, a constraint:
 *
 *   frontend intake (source, rate 0.6) ┐
 *                                       ├→ intake ──┬→ fast lane ┐
 *   backend intake  (source, rate 0.4) ┘            └→ slow lane ┘→ review → ship
 *
 * Covers, vs M1's v1 model:
 *   - kind:'source' nodes (TWO of them — real multi-source, no `_start` hack)
 *   - per-source `rate`
 *   - first-class `forks` with per-branch `rateShare`
 *   - first-class `merges` with `from`
 *   - `widthMode`
 *   - per-node `width` override
 *   - `pinchPreset`
 *   - `constraintKind` on the constraint node
 *
 * NOTE: this fixture sets fields *explicitly* (no reliance on defaults) so the
 * round-trip test asserts byte-faithful losslessness. Default-filling is
 * `normalizeFlow()`'s job and is tested separately in model.test.js.
 */

export default {
  viewBox: { x: 0, y: 0, w: 1600, h: 900 },
  baseSpeed: 200,
  initialAgents: 20,

  // ── M2: width/rate coupling ──────────────────────────────────────────────
  widthMode: 'coupled',

  // ── M2: register knobs / pinch preset ────────────────────────────────────
  pinchPreset: 'constraint-pinch',
  // explicit flat register overrides — an explicit field beats the preset
  ribbonColor: '#e8d8b0',
  pinchMode: 'constraint-only',
  pinchFillColor: '#e6c8c8',
  constraintFillColor: '#d8a8a8',
  bandWidth: 70,
  constraintWidth: 22,
  constraintPlateauWidth: 80,
  inkWobble: true,
  fenceMarkers: true,
  showLegend: false,

  // ── M2: first-class forks (carry the rate split) ─────────────────────────
  forks: [
    {
      from: 'intake',
      branches: [
        { to: 'lane-fast', rateShare: 0.7 },
        { to: 'lane-slow', rateShare: 0.3 },
      ],
    },
  ],

  // ── M2: first-class merges ───────────────────────────────────────────────
  merges: [
    { to: 'review', from: ['lane-fast', 'lane-slow'] },
  ],

  nodes: [
    // ── Two real source nodes, each with its own emit rate ─────────────────
    { id: 'src-frontend', x: 120, y: 300, label: 'frontend intake',
      kind: 'source', rate: 0.6,
      capacity: 4, latency: 0.5, width: 56,
      labelDx: 0, labelDy: -90, successors: ['intake'] },

    { id: 'src-backend', x: 120, y: 600, label: 'backend intake',
      kind: 'source', rate: 0.4,
      capacity: 4, latency: 0.5, width: 44,
      labelDx: 0, labelDy: 90, successors: ['intake'] },

    // ── Fork root ──────────────────────────────────────────────────────────
    { id: 'intake', x: 440, y: 450, label: 'intake',
      capacity: 6, latency: 0.6, width: 70,
      labelDx: 0, labelDy: -90, successors: ['lane-fast', 'lane-slow'] },

    // ── Two lanes ──────────────────────────────────────────────────────────
    { id: 'lane-fast', x: 780, y: 320, label: 'fast lane',
      capacity: 8, latency: 0.5, width: 50,
      labelDx: 0, labelDy: -90, successors: ['review'] },

    { id: 'lane-slow', x: 780, y: 580, label: 'slow lane',
      capacity: 8, latency: 0.9, width: 30,
      labelDx: 0, labelDy: 90, successors: ['review'] },

    // ── Constraint (merge point) ───────────────────────────────────────────
    { id: 'review', x: 1140, y: 450, label: 'review',
      kind: 'constraint', constraintKind: 'pinch',
      capacity: 1, latency: 2.0, width: 22,
      labelDx: 0, labelDy: -90, successors: ['ship'] },

    // ── Sink ───────────────────────────────────────────────────────────────
    { id: 'ship', x: 1440, y: 450, label: 'ship',
      capacity: 4, latency: 0.4, width: 70,
      labelDx: 0, labelDy: -90, successors: [] },
  ],
}
