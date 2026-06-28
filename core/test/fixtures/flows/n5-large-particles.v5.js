/**
 * n5-large-particles.v5.js — a flow-format **version 5** fixture exercising the
 * v1.3 L2 large-particle model (bead ai-engineer-otci — see
 * docs/superpowers/specs/2026-05-20-flow-v1.3-large-particles-design.md §2/§6).
 *
 * Used by the round-trip tests to prove the hard losslessness invariant for the
 * v5 fields: `source.particleSize`, `node.transform`, `splitCount`,
 * `combineCount`.
 *
 * Topology — a decompose / recompose pipeline. A large-particle source (an
 * "epic") and a small-particle source ("tickets") merge into a triage node;
 * a split node decomposes the epic into small tasks; a combine node
 * recomposes small tasks into one large unit before ship:
 *
 *   epic    (source, large) ┐
 *                            ├→ triage → decompose (split×3) → assemble
 *   tickets (source, small) ┘                                      │
 *                                          ship ← integrate (combine×5) ←┘
 *
 * Covers, vs the v4 model:
 *   - `source.particleSize`: both 'large' and 'small' set explicitly
 *   - `node.transform`: 'none', 'split', and 'combine'
 *   - `splitCount` on the split node (non-default 3)
 *   - `combineCount` on the combine node (non-default 5)
 *
 * NOTE: this fixture sets every field *explicitly* (no reliance on defaults) so
 * the round-trip test asserts byte-faithful losslessness. Default-filling is
 * `normalizeFlow()`'s job — tested in model.test.js.
 */

export default {
  viewBox: { x: 0, y: 0, w: 1600, h: 900 },
  baseSpeed: 200,
  initialAgents: 4,

  forks: [],
  merges: [
    { to: 'triage', from: ['epic', 'tickets'] },
  ],
  rejections: [],

  nodes: [
    { id: 'epic', x: 200, y: 320, label: 'epic',
      kind: 'source', rate: 0.5, particleSize: 'large', transform: 'none',
      length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['triage'] },

    { id: 'tickets', x: 200, y: 580, label: 'tickets',
      kind: 'source', rate: 1.0, particleSize: 'small', transform: 'none',
      length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'below', labelDx: 0, labelDy: 70,
      successors: ['triage'] },

    { id: 'triage', x: 520, y: 450, label: 'triage',
      kind: 'normal', transform: 'none',
      length: 1.0, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['decompose'] },

    // Split node — turns one large particle into splitCount small ones.
    { id: 'decompose', x: 820, y: 450, label: 'decompose',
      kind: 'normal', transform: 'split', splitCount: 3,
      length: 1.2, speed: 1.0, width: 80, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['assemble'] },

    { id: 'assemble', x: 1100, y: 450, label: 'assemble',
      kind: 'normal', transform: 'none',
      length: 1.0, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'neutral',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['integrate'] },

    // Combine node — accumulates combineCount small particles, fires one large.
    { id: 'integrate', x: 1340, y: 450, label: 'integrate',
      kind: 'normal', transform: 'combine', combineCount: 5,
      length: 1.2, speed: 1.0, width: 90, coupleSpeedWidth: true,
      colorScheme: 'green',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: ['ship'] },

    { id: 'ship', x: 1500, y: 450, label: 'ship',
      kind: 'normal', transform: 'none',
      length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
      colorScheme: 'green',
      labelSide: 'above', labelDx: 0, labelDy: -70,
      successors: [] },
  ],
}
