/**
 * n9-multilane.v1.js — a FROZEN flow-format **version 1** fixture.
 *
 * This is the pre-M2 shape of the n9-multilane flow, kept verbatim as a
 * migration-machinery test sample. The live `n9-multilane.js` fixture was
 * re-authored to v2 (three real `kind:'source'` nodes — bd ai-engineer-dxgu,
 * M2 §5.1) and is no longer a valid v1 input, so the v1→v2→v3 migration
 * tests (migrate.test.js, normalizeFlowInput.test.js) import THIS file
 * instead.
 *
 * It exercises every v1→v2 migration step:
 *   - `entryId` + `spawnRate` → a `kind:'source'` node with a `rate`
 *   - `forks[].branches` string[] → `{ to, rateShare }[]` (even default)
 *   - `merges[].branches` → `merges[].from`
 *   - the off-canvas `_start` round-robin entry node
 *
 * DO NOT re-author this fixture. It is a frozen historical artefact.
 */

export default {
  viewBox: { x: -300, y: 0, w: 2050, h: 900 },
  baseSpeed: 200,
  entryId: '_start',
  initialAgents: 35,
  spawnRate: 1.0,

  pinchMode: 'constraint-only',
  ribbonColor:    '#e8d8b0',
  pinchFillColor: '#e6c8c8',
  constraintFillColor: '#d8a8a8',
  inkWobble: true,
  fenceMarkers: true,
  bandWidth: 70,
  constraintWidth: 28,
  constraintPlateauWidth: 260,
  showLegend: false,
  stageAnchors: true,

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
    { id: '_start', x: -700, y: 450, label: '',
      capacity: 5, latency: 0.01,
      successors: ['discovery', 'triage', 'architecture'] },

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

    { id: 'triage', x: 200, y: 450, label: 'triage',
      capacity: 2, latency: 0.5,
      labelX: 80, labelDx: 0, labelDy: -60,
      successors: ['build-bug'] },

    { id: 'build-bug', x: 540, y: 450, label: 'build · bug',
      capacity: 12, latency: 0.5,
      labelX: 700, labelDx: 0, labelDy: -60,
      successors: ['cross-team-review'] },

    { id: 'architecture', x: 240, y: 720, label: 'architecture',
      capacity: 2, latency: 0.8,
      labelX: 80, labelDx: 0, labelDy: 60,
      successors: ['build-platform'] },

    { id: 'build-platform', x: 540, y: 720, label: 'build · platform',
      capacity: 12, latency: 0.7,
      labelX: 700, labelDx: 0, labelDy: 60,
      successors: ['cross-team-review'] },

    { id: 'cross-team-review', x: 1100, y: 450, label: 'cross-team review',
      capacity: 1, latency: 2.0, kind: 'constraint',
      labelDx: 0, labelDy: -60,
      successors: ['change-board'] },

    { id: 'change-board', x: 1550, y: 450, label: 'change board',
      capacity: 4, latency: 0.5,
      labelDx: 0, labelDy: -60,
      successors: [] },
  ],
}
