/**
 * The starter flow the designer opens with — a small linear v2 flow:
 *
 *   intake (source) ──→ design ──→ build (constraint) ──→ ship
 *
 * It exercises every M3 editing surface out of the box: a source node with a
 * rate, a constraint node, labels placed above, and the coupled width mode.
 * Returns a FRESH object each call so the designer can "new document" cleanly.
 */
export function makeSampleFlow() {
  return {
    viewBox: { x: 0, y: 0, w: 1600, h: 900 },
    baseSpeed: 200,
    initialAgents: 6,
    widthMode: 'coupled',
    pinchPreset: 'constraint-pinch',
    forks: [],
    merges: [],
    nodes: [
      {
        id: 'intake', x: 240, y: 450, label: 'intake',
        kind: 'source', rate: 1.0,
        capacity: 6, latency: 0.6,
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: ['design'],
      },
      {
        id: 'design', x: 620, y: 450, label: 'design',
        kind: 'normal',
        capacity: 8, latency: 0.8,
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: ['build'],
      },
      {
        id: 'build', x: 1000, y: 450, label: 'build',
        kind: 'constraint', constraintKind: 'pinch',
        capacity: 1, latency: 1.6,
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: ['ship'],
      },
      {
        id: 'ship', x: 1360, y: 450, label: 'ship',
        kind: 'normal',
        capacity: 4, latency: 0.5,
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: [],
      },
    ],
  }
}
