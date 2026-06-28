# ribbonflow Preview Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Pages companion site that previews a curated gallery of ribbon flows, runs the designer at `/designer/`, and prominently links to the `jecornwall.com/ai-engineer` talk.

**Architecture:** A new framework-free `site/` Vite app imports the published `ribbonflow` renderer and mounts each curated flow with `mountFlowAuto`, using `handle.update()` for before→after steppers. The designer is built separately with a configurable base path, pre-seeded with the curated flows via a generated `public/seed.json`, and assembled into the same Pages artifact under `/designer/`. One GitHub Actions workflow builds both and deploys.

**Tech Stack:** Vite 6, vanilla JS/HTML/CSS (no framework in the site shell), `ribbonflow` + `@ribbonflow/core` workspace packages, pnpm workspaces, GitHub Actions Pages deploy.

## Global Constraints

- Package manager: `pnpm@10.20.0`; Node 20 in CI. (verbatim from root `package.json` `packageManager`.)
- Site base path: `/ribbonflow/`. Designer base path: `/ribbonflow/designer/`. Pages URL: `https://jecornwall.github.io/ribbonflow/`.
- The site shell is **framework-free** (plain HTML/CSS/JS) — it dogfoods the vanilla `ribbonflow` package. No Vue/React in `site/`.
- The designer ships **static** on its default **localStorage** backend (no `VITE_FLOW_BACKEND=server`).
- Gallery cards show **friendly titles only** — slide codes (N3/N4/…) are hidden. The talk linkage lives solely in the hero CTA.
- The hero must **prominently** link to `https://jecornwall.com/ai-engineer` and the page must carry the one-line origin note: *"ribbonflow began as the diagram engine for the talk* The AI Engineer*, then was extracted into a standalone MIT library."*
- Footer: `MIT © 2026 Jason Cornwall`.
- `@ribbonflow/core` is `FLOW_FORMAT_VERSION = 5` and reads v3 + v5 envelopes (migrates v3 forward) — curated flows load unchanged.
- The 8 curated sets are the single source of truth in `examples/curated.json`; both the site catalog and the designer seed read from it.

The 8 curated sets (source dir → friendly title):

| `examples/<dir>` | Friendly title (cards) |
|---|---|
| `s12-define-implement-deploy` | Define → Implement → Deploy |
| `n4-startup` | Startup under load |
| `n11-build-and-test` | Build & test environment |
| `n12-review-turnaround` | Review turnaround |
| `n9-multilane` | Many lanes at once |
| `n7-enterprise-gates` | Coordination & gates |
| `n3-constraint-shift` | The moving constraint |
| `n14-context-layer` | A shared AI context layer |

---

### Task 1: Curated flows in `examples/` + `curated.json`

Replace the toy `examples/sample` with the 8 curated presentation sets copied from `~/src/ai-engineer/flow/flows`, and add the curated manifest both the site and the designer seed read.

**Files:**
- Delete: `examples/sample/` (toy set; verified no test/CLI references it)
- Create: `examples/<dir>/…` for each of the 8 sets (copied verbatim: `set.json` + every `*.flow.json`)
- Create: `examples/curated.json`

**Interfaces:**
- Produces: `examples/curated.json` shaped `{ sets: [{ dir: string, title: string, caption: string }] }`. Consumed by Task 3 (`catalog.js`/test) and Task 6 (`gen-seed.mjs`).
- Produces: `examples/<dir>/set.json` shaped `{ id, title, flows: [{ slug, title }], transition?: { durationMs, holdMs, easing } }` and `examples/<dir>/<slug>.flow.json` envelopes `{ formatVersion, flow }`.

- [ ] **Step 1: Copy the 8 curated sets and remove the sample**

```bash
cd /Users/jecornwall/src/ribbonflow
git rm -r examples/sample
SRC=~/src/ai-engineer/flow/flows
for d in s12-define-implement-deploy n4-startup n11-build-and-test n12-review-turnaround \
         n9-multilane n7-enterprise-gates n3-constraint-shift n14-context-layer; do
  mkdir -p "examples/$d"
  cp "$SRC/$d/set.json" "examples/$d/"
  cp "$SRC/$d"/*.flow.json "examples/$d/"
done
ls examples
```
Expected: the 8 directories listed (no `sample`).

- [ ] **Step 2: Write `examples/curated.json`**

```json
{
  "sets": [
    { "dir": "s12-define-implement-deploy", "title": "Define → Implement → Deploy",
      "caption": "A clean three-stage pipeline. The ribbon pinches where “implement” can’t keep up — the bottleneck is visible, not annotated." },
    { "dir": "n4-startup", "title": "Startup under load",
      "caption": "Before and after: what happens to flow when a small team scales past its constraint." },
    { "dir": "n11-build-and-test", "title": "Build & test environment",
      "caption": "Slow, shared build-and-test turned fast and parallel — step between the two states." },
    { "dir": "n12-review-turnaround", "title": "Review turnaround",
      "caption": "Code review as a queue, before and after the wait is cut." },
    { "dir": "n9-multilane", "title": "Many lanes at once",
      "caption": "Forks, merges, and parallel lanes converging through shared stages." },
    { "dir": "n7-enterprise-gates", "title": "Coordination & gates",
      "caption": "Enterprise gates and rejection edges — work that loops back instead of flowing through." },
    { "dir": "n3-constraint-shift", "title": "The moving constraint",
      "caption": "Three states: widen the real constraint, then widen the wrong stage and watch nothing improve." },
    { "dir": "n14-context-layer", "title": "A shared AI context layer",
      "caption": "Before and after a shared context layer unblocks parallel AI-assisted delivery." }
  ]
}
```

