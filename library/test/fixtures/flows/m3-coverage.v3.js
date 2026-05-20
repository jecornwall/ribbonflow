/**
 * m3-coverage.v3.js — a flow-format **version 3** fixture exercising every
 * field the v1.1 node-controls rework introduced (beads ai-engineer-t0c8 /
 * wec5 — see docs/superpowers/specs/2026-05-20-flow-v1.1-node-controls-design.md).
 * Used by the round-trip tests to prove the hard losslessness invariant for the
 * v3 model.
 *
 * Topology — a source, a rate-split fork, a merge, and a narrow/slow node that
 * reads as a constraint purely from its low speed/width + red colour scheme:
 *
 *   intake (source) ──┬→ fast lane ┐
 *                     └→ slow lane ┘→ review (narrow+red) → ship (green)
 *
 * Covers, vs the v2 model:
 *   - the three node controls: `length`, `speed`, `width`
 *   - `coupleSpeedWidth` (set both true and false)
 *   - `colorScheme` (all three: red / neutral / green)
 *   - NO `kind:'constraint'`, NO `capacity` / `latency` / `constraintKind`
 *   - NO `widthMode` / pinch register knobs
 *
 * NOTE: this fixture sets fields *explicitly* (no reliance on defaults) so the
 * round-trip test asserts byte-faithful losslessness. Default-filling and
 * engine-field derivation are `normalizeFlow()`'s job — tested in model.test.js.
 */

export default {
  viewBox: { x: 0, y: 0, w: 1600, h: 900 },
  baseSpeed: 200,
  initialAgents: 12,

  // First-class forks / merges are unchanged by v1.1.
  forks: [
    {
      from: 'intake',
      branches: [
        { to: 'lane-fast', rateShare: 0.6 },
        { to: 'lane-slow', rateShare: 0.4 },
      ],
    },
  ],
  merges: [
    { to: 'review', from: ['lane-fast', 'lane-slow'] },
  ],

  nodes: [
    { id: 'intake', x: 240, y: 450, label: 'intake',
      kind: 'source', rate: 1.0,
      length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['lane-fast', 'lane-slow'] },

    { id: 'lane-fast', x: 680, y: 320, label: 'fast lane',
      kind: 'normal',
      length: 0.7, speed: 1.4, width: 96, coupleSpeedWidth: true,
      colorScheme: 'green',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['review'] },

    { id: 'lane-slow', x: 680, y: 580, label: 'slow lane',
      kind: 'normal',
      length: 1.3, speed: 0.7, width: 44, coupleSpeedWidth: false,
      colorScheme: 'neutral',
      labelSide: 'below', labelDx: 0, labelDy: 70,
      successors: ['review'] },

    // Narrow + slow + red — a constraint without a constraint *type*.
    { id: 'review', x: 1080, y: 450, label: 'review',
      kind: 'normal',
      length: 1.5, speed: 0.4, width: 30, coupleSpeedWidth: true,
      colorScheme: 'red',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['ship'] },

    { id: 'ship', x: 1420, y: 450, label: 'ship',
      kind: 'normal',
      length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'green',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: [] },
  ],
}
