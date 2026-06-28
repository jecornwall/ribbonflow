# @ribbonflow/cli

`ribbonflow build` — turn a directory of `.flow.json` files into a deployable
flow collection. It validates, migrates, and normalizes every flow through
[`@ribbonflow/core`](../core)'s format layer (a shared front-end), then emits one
or both of:

- **`--mode=bundle`** — a referenceable **asset bundle**: `flows.js` (an
  importable keyed map of normalized flows) plus a pre-wired `index.js` that
  mounts any flow by key over [`ribbonflow`](../ribbonflow).
- **`--mode=gallery`** — a self-contained **static gallery**: an index of every
  flow, each playable and iframe-embeddable at its own URL, all sharing one
  bundled, dependency-free renderer asset (`assets/ribbonflow.mjs`).

## Usage

```bash
ribbonflow build <flowsDir> [--mode=bundle|gallery|both] [--out=<dir>]
```

```bash
# Build both from the repo's example flows:
node bin/ribbonflow.js build ../examples --mode=both --out=./out
# → ./out/bundle/{flows.js,index.js}  and  ./out/gallery/{index.html, <flow>.html…}
```

Defaults: `--mode=both`, `--out=./dist-flows`. Each `.flow.json` is keyed by its
path under `<flowsDir>` (single flows and flow-sets are auto-detected and
rendered through `mountFlowAuto`). Parse/validation failures are reported and
skipped, not fatal.

The gallery's renderer asset is bundled from `ribbonflow` with esbuild, so the
output is a static site you can drop on any host — no build step for the consumer.

## License

[MIT](../LICENSE)
