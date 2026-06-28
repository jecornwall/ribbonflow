/**
 * authoring-ux.spec.js — Playwright E2E for the designer's authoring-UX
 * features that landed with unit tests but no browser smoke (bd ai-engineer-ahy2):
 *
 *   1. DUPLICATE FLOW — the index page's duplicate (⧉) button forks a flow;
 *      the copy appears in the set, right after its source.
 *   2. REORDER FLOW — drag-to-reorder flows within a set; the new order
 *      persists across a page reload (it is written to set.json).
 *   3. OUT-OF-BOUNDS CLAMPING — a node dragged off the slide frame is detected;
 *      the StatusStrip "bring in bounds" button clamps it back inside.
 *
 * Tests 1 + 2 drive the index page, which is backed by the flow-store
 * dev-server plugin reading/writing flow/flows/. To stay hermetic, a scratch
 * flow-set (`zz-pw-authoring`) is seeded on disk before each index-page test
 * and removed afterwards — the repo's authored flow-sets are never touched.
 * The generated flow/flows/index.json is gitignored, so disk churn there is
 * harmless.
 *
 * Test 3 drives the editor only (/?editor, the sample flow) — same idiom as
 * smoke.spec.js / rejection-edge.spec.js — and needs no persistence.
 */

import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FLOWS_ROOT = join(HERE, '../../examples')

// Scratch flow-set — `zz-` prefix sorts it last in the index, well clear of
// the repo's authored sets. Removed in afterAll.
const SCRATCH_SLUG = 'zz-pw-authoring'
const SCRATCH_DIR = join(FLOWS_ROOT, SCRATCH_SLUG)

// Three flows: the order IS the animation sequence (M4), so reorder has
// something to reorder.
const SCRATCH_FLOWS = [
  { slug: 'state-one', title: 'State One' },
  { slug: 'state-two', title: 'State Two' },
  { slug: 'state-three', title: 'State Three' },
]

/**
 * Seed the scratch flow-set on disk: a set.json plus one valid flow envelope
 * per flow (copied from the repo's sample flow so indexBuilder parses them).
 */
function seedScratchSet() {
  rmSync(SCRATCH_DIR, { recursive: true, force: true })
  mkdirSync(SCRATCH_DIR, { recursive: true })
  const sampleEnvelope = readFileSync(
    join(HERE, 'fixtures/intake-to-ship.flow.json'),
    'utf8',
  )
  for (const f of SCRATCH_FLOWS) {
    writeFileSync(join(SCRATCH_DIR, `${f.slug}.flow.json`), sampleEnvelope, 'utf8')
  }
  writeFileSync(
    join(SCRATCH_DIR, 'set.json'),
    JSON.stringify(
      { id: SCRATCH_SLUG, title: 'ZZ · Playwright authoring-UX scratch', flows: SCRATCH_FLOWS },
      null,
      2,
    ) + '\n',
    'utf8',
  )
}

/** The index-page section (<section class="ix-set">) for the scratch set. */
function scratchSetSection(page) {
  return page.locator('.ix-set').filter({ hasText: SCRATCH_SLUG })
}

/** Open the index page and wait for the scratch set to render. */
async function openIndexWithScratch(page) {
  await page.goto('/')
  await scratchSetSection(page).waitFor({ state: 'visible', timeout: 15_000 })
}

// ── index-page tests: duplicate + reorder ─────────────────────────────────────

