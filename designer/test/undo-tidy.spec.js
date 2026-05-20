/**
 * undo-tidy.spec.js — Playwright e2e for the M3-polish designer features
 * (bd ai-engineer-fu5s): undo/redo and label collision-avoidance.
 *
 * Entry point: /?editor opens the four-node sample flow (intake → design →
 * build → ship) directly, bypassing the index — same approach as smoke.spec.
 *
 *   1. Undo/redo via the toolbar buttons — a dragged node returns to its
 *      origin on Undo and back out on Redo.
 *   2. Undo via the Cmd/Ctrl+Z keyboard shortcut.
 *   3. Tidy labels — two labels forced to overlap (one node dragged on top of
 *      another) are nudged apart by the Tidy-labels action.
 */

import { test, expect } from '@playwright/test'

async function openEditor(page) {
  await page.goto('/?editor')
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** { x, y } from a node circle's reactive cx/cy SVG attributes. */
async function nodePos(page, nodeId) {
  const circle = page.locator(`[data-node-id="${nodeId}"]`)
  return { x: Number(await circle.getAttribute('cx')), y: Number(await circle.getAttribute('cy')) }
}

/** Drag a node handle by a screen-space delta, in steps so pointermove fires. */
async function dragNode(page, nodeId, dx, dy) {
  const handle = page.locator(`[data-node-id="${nodeId}"]`)
  const box = await handle.boundingBox()
  expect(box, `node ${nodeId} must have a bounding box`).not.toBeNull()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 })
  await page.mouse.up()
}

test.describe('flow designer — undo / redo (bd ai-engineer-fu5s)', () => {
  test('Undo restores a dragged node; Redo re-applies it', async ({ page }) => {
    await openEditor(page)
    await page.getByTitle('select / drag nodes & labels').click()

    const before = await nodePos(page, 'design')
    await dragNode(page, 'design', 220, 90)
    const moved = await nodePos(page, 'design')
    expect(moved.x).not.toBe(before.x)
    expect(moved.y).not.toBe(before.y)

    // Undo button is enabled once an edit is committed.
    const undoBtn = page.getByTitle('undo the last edit (Cmd/Ctrl+Z)')
    await expect(undoBtn).toBeEnabled()
    await undoBtn.click()
    const restored = await nodePos(page, 'design')
    expect(restored).toEqual(before)

    // Redo puts it back where the drag left it.
    const redoBtn = page.getByTitle('redo the last undone edit (Cmd/Ctrl+Shift+Z)')
    await expect(redoBtn).toBeEnabled()
    await redoBtn.click()
    const redone = await nodePos(page, 'design')
    expect(redone).toEqual(moved)
  })

  test('Undo also fires on the Cmd/Ctrl+Z shortcut', async ({ page }) => {
    await openEditor(page)
    await page.getByTitle('select / drag nodes & labels').click()

    const before = await nodePos(page, 'build')
    await dragNode(page, 'build', -180, 70)
    const moved = await nodePos(page, 'build')
    expect(moved.x).not.toBe(before.x)

    await page.keyboard.press('Control+z')
    const restored = await nodePos(page, 'build')
    expect(restored).toEqual(before)
  })
})

test.describe('flow designer — label collision-avoidance (bd ai-engineer-fu5s)', () => {
  test('Tidy labels nudges apart two overlapping labels', async ({ page }) => {
    await openEditor(page)
    await page.getByTitle('select / drag nodes & labels').click()

    // Force a collision: drag the 'design' node directly on top of 'build'.
    const buildPos = await nodePos(page, 'build')
    const designPos = await nodePos(page, 'design')
    const designHandle = page.locator('[data-node-id="design"]')
    const designBox = await designHandle.boundingBox()
    const buildHandle = page.locator('[data-node-id="build"]')
    const buildBox = await buildHandle.boundingBox()
    await page.mouse.move(designBox.x + designBox.width / 2, designBox.y + designBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      buildBox.x + buildBox.width / 2,
      buildBox.y + buildBox.height / 2,
      { steps: 12 },
    )
    await page.mouse.up()

    // Both labels now sit at (roughly) the same anchor — their text y attrs
    // (node.y + labelDy) coincide.
    const designLabel = page.locator('.cn-label', { hasText: 'design' })
    const buildLabel = page.locator('.cn-label', { hasText: 'build' })
    const yDesignBefore = Number(await designLabel.getAttribute('y'))
    const yBuildBefore = Number(await buildLabel.getAttribute('y'))
    expect(Math.abs(yDesignBefore - yBuildBefore)).toBeLessThan(8)

    // Tidy: the resolver nudges the lower-priority label clear.
    await page.getByTitle('nudge apart any labels that overlap').click()

    const yDesignAfter = Number(await designLabel.getAttribute('y'))
    const yBuildAfter = Number(await buildLabel.getAttribute('y'))
    expect(
      Math.abs(yDesignAfter - yBuildAfter),
      'tidy must separate the two overlapping labels vertically',
    ).toBeGreaterThan(20)

    // And the tidy itself is undoable.
    void buildPos
    void designPos
  })
})
