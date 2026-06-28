# ribbonflow

Animated SVG **flow diagrams**: particles ("agents") stream along variable-width
ribbons through nodes. Ribbon width encodes throughput (Minard-style) and pinches
at bottlenecks and constraints, so a diagram *shows* where work piles up. Embed
them in slide decks and websites, or author your own with the interactive designer.

```js
import { mountFlowAuto } from 'ribbonflow'

const handle = mountFlowAuto(document.getElementById('stage'), flow)
handle.update(nextFlow)   // swap the flow (e.g. a before → after click)
handle.destroy()          // stop the loop, detach
```

## Packages

This is a pnpm monorepo. The published set:

| Package | What it is |
|---|---|
| [`@ribbonflow/core`](./core) | Pure, headless: simulation engine, curve/width/glyph geometry, the scene model (`buildFlowScene`), and the flow format (serialize/migrate/validate). No DOM, no framework. |
| [`ribbonflow`](./ribbonflow) | The vanilla SVG renderer — `mountFlow(el, flow)` + a visibility-gated rAF loop. Re-exports `@ribbonflow/core`. The no-framework headline. |
| [`@ribbonflow/vue`](./adapters/vue) | A thin `<FlowEmbed>` Vue component over `ribbonflow`. |
| [`@ribbonflow/react`](./adapters/react) | A thin `<FlowEmbed>` React component over `ribbonflow`. |
| [`@ribbonflow/designer`](./designer) | The interactive builder app (Vue). Hostable as a static site. |
| [`@ribbonflow/cli`](./cli) | `ribbonflow build` — turn a directory of `.flow.json` into an importable asset bundle and/or a hostable static gallery. |

## Architecture

One pure scene builder, one imperative renderer, thin framework wrappers
(*Approach A*). `@ribbonflow/core`'s `buildFlowScene(flow)` derives a declarative
list of SVG primitives; `ribbonflow`'s `mountFlow` paints those once and then
moves only the agent circles each frame. The Vue and React adapters are ~30-line
shells around `mountFlow`, so a topology swap and the deck "click to advance"
idiom work identically everywhere through one `update()` code path.

## Quick start

**Vanilla (no framework):**

```bash
npm install ribbonflow
```
```js
import { mountFlowAuto } from 'ribbonflow'
mountFlowAuto(el, myFlow)
```

**Vue / React:** install `@ribbonflow/vue` or `@ribbonflow/react` and render
`<FlowEmbed :flow="flow" />`. `flow` accepts a flow object, a serialized flow,
or a flow-set (object or serialized) — the renderer auto-detects.

## Preview site

A live gallery + the interactive designer is published to GitHub Pages:
**<https://jecornwall.github.io/ribbonflow/>**. It previews a curated set of the
flows from the talk [*The AI Engineer*](https://jecornwall.com/ai-engineer) — the
presentation ribbonflow was built for — and launches the designer at
[`/designer/`](https://jecornwall.github.io/ribbonflow/designer/).

The site is the `@ribbonflow/site` package; CI (`.github/workflows/pages.yml`)
builds it plus the designer and deploys on every push to `main`.

## Develop

```bash
pnpm install
pnpm -r build      # Vite lib builds + JSDoc-derived .d.ts, per package
pnpm -r test       # node:test unit suites (core, renderer, designer, cli)
pnpm design        # run the designer app (@ribbonflow/designer)
```

The designer's e2e suites:

```bash
pnpm --filter @ribbonflow/designer test:e2e         # server-backend authoring
pnpm --filter @ribbonflow/designer test:e2e:local   # static localStorage backend
```

## Examples

`examples/` carries a generic sample flow. Build a gallery from it:

```bash
node cli/bin/ribbonflow.js build examples --mode=gallery --out=./out
# → ./out/gallery/index.html + one playable, iframe-embeddable page per flow
```

## License

[MIT](./LICENSE) © 2026 Jason Cornwall
