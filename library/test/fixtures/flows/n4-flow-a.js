/**
 * n4-flow-a.js — N4 variant A: flat horizontal layout.
 *
 * Design intent: "early diagram" aesthetic (2026-05-17 iter-1 variant A).
 * - Fully straight horizontal runs; minimal fork vertical offset (130px)
 * - Station boxes at node positions (flow.showBoxes = true)
 * - Straight vertical leader lines (flow.verticalLeaders = true)
 * - Lowercase labels
 *
 * The fork/merge Y-spread is intentionally tight (build at y=320,
 * test-prep at y=580 around the y=450 centre line) so the two branches
 * read as nearly parallel horizontal lanes rather than a tall "eye".
 * This flattens the Catmull-Rom curve almost to straight lines.
 *
 * Label offsets: only dy is used when verticalLeaders=true (dx is ignored).
 *   - Nodes on the upper half: dy=-90 (label sits above)
 *   - test-prep: dy=+90 (label sits below to avoid collision with build)
 */

export default {
  viewBox: { w: 1600, h: 900 },
  baseSpeed: 200,
  entryId: 'intake',
  initialAgents: 24,

  // early-diagram flags
  showBoxes: true,
  verticalLeaders: true,

  nodes: [
    { id: 'intake',    x:  150, y: 450, label: 'intake',
      capacity: 1, latency: 0.6,
      labelDx: 0, labelDy: -90,
      successors: ['design'] },

    { id: 'design',    x:  430, y: 450, label: 'design',
      capacity: 1, latency: 0.8,
      labelDx: 0, labelDy: -90,
      successors: ['build', 'test-prep'] },

    { id: 'build',     x:  740, y: 320, label: 'build',
      capacity: 1, latency: 0.9,
      labelDx: 0, labelDy: -90,
      successors: ['review'] },

    { id: 'test-prep', x:  740, y: 580, label: 'test prep',
      capacity: 1, latency: 0.5,
      labelDx: 0, labelDy: 90,
      successors: ['review'] },

    { id: 'review',    x: 1060, y: 450, label: 'review',
      capacity: 1, latency: 1.4, kind: 'constraint',
      labelDx: 0, labelDy: -90,
      successors: ['ship'],
      reviseTo: 'design', reviseProb: 0.15 },

    { id: 'ship',      x: 1350, y: 450, label: 'ship',
      capacity: 1, latency: 0.4,
      labelDx: 0, labelDy: -90,
      successors: [] },
  ],
}