- [ ] **Step 3: Verify every curated flow still builds through the CLI gallery**

Run:
```bash
node cli/bin/ribbonflow.js build examples --mode=gallery --out=/private/tmp/claude-501/-Users-jecornwall-src-ribbonflow/fb16731f-8f50-4d88-b6d9-12fd1b59574b/scratchpad/gallery-check
```
Expected: summary prints `errors: 0` and a flow count ≥ 8 (counts every state across sets). Any `✗` line is a bad/missing flow — fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add examples
git commit -m "feat(examples): curated presentation flow sets + curated.json manifest"
```

---

### Task 2: Scaffold the `site/` package

Create the workspace package and a minimal buildable app so `pnpm --filter @ribbonflow/site build` succeeds end-to-end before any real UI exists.

**Files:**
- Create: `site/package.json`
- Create: `site/vite.config.js`
- Create: `site/index.html`
- Create: `site/src/main.js`
- Create: `site/.gitignore`
- Modify: `pnpm-workspace.yaml` (add `- site`)
- Modify: `pnpm-lock.yaml` (regenerated by `pnpm install`)

**Interfaces:**
- Produces: package name `@ribbonflow/site` with scripts `dev`, `build`, `preview`, `test`. `build` honors `process.env.SITE_BASE` (default `/`).
- Consumes: `ribbonflow` and `@ribbonflow/core` as `workspace:*`.

- [ ] **Step 1: Add `site` to the workspace**

In `pnpm-workspace.yaml`, under `packages:`, add a line:
```yaml
  - site
```

- [ ] **Step 2: Write `site/package.json`**

```json
{
  "name": "@ribbonflow/site",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "Companion preview site for ribbonflow — curated flow gallery + designer launcher, deployed to GitHub Pages.",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --test test/*.test.js"
  },
  "dependencies": {
    "@ribbonflow/core": "workspace:*",
    "ribbonflow": "workspace:*"
  },
  "devDependencies": {
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 3: Write `site/vite.config.js`**

```js
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// base is /ribbonflow/ in CI (SITE_BASE), / for local dev/preview.
// fs.allow ['../..'] lets the dev server read examples/ (a sibling of site/).
// Two HTML entries: the landing page and the full-screen flow viewer.
export default defineConfig({
  base: process.env.SITE_BASE || '/',
  server: { fs: { allow: ['../..'] } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)),
      },
    },
  },
})
```
*(Note: `viewer.html` is created in Task 5. Until then, comment out the `viewer` input line, or create an empty `viewer.html` placeholder. Simplest: in this task, temporarily reduce `input` to only `main`; Task 5 adds the `viewer` entry.)*

For this task, use a single-entry config to keep the build green:
```js
import { defineConfig } from 'vite'
export default defineConfig({
  base: process.env.SITE_BASE || '/',
  server: { fs: { allow: ['../..'] } },
})
```

- [ ] **Step 4: Write `site/index.html` (placeholder)**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ribbonflow</title>
  </head>
  <body>
    <div id="app">ribbonflow preview site</div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `site/src/main.js` (placeholder)**

```js
// Entry point — Task 4 builds the landing page + gallery here.
console.log('ribbonflow preview site')
```

- [ ] **Step 6: Write `site/.gitignore`**

```
dist/
```

- [ ] **Step 7: Install (updates the lockfile) and build**

Run:
```bash
cd /Users/jecornwall/src/ribbonflow
pnpm install
pnpm --filter @ribbonflow/site build
```
Expected: `pnpm install` links the new package; `vite build` writes `site/dist/index.html` with exit 0.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml site
git commit -m "feat(site): scaffold @ribbonflow/site Vite package"
```

---

### Task 3: Flow catalog + data validation test

Build the runtime catalog (Vite glob over `examples/`) and a node test that proves every curated flow deserializes through `@ribbonflow/core`.

**Files:**
- Create: `site/src/catalog.js`
- Create: `site/test/catalog.test.js`

**Interfaces:**
- Produces: `catalog` — `Array<{ id: string, title: string, caption: string, transition: object|null, states: Array<{ slug: string, title: string, envelope: object }> }>`. `id` is the set dir; a state envelope is the raw `{ formatVersion, flow }`.
- Produces: `findFlow(id: string) → { slug, title, envelope } | null`, where `id` is `"<dir>__<slug>"`.
- Consumed by Task 4 (`gallery.js`/`main.js`) and Task 5 (`viewer.js`).

- [ ] **Step 1: Write the failing test `site/test/catalog.test.js`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { deserializeFlow } from '@ribbonflow/core'

const examplesDir = fileURLToPath(new URL('../../examples/', import.meta.url))
const curated = JSON.parse(readFileSync(path.join(examplesDir, 'curated.json'), 'utf8'))

test('curated.json lists exactly 8 sets, each with dir/title/caption', () => {
  assert.equal(curated.sets.length, 8)
  for (const s of curated.sets) {
    assert.ok(s.dir && s.title && s.caption, `set entry complete: ${JSON.stringify(s)}`)
  }
})

for (const { dir } of curated.sets) {
  test(`set "${dir}": set.json resolves and every state deserializes via core`, () => {
    const meta = JSON.parse(readFileSync(path.join(examplesDir, dir, 'set.json'), 'utf8'))
    assert.ok(meta.flows.length >= 1, `${dir} has at least one flow`)
    for (const { slug } of meta.flows) {
      const env = JSON.parse(
        readFileSync(path.join(examplesDir, dir, `${slug}.flow.json`), 'utf8'),
      )
      const flow = deserializeFlow(env) // migrates v3→v5; throws on malformed data
      assert.ok(flow && Array.isArray(flow.nodes) && flow.nodes.length > 0,
        `${dir}/${slug} deserializes to a flow with nodes`)
    }
  })
}
```

- [ ] **Step 2: Run the test to verify it passes against the curated data**

Run:
```bash
cd /Users/jecornwall/src/ribbonflow
pnpm --filter @ribbonflow/site test
```
Expected: all tests PASS. (If `deserializeFlow`'s return lacks `.nodes`, inspect one envelope with `node -e` and adjust the assertion to the actual normalized shape — but per `core/src/format`, the normalized flow carries `nodes`.)

- [ ] **Step 3: Write `site/src/catalog.js`**

```js
// catalog.js — build-time catalog of the curated flows.
//
// Vite eager-globs examples/curated.json (the allow-list + friendly copy),
// every set.json (slugs/titles/transition), and every *.flow.json envelope,
// and assembles them into the structure the gallery + viewer render.
import curated from '../../examples/curated.json'

const setMetas = import.meta.glob('../../examples/*/set.json', {
  eager: true,
  import: 'default',
})
const envelopes = import.meta.glob('../../examples/*/*.flow.json', {
  eager: true,
  import: 'default',
})

