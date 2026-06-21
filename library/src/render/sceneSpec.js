// flow/library/src/render/sceneSpec.js
/**
 * sceneSpec.js — pure Scene → element-spec mapping for the vanilla renderer.
 *
 * Turns a Scene from buildFlowScene (defs + static[]) into framework-free
 * element-spec descriptors ({tag, attrs, children?, text?}) that applySpec
 * paints. No DOM, no Vue. This is the imperative twin of FlowGraph.vue's
 * <defs> + clipped paint group + per-primitive elements — by mapping the SAME
 * scene primitives FlowGraph derives, the output is structurally identical.
 *
 * Provenance is cited per block against FlowGraph.vue / the child SFCs.
 */

// ── defs: clipPath + optional wobble filter + optional hatch pattern ─────────
// FlowGraph.vue:33-46 (clip + wobble) + FlowSegmentMarker.vue:127-129 (hatch).
export function defsSpec(defs) {
  const children = []

  // clipPath — clips all paint to the viewBox bounds (FlowGraph.vue:34-41).
  children.push({
    tag: 'clipPath',
    attrs: { id: defs.clipId },
    children: [{
      tag: 'rect',
      attrs: {
        x: defs.clipRect.x, y: defs.clipRect.y,
        width: defs.clipRect.width, height: defs.clipRect.height,
      },
    }],
  })

  // ink-wobble draftsman's-hand filter (FlowGraph.vue:42-45).
  if (defs.wobble) {
    children.push({
      tag: 'filter',
      attrs: { id: defs.wobble.id, x: '-2%', y: '-2%', width: '104%', height: '104%' },
      children: [
        { tag: 'feTurbulence', attrs: { type: 'fractalNoise', baseFrequency: defs.wobble.baseFrequency, numOctaves: 2, seed: 3 } },
        { tag: 'feDisplacementMap', attrs: { in: 'SourceGraphic', scale: defs.wobble.scale } },
      ],
    })
  }

  // constraint-hatch pattern (FlowSegmentMarker.vue:127-129) — one shared def.
  if (defs.hatch) {
    children.push({
      tag: 'pattern',
      attrs: {
        id: defs.hatch.id, patternUnits: 'userSpaceOnUse',
        width: defs.hatch.tile, height: defs.hatch.tile,
        patternTransform: `rotate(${defs.hatch.rotate})`,
      },
      children: [{
        tag: 'line',
        attrs: { x1: 0, y1: 0, x2: 0, y2: defs.hatch.tile, stroke: defs.hatch.stroke, 'stroke-width': defs.hatch.strokeWidth },
      }],
    })
  }

  return { tag: 'defs', attrs: {}, children }
}
