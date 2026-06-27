import { test, expect } from '@playwright/test'

for (const [name, url] of [['vue', 'http://localhost:5191/'], ['react', 'http://localhost:5192/']]) {
  test(`${name} adapter: renders an svg with agent circles, then updates on swap`, async ({ page }) => {
    await page.goto(url)
    const svg = page.locator('svg.flow-graph')
    await expect(svg).toBeVisible()
    // The visibility-gated loop paints agent circles once on-screen.
    await expect(page.locator('svg.flow-graph circle').first()).toBeVisible({ timeout: 5000 })
    // Swap the flow prop — the third node ('mid') appears in the updated scene.
    await page.locator('#swap').click()
    await expect(page.getByText('mid')).toBeVisible({ timeout: 5000 })
  })
}
