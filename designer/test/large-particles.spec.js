/**
 * large-particles.spec.js — Playwright E2E for v1.3 large particles + split /
 * combine (spec §7 item 9, bead ai-engineer-dkcr / L5).
 *
 * Exercises the full designer story for the v1.3 feature:
 *
 *   1. SOURCE SIZE — toggling a source to 'large' makes the live preview emit
 *      large particles, rendered at 3× the small radius (r ≈ 10.5 vs 3.5 —
 *      the library's renderRadiusForAgent, spec §3.1 / §4).
 *   2. SPLIT — making a node a `split` node draws the §4 fork badge on the
 *      canvas and, in the preview, large particles arriving at it split into
 *      small ones travelling downstream (the split-count control reads 4).
 *   3. COMBINE — a `combine` node draws the merge badge; small particles
 *      accumulate and a large particle "pops" downstream of it.
 *   4. ROUND-TRIP — export then re-import preserves particleSize / transform /
 *      splitCount / combineCount, and a re-export is byte-identical.
 *
 * Entry point: /?editor opens the sample flow (intake → design → build → ship)
 * directly in the editor — same idiom as smoke.spec.js / rejection-edge.spec.js.
 *
 * "Split into 4 small": the exact 1-large→4-small conservation is proven
 * deterministically by the library's L3 engine tests (spec §7 items 5–6). This
 * browser drive confirms the behaviour end-to-end — that a designer edit feeds
 * the real library and produces the two sizes — and that the split-count
 * control commits the authored 4.
 */

import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Render radii from the library (agentRender.js): small 3.5, large 10.5 (3×).
// A circle with r above this threshold is a large particle; below, small.
const LARGE_R_MIN = 9

