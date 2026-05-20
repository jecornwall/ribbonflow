# M5 Parity Report — deck flows rendered through the new library

**Date:** 2026-05-20
**Bead:** `ai-engineer-h6sn` (M5 — Prove & swap)
**Harness:** `flow/parity/` — a throwaway Vite app that imports the deck's real
flow definitions (`deck/flows/*.js`, read-only) and renders each through the
new library's slide face, `<FlowEmbed>`. Screenshots in `flow/parity/out/`.

## Method

The deck has **13 flow files / 15 flow states** (`n4-year-walk.js` exports an
ordered array of 3). All are **format v1** (top-level `entryId` / `spawnRate`;
`capacity` / `latency` / `kind:'constraint'` nodes). The harness, per state:

1. `migrateFlow(flow, 1)` → v3 (the same forward-port `deserializeFlow()` runs).
2. `normalizeFlow(...)` → default-fill + engine-field derivation.
3. Render through `<FlowEmbed>`.

Ground truth for the current deck rendering: `deck/playwright-review/audit-2026-05-20-N*.png`.

## Finding 0 (blocker, library) — `<FlowEmbed>` does not make a bare flow render-ready

`normalizeFlowInput()` (`format/index.js`) returns a bare flow **object**
untouched — it neither migrates nor `normalizeFlow`s it. Handing `<FlowEmbed>`
a deck v1 flow object directly produced **189 console errors** (`<text>`/`<line>`
`NaN` attributes) and a hard throw in `pinchZoneOutlinePath` ("Cannot read
properties of undefined"). The harness only renders cleanly because it runs
`migrateFlow` + `normalizeFlow` itself before handing the flow over.

For the swap, `<FlowEmbed>` is the slide face — a slide will hand it a flow and
expect it to render. **The slide face must migrate + normalize.** This is a
library fix and a precursor to any swap dispatch.

## Finding 1 — topology, layout & chrome reach parity

With migrate + normalize applied, **all 15 states render without error.** Node
placement, branch centerlines, fork/merge topology, segment-divider hairlines,
labels-above with leader lines, and the particle agents all reproduce the deck
faithfully. The structural renderer is sound.

## Finding 2 (major delta) — the constraint colour is far too loud

v1 `kind:'constraint'` nodes migrate (v2→v3) to `colorScheme:'red'`. The
library renders `red` as a **saturated bright orange block**. The deck renders
the constraint as a **subtle dusty-rose pinch** inside the warm-wheat band
(`pinchFillColor` / `constraintFillColor`, dropped by the v3 migration).

| State | Deck (current) | Library (migrated) |
|---|---|---|
| `n4-toc-baseline` | rose pinch, wheat band | bright-orange plateau, salmon transitions |
| `n4-year-walk` #0–2 | rose pinch / inverse bulge | bright-orange block |
| `n17-*-before/after` | rose pinch | bright-orange block |
| `n9-multilane` | wheat multilane, subtle tint | **most of the band orange** |

This is **expected** — M2/v1.1 deliberately dropped the v1 visual register
(`pinchMode`, `ribbonColor`, rose fills) in favour of per-node `width` +
`colorScheme`. Migration is documented-lossy there. Parity is therefore a
**re-authoring** problem, not a migration problem: each flow needs per-node
`width` + `colorScheme` set deliberately to match the locked mockups.

## Finding 3 — `n9-multilane` clips at the viewBox left edge

The migrated `n9-multilane` ribbons extend past `x=0` and are clipped (see
`out/parity-n9-multilane.png`). The deck render fits. A geometry/viewBox or
ribbon-extent regression that the multi-root branch seeding (M2 `flowCurve.js`
change) may have introduced. Needs investigation before the swap.

## Finding 4 (minor) — constraint label not colour-matched

The deck colours the constraint's label rose; the library renders all labels
in the same neutral ink. Cosmetic; folds into the re-authoring pass.

## Verdict

**The swap is NOT a mechanical drop-in.** The new renderer is structurally
sound and every deck flow migrates and renders, but visual parity needs:

- **Library fixes (flow-platform-engineer):** (a) `<FlowEmbed>` must migrate +
  normalize a bare flow — Finding 0; (b) the `n9-multilane` clipping — Finding 3;
  (c) optionally a register-faithful colour scheme (warm-wheat / dusty-rose)
  so re-authoring has the right palette to reach for.
- **Re-authoring (simulation-engineer):** the 13 deck flows converted to v3
  `.flow.json` with per-node `width` + `colorScheme` hand-tuned against the
  locked mockup PNGs — Findings 2 & 4.

The swap is safe to *plan and stage* now; it is **not safe to execute** until
the library fixes land and the re-authored flows are signed off against the
mockups. See `docs/superpowers/specs/2026-05-20-flow-M5-design.md`.
