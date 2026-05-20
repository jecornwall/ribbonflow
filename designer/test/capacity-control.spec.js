/**
 * capacity-control.spec.js — Playwright E2E for bd ai-engineer-ey0b.
 *
 * The designer's node inspector re-adds a per-node CAPACITY control — the
 * field v1.1 dropped when LENGTH / SPEED / WIDTH replaced width/capacity/
 * latency. `capacity` is the max particles a node processes concurrently; it
 * is OPTIONAL — when absent the library derives it from width. The control is
 * an explicit OVERRIDE: an "override capacity" checkbox materialises an
 * integer the slider then drives across CAPACITY_CONTROL_RANGE.
 *
 * Why it matters: the N9 multilane flow's `cross-team-review` node (3 inbound
 * paths, authored `capacity: 1`) backs up a convergence pile-up. An engine
 * sweep (recorded on the bead) proved the pile is CAPACITY-bound, not
 * speed-bound — sweeping speed leaves it ~17 agents, while capacity 1→4
 * nearly clears it. This suite drives the new control and verifies that.
 *
 * Two tests:
 *  1. functional — on the in-memory sample flow (?editor): the override
 *     checkbox toggles the slider on/off, the slider reaches past the
 *     width-derived ceiling, and dragging it materialises node.capacity.
 *  2. verification — opens the real N9 multilane flow, measures the pile-up
 *     at cross-team-review's entrance with capacity 1, sets capacity to 4 via
 *     the inspector, and confirms the pile clears. Captures pre/post images.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'

/**
 * The on-disk N9 multilane flow. Imported (not opened-from-store) so the
 * verification run never triggers the designer's auto-save — the authored
 * `capacity: 1` bottleneck optic on disk is left untouched. Playwright's cwd
 * is flow/designer/, so the flow content sits one level up.
 */
const N9_FLOW_PATH = join(process.cwd(), '..', 'flows', 'n9-multilane', 'multilane.flow.json')

/** The capacity-row slider/readout — a `.row.ctl` whose label span is "capacity". */
function capacityRow(page) {
  return page.locator('.row.ctl').filter({
    has: page.locator('span', { hasText: /^capacity$/ }),
  })
}

/** The "override capacity" checkbox row. */
function overrideRow(page) {
  return page.locator('.row.couple').filter({
    has: page.locator('span', { hasText: /^override capacity$/ }),
  })
}

