# flow/parity — ribbonflow parity harness

Throwaway validation tooling for the ribbonflow renderer swap. Renders the
canonical flow content (`flow/flows/**/*.flow.json`) through BOTH renderers so
they can be diffed before the legacy Vue renderer is retired.

- **GOLDEN** — `<FlowEmbed>` → `FlowGraph` (the legacy Vue renderer).
- **CANDIDATE** — `mountFlow` / `mountFlowSet` (the new imperative renderer).

It only ever **reads** `flow/flows/**` and the library; it never edits the
golden refs. (It originally globbed `deck/flows/*.js` for the M5 swap; those were
retired, so it now sources `flow/flows/**`.)

## Run the app

```bash
pnpm --filter @flow-designer/parity dev   # → http://localhost:5180
```

- `/` — index of every flow state.
- `/?flow=<key>&compare=1` — both renderers, stacked (the capture view).
- `/?flow=<key>&mode=<flowgraph|mountflow>` — one renderer, full-bleed.
- `&agents=off` — hide agents (static-scene visual backstop).

`<key>` is the flow id, e.g. `n4-startup/before`.

## Phase 2c — the parity GATE (bd `ai-engineer-uttb`)

The trustworthy GREEN/RED verdict that `mountFlow` matches `FlowGraph` before
Phase 2d retires the Vue renderer.

- **Diff core** (`src/diff/`, pure, unit-tested — `npm test`): `extractScene`
  (generic leaf-shape geometric extraction, agent-excluded, deviation-invariant)
  + `diffScenes` (multiset compare) + `canonicalGeometry` (float/colour/style
  canonicalisation).
- **Runner** (`run-parity-2c.mjs`): renders all states through both renderers
  (deck's installed `playwright-chromium`, read-only), diffs geometrically,
  writes `out/2c/results.json`. `--shots` also saves agents-off screenshots.

  ```bash
  pnpm --filter @flow-designer/parity dev &   # serve on :5180
  node flow/parity/run-parity-2c.mjs          # run the gate
  ```

- **Verdict:** `PARITY-REPORT-2c.md` — **GREEN** (38/38 renderable states; the
  one 0-node flow fails on both renderers via the shared engine, deck-guarded).

## Tests

```bash
pnpm --filter @flow-designer/parity test   # the diff-core unit suite (21 tests)
```

## Artefacts

- `PARITY-REPORT-2c.md` — the Phase-2c verdict.
- `out/2c/` — `results.json` + the `n9-multilane` visual-backstop A/B.
- `out/` + `PARITY-REPORT.md` — the earlier M5 findings (kept for history).
