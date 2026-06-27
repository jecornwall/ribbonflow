# ribbonflow Phase-2c — PARITY REPORT

**Bead:** `ai-engineer-uttb` · **Date:** 2026-06-27 · **Gate for:** `ai-engineer-bu5t` (Phase 2d — retire the Vue `FlowGraph` renderer)

## VERDICT: ✅ GREEN

The new imperative renderer (`mountFlow`, and `mountFlowSet`) renders at **geometric + pixel parity** with the legacy Vue `FlowGraph`/`FlowSetPlayer` across **all 21 deck-referenced flows (21/21 GREEN on both checks)**. Bonus library coverage: **17/18** of the non-deck states (the one exception is an empty 0-node flow that fails on BOTH renderers — see §6). **Phase 2d is unblocked. No real divergences. No fix-before-2d beads filed.**

## 1. Method (geometric primary + pixel backstop)

Seeded frame-exact agent comparison is infeasible (FlowGraph builds its sim internally, accepts no seed, and is a read-only golden ref) — so, per the agreed fallback, three layers:

1. **PRIMARY — generic leaf-shape geometric diff.** Render both renderers; extract every painted *leaf* shape (`path`/`circle`/`line`/`text`/`polygon`/`rect`) into a per-tag MULTISET of canonical, float-rounded keys (agents excluded); compare with `diffScenes`. "Geometric, not structural": the renderers emit different DOM trees but the same painted shapes. Auto-whitelists the 3 known deviations. Extractor + diff are pure node modules, unit-tested (**22 tests**, `flow/parity/src/diff/*.test.js`), run in-browser via `window.__extractScene` (same code).
2. **BACKSTOP — pixel diff (ALL states).** The multiset compare is deliberately order-independent (to absorb the legend z-order deviation), which would otherwise mask a paint-ORDER / overpaint regression. The pixel pass is the only coverage for that, so it runs on **every** state: each static scene (agents hidden) is rasterised to a 640×360 canvas and ImageData-diffed.
3. **CORROBORATION — agent statistics** (unseeded RNG ⇒ distribution equivalence, not frame-exact).

**Diff parameters.** Geometric: coordinates rounded to **2 decimals** (trivial float formatting only; a genuine sub-pixel-but-systematic shift would still surface). Pixel: a pixel counts as different when any RGB channel differs by **> 30/255**; a state is pixel-clean when the differing-pixel **ratio ≤ 0.005 (0.5%)**. AA edge noise on an identical scene measures ~0.0003; the worst observed ratio across all 39 states was **0.0005** — every state is an order of magnitude under threshold.