const setMetaFor = (dir) => setMetas[`../../examples/${dir}/set.json`]
const envelopeFor = (dir, slug) => envelopes[`../../examples/${dir}/${slug}.flow.json`]

function buildCatalog() {
  return curated.sets.map(({ dir, title, caption }) => {
    const meta = setMetaFor(dir)
    if (!meta) throw new Error(`curated set "${dir}" has no examples/${dir}/set.json`)
    const states = meta.flows.map(({ slug, title: stateTitle }) => {
      const envelope = envelopeFor(dir, slug)
      if (!envelope) throw new Error(`missing examples/${dir}/${slug}.flow.json`)
      return { slug, title: stateTitle, envelope }
    })
    return { id: dir, title, caption, transition: meta.transition || null, states }
  })
}

export const catalog = buildCatalog()

/** Look up one state by `"<dir>__<slug>"` (the viewer's ?id param). */
export function findFlow(id) {
  const sep = String(id || '').indexOf('__')
  if (sep < 0) return null
  const dir = id.slice(0, sep)
  const slug = id.slice(sep + 2)
  const set = catalog.find((s) => s.id === dir)
  return set?.states.find((st) => st.slug === slug) || null
}
```

- [ ] **Step 4: Verify the catalog builds in a real Vite build**

Run:
```bash
pnpm --filter @ribbonflow/site build
```
Expected: exit 0 (no glob/import errors). The catalog is tree-shaken out for now (nothing imports it yet) — this just confirms the module parses and globs resolve once Task 4 imports it; to force evaluation, temporarily add `import './catalog.js'` to `main.js`, build, then remove it. (Optional — Task 4 imports it for real.)

- [ ] **Step 5: Commit**

```bash
git add site/src/catalog.js site/test/catalog.test.js
git commit -m "feat(site): curated flow catalog + data-validation test"
```

---

### Task 4: Landing page + gallery (the core deliverable)

Render the full landing page — hero with the prominent talk CTA, origin note, gallery of live flow cards with before→after steppers, designer CTA, quick start, footer.

**Files:**
- Create: `site/src/gallery.js`
- Create: `site/src/styles.css`
- Modify: `site/index.html` (full static landing markup)
- Modify: `site/src/main.js` (mount the gallery)

**Interfaces:**
- Consumes: `catalog` from `./catalog.js`.
- Produces: `renderGallery(rootEl: Element, sets: typeof catalog): void` — appends one card per set, mounts each via `mountFlowAuto`, and wires its stepper to `handle.update()`.

**Apply the `frontend-design` skill** for typography/spacing/palette while implementing this task; the CSS below is a correct, tasteful baseline to start from (warm `#F4F2ED` ground matching the flows).

