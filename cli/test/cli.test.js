// flow/cli/test/cli.test.js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { buildCommand } from '../src/build.js'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

let outDir
let summary

async function exists(p) {
  try { await stat(p); return true } catch { return false }
}

before(async () => {
  outDir = await mkdtemp(path.join(os.tmpdir(), 'rf-cli-'))
  summary = await buildCommand({ flowsDir: FIXTURES, mode: 'both', outDir })
})

after(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true })
})

test('buildCommand: reports flow + error counts', () => {
  assert.equal(summary.flowCount, 4, '4 valid flows')
  assert.equal(summary.errorCount, 1, '1 invalid flow recorded')
})

test('buildCommand: writes the bundle files', async () => {
  assert.ok(await exists(path.join(outDir, 'bundle', 'flows.js')))
  assert.ok(await exists(path.join(outDir, 'bundle', 'index.js')))
  assert.ok(await exists(path.join(outDir, 'bundle', 'README.md')))
})

test('buildCommand: writes the gallery files', async () => {
  assert.ok(await exists(path.join(outDir, 'gallery', 'index.html')))
  // one page per valid flow (flattened keys)
  assert.ok(await exists(path.join(outDir, 'gallery', 'current-single.html')))
  assert.ok(await exists(path.join(outDir, 'gallery', 'nested__deep__inner.html')))
  assert.ok(await exists(path.join(outDir, 'gallery', 'set-pair.html')))
  assert.ok(await exists(path.join(outDir, 'gallery', 'v1-legacy.html')))
})

test('buildCommand: bundles the vanilla renderer to gallery/assets/ribbonflow.mjs with NO bare imports', async () => {
  const asset = path.join(outDir, 'gallery', 'assets', 'ribbonflow.mjs')
  assert.ok(await exists(asset), 'renderer asset written')
  const code = await readFile(asset, 'utf8')
  assert.ok(code.length > 0, 'asset is non-empty')
  // a fully-bundled ESM has no bare (non-relative) import specifiers
  const bareImport = /\bfrom\s*["'][^."'/][^"']*["']/
  assert.doesNotMatch(code, bareImport, 'renderer bundle is self-contained (no bare imports)')
  // and it exports the mount entry the gallery pages import
  assert.match(code, /mountFlowAuto/)
})