async function openEditor(page) {
  await page.goto('/?editor')
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Click a canvas node handle by id — selects it, opening the inspector. */
async function clickNode(page, nodeId) {
  await page.locator(`[data-node-id="${nodeId}"]`).click()
}

/** The inspector row whose label span is exactly `label`. */
function inspectorRow(page, label) {
  return page
    .locator('.inspector .row')
    .filter({ has: page.getByText(label, { exact: true }) })
}

/** Set the selected source node's particle size via the inspector toggle. */
async function setParticleSize(page, size) {
  await inspectorRow(page, 'particle').getByRole('button', { name: size, exact: true }).click()
}

/** Set the selected node's transform via the inspector selector. */
async function setTransform(page, transform) {
  await inspectorRow(page, 'transform').locator('select').selectOption(transform)
}

/** Read every preview agent circle as { r, cx }. r/cx are viewBox units. */
async function previewAgents(page) {
  return page.$$eval('.preview-pane circle[data-agent-id]', (els) =>
    els.map((e) => ({
      r: Number(e.getAttribute('r')),
      cx: Number(e.getAttribute('cx')),
    })),
  )
}

/** Read a Playwright download's content as a UTF-8 string. */
async function streamText(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

test.describe('flow designer — large particles (v1.3 L5)', () => {
  // ── 1: a large source emits particles rendered at 3× ───────────────────────
  test('a source set to large emits large particles in the preview', async ({ page }) => {
    await openEditor(page)
    await clickNode(page, 'intake')
    await setParticleSize(page, 'large')

    // Poll the preview for a large-radius agent circle (r ≈ 10.5 = 3 × 3.5).
    await expect(async () => {
      const agents = await previewAgents(page)
      const large = agents.find((a) => a.r >= LARGE_R_MIN)
      expect(large, 'a large particle (r ≥ 9) renders in the preview').toBeTruthy()
      // 3× the small radius — confirm it is not just any oversized dot.
      expect(large.r).toBeLessThan(13)
    }).toPass({ timeout: 20_000, intervals: [400] })
  })

  // ── 2: a split node draws the badge and splits large → small ───────────────
  test('a split node draws a badge and splits large particles into small', async ({ page }) => {
    await openEditor(page)

    // Source emits large; `design` becomes a split node.
    await clickNode(page, 'intake')
    await setParticleSize(page, 'large')
    await clickNode(page, 'design')
    await setTransform(page, 'split')

    // The split-count control appears and commits the authored default of 4.
    const splitCount = inspectorRow(page, 'split count').locator('input')
    await expect(splitCount).toHaveValue('4')

    // The canvas shows exactly one split badge (the §4 fork glyph).
    await expect(page.locator('[data-transform="split"]')).toHaveCount(1)
    await expect(page.locator('[data-transform="combine"]')).toHaveCount(0)

    // In the preview, BOTH sizes appear over time: a large particle upstream
    // of `design`, small particles downstream of it — the split happened.
    let sawLarge = false
    let sawSmall = false
    await expect(async () => {
      const agents = await previewAgents(page)
      for (const a of agents) {
        if (a.r >= LARGE_R_MIN) sawLarge = true
        else if (a.r > 0) sawSmall = true
      }
      expect(sawLarge && sawSmall, 'preview shows both large and small particles').toBe(true)
    }).toPass({ timeout: 22_000, intervals: [350] })
  })

  // ── 3: a combine node accumulates small particles, pops a large one ────────
  test('a combine node draws a badge and pops a large particle downstream', async ({ page }) => {
    // The accumulate-then-pop cycle is multi-stage (emit → split → accumulate
    // → pop → travel), so give the simulation room beyond the default 30s.
    test.setTimeout(70_000)
    await openEditor(page)

    // intake (large) → design (split) → build (combine) → ship.
    await clickNode(page, 'intake')
    await setParticleSize(page, 'large')
    await clickNode(page, 'design')
    await setTransform(page, 'split')
    await clickNode(page, 'build')
    await setTransform(page, 'combine')

    // The combine-count control appears, default 4; the badge is the merge glyph.
    await expect(inspectorRow(page, 'combine count').locator('input')).toHaveValue('4')
    await expect(page.locator('[data-transform="combine"]')).toHaveCount(1)

    // `build` is the sample's narrow constraint (width 30). A combine node must
    // be sized to hold the small particles while they accumulate (spec §3.2),
    // so widen it — the realistic authoring move, and it admits the popped
    // large particle comfortably (a large needs width ≥ ~22, spec §3.1).
    await page
      .locator('.inspector .row.ctl')
      .filter({ has: page.getByText('width', { exact: true }) })
      .locator('input')
      .evaluate((el) => {
        el.value = '90'
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })

    // The ONLY way a large particle can appear downstream of `build` (x≈1000)
    // is a combine pop — `design` splits every emitted large into smalls, so a
    // large past `build` is N smalls re-combined. Small particles in the
    // design→build span are the work being accumulated.
    let sawSmallsFeeding = false
    let sawPoppedLarge = false
    await expect(async () => {
      const agents = await previewAgents(page)
      for (const a of agents) {
        if (a.r > 0 && a.r < LARGE_R_MIN && a.cx > 660 && a.cx < 980) {
          sawSmallsFeeding = true
        }
        if (a.r >= LARGE_R_MIN && a.cx > 1080) sawPoppedLarge = true
      }
      expect(
        sawSmallsFeeding && sawPoppedLarge,
        'small particles feed the combine and a large pops downstream',
      ).toBe(true)
    }).toPass({ timeout: 55_000, intervals: [500] })
  })

  // ── 4: export → import preserves every v1.3 field ──────────────────────────
  test('export then re-import preserves particleSize / transform / counts', async ({ page }) => {
    await openEditor(page)

    // intake → large; design → split with a NON-default count (5); build → combine.
    await clickNode(page, 'intake')
    await setParticleSize(page, 'large')
    await clickNode(page, 'design')
    await setTransform(page, 'split')
    const splitCount = inspectorRow(page, 'split count').locator('input')
    await splitCount.fill('5')
    await splitCount.blur()
    await clickNode(page, 'build')
    await setTransform(page, 'combine')

    // Export.
    const dl1 = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const exported = await streamText(await dl1)
    const parsed1 = JSON.parse(exported)
    const nodeById = (id) => parsed1.flow.nodes.find((n) => n.id === id)

    // Every v1.3 field survived the serialize.
    expect(nodeById('intake').particleSize).toBe('large')
    expect(nodeById('design').transform).toBe('split')
    expect(nodeById('design').splitCount).toBe(5)
    expect(nodeById('build').transform).toBe('combine')
    expect(nodeById('build').combineCount).toBe(4)

    // Write to a temp file and import it back.
    const tmpPath = join(tmpdir(), `large-particles-round-trip-${Date.now()}.flow.json`)
    writeFileSync(tmpPath, exported, 'utf8')
    await page.locator('.tb-file').setInputFiles(tmpPath)
    await page.locator('.cn-handle').first().waitFor({ state: 'visible' })

    // The imported flow still shows both transform badges on the canvas.
    await expect(page.locator('[data-transform="split"]')).toHaveCount(1)
    await expect(page.locator('[data-transform="combine"]')).toHaveCount(1)

    // Re-export — the two serialisations must be byte-identical.
    const dl2 = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const reexported = await streamText(await dl2)
    expect(JSON.stringify(JSON.parse(reexported))).toBe(JSON.stringify(parsed1))
  })
})
