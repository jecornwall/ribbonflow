# @ribbonflow/vue

A thin Vue `<FlowEmbed>` wrapper over [`ribbonflow`](../../ribbonflow)'s
`mountFlowAuto`. Renders an animated flow diagram and updates it when the `flow`
prop changes — including across a single-flow ⇄ flow-set switch.

```bash
npm install @ribbonflow/vue ribbonflow vue
```

```vue
<script setup>
import { FlowEmbed } from '@ribbonflow/vue'
import myFlow from './my.flow.json'
</script>

<template>
  <FlowEmbed :flow="myFlow" />
</template>
```

## Props

| Prop | Type | Notes |
|---|---|---|
| `flow` | object \| string | A flow / flow-set object, or its serialized JSON form. Auto-detected. |
| `showMetrics` | boolean | Surface the renderer's read-only metrics overlay. |

The deck "click to advance" idiom maps to swapping the prop —
`:flow="clicks > 0 ? after : before"` — which drives the renderer's `update()`.

`vue` is a peer dependency. `ribbonflow` does the actual rendering.

## License

[MIT](../../LICENSE)
