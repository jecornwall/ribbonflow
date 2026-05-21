/**
 * verify-j5cq-constraint-label.spec.js — bd ai-engineer-j5cq
 *
 * Verifies the firebrick constraint-stage label accent restored in the flow
 * library (FlowGraph → FlowSegmentMarker, driven by isConstraintNode).
 *
 * Post-M5 FlowGraph keyed the label colour off `kind === 'constraint'` alone;
 * v3+ flows encode the constraint as `colorScheme: 'red'`, so every constraint
 * label fell back to plain grey. Jason decided (2026-05-21) to RESTORE the
 * accent — the red is the narrative-load-bearing visual argument of the
 * constraint slides.
 *
 * Strategy: open the designer editor, import each affected flow file via the
 * hidden file input, then read the SVG <text> fill of the constraint stage's
 * label in the live preview (which renders through the real library).
 *
 *   firebrick CONSTRAINT_INK = #E2522B   grey default = #555555
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FLOWS = join(HERE, '..', '..', 'flows')
const FIREBRICK = '#E2522B'

// Affected flows: slide → flow file → constraint node label.
const CASES = [
  { slide: 'N3',  file: 'n3-baseline/baseline.flow.json',          label: 'implementation' },
  { slide: 'N8',  file: 'n9-multilane/multilane.flow.json',        label: 'cross-team review' },
  { slide: 'N16', file: 'n16-review-turnaround/before.flow.json',  label: 'code review' },
  { slide: 'N18', file: 'n18-speckit-alignment/before.flow.json',  label: 'arch' },
]

async function importFlow(page, relFile) {
  await page.goto('/?editor')
  await page.locator('.cn-handle').first().waitFor({ state: 'visible' })
  await page.locator('.tb-file').setInputFiles(join(FLOWS, relFile))
  await page.locator('.cn-handle').first().waitFor({ state: 'visible' })
  // Let the preview pane settle.
  await page.locator('.pp-stage svg').first().waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
}

for (const { slide, file, label } of CASES) {
  test(`${slide}: constraint label "${label}" renders firebrick, not grey`, async ({ page }) => {
    // Sanity-check the fixture really encodes a constraint via colorScheme:'red'.
    const parsed = JSON.parse(readFileSync(join(FLOWS, file), 'utf8'))
    const nodes = (parsed.flow ?? parsed).nodes
    const constraint = nodes.find(
      (n) => n.colorScheme === 'red' || n.kind === 'constraint',
    )
    expect(constraint, `${file} must have a constraint node`).toBeTruthy()

    await importFlow(page, file)

    // The constraint stage's label <text> in the preview SVG. fenceMarkers
    // lowercases via CSS text-transform, so match case-insensitively on the
    // node's authored label.
    const wanted = constraint.label.trim().toLowerCase()
    const fill = await page.evaluate((want) => {
      const stage = document.querySelector('.pp-stage')
      const texts = [...stage.querySelectorAll('text')]
      const hit = texts.find((t) => (t.textContent || '').trim().toLowerCase() === want)
      return hit ? hit.getAttribute('fill') : null
    }, wanted)

    expect(fill, `constraint label "${label}" should be present in preview`).toBeTruthy()
    expect(fill.toUpperCase()).toBe(FIREBRICK)

    await page.locator('.pp-stage').screenshot({
      path: join(HERE, '..', 'playwright-review', `verify-j5cq-${slide}.png`),
    })
  })
}
