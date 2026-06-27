// flow/parity/run-parity-2c.mjs
//
// ribbonflow Phase-2c parity GATE runner (bd ai-engineer-uttb).
//
// For every canonical flow state (flow/flows/**/*.flow.json), render BOTH the
// golden Vue FlowGraph (<FlowEmbed>) and the candidate imperative mountFlow in
// the parity app's compare view (agents hidden), and run TWO checks:
//   1. GEOMETRIC — extract each painted SVG with the SAME pure extractor the unit
//      tests pin (window.__extractScene) and diff leaf-shape multisets
//      (diffScenes). The 3 known deviations are auto-excluded.
//   2. PIXEL — rasterise each static scene to a canvas and diff ImageData. This
//      is the ONLY coverage for paint-ORDER / overpaint regressions that the
//      order-independent geometric multiset cannot see.
//
// The GATE VERDICT is scoped to the 21 deck-referenced flows (DECK_SET); the
// other states are bonus library coverage and never block Phase 2d.
//
// Reads only: the running parity Vite server (:5180) + flow/flows. Uses deck's
// installed playwright-chromium (read-only; no deck edits). Re-runnable. NO commit.
//
//   node run-parity-2c.mjs            # geometric + pixel gate over all states
//   node run-parity-2c.mjs --shots    # also save per-stage screenshots
import { createRequire } from 'node:module'
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffScenes } from './src/diff/diffScenes.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '..', '..')
const FLOWS = join(REPO, 'flow', 'flows')
const BASE = 'http://localhost:5180'
const OUT = join(HERE, 'out', '2c')
const wantShots = process.argv.includes('--shots')

// The AUTHORITATIVE deck-referenced set — exactly the .flow.json the deck slides
// import (grep deck/slides). The GATE VERDICT is scoped to these 21; the other
// flow/flows states are BONUS library coverage and never block Phase 2d.
const DECK_SET = new Set([
  'n11-build-and-test/before', 'n11-build-and-test/after',
  'n13-speckit-alignment/before', 'n13-speckit-alignment/after',
  'n15-language-rollout/before', 'n15-language-rollout/after',
  'n3-constraint-shift/a', 'n3-constraint-shift/b', 'n3-constraint-shift/c',
  'n4-startup/before', 'n4-startup/after',
  'n7-enterprise-gates/gates', 'n7-enterprise-gates/multiteam',
  's12-define-implement-deploy/baseline',
  'time-warp-alt/state-1', 'time-warp-alt/state-2', 'time-warp-alt/state-3',
  'time-warp-alt/state-4', 'time-warp-alt/state-5', 'time-warp-alt/state-6',
  'time-warp-alt/state-7',
])

// Diff parameters (documented in PARITY-REPORT-2c.md):
//   GEOMETRIC: coordinates rounded to 2 dp (trivial float formatting only).
//   PIXEL: a pixel counts as different when any RGB channel differs by
//   > PIXEL_CHANNEL; a state is pixel-clean when the differing-pixel RATIO ≤
//   PIXEL_RATIO. AA edge noise on an identical scene measures ~0.0003.
const PIXEL_CHANNEL = 30
const PIXEL_RATIO = 0.005

const deckRequire = createRequire(join(REPO, 'deck', 'package.json'))
const { chromium } = deckRequire('playwright-chromium')

// Enumerate flow keys exactly as ParityApp's glob does: dir/slug, no extension.
function flowKeys() {
  const keys = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.flow.json')) {
        keys.push(relative(FLOWS, p).replace(/\.flow\.json$/, '').split('\\').join('/'))
      }
    }
  }
  walk(FLOWS)
  return keys.sort()
}

// In-browser: extract both scenes + rasterise both static scenes and pixel-diff.
function browserProbe(channel) {
  const fg = document.querySelector('.stage-flowgraph svg.flow-graph')
  const mf = document.querySelector('.stage-mountflow svg.flow-graph')
  const err = document.querySelector('.case-error')
  const ex = (el) => (el && window.__extractScene ? window.__extractScene(el) : null)
  const out = {
    error: err ? err.textContent.trim().slice(0, 400) : null,
    golden: ex(fg),
    candidate: ex(mf),
    pixel: null,
  }
  if (!fg || !mf) return Promise.resolve(out)

  const W = 640, H = 360
  const raster = (svgEl) =>
    new Promise((resolve, reject) => {
      const s = svgEl.cloneNode(true)
      s.setAttribute('width', W)
      s.setAttribute('height', H)
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(s))
      const img = new Image()
      img.onload = () => {
        try {
          const c = document.createElement('canvas')
          c.width = W
          c.height = H
          const ctx = c.getContext('2d')
          ctx.fillStyle = '#fffdf5'
          ctx.fillRect(0, 0, W, H)
          ctx.drawImage(img, 0, 0, W, H)
          resolve(ctx.getImageData(0, 0, W, H))
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('svg raster load error'))
      img.src = url
    })

  return Promise.all([raster(fg), raster(mf)])
    .then(([g, c]) => {
      let diff = 0
      for (let i = 0; i < g.data.length; i += 4) {
        if (
          Math.abs(g.data[i] - c.data[i]) > channel ||
          Math.abs(g.data[i + 1] - c.data[i + 1]) > channel ||
          Math.abs(g.data[i + 2] - c.data[i + 2]) > channel
        )
          diff++
      }
      out.pixel = { diffPixels: diff, totalPixels: W * H, ratio: +(diff / (W * H)).toFixed(5) }
      return out
    })
    .catch((e) => {
      out.pixel = { error: String(e) }
      return out
    })
}

