# @ribbonflow/react

A thin React `<FlowEmbed>` wrapper over [`ribbonflow`](../../ribbonflow)'s
`mountFlowAuto`. Renders an animated flow diagram and updates it when the `flow`
prop changes — including across a single-flow ⇄ flow-set switch.

```bash
npm install @ribbonflow/react ribbonflow react react-dom
```

```jsx
import { FlowEmbed } from '@ribbonflow/react'
import myFlow from './my.flow.json'

export function Diagram() {
  return <FlowEmbed flow={myFlow} />
}
```

## Props

| Prop | Type | Notes |
|---|---|---|
| `flow` | object \| string | A flow / flow-set object, or its serialized JSON form. Auto-detected. |
| `showMetrics` | boolean | Surface the renderer's read-only metrics overlay. |

Swapping `flow` (e.g. from React state) drives the renderer's `update()`, so a
before → after transition is just a state change.

`react` is a peer dependency. `ribbonflow` does the actual rendering.

## License

[MIT](../../LICENSE)
