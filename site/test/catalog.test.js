import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { deserializeFlow } from '@ribbonflow/core'

const examplesDir = fileURLToPath(new URL('../../examples/', import.meta.url))
const curated = JSON.parse(readFileSync(path.join(examplesDir, 'curated.json'), 'utf8'))

test('curated.json lists exactly 8 sets, each with dir/title/caption', () => {
  assert.equal(curated.sets.length, 8)
  for (const s of curated.sets) {
    assert.ok(s.dir && s.title && s.caption, `set entry complete: ${JSON.stringify(s)}`)
  }
})

for (const { dir } of curated.sets) {
  test(`set "${dir}": set.json resolves and every state deserializes via core`, () => {
    const meta = JSON.parse(readFileSync(path.join(examplesDir, dir, 'set.json'), 'utf8'))
    assert.ok(meta.flows.length >= 1, `${dir} has at least one flow`)
    for (const { slug } of meta.flows) {
      const env = JSON.parse(
        readFileSync(path.join(examplesDir, dir, `${slug}.flow.json`), 'utf8'),
      )
      const flow = deserializeFlow(env) // migrates v3→v5; throws on malformed data
      assert.ok(flow && Array.isArray(flow.nodes) && flow.nodes.length > 0,
        `${dir}/${slug} deserializes to a flow with nodes`)
    }
  })
}
