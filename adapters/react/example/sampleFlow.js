// A minimal two-node flow + a swapped variant (third node) to exercise update().
export const before = {
  viewBox: { w: 1600, h: 900 }, entryId: 'a', spawnRate: 1, initialAgents: 8,
  nodes: [
    { id: 'a', x: 200, y: 450, label: 'start', capacity: 1, latency: 0.6, successors: ['b'] },
    { id: 'b', x: 1200, y: 450, label: 'end', capacity: 1, latency: 0.6, successors: [] },
  ],
}
export const after = {
  ...before,
  nodes: [
    { id: 'a', x: 200, y: 450, label: 'start', capacity: 1, latency: 0.6, successors: ['b'] },
    { id: 'b', x: 760, y: 450, label: 'mid', capacity: 1, latency: 0.6, successors: ['c'] },
    { id: 'c', x: 1300, y: 450, label: 'end', capacity: 1, latency: 0.6, successors: [] },
  ],
}
