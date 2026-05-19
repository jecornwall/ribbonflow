/**
 * n4-flow-b.js — N4 variant B: straight with soft elbows.
 *
 * Design intent: "early diagram" aesthetic (2026-05-17 iter-1 variant B).
 * - Wider fork vertical spread than A (build y=270, test-prep y=630)
 *   so the two branches are more clearly separated visually
 * - Station boxes at node positions (flow.showBoxes = true)
 * - Straight vertical leader lines (flow.verticalLeaders = true)
 * - Lowercase labels
 * - design and review nodes have a slight y-offset (y=440) to add gentle
 *   shoulder curves at the fork and merge — the "soft elbow" effect
 *
 * This layout emphasises the parallel-lane structure more than A while
 * still reading as an orderly left-to-right flow.
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
    { id: 'intake',    x:  140, y: 450, label: 'intake',
      capacity: 1, latency: 0.6,
      labelDx: 0, labelDy: -90,
      successors: ['design'] },

    { id: 'design',    x:  430, y: 440, label: 'design',
      capacity: 1, latency: 0.8,
      labelDx: 0, labelDy: -90,
      successors: ['build', 'test-prep'] },

    { id: 'build',     x:  760, y: 270, label: 'build',
      capacity: 1, latency: 0.9,
      labelDx: 0, labelDy: -90,
      successors: ['review'] },

    { id: 'test-prep', x:  760, y: 630, label: 'test prep',
      capacity: 1, latency: 0.5,
      labelDx: 0, labelDy: 90,
      successors: ['review'] },

    { id: 'review',    x: 1080, y: 440, label: 'review',
      capacity: 1, latency: 1.4, kind: 'constraint',
      labelDx: 0, labelDy: -90,
      successors: ['ship'],
      reviseTo: 'design', reviseProb: 0.15 },

    { id: 'ship',      x: 1380, y: 450, label: 'ship',
      capacity: 1, latency: 0.4,
      labelDx: 0, labelDy: -90,
      successors: [] },
  ],
}