Runner: `flow/parity/run-parity-2c.mjs` (re-runnable; deck's installed `playwright-chromium`, read-only). Raw data: `out/2c/results.json`.

## 2. Scope — the GATE verdict is the 21 deck-referenced flows

The authoritative deck set was established by grepping `deck/slides/**` for `*.flow.json` imports (not taken on trust): **exactly 21 distinct flows**, and **zero** `FlowSetPlayer`/`flowSet`/`set.json` usage — the deck does before/after by swapping the `:flow` prop on a single embed.

- **DECK (21, the verdict):** `n11/{before,after}`, `n13/{before,after}`, `n15/{before,after}`, `n3-constraint-shift/{a,b,c}`, `n4-startup/{before,after}`, `n7-enterprise-gates/{gates,multiteam}`, `s12/baseline`, `time-warp-alt/state-{1..7}`. → **21/21 GREEN** (geometric + pixel).
- **bonus (18, library coverage, does NOT gate 2d):** n12/n14/toc-baseline/n4-variants/n4-year-walk/n5/n9-multilane/n3-baseline/sample/test-explosion/time-warp-alt/{one-poor-engineer,state-0}. → **17/18 GREEN**; the one exception (state-0) is §6.

## 3. Per-state results (39 states; pixel ratio = differing-pixel fraction, threshold 0.005)

All GREEN states have geometric `ok` AND pixel ratio ≤ 0.005. Representative ratios (full data in `results.json`):

| Set | DECK? | result | pixel ratio (max in set) |
|---|---|---|---|
| n11-build-and-test (before/after) | DECK | GREEN | 0.00009 |
| n13-speckit-alignment (before/after) | DECK | GREEN | 0.00003 |
| n15-language-rollout (before/after) | DECK | GREEN | 0.00024 |
| n3-constraint-shift (a/b/c) | DECK | GREEN | 0.00005 |
| n4-startup (before/after) | DECK | GREEN | 0.00015 |
| n7-enterprise-gates (gates/multiteam) | DECK | GREEN | 0.00014 |
| s12-define-implement-deploy/baseline | DECK | GREEN | 0.00034 |
| time-warp-alt/state-1..7 | DECK | GREEN | 0.0005 |
| n9-multilane/multilane (wobble) | bonus | GREEN | 0.00008 |
| toc-baseline (before/after, wobble) | bonus | GREEN | 0.00012 |
| n4-year-walk/2024,2025,2026 | bonus | GREEN | 0.00009 |
| n5-activity-landscape/system (26 nodes) | bonus | GREEN | 0.00021 |
| n12, n14, n4-variants, n3-baseline, sample, test-explosion, one-poor-engineer | bonus | GREEN | ≤ 0.0004 |
| time-warp-alt/state-0 (0 nodes) | bonus | NO_RENDER (both fail) | — |

## 4. Extractor canonicalisation (visual-equivalence, NOT threshold-loosening)

Each equates forms that paint identically; a genuine difference still surfaces. All TDD'd.
- **`url(#id)` refs (fill, clip-path, filter, mask)** — strip the renderer-specific id suffix, keep the ref KIND (`url(#flow-hatch-438769224)` ≡ `url(#flow-hatch-0)` → `url(#flow-hatch)`). This is deviation #2; a real "clip/filter present vs absent" still diverges.
- **`text-transform:none` ≡ absent**; **`opacity:1` ≡ absent**.
- **Inherited group opacity resolved** (effective = leaf × ancestors) — see §5.
- **float rounding to 2 dp** in `d`/`points`/coords.

## 5. The two non-trivial cases (both resolved; neither a mountFlow bug)

### `n13-speckit-alignment/after` — initially RED, was an EXTRACTOR gap (now GREEN)
First run flagged the ghost review-markers as `op=1` (golden) vs `op=0.3` (candidate). DOM inspection proved a **false divergence**: `FlowGraph` dims them via a parent `<g class="ghost-markers" style="opacity:0.3">`; `mountFlow` bakes `0.3` into the leaf — **both paint at effective opacity 0.3, identical**. Fix: the extractor now resolves inherited (ancestor) opacity (SVG opacity multiplies down the tree) — a correct visual-equivalence model, not a loosened threshold. Re-run GREEN (geometric + pixel 0.00003).

### `time-warp-alt/state-0` — see §6.

## 6. The 0-node edge case (datapoint, not a skip)

`time-warp-alt/state-0` is an empty 0-node flow. **Both** renderers fail to produce an SVG, verified independently per renderer:
- `FlowGraph` (golden): `TypeError: Cannot read properties of undefined (reading 'length')`.
- `mountFlow` (candidate): `Error: createFlowSimulation: flow needs a source node (kind:'source') or a legacy entryId`.

The simulation engine (shared by both) cannot run a sourceless flow. The deck already guards this (S6 renders a blank canvas at `$clicks===0`; state-0 is **not** in the deck-referenced set). → **Parity**: both fail; `mountFlow` fails strictly more gracefully (clear error vs opaque TypeError). Not a 2d blocker.

## 7. The 3 known-inert deviations — confirmed inert

| # | Deviation | How confirmed |
|---|---|---|
| 1 | wobble filter wraps the whole paint group vs only the ribbon subgroup | Geometric: the wobble is a `<g filter>` (not a leaf); child paths identical → GREEN. Pixel: the wobble flows (n9-multilane, toc-baseline) are ≤ 0.00012 (well under threshold). Full-fidelity A/B `out/2c/n9-multilane-compare.png` is indistinguishable. |
| 2 | random clip/wobble/hatch ids vs deterministic `flow-*-0` | All `url(#…)` refs (fill/clip/filter/mask) canonicalised — structure compared, not ids. |
| 3 | Minard legend paints under agents (scene) vs after (FlowGraph) | Multiset compare order-independent; the pixel backstop (agents hidden) confirms no z-order regression elsewhere. |

## 8. Agent statistics (corroboration)

`n4-startup/after`, ~1.8 s live: both renderers — all agents in-bounds, identical radius (3.5), identical fill (cream `#F4F2ED`), identical viewBox. Counts 17 (golden) vs 20 (candidate): within band; pure unseeded-RNG/timing, not a render divergence.

## 9. Flow-set playback parity — reduction + spot-check

**Reduction (stated explicitly, auditable):** the deck embeds single flows only (§2). `FlowSetPlayer` renders each HELD state through `<FlowGraph>`; `mountFlowSet` renders each held state through a nested single-flow `mountFlow`. So a flow-set's visual parity at any settled state = the single-flow parity of that state (gated GREEN) + the crossfade timeline (identical logic, ported and unit-tested in Phase 2b, 23 tests). No separate set-diff harness needed.

**Spot-check (`n4-year-walk`, 3-state set, both rendered through the real players):**
- The 3 states are each GREEN as singles (geometric + pixel).
- **Held A/B** (`out/2c/2c-yearwalk-held.png`): both show state 0 identically. Golden mounts 1 slot (FlowSetPlayer's `v-if`); candidate mounts 2 slots (the persistent-slots 2b deviation, hidden slot opacity 0) — visually identical.
- **Mid-crossfade A/B** (`out/2c/2c-yearwalk-crossfade.png`): both players mid-fade with IDENTICAL slot opacities `[0.25, 1]` — same diagram, same constraint pinch, same labels, same eased blend. The crossfade mechanism matches.

## 10. Conclusion

GREEN across the deck-referenced set (21/21) on both geometric and pixel checks, corroborated by agent statistics and the flow-set spot-check. The imperative renderer is a faithful replacement for the Vue `FlowGraph`/`FlowSetPlayer`. **Phase 2d may proceed.**
