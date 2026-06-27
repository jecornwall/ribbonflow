/**
 * The starter flow the designer opens with — a small linear v3 flow:
 *
 *   intake (source) ──→ design ──→ build ──→ ship
 *
 * It exercises every v1.1 editing surface out of the box: a source node, the
 * three node controls (LENGTH / SPEED / WIDTH), the Speed⇄Width coupling, and
 * all three colour schemes. `build` is narrow + slow + red — a constraint that
 * reads purely from its low speed/width, with no `constraint` node *type*
 * (v1.1, beads ai-engineer-t0c8 / wec5).
 *
 * Returns a FRESH object each call so the designer can "new document" cleanly.
 *
 * @param {{x?:number,y?:number,w:number,h:number}} [viewBox] — the new flow's
 *   slide-scope frame. Defaults to the legacy 16:9 1600×900 so every existing
 *   call site (`makeSampleFlow()`) is unchanged; the designer passes the
 *   remembered preset's viewBox to seed new flows at the last-chosen aspect
 *   (bd ai-engineer-zr7k §7.1).
 */
export function makeSampleFlow(viewBox = { x: 0, y: 0, w: 1600, h: 900 }) {
  return {
    viewBox: { x: 0, y: 0, ...viewBox },
    baseSpeed: 200,
    initialAgents: 6,
    forks: [],
    merges: [],
    nodes: [
      {
        id: 'intake', x: 240, y: 450, label: 'intake',
        kind: 'source', rate: 1.0,
        length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
        colorScheme: 'neutral',
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: ['design'],
      },
      {
        id: 'design', x: 620, y: 450, label: 'design',
        kind: 'normal',
        length: 1.0, speed: 1.0, width: 70, coupleSpeedWidth: true,
        colorScheme: 'neutral',
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: ['build'],
      },
      {
        id: 'build', x: 1000, y: 450, label: 'build',
        kind: 'normal',
        length: 1.4, speed: 0.4, width: 30, coupleSpeedWidth: true,
        colorScheme: 'red',
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: ['ship'],
      },
      {
        id: 'ship', x: 1360, y: 450, label: 'ship',
        kind: 'normal',
        length: 0.8, speed: 1.0, width: 70, coupleSpeedWidth: true,
        colorScheme: 'green',
        labelSide: 'above', labelDx: 0, labelDy: -70,
        successors: [],
      },
    ],
  }
}
