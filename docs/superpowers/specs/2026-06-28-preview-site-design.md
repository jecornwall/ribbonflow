# ribbonflow preview site — design

**Date:** 2026-06-28
**Status:** approved (brainstorming) → ready for implementation plan

## 1. Purpose

A companion **preview site** for the `ribbonflow` repo, published to **GitHub
Pages**, that:

1. previews a curated gallery of ribbon flows, each playing live;
2. lets visitors **run the designer** (full-screen, at `/designer/`);
3. **prominently** points to <https://jecornwall.com/ai-engineer> to see the
   flows in the context of the presentation; and
4. briefly explains that the library was developed while building that talk.

The site is itself a working consumer of the public `ribbonflow` API — a live
example, not just marketing.

## 2. Deployment target

- **Project Pages:** <https://jecornwall.github.io/ribbonflow/>.
- Site base path `/ribbonflow/`; designer base path `/ribbonflow/designer/`.
- No custom domain / DNS.
- **One manual step (owner):** repo Settings → Pages → Source = "GitHub
  Actions". Everything else is automated.

## 3. Architecture (Approach A)

A new, framework-free Vite app in a top-level `site/` workspace package that
imports the published `ribbonflow` renderer directly and mounts each flow with
`mountFlowAuto`. The designer is built separately with a configurable base and
assembled into the same Pages artifact under `/designer/`. One GitHub Actions
workflow builds both and deploys.

Why A: cleanest/most branded result; the site dogfoods the vanilla `ribbonflow`
package (the "no-framework headline"); it showcases the signature before→after
`handle.update()` idiom; the designer stays cleanly separate.

Rejected: (B) reuse the CLI `gallery` emitter — it is intentionally bare (one
static page per flow, no set transitions/branding) and would require enhancing a
*published* package; (C) extend the designer to double as the site — conflates an
authoring tool with a marketing site.

### 3.1 Repo layout

```
site/
  package.json          # @ribbonflow/site (private). deps: ribbonflow,
                        #   @ribbonflow/core (workspace:*). devDep: vite
  vite.config.js        # base: process.env.SITE_BASE || '/'
  index.html            # landing page (hero, gallery, designer CTA, quick start)
  viewer.html           # full-screen single-flow viewer (?id=…)
  src/
    main.js             # entry: build catalog, render landing + gallery
    catalog.js          # import.meta.glob curated flows → [{ id,title,caption,states[] }]
    gallery.js          # card rendering; before→after / state stepper via update()
    viewer.js           # viewer.html entry: mount one flow full-bleed by ?id=
    curated.js          # the allow-list + friendly titles/captions (single source)
    styles.css
  test/catalog.test.js  # node:test — every curated flow deserializes via core
examples/               # the 8 curated sets live here; examples/index.json regenerated
.github/workflows/pages.yml
```

Flows live in `examples/` — the README already documents it as the showcase
source, so the repo gains real examples and the CLI gallery keeps working. The
toy `examples/sample` set is retired (verified: no test/CLI code references it).
The site globs `../examples/**` at build time and filters by `curated.js`.

`ribbonflow`'s `exports.default` resolves to `./src/index.js`, so Vite compiles
the library source through the workspace link — **no library pre-build is needed**
for the site or the designer to build.

## 4. Curated flows

Eight sets from `~/src/ai-engineer/flow/flows`, spanning ribbonflow's range
(single hero diagram, before→after pairs demonstrating `update()`, a multi-state
stepper, multilane forks/merges). **Slide codes (N3/N4/…) are hidden on the
cards** — friendly titles only; the talk linkage lives in the hero CTA.

| Source set | Friendly title (card) | Shows |
|---|---|---|
| `s12-define-implement-deploy` | Define → Implement → Deploy | width-as-throughput; pinch at the bottleneck |
| `n4-startup` | Startup under load | before→after `update()` swap |
| `n11-build-and-test` | Build & test environment | before→after |
| `n12-review-turnaround` | Review turnaround | before→after |
| `n9-multilane` | Many lanes at once | forks, merges, multiple lanes |
| `n7-enterprise-gates` | Coordination & gates | gates, rejection edges |
| `n3-constraint-shift` | The moving constraint | 3-state stepper (Theory of Constraints) |
| `n14-context-layer` | A shared AI context layer | before→after |

Final per-card captions are written during implementation. The list is trivially
editable in `curated.js`. All eight are `formatVersion` 3 or 5; `@ribbonflow/core`
(`FLOW_FORMAT_VERSION = 5`) reads v5 natively and migrates v3 forward, so they
load unchanged.

Using these presentation diagrams in the public MIT repo is authorized by the
owner.

## 5. The site

Single landing page (`index.html`) plus a full-screen viewer (`viewer.html`).

### 5.1 Landing sections
- **Hero** — name, one-liner, and a **prominent CTA**: *"▶ See these flows in the
  talk → The AI Engineer"* → `https://jecornwall.com/ai-engineer` (new tab).
