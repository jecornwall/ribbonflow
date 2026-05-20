/**
 * fork-authoring.spec.js — Playwright E2E for the fork/merge authoring UI
 * (bead ai-engineer-kcmj, spec 2026-05-21-flow-fork-authoring-design.md).
 *
 * Exercises the fork-rate-split editor end to end:
 *
 *   1. NO FORK — a linear node shows no rate-split section.
 *   2. BECOME A FORK — adding a 2nd successor edge surfaces the rate-split
 *      editor with one slider per branch, each at an even 50%.
 *   3. REBALANCE — dragging one branch slider rebalances its sibling so the
 *      shares still sum to 100%.
 *   4. SYNC TO forks[] — the export carries a materialised flow.forks[] entry
 *      with the authored rate split.
 *   5. RESET — "Reset to even split" drops the entry, returning to 50/50.
 *
 * Entry point: /?editor opens the sample flow (intake → design → build →
 * ship) directly in the editor — same idiom as smoke.spec.js. The fork is
 * created by adding a design → ship edge, so `design` forks into build + ship.
 */

import { test, expect } from '@playwright/test'

async function openEditor(page) {
  await page.goto('/?editor')
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Click a canvas node handle by id. */
async function clickNode(page, nodeId) {
  await page.locator(`[data-node-id="${nodeId}"]`).click()
}

/** Select a node with the select tool so the inspector opens on it. */
async function selectNode(page, nodeId) {
  await page.getByTitle('select / drag nodes & labels').click()
  await clickNode(page, nodeId)
}

/** The inspector fork-branch row whose branch label contains `text`. */
function forkRow(page, text) {
  return page
    .locator('.inspector .row.ctl')
    .filter({ has: page.locator('.branch', { hasText: text }) })
}

/** Set a range input's value and fire input + change, like a real drag+drop. */
async function dragSlider(locator, value) {
  await locator.evaluate((el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/** Read a Playwright download's content as a UTF-8 string. */
async function streamText(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

test.describe('flow designer — fork rate-split authoring (bd kcmj)', () => {
  // ── 1: a linear node shows no rate-split editor ────────────────────────────
  test('a node with one successor shows no fork rate-split section', async ({ page }) => {
    await openEditor(page)
    await selectNode(page, 'design') // design → build only
    await expect(page.locator('.inspector')).toContainText('Node')
    await expect(page.locator('.inspector h4', { hasText: 'fork' })).toHaveCount(0)
  })

  // ── 2 + 3: become a fork, rebalance the split ──────────────────────────────
  test('adding a 2nd successor surfaces the rate-split editor and rebalances', async ({ page }) => {
    await openEditor(page)

    // Add a design → ship edge: `design` now forks into build + ship.
    await page.getByTitle('click a source node then a target').click()
    await clickNode(page, 'design')
    await clickNode(page, 'ship')

    await selectNode(page, 'design')

    // The rate-split editor appears with one row per branch, each at 50%.
    await expect(page.locator('.inspector h4', { hasText: 'fork' })).toHaveCount(1)
    const buildRow = forkRow(page, 'build')
    const shipRow = forkRow(page, 'ship')
    await expect(buildRow).toHaveCount(1)
    await expect(shipRow).toHaveCount(1)
    await expect(buildRow.locator('.readout')).toHaveText('50%')
    await expect(shipRow.locator('.readout')).toHaveText('50%')

    // Drag the build branch to 80% — ship must absorb the remainder (20%).
    await dragSlider(buildRow.locator('.slider'), 80)
    await expect(buildRow.locator('.readout')).toHaveText('80%')
    await expect(shipRow.locator('.readout')).toHaveText('20%')
  })

  // ── 4: the split syncs to a flow.forks[] entry on export ───────────────────
  test('an authored split materialises a flow.forks[] entry in the export', async ({ page }) => {
    await openEditor(page)
    await page.getByTitle('click a source node then a target').click()
    await clickNode(page, 'design')
    await clickNode(page, 'ship')
    await selectNode(page, 'design')
    await dragSlider(forkRow(page, 'build').locator('.slider'), 80)

    const dl = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const parsed = JSON.parse(await streamText(await dl))

    expect(Array.isArray(parsed.flow.forks)).toBe(true)
    expect(parsed.flow.forks.length).toBe(1)
    const fork = parsed.flow.forks[0]
    expect(fork.from).toBe('design')
    const byTo = Object.fromEntries(fork.branches.map((b) => [b.to, b.rateShare]))
    expect(Math.abs(byTo.build - 0.8)).toBeLessThan(1e-6)
    expect(Math.abs(byTo.ship - 0.2)).toBeLessThan(1e-6)
  })

  // ── 5: reset to even drops the entry ───────────────────────────────────────
  test('"Reset to even split" returns the fork to 50/50 and drops the entry', async ({ page }) => {
    await openEditor(page)
    await page.getByTitle('click a source node then a target').click()
    await clickNode(page, 'design')
    await clickNode(page, 'ship')
    await selectNode(page, 'design')
    await dragSlider(forkRow(page, 'build').locator('.slider'), 80)

    await page.getByRole('button', { name: 'Reset to even split' }).click()
    await expect(forkRow(page, 'build').locator('.readout')).toHaveText('50%')
    await expect(forkRow(page, 'ship').locator('.readout')).toHaveText('50%')
    // The reset button is gone — no forks[] entry remains.
    await expect(page.getByRole('button', { name: 'Reset to even split' })).toHaveCount(0)

    const dl = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const parsed = JSON.parse(await streamText(await dl))
    expect((parsed.flow.forks || []).length).toBe(0)
  })
})
