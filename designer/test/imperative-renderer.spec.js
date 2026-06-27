/**
 * imperative-renderer.spec.js — Phase A consumer-swap smoke (bd ai-engineer-cr1x).
 *
 * The designer's last two render consumers were migrated off the legacy Vue
 * renderer (<FlowGraph> / <FlowSetPlayer>) onto the imperative mountFlow renderer
 * (Phase 2/3). This smoke is the GATE before Phase B deletes the old code: it
 * drives BOTH migrated views in a real browser and proves they render + animate +
 * stay drivable through the imperative renderer.
 *
 *   1. Editor live preview (PreviewPane.vue → mountFlow): the preview <svg>
 *      renders, agent circles animate, and a committed edit (node move) rebuilds
 *      the scene (geometry changes) — proving the previewKey → handle.update()
 *      cadence is wired.
 *
 *   2. Set-preview (SetPreview.vue → mountFlow → mountFlowSet): the player <svg>
 *      renders + animates, transport (Next / Play-Pause) drives the handle, and
 *      live transition tuning (easing <select> + a transition slider) does not
 *      crash and keeps animating — exercising the new handle.setTransition path.
 *
 * The set-preview needs a flow-set of ≥2 states on disk. We seed a throwaway
 * `smoke-e2e` set (two copies of the sample flow) into the persistence root
 * (flow/flows/) the dev-server plugin scans, and tear it down after. The slug is
 * SLUG_RE-valid (/^[a-z0-9-]+$/) so the store actually scans it; `smoke-e2e/` is
 * gitignored, so neither the fixture nor the transitionSaver's set.json write
 * dirties the working tree.
 */

import { test, expect } from '@playwright/test'
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
// flow/designer/test → flow/flows (the dev-server persistence root).
const FLOWS_ROOT = join(HERE, '..', '..', 'flows')
const SMOKE_ID = 'smoke-e2e'
const SMOKE_DIR = join(FLOWS_ROOT, SMOKE_ID)
const SAMPLE_FLOW = join(FLOWS_ROOT, 'sample', 'intake-to-ship.flow.json')

/** Seed a 2-state throwaway set by copying the sample flow into two slugs. */
function seedSmokeSet() {
  mkdirSync(SMOKE_DIR, { recursive: true })
  copyFileSync(SAMPLE_FLOW, join(SMOKE_DIR, 'state-a.flow.json'))
  copyFileSync(SAMPLE_FLOW, join(SMOKE_DIR, 'state-b.flow.json'))
  writeFileSync(
    join(SMOKE_DIR, 'set.json'),
    JSON.stringify(
      {
        id: SMOKE_ID,
        title: 'Smoke set (imperative renderer)',
        flows: [
          { slug: 'state-a', title: 'State A' },
          { slug: 'state-b', title: 'State B' },
        ],
      },
      null,
      2,
    ) + '\n',
  )
}

function cleanupSmokeSet() {
  rmSync(SMOKE_DIR, { recursive: true, force: true })
}

/** Join every ribbon path's `d` in the preview svg — a geometry fingerprint. */
async function ribbonSignature(scope) {
  return scope
    .locator('svg.flow-graph path')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d')).join('|'))
}

test.describe('imperative renderer — migrated designer views (bd ai-engineer-cr1x)', () => {
  // ── 1. editor live preview through mountFlow ────────────────────────────────
  test('editor live preview renders, animates, and rebuilds on a committed edit', async ({
    page,
  }) => {
    await page.goto('/?editor')

    const preview = page.locator('.pp-host')
    const previewSvg = preview.locator('svg.flow-graph')
    await previewSvg.waitFor({ state: 'visible', timeout: 15_000 })

    // Animating: the imperative renderer paints agent circles (sample flow seeds
    // initialAgents), proving the rAF loop is live in the preview.
    await preview
      .locator('circle[data-agent-id]')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })

    const sigBefore = await ribbonSignature(preview)

    // Commit an edit: drag the 'design' node. On drop, previewKey bumps and the
    // PreviewPane watcher calls handle.update() → a full scene rebuild.
    await page.getByTitle('select / drag nodes & labels').click()
    const node = page.locator('[data-node-id="design"]')
    const box = await node.boundingBox()
    expect(box, 'design node must have a bounding box').not.toBeNull()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 160, cy + 90, { steps: 12 })
    await page.mouse.up()

    // The preview re-rendered through the imperative renderer: still an svg, still
    // animating, and the ribbon geometry changed (proves update(), not a stale
    // frame).
    await expect(previewSvg).toBeVisible()
    await expect
      .poll(async () => ribbonSignature(preview), { timeout: 5_000 })
      .not.toBe(sigBefore)
    await preview
      .locator('circle[data-agent-id]')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
  })

  // ── 2. set-preview through mountFlow → mountFlowSet ─────────────────────────
  test('set-preview plays, transports, and tunes (setTransition) without crashing', async ({
    page,
  }) => {
    seedSmokeSet()
    try {
      await page.goto('/')
      // The index regenerates from a disk scan on GET, so the seeded set appears.
      await page.locator('.ix-set').first().waitFor({ state: 'visible', timeout: 15_000 })
      const smokeSection = page.locator('.ix-set', {
        has: page.locator('.ix-slug', { hasText: SMOKE_ID }),
      })
      await smokeSection.locator('.ix-preview').click()

      // The player renders through mountFlow → mountFlowSet: two crossfade slots,
      // each a nested mountFlow svg.
      const stage = page.locator('.sp-host')
      const playerSvg = stage.locator('svg.flow-graph').first()
      await playerSvg.waitFor({ state: 'visible', timeout: 15_000 })
      await stage
        .locator('circle[data-agent-id]')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })

      // Transport drives the handle (next / toggle); the player must not crash.
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Play / Pause' }).click()
      await expect(playerSvg).toBeVisible()

      // Live tuning through handle.setTransition: change the easing + nudge the
      // hold slider. Must not crash and must keep animating.
      await page.locator('.sp-ctl select').selectOption('linear')
      const holdSlider = page.locator('.sp-ctl input[type="range"]').first()
      await holdSlider.focus()
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')

      await expect(playerSvg).toBeVisible()
      await stage
        .locator('circle[data-agent-id]')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
    } finally {
      cleanupSmokeSet()
    }
  })
})
