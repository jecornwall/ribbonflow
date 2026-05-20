# flow/parity — M5 swap parity harness

Throwaway validation tooling for **M5** (bd `ai-engineer-h6sn`). Renders the
deck's real flow definitions (`deck/flows/*.js`) through the **new** shared
library (`@flow-designer/library`) so the swap can be checked against the
current `deck/components/flow/*` rendering.

It only ever **reads** `deck/` files — it never edits them. The M5 ownership
boundary holds; the swap itself is a separate, supervised dispatch.

## Run

```bash
pnpm --filter @flow-designer/parity dev   # → http://localhost:5180
```

- `/` — index: every deck flow state, stacked.
- `/?flow=<key>` — one state, full-bleed, for a clean capture.
  Keys are the flow filename; `n4-year-walk` exports 3 states → `n4-year-walk#0..2`.

Each flow is format v1; the harness runs `migrateFlow(flow, 1)` then
`normalizeFlow()` before rendering — see `PARITY-REPORT.md` Finding 0 for why
that explicit step is itself a finding.

## Artefacts

- `PARITY-REPORT.md` — the parity findings.
- `out/` — representative screenshots captured 2026-05-20.

Full milestone plan: `docs/superpowers/specs/2026-05-20-flow-M5-design.md`.