- [ ] **Step 1: Write `site/index.html` (full landing)**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ribbonflow — animated SVG flow diagrams</title>
    <meta name="description" content="Animated SVG flow diagrams whose ribbon width shows where work piles up. Built for the talk The AI Engineer, now an open-source library." />
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <header class="hero">
      <h1>ribbonflow</h1>
      <p class="tagline">
        Animated SVG flow diagrams. Particles stream along variable-width ribbons;
        the ribbon pinches at bottlenecks, so a diagram <em>shows</em> where work piles up.
      </p>
      <a class="cta cta-primary" href="https://jecornwall.com/ai-engineer" target="_blank" rel="noopener">
        ▶ See these flows in the talk — <strong>The AI&nbsp;Engineer</strong>
      </a>
      <p class="origin">
        ribbonflow began as the diagram engine for the talk
        <em>The AI Engineer</em>, then was extracted into a standalone MIT library.
      </p>
    </header>

    <main>
      <section class="gallery-section">
        <h2>Flows</h2>
        <p class="section-sub">Each plays live. Sets with multiple states step before → after.</p>
        <div id="gallery" class="gallery"></div>
      </section>

      <section class="designer-section">
        <h2>Build your own</h2>
        <p class="section-sub">Open the interactive designer — place nodes, set widths and rates, preview through the real renderer.</p>
        <a class="cta" href="designer/">Open the designer →</a>
      </section>

      <section class="quickstart-section">
        <h2>Quick start</h2>
        <pre><code>npm install ribbonflow</code></pre>
        <pre><code>import { mountFlowAuto } from 'ribbonflow'

const handle = mountFlowAuto(document.getElementById('stage'), flow)
handle.update(nextFlow)   // before → after, the deck's click idiom</code></pre>
        <p><a href="https://github.com/jecornwall/ribbonflow" target="_blank" rel="noopener">Source on GitHub →</a></p>
      </section>
    </main>

    <footer class="site-footer">MIT © 2026 Jason Cornwall</footer>

    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `site/src/gallery.js`**

```js
// gallery.js — render one live flow card per curated set.
//
// Each card mounts its first state through the real ribbonflow renderer; the
// renderer's visibility gate pauses off-screen cards. Multi-state sets get a
// stepper that drives handle.update() — the library's headline before→after
// idiom, demonstrated by the site itself.
import { mountFlowAuto } from 'ribbonflow'

export function renderGallery(rootEl, sets) {
  for (const set of sets) {
    rootEl.appendChild(renderCard(set))
  }
}

function renderCard(set) {
  const card = el('article', 'card')

  const stage = el('div', 'card-stage')
  card.appendChild(stage)

  const body = el('div', 'card-body')
  const h3 = el('h3', 'card-title')
  h3.textContent = set.title
  const caption = el('p', 'card-caption')
  caption.textContent = set.caption
  body.append(h3, caption)

  const handle = mountFlowAuto(stage, set.states[0].envelope)
  let active = 0

  if (set.states.length > 1) {
    const stepper = el('div', 'card-stepper')
    const buttons = set.states.map((state, i) => {
      const b = el('button', 'step-btn')
      b.type = 'button'
      b.textContent = state.title
      if (i === 0) b.classList.add('is-active')
      b.addEventListener('click', () => {
        if (i === active) return
        active = i
        handle.update(set.states[i].envelope)
        buttons.forEach((btn, j) => btn.classList.toggle('is-active', j === i))
        openLink.href = `viewer.html?id=${set.id}__${set.states[i].slug}`
      })
      return b
    })
    stepper.append(...buttons)
    body.appendChild(stepper)
  }

  const openLink = el('a', 'card-open')
  openLink.href = `viewer.html?id=${set.id}__${set.states[active].slug}`
  openLink.textContent = 'Open ↗'
  body.appendChild(openLink)

  card.appendChild(body)
  return card
}

function el(tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}
```

- [ ] **Step 3: Write `site/src/main.js`**

```js
import './styles.css'
import { catalog } from './catalog.js'
import { renderGallery } from './gallery.js'

renderGallery(document.getElementById('gallery'), catalog)
```

- [ ] **Step 4: Write `site/src/styles.css`**