test.describe('per-node CAPACITY control (bd ai-engineer-ey0b)', () => {
  test('the override checkbox toggles a capacity slider that reaches past the width ceiling', async ({ page }) => {
    await page.goto('/?editor')
    await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })

    // Select a normal node — the sample flow's nodes carry no authored
    // capacity, so the override starts OFF and the slider is hidden.
    await page.locator('[data-node-id="design"]').click()
    const override = overrideRow(page).locator('input[type="checkbox"]')
    await expect(override).toBeVisible()
    await expect(override).not.toBeChecked()
    await expect(capacityRow(page)).toHaveCount(0)

    // Turn the override ON — the slider appears.
    await override.check()
    const slider = capacityRow(page).locator('.slider')
    const readout = capacityRow(page).locator('.readout')
    await expect(slider).toBeVisible()

    // The slider range reaches past the width-derived ceiling (~8 at the
    // widest node) so a converged node can be driven well above it.
    const sliderMax = parseFloat(await slider.getAttribute('max'))
    expect(sliderMax).toBeGreaterThanOrEqual(8)
    const sliderMin = parseFloat(await slider.getAttribute('min'))
    expect(sliderMin).toBe(1) // capacity:1 — the strict one-at-a-time gate

    // Drive the slider — the explicit override is materialised + reflected.
    await slider.evaluate((el) => {
      el.value = '9'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(parseInt(await readout.textContent(), 10)).toBe(9)

    // Turn the override OFF — the slider is gone and the width-derived
    // default is shown read-only instead.
    await override.uncheck()
    await expect(capacityRow(page)).toHaveCount(0)
    await expect(page.locator('.inspector .hint', { hasText: /capacity auto/ }))
      .toBeVisible()
  })

  test('setting cross-team-review capacity to 4 clears the N9 convergence pile-up', async ({ page }) => {
    test.setTimeout(150_000)

    // ── load the real N9 multilane flow via IMPORT (no auto-save) ───────────
    // Importing leaves `currentId` unset, so the auto-save watcher never
    // fires — the run cannot mutate the on-disk capacity:1 bottleneck optic.
    await page.goto('/?editor')
    await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('input.tb-file').setInputFiles(N9_FLOW_PATH)
    await page.locator('[data-node-id="cross-team-review"]')
      .waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('.preview-pane circle[data-agent-id]')
      .first().waitFor({ state: 'visible', timeout: 15_000 })

    // Two metrics, both read from the preview SVG (cx/cy are viewBox units,
    // unaffected by CSS scale):
    //  - pile  — agents in the convergence funnel feeding cross-team-review
    //            (the 3 build lanes converging on the node at x:1100,y:450);
    //  - total — every live preview agent. A capacity-bound node backs the
    //            whole upstream up, so total climbs when the node cannot keep
    //            pace and stabilises lower once it can.
    const measure = () => page.evaluate(() => {
      const circles = document.querySelectorAll('.preview-pane circle[data-agent-id]')
      let pile = 0
      for (const c of circles) {
        const x = parseFloat(c.getAttribute('cx'))
        const y = parseFloat(c.getAttribute('cy'))
        if (x >= 600 && x <= 1130 && y >= 120 && y <= 800) pile++
      }
      return { pile, total: circles.length }
    })
    const sampleAvg = async (samples = 10) => {
      let pile = 0, total = 0
      for (let i = 0; i < samples; i++) {
        await page.waitForTimeout(300)
        const m = await measure()
        pile += m.pile
        total += m.total
      }
      return { pile: pile / samples, total: total / samples }
    }
    // Let a capacity-bound run accumulate its pile — the bead's engine sweep
    // measured ~17 at steady state, which needs real accumulation time.
    const RUN_MS = 40_000

    // ── PRE: authored capacity:1 — the convergence pile builds up ───────────
    await page.waitForTimeout(RUN_MS)
    const pre = await sampleAvg()
    await page.screenshot({
      path: join('test-results', 'capacity-ey0b-pre.png'),
      fullPage: true,
    })

    // ── select cross-team-review and raise its capacity 1 → 4 ───────────────
    await page.locator('[data-node-id="cross-team-review"]').click()
    // The node authors capacity:1, so the override is already ON and the
    // capacity slider already shown — sitting at 1.
    const slider = capacityRow(page).locator('.slider')
    const readout = capacityRow(page).locator('.readout')
    await expect(slider).toBeVisible()
    expect(parseInt(await readout.textContent(), 10)).toBe(1)

    await slider.evaluate((el) => {
      el.value = '4'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(parseInt(await readout.textContent(), 10)).toBe(4)

    // ── POST: capacity:4 — the preview remounts; let it run the same window ─
    await page.waitForTimeout(RUN_MS)
    const post = await sampleAvg()
    await page.screenshot({
      path: join('test-results', 'capacity-ey0b-post.png'),
      fullPage: true,
    })

    // The simulation is still running (agents present).
    expect(await page.locator('.preview-pane circle[data-agent-id]').count())
      .toBeGreaterThan(0)

    // eslint-disable-next-line no-console
    console.log(
      `N9 cross-team-review capacity verification — `
      + `PRE(cap1): pile=${pre.pile.toFixed(1)} total=${pre.total.toFixed(1)} | `
      + `POST(cap4): pile=${post.pile.toFixed(1)} total=${post.total.toFixed(1)}`,
    )

    // The capacity:1 run must show a real pile-up — the convergence funnel is
    // congested and the whole system has backed up.
    expect(pre.pile).toBeGreaterThan(6)

    // Raising capacity to 4 clears it: the funnel pile and the system-wide
    // agent count both drop sharply. The engine sweep measured the entrance
    // pile ~17 → ~1.4; a margin-bearing assertion proves the designer control
    // reaches the engine and changes its behaviour.
    expect(post.pile).toBeLessThan(pre.pile * 0.65)
    expect(post.total).toBeLessThan(pre.total)
  })
})
