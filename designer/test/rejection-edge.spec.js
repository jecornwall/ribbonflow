/**
 * rejection-edge.spec.js — Playwright E2E for v1.2 rejection edges (spec §7
 * item 6, bd ai-engineer-y275 / R5).
 *
 * Exercises the full designer-canvas rejection-edge story:
 *
 *   1. DRAW — the add-rejection tool draws an edge between two nodes.
 *   2. RENDER — the dotted red bow arc appears on the editor canvas AND in
 *      the live preview (the library's FlowRejectionArc).
 *   3. PARTICLES — 'revising' agents visibly travel the back-path: the
 *      preview shows agent particles tinted toward the rejection colour
 *      (FlowGraph paints revising agents with REJECTION_PARTICLE_COLOR).
 *   4. APEX DRAG — the arc's apex handle drags, re-bowing the arc.
 *   5. ROUND-TRIP — export then re-import preserves the rejection edge.
 *
 * Entry point: /?editor opens the sample flow (intake → design → build →
 * ship) directly in the editor — same idiom as smoke.spec.js.
 *
 * The rejection edge is drawn design → intake: rejected design-work returns
 * upstream to intake and re-flows. design is fast and early, so revising
 * particles appear quickly; the test also bumps the rejection rate high so
 * the particle check is fast and deterministic.
 */

import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The agent default fill (cream) — see FlowAgent.vue. Any agent circle whose
// fill differs from this is a tinted 'revising' particle on a rejection edge.
const AGENT_CREAM = '#f4f2ed'

async function openEditor(page) {
  await page.goto('/?editor')
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Click a canvas node handle by id (centre of its bounding box). */
async function clickNode(page, nodeId) {
  const handle = page.locator(`[data-node-id="${nodeId}"]`)
  await handle.click()
}

/**
 * Draw a rejection edge from → to via the add-rejection tool. Leaves the new
 * edge selected (addRejection selects it) and the tool still on add-rejection.
 */
async function drawRejection(page, from, to) {
  await page.getByTitle('click a review node then the node rejected work returns to').click()
  await clickNode(page, from)
  await clickNode(page, to)
}

test.describe('flow designer — rejection edges (v1.2 R5)', () => {
  // ── 1 + 2: draw the edge, the dotted red arc renders ───────────────────────
  test('drawing a rejection edge renders the dotted red arc', async ({ page }) => {
    await openEditor(page)

    // No rejection arc before drawing one.
    await expect(page.locator('.canvas-rejection-edge')).toHaveCount(0)

    await drawRejection(page, 'design', 'intake')

    // The editor canvas now shows exactly one rejection arc.
    const arc = page.locator('.canvas-rejection-edge')
    await expect(arc).toHaveCount(1)
    await expect(arc.locator('.cre-arc')).toBeVisible()

    // The visible arc is dotted and red (REJECTION_COLOR #b5524b).
    const stroke = await arc.locator('.cre-arc').getAttribute('stroke')
    expect(stroke.toLowerCase()).toBe('#b5524b')
    const dash = await arc.locator('.cre-arc').getAttribute('stroke-dasharray')
    expect(dash).toBeTruthy() // a non-empty dash pattern → dotted

    // The live preview, rendered through the real library, shows the arc too.
    await expect(page.locator('.preview-pane .flow-rejection-arc')).toHaveCount(1)
  })

  // ── 3: revising particles visibly travel the rejection arc ─────────────────
  test('revising particles visibly travel the rejection arc', async ({ page }) => {
    await openEditor(page)
    await drawRejection(page, 'design', 'intake')

    // Bump the rejection rate high so almost every particle crossing `design`
    // is rejected — makes the revising-particle check fast and deterministic.
    // The rejection inspector's first slider is the rejection-% control.
    const rateSlider = page.locator('.slider').first()
    await rateSlider.evaluate((el) => {
      el.value = '90'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Poll the preview for a tinted agent circle — an agent whose fill is not
    // the default cream is a 'revising' particle on the rejection branch.
    await expect(async () => {
      const tinted = await page.evaluate((cream) => {
        const circles = document.querySelectorAll(
          '.preview-pane circle[data-agent-id]',
        )
        let n = 0
        for (const c of circles) {
          const fill = (c.getAttribute('fill') || '').toLowerCase()
          if (fill && fill !== cream) n++
        }
        return n
      }, AGENT_CREAM)
      expect(tinted).toBeGreaterThan(0)
    }).toPass({ timeout: 22_000, intervals: [500] })
  })

  // ── 4: the apex handle drags, re-bowing the arc ────────────────────────────
  test('the rejection arc apex handle drags', async ({ page }) => {
    await openEditor(page)
    await drawRejection(page, 'design', 'intake')

    // The apex drag is gated behind a non-link tool — switch to Select.
    await page.getByTitle('select / drag nodes & labels').click()

    const arcPathBefore = await page.locator('.cre-arc').getAttribute('d')

    // Grab the apex handle and drag it well upward (screen-up) — across the
    // chord, which re-bows the arc (new depth, flipped side).
    const apex = page.locator('.cre-apex')
    const box = await apex.boundingBox()
    expect(box, 'apex handle must be visible with a bounding box').not.toBeNull()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy - 220, { steps: 16 })
    await page.mouse.up()

    // The rendered arc path changed → the apex drag mutated bow geometry.
    const arcPathAfter = await page.locator('.cre-arc').getAttribute('d')
    expect(arcPathAfter).not.toBe(arcPathBefore)
  })

  // ── 5: export → import round-trips the rejection edge ──────────────────────
  test('export then re-import preserves the rejection edge', async ({ page }) => {
    await openEditor(page)
    await drawRejection(page, 'design', 'intake')

    // Export.
    const dl1 = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const download1 = await dl1
    const exported = await streamText(download1)
    const parsed1 = JSON.parse(exported)

    // The export carries the rejection edge.
    expect(Array.isArray(parsed1.flow.rejections)).toBe(true)
    expect(parsed1.flow.rejections.length).toBe(1)
    expect(parsed1.flow.rejections[0]).toMatchObject({ from: 'design', to: 'intake' })

    // Write to a temp file and import it back.
    const tmpPath = join(tmpdir(), `rejection-round-trip-${Date.now()}.flow.json`)
    writeFileSync(tmpPath, exported, 'utf8')
    await page.locator('.tb-file').setInputFiles(tmpPath)
    await page.locator('.cn-handle').first().waitFor({ state: 'visible' })

    // The imported flow still shows the rejection arc.
    await expect(page.locator('.canvas-rejection-edge')).toHaveCount(1)

    // Export again — the two serialisations must be byte-identical.
    const dl2 = page.waitForEvent('download')
    await page.getByTitle('export this flow').click()
    const download2 = await dl2
    const reexported = await streamText(download2)
    expect(JSON.stringify(JSON.parse(reexported))).toBe(JSON.stringify(parsed1))
  })
})

/** Read a Playwright download's content as a UTF-8 string. */
async function streamText(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
