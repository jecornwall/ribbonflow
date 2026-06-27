/**
 * frame.spec.js — Playwright smoke for the configurable aspect ratio
 * (bd ai-engineer-zr7k §7.1).
 *
 * Drives the real designer through /?editor (the in-memory sample flow, so this
 * spec is backend-agnostic and runs under the server-backed npm run dev like
 * every other non-authoring spec). Verifies:
 *
 *   1. The flow inspector exposes the Frame control (preset buttons + W×H).
 *   2. Picking the 1:1 preset reshapes the canvas frame guide to a square
 *      (the <rect class="ec-frame"> width == height) and rewrites it to 900×900.
 *   3. The reshape pushes the sample flow's right-hand nodes outside the
 *      narrower frame — the status strip's off-slide warning appears — WITHOUT
 *      moving any node (no rescale; the out-of-bounds machinery handles it).
 *   4. A custom W×H is reflected as the 'custom' active state.
 */

import { test, expect } from '@playwright/test'

async function openEditor(page) {
  await page.goto('/?editor')
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** The cx/cy of a node's handle circle (authored-space integers). */
async function nodePos(page, nodeId) {
  const circle = page.locator(`[data-node-id="${nodeId}"]`)
  return {
    x: Number(await circle.getAttribute('cx')),
    y: Number(await circle.getAttribute('cy')),
  }
}

/** width/height of the slide frame guide rect. */
async function frameSize(page) {
  const rect = page.locator('rect.ec-frame')
  return {
    w: Number(await rect.getAttribute('width')),
    h: Number(await rect.getAttribute('height')),
  }
}

test.describe('configurable aspect ratio', () => {
  test('switching to 1:1 reshapes the frame and flags off-slide nodes', async ({ page }) => {
    await openEditor(page)

    // The flow inspector (default selection) shows the Frame preset buttons.
    const square = page.locator('[data-testid="frame-preset-1:1"]')
    await expect(square).toBeVisible()

    // Sample flow starts 16:9 (1600×900); all four nodes fit, so no off-slide
    // warning yet.
    const start = await frameSize(page)
    expect(start.w).toBe(1600)
    expect(start.h).toBe(900)
    await expect(page.locator('.ss-oob')).toHaveCount(0)

    // Capture the right-hand node positions BEFORE the switch — the aspect
    // change must NOT move them (no rescale).
    const buildBefore = await nodePos(page, 'build')
    const shipBefore = await nodePos(page, 'ship')

    // Switch to 1:1.
    await square.click()

    // The frame guide is now square, 900×900.
    await expect.poll(async () => (await frameSize(page)).w).toBe(900)
    const after = await frameSize(page)
    expect(after.w).toBe(after.h)
    expect(after.h).toBe(900)

    // The active preset button reflects the new aspect.
    await expect(square).toHaveClass(/active/)

    // build (x≈1000) and ship (x≈1360) now sit outside the 900-wide frame:
    // the status strip warns about off-slide nodes.
    await expect(page.locator('.ss-oob')).toBeVisible()
    await expect(page.locator('.ss-oob')).toContainText('off-slide')

    // ...but the nodes themselves did NOT move (aspect change only rewrites the
    // viewBox).
    const buildAfter = await nodePos(page, 'build')
    const shipAfter = await nodePos(page, 'ship')
    expect(buildAfter).toEqual(buildBefore)
    expect(shipAfter).toEqual(shipBefore)
  })

  test('a custom W×H reads as the custom aspect', async ({ page }) => {
    await openEditor(page)

    // Type a non-preset width and commit it.
    const wInput = page.locator('[data-testid="frame-w"]')
    await wInput.fill('2100')
    await wInput.blur()

    // The frame guide widened; no preset button is active (custom ratio).
    await expect.poll(async () => (await frameSize(page)).w).toBe(2100)
    await expect(page.locator('[data-testid="frame-preset-16:9"]')).not.toHaveClass(/active/)
    await expect(page.locator('[data-testid="frame-preset-1:1"]')).not.toHaveClass(/active/)
  })
})