async function captureCase(page, key) {
  // agents=off so the pixel raster compares the STATIC scene (geometric extract
  // excludes agents regardless).
  await page.goto(`${BASE}/?flow=${encodeURIComponent(key)}&compare=1&agents=off`, { waitUntil: 'networkidle' })
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('.case-error') ||
        (document.querySelector('.stage-flowgraph svg.flow-graph') &&
          document.querySelector('.stage-mountflow svg.flow-graph')),
      { timeout: 8000 },
    )
  } catch {
    /* timeout — reported below */
  }
  const data = await page.evaluate(browserProbe, PIXEL_CHANNEL)
  if (wantShots && data.golden && data.candidate) {
    await page.locator('.stage-flowgraph').screenshot({ path: join(OUT, `${key.replace(/\//g, '__')}.golden.png`) })
    await page.locator('.stage-mountflow').screenshot({ path: join(OUT, `${key.replace(/\//g, '__')}.candidate.png`) })
  }
  return data
}

function summarizeTag(perTag) {
  const out = {}
  for (const [t, d] of Object.entries(perTag)) {
    if (d.missing.length || d.extra.length) {
      out[t] = { missing: d.missing.slice(0, 8), extra: d.extra.slice(0, 8), matched: d.matched }
    }
  }
  return out
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const keys = flowKeys()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1600 }, deviceScaleFactor: 1 })

  const results = []
  for (const key of keys) {
    const deck = DECK_SET.has(key)
    const cap = await captureCase(page, key)
    let entry
    if (!cap.golden || !cap.candidate) {
      entry = { key, deck, status: 'NO_RENDER', error: cap.error || 'one or both renderers produced no svg' }
    } else {
      const d = diffScenes(cap.golden, cap.candidate)
      const pr = cap.pixel && typeof cap.pixel.ratio === 'number' ? cap.pixel.ratio : null
      const pixelOk = pr != null && pr <= PIXEL_RATIO
      entry = {
        key,
        deck,
        status: d.ok && pixelOk ? 'GREEN' : 'RED',
        geometricOk: d.ok,
        pixelRatio: pr,
        pixelOk,
        viewBoxMatch: d.viewBoxMatch,
        goldenViewBox: d.goldenViewBox,
        candidateViewBox: d.candidateViewBox,
        counts: Object.fromEntries(Object.keys(cap.golden.byTag).map((t) => [t, cap.golden.byTag[t].length])),
        divergences: d.ok ? null : summarizeTag(d.perTag),
      }
    }
    results.push(entry)
    const flag = entry.deck ? 'DECK ' : 'bonus'
    const px = entry.pixelRatio != null ? `px=${entry.pixelRatio}` : ''
    console.log(`${entry.status.padEnd(9)} ${flag} ${key.padEnd(34)} ${px}`)
  }

  await browser.close()
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))

  const deck = results.filter((r) => r.deck)
  const bonus = results.filter((r) => !r.deck)
  const greens = (rs) => rs.filter((r) => r.status === 'GREEN').length
  console.log('\n── VERDICT (scoped to the 21 deck-referenced flows) ──')
  console.log(`DECK   GREEN ${greens(deck)}/${deck.length}`)
  console.log(`bonus  GREEN ${greens(bonus)}/${bonus.length}  (library coverage; does not gate 2d)`)
  for (const r of results.filter((r) => r.status !== 'GREEN')) {
    console.log(`\n${r.status} ${r.deck ? 'DECK' : 'bonus'}  ${r.key}`)
    if (r.error) console.log(`   error: ${r.error.split('\n')[0]}`)
    if (r.geometricOk === false && r.viewBoxMatch === false) console.log(`   viewBox: golden=${r.goldenViewBox} candidate=${r.candidateViewBox}`)
    if (r.divergences) console.log('   geom: ' + JSON.stringify(r.divergences))
    if (r.geometricOk && r.pixelOk === false) console.log(`   pixel-only divergence: ratio=${r.pixelRatio} (> ${PIXEL_RATIO})`)
  }
  console.log(`\nwrote ${join(OUT, 'results.json')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