```css
:root {
  color-scheme: light;
  --ground: #f4f2ed;
  --ink: #1b1b1a;
  --rule: rgba(0, 0, 0, 0.12);
  --accent: #1b1b1a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--ground);
  color: var(--ink);
}
.hero {
  max-width: 60rem;
  margin: 0 auto;
  padding: 4rem clamp(1rem, 5vw, 2rem) 2rem;
  text-align: center;
}
.hero h1 { font-size: clamp(2.5rem, 7vw, 4rem); margin: 0; letter-spacing: -0.03em; }
.tagline { font-size: 1.15rem; max-width: 40rem; margin: 1rem auto 1.75rem; opacity: 0.8; }
.cta {
  display: inline-block; text-decoration: none; color: var(--ink);
  border: 1px solid var(--ink); border-radius: 0.6rem;
  padding: 0.7rem 1.2rem; font-weight: 600;
  transition: transform 0.15s ease, background 0.15s ease;
}
.cta:hover { transform: translateY(-1px); }
.cta-primary { background: var(--ink); color: var(--ground); font-size: 1.05rem; }
.origin { margin: 1.75rem auto 0; max-width: 36rem; font-size: 0.95rem; opacity: 0.65; }
main { max-width: 72rem; margin: 0 auto; padding: 2rem clamp(1rem, 5vw, 2rem) 4rem; }
section { margin: 3.5rem 0; }
h2 { font-size: 1.5rem; letter-spacing: -0.01em; margin: 0 0 0.25rem; }
.section-sub { margin: 0 0 1.5rem; opacity: 0.6; }
.gallery {
  display: grid; gap: 1.5rem;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 26rem), 1fr));
}
.card {
  border: 1px solid var(--rule); border-radius: 0.8rem; overflow: hidden;
  background: #fff; display: flex; flex-direction: column;
}
.card-stage { aspect-ratio: 16 / 9; background: var(--ground); }
.card-stage svg { width: 100%; height: 100%; display: block; }
.card-body { padding: 1rem 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 0.5rem; }
.card-title { margin: 0; font-size: 1.1rem; }
.card-caption { margin: 0; font-size: 0.9rem; opacity: 0.7; }
.card-stepper { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.25rem; }
.step-btn {
  font: inherit; font-size: 0.8rem; cursor: pointer;
  border: 1px solid var(--rule); border-radius: 0.4rem; padding: 0.3rem 0.7rem;
  background: #fff; color: var(--ink);
}
.step-btn.is-active { background: var(--ink); color: var(--ground); border-color: var(--ink); }
.card-open { margin-top: 0.25rem; font-size: 0.85rem; text-decoration: none; color: var(--ink); opacity: 0.7; }
.card-open:hover { opacity: 1; }
pre {
  background: #fff; border: 1px solid var(--rule); border-radius: 0.5rem;
  padding: 1rem; overflow-x: auto; font-size: 0.85rem;
}
.site-footer { text-align: center; padding: 2rem; opacity: 0.5; font-size: 0.85rem; }
```

- [ ] **Step 5: Build and visually verify**

