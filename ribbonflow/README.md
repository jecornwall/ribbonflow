# ribbonflow

The vanilla SVG renderer for **animated flow diagrams** — and the no-framework
headline of the ribbonflow project. Particles stream along variable-width ribbons
that pinch at bottlenecks; width encodes throughput.

```bash
npm install ribbonflow
```

```js
import { mountFlowAuto } from 'ribbonflow'

const handle = mountFlowAuto(el, flow)
handle.update(nextFlow)   // swap to another flow (a before → after click)
handle.destroy()          // cancel rAF, remove nodes, detach observers
```

## API

### `mountFlow(el, flow, opts?) → { update, destroy }`
Paints the flow's static scene into `el` as SVG once, then runs a
**visibility-gated** `requestAnimationFrame` loop, updating only the agent
circles each frame (the simulation runs only while the element is on-screen and
the tab is foregrounded, and replays fresh on re-entry). `opts.showMetrics`
surfaces the read-only metrics overlay. `update(nextFlow)` re-runs the scene
builder, rebuilding the static layer on a flow-identity change while preserving
loop semantics.

### `mountFlowAuto(el, flow, opts?) → { update, destroy }`
Same surface, but `update()` also works across a **kind switch** (single flow ⇄
flow-set): it remounts instead of forwarding. This is what the framework adapters
wrap. Prefer it unless you know the kind never changes.

### `mountFlowSet(el, flowSet, opts?) → { update, destroy }`
The crossfade player for an ordered flow-set (states + animated transitions).

`flow` accepts the transparent union: a plain flow object, a serialized flow
envelope (string or parsed), or a flow-set (object or serialized).

This package **re-exports all of [`@ribbonflow/core`](../core)** — the scene
model, simulation, geometry, and flow format — so `import { ... } from
'ribbonflow'` is the single import most apps need.

## License

[MIT](../LICENSE)
