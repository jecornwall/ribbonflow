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

// ── style helper: emit opacity / font-size / text-transform as an inline
// style string, NEVER a bare presentation attribute. UnoCSS attributify would
// otherwise rewrite a bare `opacity="0.85"` to its 0.85% utility and paint the
// element near-invisible (FlowGraph.vue:74-76, ai-engineer-tsb4). ────────────
function styleString(pairs) {
  const parts = []
  for (const [k, v] of pairs) {
    if (v === null || v === undefined) continue
    parts.push(`${k}:${v}`)
  }
  return parts.length ? parts.join(';') : undefined
}

// ── static[] → element-specs (one per primitive, in paint order) ─────────────
// Each kind mirrors the element FlowGraph paints for it; field names are the
// SVG-native scene fields from buildFlowScene, mapped to kebab SVG attributes.
export function staticSpec(staticPrims) {
  return staticPrims.map(primSpec)
}

function primSpec(p) {
  switch (p.kind) {
    case 'ribbon':
    case 'path':
      // FlowGraph.vue:108-114 (ribbon) / :122-127 (coloured + pinch overlays).
      return { tag: 'path', attrs: { d: p.d, fill: p.fill } }

    case 'disc':
      // Junction star-burst cap — FlowGraph.vue:142-149.
      return { tag: 'circle', attrs: { cx: p.cx, cy: p.cy, r: p.r, fill: p.fill } }

    case 'line':
      // Dividers / anchors / marker ticks+leaders / ghost leaders / spine.
      return {
        tag: 'line',
        attrs: {
          x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
          stroke: p.stroke, 'stroke-width': p.strokeWidth,
          'stroke-linecap': p.linecap,
          style: styleString([['opacity', p.opacity]]),
        },
      }

    case 'text':
      // Marker / ghost / decoration / legend labels — FlowSegmentMarker.vue:108-118.
      return {
        tag: 'text',
        text: p.text,
        attrs: {
          x: p.x, y: p.y,
          'font-family': p.font, 'font-style': p.fontStyle,
          fill: p.fill, 'text-anchor': p.anchor,
          'dominant-baseline': p.baseline,
          style: styleString([
            ['font-size', p.fontSize !== undefined ? `${p.fontSize}px` : undefined],
            ['text-transform', p.textTransform && p.textTransform !== 'none' ? p.textTransform : undefined],
            ['opacity', p.opacity],
          ]),
        },
      }

    case 'polygon': {
      // Station boxes / legend swatch — FlowGraph.vue:209-218 / :429-432.
      // stroke / stroke-width are optional: only present when the primitive
      // carries a stroke (legend swatch is fill-only — no bare stroke key).
      const attrs = { points: p.points, fill: p.fill }
      if (p.stroke !== undefined) {
        attrs.stroke = p.stroke
        attrs['stroke-width'] = p.strokeWidth
      }
      return { tag: 'polygon', attrs }
    }

    case 'rect':
      // Constraint hatch band — FlowSegmentMarker.vue:131-138.
      return {
        tag: 'rect',
        attrs: {
          x: p.x, y: p.y, width: p.width, height: p.height, fill: p.fill,
          style: styleString([['opacity', p.opacity]]),
        },
      }

    case 'glyph':
      // Transform split/combine glyph — FlowGraph.vue:383-396.
      return {
        tag: 'path',
        attrs: {
          d: p.d, transform: p.transform, fill: p.fill,
          stroke: p.stroke, 'stroke-width': p.strokeWidth,
          'stroke-linecap': p.linecap, 'stroke-linejoin': p.linejoin,
          style: styleString([['opacity', p.opacity]]),
        },
      }

    case 'rejectionArc':
      // Dotted back-path bow + arrowhead — FlowGraph.vue:184-192 / FlowRejectionArc.vue.
      // Carries the same `flow-rejection-arc` class hook FlowRejectionArc.vue did,
      // so the imperative renderer is DOM-parity-faithful (the class is a hook only
      // — the dotted-bow styling is the inline stroke/dasharray attrs below).
      return {
        tag: 'g',
        attrs: { class: 'flow-rejection-arc' },
        children: [
          {
            tag: 'path',
            attrs: {
              d: p.d, fill: 'none', stroke: p.stroke,
              'stroke-width': p.strokeWidth, 'stroke-dasharray': p.dasharray,
              'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            },
          },
          { tag: 'polygon', attrs: { points: p.arrowPoints, fill: p.stroke, stroke: 'none' } },
        ],
      }

    default:
      throw new Error(`sceneSpec: unknown primitive kind "${p.kind}"`)
  }
}

// ── rootSpec: the whole scene as ONE element-spec tree ───────────────────────
// FlowGraph.vue:17-21 (svg root) / :51 (clip group) / :107 (wobble group).

/** Class on the <g> that holds the static paint (so the wobble filter + tests target it). */
export const PAINT_GROUP_CLASS = 'flow-paint'
/** Class on the <g> mountFlow fills with agent circles each frame. */
export const AGENTS_GROUP_CLASS = 'flow-agents'

/**
 * The whole scene as ONE element-spec tree: <svg> → <defs> + a clip group that
 * holds the static paint group (optionally wobble-filtered) and an empty agents
 * group. mountFlow paints this once, then fills the agents group per frame.
 *
 * DELIBERATE DOCUMENTED DEVIATION (2c parity candidate): the ink-wobble filter
 * wraps the WHOLE paint group here, whereas FlowGraph.vue:107 wraps only the
 * ribbon sub-group (rejection arcs / markers / boxes sit outside its wobble
 * group). The visual difference — whether the draftsman wobble also displaces
 * marker hairlines — is immaterial for the deck flows that enable inkWobble
 * (ribbon-dominant figures), so this is the faithful-enough simplification.
 * The agents group sits OUTSIDE the clip's paint group (agents are never
 * wobbled — FlowGraph.vue:398-415 renders them after the filter group).
 *
 * FlowGraph.vue:17-21 (svg) / :51 (clip group) / :107 (wobble group).
 */
export function rootSpec(scene) {
  const { viewBox, defs } = scene
  const paintAttrs = { class: PAINT_GROUP_CLASS }
  // Only set the filter key when wobble is present — a bare `filter: undefined`
  // would still satisfy `'filter' in attrs`, so add it conditionally.
  if (defs.wobble) paintAttrs.filter = `url(#${defs.wobble.id})`
  const paintGroup = {
    tag: 'g',
    attrs: paintAttrs,
    children: staticSpec(scene.static),
  }
  const agentsGroup = { tag: 'g', attrs: { class: AGENTS_GROUP_CLASS }, children: [] }

  return {
    tag: 'svg',
    attrs: {
      viewBox: `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`,
      preserveAspectRatio: 'xMidYMid meet',
      class: 'flow-graph',
    },
    children: [
      defsSpec(defs),
      {
        tag: 'g',
        attrs: { 'clip-path': `url(#${defs.clipId})` },
        children: [paintGroup, agentsGroup],
      },
    ],
  }
}
