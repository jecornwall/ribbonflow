/**
 * red-ratio-control.spec.js — Playwright E2E for bd ai-engineer-s8cm.
 *
 * A source (emitter) node gains a per-emitter RED-RATIO control: the fraction
 * of its emitted particles drawn RED, signifying "bad work that should not
 * pass to production" (defective work). It is OPTIONAL and source-only —
 * default 0 emits all-black particles, the historical behaviour.
 *
 * This suite drives the new inspector control on the in-memory sample flow
 * (?editor — `intake` is its source node) and reads the live preview SVG:
 *  1. default — the red-ratio slider sits at 0 and NO preview particle is red;
 *  2. ratio 1 — every emitted particle renders red;
 *  3. a mid ratio — roughly that fraction of the live population is red;
 *  4. back to 0 — the preview returns to all-black.
 *
 * `DEFECTIVE_PARTICLE_COLOR` is '#C8201A' (flowCurve.js) — a circle's `fill`
 * attribute is that exact hex when the agent is defective, the cream
 * '#F4F2ED' otherwise. cx/cy/fill are viewBox-space attributes, unaffected by
 * the preview's CSS scale.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'

const DEFECTIVE = '#C8201A'

/** The red-ratio row — a `.row.ctl` whose label span is "red ratio". */
function redRatioRow(page) {
  return page.locator('.row.ctl').filter({
    has: page.locator('span', { hasText: /^red ratio$/ }),
  })
}

/** Count live preview particles, split by red (defective) vs not. */
function countAgents(page) {
  return page.evaluate((defective) => {
    const circles = document.querySelectorAll('.preview-pane circle[data-agent-id]')
    let red = 0
    for (const c of circles) {
      if ((c.getAttribute('fill') || '').toUpperCase() === defective) red++
    }
    return { red, total: circles.length }
  }, DEFECTIVE)
}

/** Average red/total over a few samples — the preview is a moving population. */
async function sampleAgents(page, samples = 12) {
  let red = 0, total = 0
  for (let i = 0; i < samples; i++) {
    await page.waitForTimeout(300)
    const m = await countAgents(page)
    red += m.red
    total += m.total
  }
  return { red: red / samples, total: total / samples }
}

/** Drive a range input to `value`, firing input + change (live + commit). */
async function driveSlider(slider, value) {
  await slider.evaluate((el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

test.describe('per-emitter RED-RATIO control (bd ai-engineer-s8cm)', () => {
  test('the red-ratio slider shows for a source and is hidden for a normal node', async ({ page }) => {
    await page.goto('/?editor')
    await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })

    // `design` is a normal node — no red-ratio control.
    await page.locator('[data-node-id="design"]').click()
    await expect(redRatioRow(page)).toHaveCount(0)

    // `intake` is the source node — the control shows, defaulting to 0.
    await page.locator('[data-node-id="intake"]').click()
    const slider = redRatioRow(page).locator('.slider')
    await expect(slider).toBeVisible()
    expect(parseFloat(await slider.getAttribute('min'))).toBe(0)
    expect(parseFloat(await slider.getAttribute('max'))).toBe(1)
    expect(parseFloat(await slider.inputValue())).toBe(0)
    await expect(redRatioRow(page).locator('.readout')).toHaveText('0%')
  })

  test('raising the red ratio paints preview particles red; 0 emits all black', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?editor')
    await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('.preview-pane circle[data-agent-id]')
      .first().waitFor({ state: 'visible', timeout: 15_000 })

    // ── DEFAULT (ratio 0): no particle is red ───────────────────────────────
    const base = await sampleAgents(page)
    expect(base.total).toBeGreaterThan(0)
    expect(base.red).toBe(0)
    await page.screenshot({
      path: join('test-results', 'red-ratio-s8cm-default.png'),
      fullPage: true,
    })

    await page.locator('[data-node-id="intake"]').click()
    const slider = redRatioRow(page).locator('.slider')
    const readout = redRatioRow(page).locator('.readout')
    await expect(slider).toBeVisible()

    // ── RATIO 1: every emitted particle is red ──────────────────────────────
    await driveSlider(slider, 1)
    await expect(readout).toHaveText('100%')
    // commitEdit() remounts the preview — wait for the new population.
    await page.locator('.preview-pane circle[data-agent-id]')
      .first().waitFor({ state: 'visible', timeout: 15_000 })
    const allRed = await sampleAgents(page)
    expect(allRed.total).toBeGreaterThan(0)
    expect(allRed.red).toBe(allRed.total)
    await page.screenshot({
      path: join('test-results', 'red-ratio-s8cm-full.png'),
      fullPage: true,
    })

    // ── MID RATIO (0.5): roughly half the live population is red ────────────
    await driveSlider(slider, 0.5)
    await expect(readout).toHaveText('50%')
    await page.locator('.preview-pane circle[data-agent-id]')
      .first().waitFor({ state: 'visible', timeout: 15_000 })
    const half = await sampleAgents(page)
    expect(half.total).toBeGreaterThan(2)
    const frac = half.red / half.total
    // eslint-disable-next-line no-console
    console.log(
      `s8cm red-ratio verification — base=0/${base.total.toFixed(1)} `
      + `ratio1=${allRed.red.toFixed(1)}/${allRed.total.toFixed(1)} `
      + `ratio0.5=${half.red.toFixed(1)}/${half.total.toFixed(1)} (${frac.toFixed(2)})`,
    )
    expect(frac).toBeGreaterThan(0.2)
    expect(frac).toBeLessThan(0.8)
    await page.screenshot({
      path: join('test-results', 'red-ratio-s8cm-half.png'),
      fullPage: true,
    })

    // ── BACK TO 0: the preview returns to all-black ─────────────────────────
    await driveSlider(slider, 0)
    await expect(readout).toHaveText('0%')
    await page.locator('.preview-pane circle[data-agent-id]')
      .first().waitFor({ state: 'visible', timeout: 15_000 })
    const cleared = await sampleAgents(page)
    expect(cleared.total).toBeGreaterThan(0)
    expect(cleared.red).toBe(0)
  })
})
