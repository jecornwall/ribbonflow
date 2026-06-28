// flow/library/src/render/agentsLayer.js
/**
 * agentsLayer.js — pure agent-layer mapping + per-frame keyed diff.
 *
 * agentsView(sim) (from buildFlowScene) yields {id,x,y,r,fill}[] where fill:null
 * means "renderer default cream". This module maps a row to a circle spec and
 * computes the minimal add/move/remove ops between the previous frame's agents
 * and the next, so mountFlow mutates only what changed rather than rebuilding
 * the agents group. No DOM. Provenance: FlowAgent.vue + the null-fill sentinel
 * documented in the Phase 1 buildFlowScene review.
 */

/** Cream — the default particle colour (FlowAgent.vue:17, contrast vs ink ribbon). */
export const AGENT_DEFAULT_FILL = '#F4F2ED'

/**
 * Element-spec for one agent circle. `fill:null` resolves to the cream default.
 * @param {{id:string|number,x:number,y:number,r:number,fill:string|null}} a
 */
export function agentCircleSpec(a) {
  return {
    tag: 'circle',
    attrs: {
      cx: a.x, cy: a.y, r: a.r,
      fill: a.fill === null || a.fill === undefined ? AGENT_DEFAULT_FILL : a.fill,
      'data-agent-id': a.id,
      stroke: 'none',
      'shape-rendering': 'geometricPrecision',
    },
  }
}

/**
 * Diff the previous frame's agents (Map id→view) against the next view list.
 * Returns { adds, moves, removes }:
 *   adds    — view rows present in next but not prev (create a circle)
 *   moves   — view rows present in both whose x/y/r OR fill changed (fill is
 *             treated as a move so revising/defective colour transitions repaint
 *             each frame)
 *   removes — ids present in prev but not next (remove the circle)
 *
 * @param {Map<string|number, object>} prevById
 * @param {object[]} nextView
 */
export function reconcileAgents(prevById, nextView) {
  const adds = []
  const moves = []
  const nextIds = new Set()
  for (const a of nextView) {
    nextIds.add(a.id)
    const prev = prevById.get(a.id)
    if (!prev) {
      adds.push(a)
    } else if (prev.x !== a.x || prev.y !== a.y || prev.r !== a.r || prev.fill !== a.fill) {
      moves.push(a)
    }
  }
  const removes = []
  for (const id of prevById.keys()) {
    if (!nextIds.has(id)) removes.push(id)
  }
  return { adds, moves, removes }
}