test.describe('flow designer — authoring UX (duplicate / reorder)', () => {
  test.beforeEach(() => seedScratchSet())
  test.afterAll(() => rmSync(SCRATCH_DIR, { recursive: true, force: true }))

  // ── 1: duplicating a flow makes the copy appear in the set ─────────────────
  test('duplicating a flow adds a copy right after its source', async ({ page }) => {
    await openIndexWithScratch(page)

    const flows = scratchSetSection(page).locator('.ix-flow')
    await expect(flows).toHaveCount(3)

    // Duplicate the first flow ("State One"). The ⧉ button is title="duplicate flow".
    await flows.nth(0).getByTitle('duplicate flow').click()

    // The set now holds four flows...
    await expect(flows).toHaveCount(4)

    // ...and the copy ("State One copy") landed at index 1 — right after its
    // source — not appended at the end (server insertFlowAfter, bd ih7q).
    await expect(flows.nth(1).locator('.ix-flow-title')).toHaveText(/State One copy/)
    await expect(flows.nth(0).locator('.ix-flow-title')).toHaveText('State One')
  })

  // ── 2: drag-to-reorder persists across a reload ────────────────────────────
  test('reordering flows persists across a page reload', async ({ page }) => {
    await openIndexWithScratch(page)

    const titles = () =>
      scratchSetSection(page).locator('.ix-flow .ix-flow-title').allTextContents()

    expect(await titles()).toEqual(['State One', 'State Two', 'State Three'])

    // Drag the third flow (index 2) to the front (index 0). The list items are
    // native draggable="true" elements wired to @dragstart/@dragover/@drop —
    // dispatch those events directly so the Vue handlers fire deterministically
    // (Playwright's mouse-simulated drag does not drive HTML5 native DnD).
    const flows = scratchSetSection(page).locator('.ix-flow')
    await flows.nth(2).dispatchEvent('dragstart')
    await flows.nth(0).dispatchEvent('dragover')
    await flows.nth(0).dispatchEvent('drop')
    await flows.nth(2).dispatchEvent('dragend')

    // Optimistic local reorder applied immediately.
    await expect
      .poll(titles)
      .toEqual(['State Three', 'State One', 'State Two'])

    // Reload — refreshIndex re-reads set.json from disk. The order survived,
    // so the reorder was persisted, not just an in-memory shuffle.
    await page.reload()
    await scratchSetSection(page).waitFor({ state: 'visible' })
    expect(await titles()).toEqual(['State Three', 'State One', 'State Two'])
  })
})

// ── editor test: out-of-bounds clamping ───────────────────────────────────────

test.describe('flow designer — out-of-bounds node clamping', () => {
  test('a node dragged off the slide frame clamps back in bounds', async ({ page }) => {
    await page.goto('/?editor')
    await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })

    // Sample flow is authored within its 1600×900 frame — nothing off-slide.
    const oobButton = page.locator('.ss-oob')
    await expect(oobButton).toHaveCount(0)

    // Drag the 'ship' node into the canvas gutter — the dimmed margin OUTSIDE
    // the slide frame. The editor viewBox inflates the frame by a 12% gutter,
    // so a node dragged to the canvas corner lands well outside the frame.
    await page.getByTitle('select / drag nodes & labels').click()
    const node = page.locator('[data-node-id="ship"]')
    const nodeBox = await node.boundingBox()
    const svgBox = await page.locator('.ec-svg').boundingBox()
    expect(nodeBox, 'ship node must be visible').not.toBeNull()
    expect(svgBox, 'editor canvas must be visible').not.toBeNull()

    const cx = nodeBox.x + nodeBox.width / 2
    const cy = nodeBox.y + nodeBox.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    // Drag toward the canvas's bottom-right corner — deep in the gutter.
    await page.mouse.move(
      svgBox.x + svgBox.width - 4,
      svgBox.y + svgBox.height - 4,
      { steps: 16 },
    )
    await page.mouse.up()

    // The node is now off-slide → the StatusStrip surfaces the clamp button.
    await expect(oobButton).toBeVisible()
    await expect(oobButton).toContainText(/off-slide/)

    // Read the off-slide position — at least one coordinate is outside the
    // 1600×900 frame.
    const offSlide = await readNodePos(page, 'ship')
    expect(
      offSlide.x < 0 || offSlide.x > 1600 || offSlide.y < 0 || offSlide.y > 900,
      'ship is off-slide before clamping',
    ).toBe(true)

    // Click "bring in bounds" — bringInBounds() clamps every off-slide node.
    await oobButton.click()

    // The button is gone (no nodes off-slide)...
    await expect(oobButton).toHaveCount(0)

    // ...and the node now sits fully within the 1600×900 slide frame.
    const clamped = await readNodePos(page, 'ship')
    expect(clamped.x).toBeGreaterThanOrEqual(0)
    expect(clamped.x).toBeLessThanOrEqual(1600)
    expect(clamped.y).toBeGreaterThanOrEqual(0)
    expect(clamped.y).toBeLessThanOrEqual(900)
  })
})

/** Read a canvas node's authored-space { x, y } from its SVG cx/cy attributes. */
async function readNodePos(page, nodeId) {
  const circle = page.locator(`[data-node-id="${nodeId}"]`)
  return {
    x: Number(await circle.getAttribute('cx')),
    y: Number(await circle.getAttribute('cy')),
  }
}
