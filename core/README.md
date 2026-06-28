# @ribbonflow/core

The pure, headless heart of [ribbonflow](https://github.com/) — **no DOM, no
framework**. Everything here is deterministic and unit-testable with `node --test`.

It contains:

- **Simulation engine** — `createFlowSimulation`, agent emission/advection along
  branch centerlines, projection, branch selection.
- **Geometry** — Catmull-Rom centerlines, variable-width ribbon outlines, pinch
  zones, rejection-edge bow curves, junction discs, split/combine glyphs.
- **The scene model** — `buildFlowScene(flow)` → a declarative list of SVG
  primitives (ribbons, paths, discs, lines, text, glyphs, rejection arcs), and
  `agentsView(sim)` → the per-frame agent positions. This is the seam every
  renderer paints identically.
- **The flow format** — `serializeFlow` / `deserializeFlow` (versioned envelope,
  round-trippable), `migrateFlow` (forward-migrates older exports),
  `normalizeFlow` / `normalizeFlowInput` (default-filling + engine-field
  derivation), `validateFlow`, and the flow-set format (`serializeFlowSet`,
  `interpolateFlow`, easings).

## Usage

```js
import { buildFlowScene, agentsView, createFlowSimulation, normalizeFlowInput }
  from '@ribbonflow/core'

const flow = normalizeFlowInput(rawFlowOrEnvelope)
const scene = buildFlowScene(flow)        // { viewBox, defs, static: [...] }
const sim = createFlowSimulation(flow)
// paint scene.static once; each frame, read agentsView(sim) → [{id,x,y,r,fill}]
```

Most consumers don't import this directly — they use **`ribbonflow`** (which
re-exports all of core and adds the renderer) or a framework adapter. Reach for
`@ribbonflow/core` when you need the headless model: a custom renderer, a build
tool, SSR/analysis, or the designer's geometry.

## License

[MIT](../LICENSE)
