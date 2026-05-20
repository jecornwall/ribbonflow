/**
 * smoke.spec.js — Playwright smoke test for the flow designer (bd ai-engineer-99hk).
 *
 * Exercises the three M3 quality-gate behaviours:
 *
 *   1. Node drag — a dragged node's position changes.
 *   2. Export — the Export button produces valid flow JSON.
 *   3. Round-trip — import of the exported JSON restores the flow exactly
 *      (the exported JSON re-imports losslessly).
 *
 * Entry point: navigate to /?editor, which bypasses the index page and opens
 * the sample flow (intake → design → build → ship) directly in the editor.
 * The sample flow has four nodes, so we don't need the persistence dialogs.
 *
 * Drag strategy: read the node circle's cx/cy SVG attributes before and after
 * the drag — these are authored-space coordinates written reactively by Vue,
 * so they reliably reflect the mutation layer's state without needing window
 * exposure of the doc object.
 *
 * Export strategy: Playwright's download interception (page.waitForEvent) to
 * capture the blob the toolbar's Export button triggers via a.click().
 *
 * Import strategy: page.setInputFiles on the hidden <input type="file"> that
 * the toolbar's Import button delegates to.
 */

import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate to the designer editor view (sample flow, no persistence needed).
 * Waits until at least one canvas node handle is visible before returning.
 */
async function openEditor(page) {
  await page.goto('/?editor')
  // Wait for the editor canvas SVG to appear and at least one node to render.
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/**
 * Return { x, y } from the SVG circle's cx/cy attributes for a given node id.
 * These are authored-space integers written reactively by CanvasNode.vue.
 */
async function nodePos(page, nodeId) {
  const circle = page.locator(`[data-node-id="${nodeId}"]`)
  const cx = await circle.getAttribute('cx')
  const cy = await circle.getAttribute('cy')
  return { x: Number(cx), y: Number(cy) }
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('flow designer smoke', () => {
  // ── 1. node drag ────────────────────────────────────────────────────────────
  test('drag moves the node to a new position', async ({ page }) => {
    await openEditor(page)

    // Pick the 'design' node (middle of the pipeline) so the drag has space.
    const nodeId = 'design'
    const before = await nodePos(page, nodeId)

    // Ensure the Select tool is active (it is by default, but be explicit).
    await page.getByTitle('select / drag nodes & labels').click()

    // Drag the node 200px right and 80px down in screen space. The SVG viewBox
    // scales to the element, so the authored-space delta is proportional but
    // always non-zero for a drag that large.
    const handle = page.locator(`[data-node-id="${nodeId}"]`)
    const box = await handle.boundingBox()
    expect(box, 'canvas node must be visible with a bounding box').not.toBeNull()

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    // Move in steps so the SVG pointermove handler fires reliably.
    await page.mouse.move(cx + 200, cy + 80, { steps: 12 })
    await page.mouse.up()

    const after = await nodePos(page, nodeId)
    expect(after.x).not.toBe(before.x)
    expect(after.y).not.toBe(before.y)
  })

  // ── 2. export produces valid flow JSON ──────────────────────────────────────
  test('export produces valid flow JSON', async ({ page }) => {
    await openEditor(page)

    // Intercept the download triggered by the Export button.
    const downloadPromise = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const download = await downloadPromise

    // Read the downloaded content.
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')

    // Must be valid JSON with the expected envelope fields.
    // The library serialiser uses `formatVersion` (integer) as the envelope
    // version discriminant — not `version`. See serializeFlow in the library.
    let envelope
    expect(() => { envelope = JSON.parse(text) }, 'export must be valid JSON').not.toThrow()
    expect(envelope).toHaveProperty('formatVersion')
    expect(envelope.formatVersion).toBeGreaterThanOrEqual(1)
    expect(envelope).toHaveProperty('flow')
    expect(envelope.flow).toHaveProperty('nodes')
    expect(Array.isArray(envelope.flow.nodes)).toBe(true)
    expect(envelope.flow.nodes.length).toBeGreaterThan(0)
    // Sample flow has four nodes.
    expect(envelope.flow.nodes.length).toBe(4)
    // Filename is the designer's default export name.
    expect(download.suggestedFilename()).toBe('designer.flow.json')
  })

  // ── 3. round-trip: export then re-import restores the flow ──────────────────
  test('round-trip: re-import of exported JSON restores the flow', async ({ page }) => {
    await openEditor(page)

    // Step A: export the current (unmodified sample) flow.
    const downloadPromise = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const download = await downloadPromise

    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const exported = Buffer.concat(chunks).toString('utf8')
    const exportedParsed = JSON.parse(exported)

    // Collect the node ids from the export.
    const exportedNodeIds = exportedParsed.flow.nodes.map((n) => n.id).sort()

    // Step B: write the exported JSON to a temp file for file-input upload.
    const tmpPath = join(tmpdir(), `smoke-round-trip-${Date.now()}.flow.json`)
    writeFileSync(tmpPath, exported, 'utf8')

    // Step C: import the file back via the hidden <input type="file">.
    // The toolbar renders <input type="file" class="tb-file"> — we set the
    // file directly without triggering the button click (Playwright can set
    // files on hidden inputs).
    await page.locator('.tb-file').setInputFiles(tmpPath)

    // Wait for the import to settle: the canvas must still show the nodes.
    await page.locator('.cn-handle').first().waitFor({ state: 'visible' })

    // Step D: export again and compare node ids — they must match the original.
    const download2Promise = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const download2 = await download2Promise

    const stream2 = await download2.createReadStream()
    const chunks2 = []
    for await (const chunk of stream2) chunks2.push(chunk)
    const reimported = Buffer.concat(chunks2).toString('utf8')
    const reimportedParsed = JSON.parse(reimported)
    const reimportedNodeIds = reimportedParsed.flow.nodes.map((n) => n.id).sort()

    // Node identity must survive the round-trip.
    expect(reimportedNodeIds).toEqual(exportedNodeIds)

    // Deep structural equality: the two serialisations must be byte-for-byte
    // equal (modulo any whitespace normalisation). JSON.stringify with stable
    // sorting gives a deterministic comparison.
    expect(JSON.stringify(reimportedParsed)).toBe(JSON.stringify(exportedParsed))
  })
})