- **Origin note** (brief): *"ribbonflow began as the diagram engine for the talk*
  The AI Engineer*, then was extracted into a standalone MIT library."*
- **Gallery** — one card per curated set (§5.2).
- **Designer CTA** — *"Build your own → Open the designer"* → `/designer/`.
- **Quick start** — `npm install ribbonflow` + the `mountFlowAuto` snippet; GitHub
  link; footer (MIT © 2026 Jason Cornwall).

### 5.2 Gallery cards
- Each card mounts its first state via `mountFlowAuto(el, flow)`. The renderer's
  visibility gate pauses off-screen cards (no extra work needed).
- Multi-flow sets render a **stepper** (before→after, or 1·2·3 for `n3`). Stepping
  calls `handle.update(nextFlow)` — the same single code path the README headlines
  — so the site demonstrates the library's key idiom.
- Each card has an **"Open ↗"** link to `viewer.html?id=<setId>__<slug>`.

### 5.3 Viewer
`viewer.html?id=…` loads one flow from the shared catalog and mounts it full-bleed
via `mountFlowAuto`. Mirrors the CLI gallery's per-flow page, but as one
parameterized page; makes any flow shareable / iframe-embeddable.

### 5.4 Visual design
The shell is plain HTML/CSS/JS (no framework). Visual polish (typography, layout,
palette consistent with the flows' warm `#F4F2ED` ground) is handled during
implementation via the frontend-design skill, validated with screenshots.

## 6. Designer integration

- Built separately: `base: process.env.DESIGNER_BASE || '/'` (dev stays `/`; CI
  sets `/ribbonflow/designer/`). The dev-only `flowStorePlugin` is inert in
  `vite build`; the static build uses the default **localStorage** backend, so it
  is fully static.
- **Seed on first visit (confirmed in scope).** A build step generates a seed blob
  from the curated `examples/` sets in the exact localStorage shape
  (`{ sets: [{ id, title, transition?, flows: [{ slug, title, envelope, updatedAt }] }] }`,
  key `ribbonflow.designer.store.v1`). On load, if that key is absent, the designer
  writes the seed once, so a visitor opening `/designer/` immediately sees the
  gallery flows to tweak.
  - Gated behind a build flag (e.g. `DESIGNER_SEED=1`) so normal designer dev is
    unaffected; seed data is generated, not hand-maintained.
  - Idempotent and non-destructive: only writes when the store key is unset, so it
    never clobbers a returning visitor's edits.

## 7. Deployment workflow

`.github/workflows/pages.yml`:
- **Triggers:** push to `main`; `workflow_dispatch`.
- **Permissions:** `pages: write`, `id-token: write`, `contents: read`.
  Concurrency group `pages`.
- **Build job:** checkout → setup pnpm + Node → `pnpm install --frozen-lockfile`
  → build site (`SITE_BASE=/ribbonflow/`) → build designer
  (`DESIGNER_BASE=/ribbonflow/designer/ DESIGNER_SEED=1`) → assemble `dist/`
  (site → root; designer `dist/` → `dist/designer/`; add `.nojekyll`) →
  `actions/upload-pages-artifact`.
- **Deploy job:** `actions/deploy-pages` → `github-pages` environment.

Assembly is a small step (shell `cp` or a tiny node script) kept in the workflow
for transparency. `.nojekyll` prevents Pages from dropping `_`-prefixed asset
files.

## 8. Testing & verification

- **Unit (`node:test`):** `site/test/catalog.test.js` — every id in `curated.js`
  resolves to a flow file that `@ribbonflow/core` deserializes without throwing,
  and every set has ≥1 state. Guards typos / missing files / format breakage.
- **Build smoke:** `pnpm --filter @ribbonflow/site build` and the designer build
  succeed locally and in CI.
- **Visual verification (before "done"):** Playwright screenshots of the built
  landing page, ≥2 gallery cards (confirm ribbons + moving particles render — not
  blank SVGs), the before→after stepper, and the designer at its subpath base.
- Existing designer/core/cli/renderer test suites remain green.

## 9. Out of scope (YAGNI)

- No custom domain / DNS.
- No CMS or per-flow markdown write-ups beyond a one-line caption.
- No server-backed persistence on the public site (localStorage only).
- No new framework adapters; the shell stays vanilla.
- No changes to the published packages' public APIs (only an opt-in,
  flag-gated seed path in the designer + a configurable build `base`).

## 10. Success criteria

- `https://jecornwall.github.io/ribbonflow/` loads, with a prominent link to
  `jecornwall.com/ai-engineer` and the one-line origin note.
- The eight curated flows play; multi-flow sets step before→after via `update()`.
- `/ribbonflow/designer/` opens the designer, pre-seeded with the curated flows.
- Every push to `main` redeploys via GitHub Actions.
