/**
 * rejection-band-edge.spec.js — Playwright E2E for bd ai-engineer-91ds.
 *
 * Jason direction (2026-05-21): a rejection arc must peel off the SIDE of the
 * flow band — the top/bottom edge of the ribbon at the node's x — NOT the
 * node centerline (the middle of the ribbon). The dot then leaves the edge of
 * the flow rather than emerging from its middle.
 *
 * The sample flow nodes all sit on the centerline y=450 with width 70, so a
 * `below` rejection edge must anchor at y = 450 + 70/2 = 485. The test asserts
 * BOTH renderers agree: the editor-canvas arc (CanvasRejectionEdge / .cre-arc)
 * and the live preview rendered through the real library (FlowRejectionArc).
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'

async function openEditor(page) {
  await page.goto('/?editor')
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
}

async function clickNode(page, nodeId) {
  await page.locator(`[data-node-id="${nodeId}"]`).click()
}

async function drawRejection(page, from, to) {
  await page.getByTitle('click a review node then the node rejected work returns to').click()
  await clickNode(page, from)
  await clickNode(page, to)
}

/** Parse an `M x y Q cx cy x2 y2` path → { p0, p1 } (viewBox units). */
function parseQuadPath(d) {
  const n = d.replace(/[MQ]/g, ' ').trim().split(/\s+/).map(Number)
  return { p0: { x: n[0], y: n[1] }, p1: { x: n[4], y: n[5] } }
}

// Sample-flow geometry: every node sits on the centerline y=450; design and
// intake both have width 70, so a `below` band-edge anchor lands at y=485.
const CENTER_Y = 450
const EDGE_Y = 485

test.describe('rejection edges anchor on the band edge (bd ai-engineer-91ds)', () => {
  test('the arc peels off the band edge, not the node centerline', async ({ page }) => {
    await openEditor(page)
    await drawRejection(page, 'design', 'intake')

    // ── editor canvas (CanvasRejectionEdge) ──────────────────────────────────
    const editorD = await page.locator('.cre-arc').getAttribute('d')
    const editor = parseQuadPath(editorD)

    // The from/to anchors sit on the BOTTOM band edge (y=485), NOT the
    // centerline (y=450). A `below` bow → anchor is centre + half-width.
    expect(Math.abs(editor.p0.y - EDGE_Y)).toBeLessThan(1)
    expect(Math.abs(editor.p1.y - EDGE_Y)).toBeLessThan(1)
    expect(editor.p0.y).toBeGreaterThan(CENTER_Y + 8) // clearly off centerline

    // ── live preview through the real library (FlowRejectionArc) ─────────────
    const previewArc = page.locator('.preview-pane .flow-rejection-arc path').first()
    await expect(previewArc).toBeVisible()
    const previewD = await previewArc.getAttribute('d')
    const preview = parseQuadPath(previewD)

    // Both renderers must agree by construction (one shared rejectionEdgeAnchors).
    expect(Math.abs(preview.p0.y - EDGE_Y)).toBeLessThan(1)
    expect(Math.abs(preview.p1.y - EDGE_Y)).toBeLessThan(1)

    await page.screenshot({
      path: join('test-results', 'rejection-band-edge-91ds.png'),
      fullPage: true,
    })
  })
})
