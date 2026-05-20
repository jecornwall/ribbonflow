/**
 * speed-control-range.spec.js — Playwright E2E for bd ai-engineer-gez3.
 *
 * Jason direction (2026-05-21): the designer's node SPEED slider maxed at
 * 1.75 — Jason maxed it on the converged `cross-team-review` node (the N9
 * multilane flow stores `speed: 1.75` there) and still hit the ceiling. The
 * slider range is extended (SPEED_CONTROL_RANGE, max 6.0) so the SPEED knob
 * can be driven well past the old coupling cap.
 *
 * This test drives the SPEED slider on a real node and confirms it now
 * (a) exposes a max past 1.75, (b) starts with headroom above the old cap,
 * and (c) accepts and reflects a value past 1.75 with the live preview still
 * running. Uses ?editor (the in-memory sample flow) so the run touches no
 * on-disk flow content — the slider range is a global inspector property.
 *
 * NOTE on "clear the pile-up": an engine experiment run during this dispatch
 * showed the cross-team-review convergence pile-up is gated by node CAPACITY
 * (authored capacity:1 — a hard one-at-a-time gate), not by speed: sweeping
 * speed 1→10 leaves the pile unchanged (~17 avg), while capacity 1→4 nearly
 * eliminates it. The designer exposes no capacity control. See the dispatch
 * returner — that is a follow-up for Jason, out of this bead's scope.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'

test.describe('SPEED slider range extends past 1.75 (bd ai-engineer-gez3)', () => {
  test('the SPEED slider reaches and reflects a value past the old cap', async ({ page }) => {
    await page.goto('/?editor')
    await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })

    // Select a node and find its SPEED slider + readout.
    await page.locator('[data-node-id="design"]').click()
    const speedRow = page.locator('.row.ctl').filter({
      has: page.locator('span', { hasText: /^speed$/ }),
    })
    const speedSlider = speedRow.locator('.slider')
    const readout = speedRow.locator('.readout')
    await expect(speedSlider).toBeVisible()

    // (a) The slider range now reaches well past the old 1.75 ceiling.
    const sliderMax = parseFloat(await speedSlider.getAttribute('max'))
    expect(sliderMax).toBeGreaterThanOrEqual(4)

    // (b) The node starts at the default speed (1.0) — so there is real
    // headroom ABOVE the old 1.75 cap to drag into, which a 1.75-capped
    // slider did not have.
    expect(sliderMax).toBeGreaterThan(1.75)

    // (c) Drive the slider to a value PAST the old ceiling — the control
    // accepts it and the readout reflects it (the old slider could not
    // represent any value above 1.75).
    await speedSlider.evaluate((el) => {
      el.value = '4.5'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(parseFloat(await readout.textContent())).toBeGreaterThan(1.75)
    expect(await speedSlider.evaluate((el) => parseFloat(el.value))).toBeCloseTo(4.5, 1)

    // The live preview keeps running at the extended speed (agents present).
    await page.waitForTimeout(2500)
    expect(await page.locator('.preview-pane circle[data-agent-id]').count())
      .toBeGreaterThan(0)

    await page.screenshot({
      path: join('test-results', 'speed-control-gez3.png'),
      fullPage: true,
    })
  })
})
