/**
 * v12-rejections.v4.js — a flow-format **version 4** fixture exercising the
 * v1.2 rejection-edge model (bead ai-engineer-086t / R1 — see
 * docs/superpowers/specs/2026-05-20-flow-v1.2-rejection-edges-design.md).
 *
 * Used by the round-trip tests to prove the hard losslessness invariant for the
 * v4 `flow.rejections[]` array and every nested field.
 *
 * Topology — a linear pipeline with a review step that rejects work back to
 * two earlier nodes:
 *
 *   intake (source) → design → build → review (narrow+red) → ship
 *                       ↖__________________╱  rejection: review → design
 *                                ↖_________╱  rejection: review → build
 *
 * Covers, vs the v3 model:
 *   - the new top-level `rejections[]` array
 *   - per-edge `from` / `to` / `rate`
 *   - the nested `bow` object: `side` (both 'above' and 'below') + `depth`
 *
 * NOTE: this fixture sets every field *explicitly* (no reliance on defaults) so
 * the round-trip test asserts byte-faithful losslessness. Default-filling is
 * `normalizeFlow()`'s job — tested in model.test.js.
 */

export default {
  viewBox: { x: 0, y: 0, w: 1600, h: 900 },
  baseSpeed: 200,
  initialAgents: 6,

  forks: [],
  merges: [],

  // v1.2 — rejection edges: failed-review work travelling back upstream.
  rejections: [
    { from: 'review', to: 'design', rate: 0.15, bow: { side: 'below', depth: 90 } },
    { from: 'review', to: 'build', rate: 0.1, bow: { side: 'above', depth: 70 } },
  ],

  nodes: [
    { id: 'intake', x: 200, y: 450, label: 'intake',
      kind: 'source', rate: 1.0,
      length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['design'] },

    { id: 'design', x: 520, y: 450, label: 'design',
      kind: 'normal',
      length: 1.0, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['build'] },

    { id: 'build', x: 840, y: 450, label: 'build',
      kind: 'normal',
      length: 1.2, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['review'] },

    // Narrow + slow + red — a review step that reads as a constraint.
    { id: 'review', x: 1160, y: 450, label: 'review',
      kind: 'normal',
      length: 1.5, speed: 0.7, width: 44, coupleSpeedWidth: true,
      colorScheme: 'red',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['ship'] },

    { id: 'ship', x: 1440, y: 450, label: 'ship',
      kind: 'normal',
      length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'green',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: [] },
  ],
}
