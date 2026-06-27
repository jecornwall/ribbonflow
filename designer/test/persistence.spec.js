/**
 * persistence.spec.js — static-app persistence round-trip (bd ai-engineer-zr7k §7.2).
 *
 * Runs ONLY under playwright.local.config.js (port 5175, `npm run dev:local`,
 * no VITE_FLOW_BACKEND flag → the localStorage backend). It proves the static
 * app persists the working set with no server:
 *
 *   create a set + flow → reload → still there (localStorage survived) →
 *   export the set (.flowset.json downloads) → delete the flow → import the
 *   file back → the flow is restored.
 *
 * Dialogs: newSet / newFlow use window.prompt, delete uses window.confirm — a
 * single dialog handler feeds queued prompt answers and accepts confirms.
 */

import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/** Title element for a flow card (avoids matching the id shown in the meta). */
function flowTitle(page, title) {
  return page.locator('.ix-flow-title', { hasText: title })
}

test('localStorage persists a set across reload, with export/import round-trip', async ({ page }) => {
  // Queue prompt answers (set name, then flow name); accept any confirm.
  const promptAnswers = ['PW Set', 'Intake']
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') await dialog.accept(promptAnswers.shift() ?? '')
    else await dialog.accept()
  })

  await page.goto('/')
  // Fresh localStorage: no sets yet.
  await expect(page.getByText('No flow-sets yet.')).toBeVisible()

  // ── create a set ────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: '+ New flow-set' }).click()
  const setSection = page.locator('.ix-set').filter({ hasText: 'PW Set' })
  await expect(setSection.getByRole('heading', { name: 'PW Set' })).toBeVisible()

  // ── create a flow in it (opens the editor) ──────────────────────────────────
  await setSection.getByRole('button', { name: '+ New flow' }).click()
  await page.locator('.cn-handle').first().waitFor({ state: 'visible', timeout: 15_000 })

  // Back to the index.
  await page.getByRole('button', { name: /Index/ }).click()
  await expect(flowTitle(page, 'Intake')).toBeVisible()

  // ── reload: localStorage must survive ───────────────────────────────────────
  await page.reload()
  await expect(page.locator('.ix-set').filter({ hasText: 'PW Set' })).toBeVisible()
  await expect(flowTitle(page, 'Intake')).toBeVisible()

  // ── export the set ──────────────────────────────────────────────────────────
  const setNow = page.locator('.ix-set').filter({ hasText: 'PW Set' })
  const downloadPromise = page.waitForEvent('download')
  await setNow.getByRole('button', { name: /Export/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('pw-set.flowset.json')

  // Persist the downloaded envelope to a temp file for re-upload.
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const exported = Buffer.concat(chunks).toString('utf8')
  const tmpPath = join(tmpdir(), `pw-set-${Date.now()}.flowset.json`)
  writeFileSync(tmpPath, exported, 'utf8')
  // Sanity: it is a flow-set envelope with one state.
  const parsed = JSON.parse(exported)
  expect(parsed.flowSet.states.length).toBe(1)

  // ── delete the flow ─────────────────────────────────────────────────────────
  await setNow.locator('.ix-flow-del').first().click()
  await expect(flowTitle(page, 'Intake')).toHaveCount(0)

  // ── import the file back ────────────────────────────────────────────────────
  await page.locator('.ix-set-file').setInputFiles(tmpPath)
  // A fresh set carrying the restored flow appears.
  await expect(flowTitle(page, 'Intake')).toBeVisible()
})
