// flow/cli/test/collect.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectFlows } from '../src/collect.js'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

test('collectFlows: recurses and returns every *.flow.json under the dir', async () => {
  const found = await collectFlows(FIXTURES)
  const keys = found.map((f) => f.key)
  assert.deepEqual(keys, [
    'current-single',
    'invalid-dangling',
    'nested/deep/inner',
    'set-pair',
    'v1-legacy',
  ])
})

test('collectFlows: keys use posix slashes and drop the .flow.json suffix', async () => {
  const found = await collectFlows(FIXTURES)
  const nested = found.find((f) => f.key === 'nested/deep/inner')
  assert.ok(nested, 'nested flow is collected')
  assert.ok(!nested.key.includes('\\'), 'no backslashes in key')
  assert.ok(!nested.key.endsWith('.flow.json'), 'suffix stripped')
  // file points at the real absolute path on disk
  assert.ok(path.isAbsolute(nested.file))
  assert.ok(nested.file.endsWith(path.join('nested', 'deep', 'inner.flow.json')))
})

test('collectFlows: ignores non-*.flow.json files (e.g. set.json manifests)', async () => {
  const found = await collectFlows(FIXTURES)
  assert.ok(
    found.every((f) => f.file.endsWith('.flow.json')),
    'only .flow.json files collected',
  )
  assert.ok(
    !found.some((f) => f.file.endsWith('set.json')),
    'the set.json manifest is not collected',
  )
})

test('collectFlows: result is sorted by key', async () => {
  const found = await collectFlows(FIXTURES)
  const keys = found.map((f) => f.key)
  const sorted = [...keys].sort()
  assert.deepEqual(keys, sorted)
})