Run:
```bash
pnpm --filter @ribbonflow/site build
pnpm --filter @ribbonflow/site preview --port 4174
```
Then drive Playwright (MCP or the playwright-skill): navigate to `http://localhost:4174/`, screenshot full page. Confirm: the prominent talk CTA, origin note, ≥8 cards each containing an `<svg>` with `<circle>` agent particles (not blank), steppers present on multi-state cards, and clicking "After" swaps the diagram. Stop the preview server when done.

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/src/main.js site/src/gallery.js site/src/styles.css
git commit -m "feat(site): landing page + live flow gallery with before→after steppers"
```

---

### Task 5: Full-screen flow viewer

A standalone `viewer.html?id=<dir>__<slug>` page that mounts one flow full-bleed (shareable / iframe-embeddable).

**Files:**
- Create: `site/viewer.html`
- Create: `site/src/viewer.js`
- Modify: `site/vite.config.js` (restore the two-entry `rollupOptions.input` from Task 2)

**Interfaces:**
- Consumes: `findFlow` from `./catalog.js`, `mountFlowAuto` from `ribbonflow`.

- [ ] **Step 1: Restore the multi-page Vite input**

Replace `site/vite.config.js` with the two-entry version from Task 2, Step 3 (the `main` + `viewer` `rollupOptions.input`).

- [ ] **Step 2: Write `site/viewer.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ribbonflow — flow</title>
    <style>
      html, body { margin: 0; height: 100%; background: #f4f2ed; }
      #stage { position: fixed; inset: 0; }
      #stage svg { width: 100%; height: 100%; display: block; }
      .miss { font: 16px/1.5 system-ui, sans-serif; padding: 2rem; }
      .miss a { color: inherit; }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="/src/viewer.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `site/src/viewer.js`**

```js
import { mountFlowAuto } from 'ribbonflow'
import { findFlow } from './catalog.js'

const id = new URLSearchParams(location.search).get('id')
const found = id && findFlow(id)
const stage = document.getElementById('stage')

if (found) {
  document.title = `${found.title} · ribbonflow`
  mountFlowAuto(stage, found.envelope)
} else {
  stage.innerHTML = '<p class="miss">Flow not found. <a href="./">Back to the gallery</a>.</p>'
}
```

- [ ] **Step 4: Build and verify the viewer**

Run:
```bash
pnpm --filter @ribbonflow/site build
pnpm --filter @ribbonflow/site preview --port 4174
```
Drive Playwright: navigate to `http://localhost:4174/viewer.html?id=n4-startup__before`, screenshot. Confirm a full-bleed animated diagram with particles. Navigate to `?id=bogus__x` and confirm the "Flow not found" fallback. Confirm `site/dist/viewer.html` exists. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add site/vite.config.js site/viewer.html site/src/viewer.js
git commit -m "feat(site): full-screen single-flow viewer (?id=…)"
```

---

### Task 6: Designer base path + first-visit seed

Make the designer build at a configurable base and pre-seed localStorage with the curated flows on the public site only.

**Files:**
- Modify: `designer/vite.config.js` (add `base`)
- Create: `designer/src/seed/buildSeedBlob.js`
- Create: `designer/test/buildSeedBlob.test.js`
- Create: `designer/scripts/gen-seed.mjs`
- Create: `designer/src/seed/seedDesigner.js`
- Modify: `designer/src/main.js` (seed before mount)
- Modify: `designer/package.json` (add `build:site` script)
- Modify: `designer/.gitignore` (ignore `public/seed.json`)

**Interfaces:**
- Consumes: `examples/curated.json`, `examples/<dir>/set.json`, `examples/<dir>/<slug>.flow.json`; `STORE_KEY` from `designer/src/state/backends/localStorageBackend.js`.
- Produces: `buildSeedBlob(sets, updatedAt) → { sets: [{ id, title, transition?, flows: [{ slug, title, envelope, updatedAt }] }] }` (matches the localStorage backend's `scanStore()` shape).
- Produces: `designer/public/seed.json` (generated artifact) and `seedDesignerIfNeeded()` (flag-gated, idempotent).

- [ ] **Step 1: Write the failing test `designer/test/buildSeedBlob.test.js`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSeedBlob } from '../src/seed/buildSeedBlob.js'

test('buildSeedBlob shapes sets/flows for the localStorage backend', () => {
  const blob = buildSeedBlob(
    [
      {
        id: 'n4-startup',
        title: 'N4 · startup collapse',
        transition: { durationMs: 900, holdMs: 2400, easing: 'easeInOut' },
        flows: [
          { slug: 'before', title: 'Before', envelope: { formatVersion: 5, flow: { nodes: [] } } },
        ],
      },
    ],
    '2026-06-28T00:00:00.000Z',
  )
  assert.equal(blob.sets.length, 1)
  const s = blob.sets[0]
  assert.equal(s.id, 'n4-startup')
  assert.deepEqual(s.transition, { durationMs: 900, holdMs: 2400, easing: 'easeInOut' })
  assert.equal(s.flows[0].slug, 'before')
  assert.equal(s.flows[0].title, 'Before')
  assert.equal(s.flows[0].updatedAt, '2026-06-28T00:00:00.000Z')
  assert.deepEqual(s.flows[0].envelope, { formatVersion: 5, flow: { nodes: [] } })
})

test('buildSeedBlob omits transition when absent', () => {
  const blob = buildSeedBlob([{ id: 'x', title: 'X', flows: [] }], 't')
  assert.ok(!('transition' in blob.sets[0]))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ribbonflow/designer test`
Expected: FAIL — `Cannot find module '../src/seed/buildSeedBlob.js'`.

- [ ] **Step 3: Write `designer/src/seed/buildSeedBlob.js`**

```js
// buildSeedBlob.js — assemble the localStorage seed blob from curated sets.
//
// Output shape is EXACTLY the localStorage backend's scanStore() shape
// ({ sets: [{ id, title, transition?, flows: [{ slug, title, envelope, updatedAt }] }] }),
// so writing it under STORE_KEY seeds the designer directly. Pure → unit-tested.
export function buildSeedBlob(sets, updatedAt) {
  return {
    sets: sets.map((set) => ({
      id: set.id,
      title: set.title,
      ...(set.transition ? { transition: set.transition } : {}),
      flows: set.flows.map((f) => ({
        slug: f.slug,
        title: f.title,
        envelope: f.envelope,
        updatedAt,
      })),
    })),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ribbonflow/designer test`
Expected: PASS (alongside the existing designer unit tests).

- [ ] **Step 5: Write `designer/scripts/gen-seed.mjs`**

```js
// gen-seed.mjs — generate designer/public/seed.json from the curated examples.
// Run by the `build:site` script before `vite build`. Output is gitignored.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSeedBlob } from '../src/seed/buildSeedBlob.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)) // designer/scripts → repo/
const examplesDir = path.join(repoRoot, 'examples')
const curated = JSON.parse(readFileSync(path.join(examplesDir, 'curated.json'), 'utf8'))

function loadSet(dir) {
  const meta = JSON.parse(readFileSync(path.join(examplesDir, dir, 'set.json'), 'utf8'))
  const flows = meta.flows.map(({ slug, title }) => ({
    slug,
    title,
    envelope: JSON.parse(readFileSync(path.join(examplesDir, dir, `${slug}.flow.json`), 'utf8')),
  }))
  return { id: meta.id, title: meta.title, transition: meta.transition, flows }
}

const blob = buildSeedBlob(curated.sets.map((s) => loadSet(s.dir)), new Date().toISOString())
const outDir = fileURLToPath(new URL('../public/', import.meta.url))
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'seed.json'), JSON.stringify(blob))
console.log(`gen-seed: wrote ${blob.sets.length} sets → designer/public/seed.json`)
```

- [ ] **Step 6: Write `designer/src/seed/seedDesigner.js`**

```js
// seedDesigner.js — one-time localStorage seed for the public site.
//
// Gated by VITE_DESIGNER_SEED (set only by the `build:site` script) so normal
// dev/build never seeds. Idempotent: writes only when the store key is unset,
// so a returning visitor's edits are never overwritten. The seed blob is
// fetched at runtime from <base>seed.json (emitted from designer/public/).
import { STORE_KEY } from '../state/backends/localStorageBackend.js'

export async function seedDesignerIfNeeded({
  env = import.meta.env,
  storage = globalThis.localStorage,
  base = import.meta.env.BASE_URL,
  fetchFn = (...a) => globalThis.fetch(...a),
} = {}) {
  if (!env.VITE_DESIGNER_SEED) return false
  if (storage.getItem(STORE_KEY)) return false
  try {
    const res = await fetchFn(`${base}seed.json`)
    if (!res.ok) return false
    storage.setItem(STORE_KEY, await res.text())
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 7: Modify `designer/src/main.js` to seed before mount**

```js
import { createApp } from 'vue'
import App from './App.vue'
import { seedDesignerIfNeeded } from './seed/seedDesigner.js'

// Seed the localStorage store on the public site (no-op in dev/server builds),
// then mount. .finally so a seed failure never blocks the app.
seedDesignerIfNeeded()
  .catch(() => {})
  .finally(() => {
    createApp(App).mount('#app')
  })
```

- [ ] **Step 8: Add the `build:site` script to `designer/package.json`**

In the `scripts` block, add:
```json
    "build:site": "node scripts/gen-seed.mjs && VITE_DESIGNER_SEED=1 vite build",
```

- [ ] **Step 9: Add `base` to `designer/vite.config.js`**

In the `defineConfig({ … })` object, add as the first property:
```js
  base: process.env.DESIGNER_BASE || '/',
```
Leave `plugins`, `server` unchanged. (`flowStorePlugin` is a dev-server plugin; it is inert during `vite build`.)

- [ ] **Step 10: Ignore the generated seed**

Append to `designer/.gitignore`:
```
# Generated by scripts/gen-seed.mjs for the public (seeded) build
public/seed.json
```

- [ ] **Step 11: Build the seeded designer and verify**

Run:
```bash
cd /Users/jecornwall/src/ribbonflow
DESIGNER_BASE=/ribbonflow/designer/ pnpm --filter @ribbonflow/designer build:site
ls designer/public/seed.json designer/dist/seed.json designer/dist/index.html
```
Expected: `gen-seed` logs 8 sets; `designer/dist/seed.json` exists (copied from `public/`); `index.html` references assets under `/ribbonflow/designer/`. Confirm `node -e "const b=require('./designer/dist/seed.json'); console.log(b.sets.length, b.sets[0].flows[0].slug)"` prints `8` and a slug.

- [ ] **Step 12: Verify the full designer test suite still passes**

Run: `pnpm --filter @ribbonflow/designer test`
Expected: PASS (existing suites + `buildSeedBlob.test.js`).

- [ ] **Step 13: Commit**

```bash
git add designer/vite.config.js designer/src/seed designer/test/buildSeedBlob.test.js \
        designer/scripts/gen-seed.mjs designer/src/main.js designer/package.json designer/.gitignore
git commit -m "feat(designer): configurable base path + first-visit localStorage seed"
```

---

### Task 7: GitHub Actions Pages workflow

One workflow that builds the site + seeded designer, assembles them into a single artifact, and deploys to project Pages.

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `pnpm --filter @ribbonflow/site build` (env `SITE_BASE`) and `pnpm --filter @ribbonflow/designer build:site` (env `DESIGNER_BASE`).

- [ ] **Step 1: Write `.github/workflows/pages.yml`**

```yaml
name: Deploy preview site to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.20.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build preview site
        run: pnpm --filter @ribbonflow/site build
        env:
          SITE_BASE: /ribbonflow/
      - name: Build designer (seeded)
        run: pnpm --filter @ribbonflow/designer build:site
        env:
          DESIGNER_BASE: /ribbonflow/designer/
      - name: Assemble Pages artifact
        run: |
          rm -rf _site
          mkdir -p _site/designer
          cp -r site/dist/* _site/
          cp -r designer/dist/* _site/designer/
          touch _site/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Lint the workflow (if `actionlint` is available)**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/pages.yml || echo "actionlint not installed — skip"`
Expected: no errors (or the skip notice). Also sanity-check YAML: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('yaml ok')"`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: build + deploy preview site and designer to GitHub Pages"
```

- [ ] **Step 4: Note the one-time manual enablement (owner action — do NOT run unattended)**

GitHub Pages must be set to the "GitHub Actions" source once, by the repo owner:
- UI: repo Settings → Pages → Build and deployment → Source → **GitHub Actions**.
- or CLI: `gh api -X POST repos/jecornwall/ribbonflow/pages -f build_type=workflow` (use `-X PUT` if Pages already exists).

Surface this to the user at handoff; it requires admin and is outside the automated run.

---

### Task 8: End-to-end assembly verification + README

Build both apps with the real CI base paths, assemble exactly as CI does, serve under `/ribbonflow/`, and confirm the landing page, a flow card, the viewer, and the seeded designer all render. Then document the site in the README.

**Files:**
- Modify: `README.md` (add a "Preview site" section + live link)
- Test: local assembled `_site` served under a `/ribbonflow/` path prefix

- [ ] **Step 1: Build both apps with CI base paths and assemble**

Run:
```bash
cd /Users/jecornwall/src/ribbonflow
SITE_BASE=/ribbonflow/ pnpm --filter @ribbonflow/site build
DESIGNER_BASE=/ribbonflow/designer/ pnpm --filter @ribbonflow/designer build:site
SCRATCH=/private/tmp/claude-501/-Users-jecornwall-src-ribbonflow/fb16731f-8f50-4d88-b6d9-12fd1b59574b/scratchpad
rm -rf "$SCRATCH/_serve" && mkdir -p "$SCRATCH/_serve/ribbonflow/designer"
cp -r site/dist/* "$SCRATCH/_serve/ribbonflow/"
cp -r designer/dist/* "$SCRATCH/_serve/ribbonflow/designer/"
ls "$SCRATCH/_serve/ribbonflow" "$SCRATCH/_serve/ribbonflow/designer"
```
Expected: `index.html`, `viewer.html`, `assets/` under `ribbonflow/`; `index.html`, `seed.json`, `assets/` under `ribbonflow/designer/`.

- [ ] **Step 2: Serve and screenshot under the real base path**

Run (background): `python3 -m http.server 4180 --directory "$SCRATCH/_serve"`
Drive Playwright against the subpath URLs and verify:
- `http://localhost:4180/ribbonflow/` — landing renders; prominent talk CTA points to `https://jecornwall.com/ai-engineer`; ≥8 cards with animated `<circle>` particles; click a stepper "After" and confirm the diagram swaps; assets load (no 404s in console).
- `http://localhost:4180/ribbonflow/viewer.html?id=n11-build-and-test__after` — full-bleed animated flow.
- `http://localhost:4180/ribbonflow/designer/` — designer loads; its index lists the 8 seeded sets (the seed fetch wrote `ribbonflow.designer.store.v1`); opening one shows a live preview.
Stop the server when done. Any blank stage or console 404 is a failure — fix before continuing.

- [ ] **Step 3: Add a "Preview site" section to `README.md`**

Insert after the "Quick start" section:
```markdown
## Preview site

A live gallery + the interactive designer is published to GitHub Pages:
**<https://jecornwall.github.io/ribbonflow/>**. It previews a curated set of the
flows from the talk [*The AI Engineer*](https://jecornwall.com/ai-engineer) — the
presentation ribbonflow was built for — and launches the designer at
[`/designer/`](https://jecornwall.github.io/ribbonflow/designer/).

The site is the `@ribbonflow/site` package; CI (`.github/workflows/pages.yml`)
builds it plus the designer and deploys on every push to `main`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: link the GitHub Pages preview site from the README"
```

- [ ] **Step 5: Final full-suite check**

Run: `pnpm -r test`
Expected: every package's suite (core, ribbonflow, designer incl. `buildSeedBlob`, cli, site catalog) passes.

---

## Self-Review

**Spec coverage:**
- Preview a curated gallery → Tasks 1, 3, 4. ✔
- Each flow plays live; multi-flow sets step before→after via `update()` → Task 4 (`gallery.js`). ✔
- Run the designer at `/designer/`, static + seeded → Task 6; assembled under `/designer/` in Tasks 7–8. ✔
- Prominent `jecornwall.com/ai-engineer` link + origin note → Task 4 (`index.html` hero), Global Constraints. ✔
- Default project Pages, base `/ribbonflow/` → Tasks 2, 6, 7, Global Constraints. ✔
- Friendly titles, slide codes hidden → `curated.json` + cards use `set.title` (Tasks 1, 4). ✔
- Full-screen viewer → Task 5. ✔
- Deploy via GitHub Actions; one manual Pages-enable step → Task 7. ✔
- Tests: catalog validation, seed-blob unit, build smokes, visual checks → Tasks 3, 6, 4, 5, 8. ✔
- Out-of-scope items (custom domain, server backend, new adapters) → none added. ✔

**Placeholder scan:** Every code step has complete content. The only deferred item is final caption wording (provided as real, usable strings in Task 1) and frontend-design polish (Task 4 ships a complete baseline CSS, not a stub). No TBD/TODO/"handle errors" placeholders.

**Type consistency:** `catalog` entry shape (`{ id, title, caption, transition, states:[{slug,title,envelope}] }`) is defined in Task 3 and consumed identically in Tasks 4–5. `findFlow(id)` id format `"<dir>__<slug>"` is produced by the gallery "Open" links (Task 4) and parsed by the viewer (Task 5). `buildSeedBlob(sets, updatedAt)` signature + output shape are consistent across Task 6 Steps 1, 3, 5. `STORE_KEY` is imported (not redefined) from `localStorageBackend.js`. Env flags `SITE_BASE`, `DESIGNER_BASE`, `VITE_DESIGNER_SEED` are used consistently in `vite.config.js`, the `build:site` script, and the workflow.
