/**
 * localStorageBackend.test.js — full flowStore-contract suite for the static
 * app's in-browser persistence backend (bd ai-engineer-zr7k §7.2).
 *
 * The localStorage backend holds one JSON blob shaped exactly like the server's
 * scanStore() output, so every op reuses the same pure indexBuilder.js helpers
 * and returns a byte-identical index shape. These tests drive a localStorage
 * shim through each Backend op and assert the per-op return contract the server
 * backend already satisfies.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLocalStorageBackend } from '../src/state/backends/localStorageBackend.js'

function shim() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}
const envOf = (n = 1) => ({
  formatVersion: 5,
  flow: { nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })) },
})

test('empty store yields an index with zero sets', async () => {
  const b = makeLocalStorageBackend(shim())
  const ix = await b.refreshIndex()
  assert.equal(ix.indexVersion, 1)
  assert.deepEqual(ix.sets, [])
})

test('createSet then saveFlow round-trips through refreshIndex', async () => {
  const b = makeLocalStorageBackend(shim())
  await b.createSet('My Set') // → slug 'my-set'
  const r = await b.saveFlow('my-set/intake', envOf(3), 'Intake')
  assert.equal(r.ok, true)
  assert.equal(r.id, 'my-set/intake')
  const set = r.index.sets.find((s) => s.id === 'my-set')
  assert.equal(set.flows.length, 1)
  assert.equal(set.flows[0].nodeCount, 3) // buildIndex derives this
  assert.equal(set.flows[0].file, 'my-set/intake.flow.json')
})

test('loadFlow returns the stored envelope and throws when missing', async () => {
  const b = makeLocalStorageBackend(shim())
  await b.saveFlow('s/a', envOf(2), 'A')
  assert.equal((await b.loadFlow('s/a')).flow.nodes.length, 2)
  await assert.rejects(() => b.loadFlow('s/missing'), /not found/)
})

test('duplicateFlow inserts a copy right after the source', async () => {
  const b = makeLocalStorageBackend(shim())
  await b.saveFlow('s/a', envOf(1), 'A')
  await b.saveFlow('s/b', envOf(1), 'B')
  const dup = await b.duplicateFlow('s/a')
  assert.equal(dup.title, 'A copy')
  const order = dup.index.sets.find((s) => s.id === 's').flows.map((f) => f.slug)
  assert.deepEqual(order, ['a', dup.slug, 'b'])
})

test('renameFlow changes title but not slug', async () => {
  const b = makeLocalStorageBackend(shim())
  await b.saveFlow('s/a', envOf(1), 'A')
  const r = await b.renameFlow('s/a', 'Renamed')
  const f = r.index.sets[0].flows[0]
  assert.equal(f.slug, 'a')
  assert.equal(f.title, 'Renamed')
})

test('deleteFlow removes it from the index', async () => {
  const b = makeLocalStorageBackend(shim())
  await b.saveFlow('s/a', envOf(1), 'A')
  await b.deleteFlow('s/a')
  assert.deepEqual(
    (await b.refreshIndex()).sets.find((s) => s.id === 's')?.flows ?? [],
    [],
  )
})

test('saveSetMeta reorders flows and carries transition', async () => {
  const b = makeLocalStorageBackend(shim())
  await b.saveFlow('s/a', envOf(1), 'A')
  await b.saveFlow('s/b', envOf(1), 'B')
  const r = await b.saveSetMeta('s', { flows: ['b', 'a'], transition: { durationMs: 700 } })
  const set = r.index.sets.find((s) => s.id === 's')
  assert.deepEqual(set.flows.map((f) => f.slug), ['b', 'a'])
  assert.deepEqual(set.transition, { durationMs: 700 })
})

test('createSet returns { id, title } with a slugified id', async () => {
  const b = makeLocalStorageBackend(shim())
  const r = await b.createSet('My Set')
  assert.deepEqual(r, { id: 'my-set', title: 'My Set' })
})

test('createSet de-duplicates a colliding slug', async () => {
  const b = makeLocalStorageBackend(shim())
  await b.createSet('Dup')
  const r = await b.createSet('Dup')
  assert.equal(r.id, 'dup-2')
})

test('persistence survives a fresh backend over the same storage', async () => {
  const s = shim()
  await makeLocalStorageBackend(s).saveFlow('s/a', envOf(1), 'A')
  const ix = await makeLocalStorageBackend(s).refreshIndex() // new instance, same storage
  assert.equal(ix.sets[0].flows[0].slug, 'a')
})
