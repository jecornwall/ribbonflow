# @ribbonflow/designer

The interactive **flow builder** — a Vue app for authoring ribbonflow diagrams.
Place and move nodes and edges, edit labels, widths, source rates, capacities,
rejection edges, particle sizes and split/combine transforms, set the frame
aspect ratio, and preview live through the real renderer. Export/import a single
flow or a flow-set.

```bash
pnpm install
pnpm --filter @ribbonflow/designer dev      # → http://localhost:5174
```

## Persistence backends

The designer runs against either of two storage backends (spec §7.2):

- **localStorage + download/upload** (default) — zero-config, so the designer
  deploys as a plain **static site** anyone can host. `pnpm --filter
  @ribbonflow/designer dev:local`.
- **Dev-server file API** — reads/writes a directory of `.flow.json` files (the
  `examples/` tree by default), for local authoring against version control.
  Selected with `VITE_FLOW_BACKEND=server` (what `dev` uses).

Build the static app:

```bash
pnpm --filter @ribbonflow/designer build    # → designer/dist/
```

## Tests

```bash
pnpm --filter @ribbonflow/designer test           # node:test unit suites
pnpm --filter @ribbonflow/designer test:e2e       # Playwright, server backend
pnpm --filter @ribbonflow/designer test:e2e:local # Playwright, localStorage backend
```

Live preview renders through [`ribbonflow`](../ribbonflow); the inspector
geometry comes from [`@ribbonflow/core`](../core).

## License

[MIT](../LICENSE)
