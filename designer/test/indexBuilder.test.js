/**
 * indexBuilder.test.js — headless unit tests for the persistence layer's pure
 * logic (server/indexBuilder.js): slug derivation and the machine-readable
 * index assembly.
 *
 * These are pure functions — no fs, no Vite, no Vue — so they run directly
 * under `node --test`. The plugin (flowStorePlugin.js) does the fs work and is
 * verified end-to-end in the browser (see 2026-05-20-flow-persistence-design.md
 * §5); the index *shape and ordering* — the part a slide build will depend on —
 * is locked down here, test-first.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { slugify, uniqueSlug, buildIndex } from '../server/indexBuilder.js'

// ── slugify ──────────────────────────────────────────────────────────────────

test('slugify lowercases, hyphenates, and strips punctuation', () => {
  assert.equal(slugify('TOC Baseline'), 'toc-baseline')
  assert.equal(slugify('Before / After!'), 'before-after')
  assert.equal(slugify('  Year   Walk  '), 'year-walk')
  assert.equal(slugify('n4-toc-baseline'), 'n4-toc-baseline')
})

test('slugify collapses runs and trims stray hyphens', () => {
  assert.equal(slugify('a---b'), 'a-b')
  assert.equal(slugify('--edge--'), 'edge')
})

test('slugify falls back to "untitled" for empty / symbol-only input', () => {
  assert.equal(slugify(''), 'untitled')
  assert.equal(slugify('   '), 'untitled')
  assert.equal(slugify('!!!'), 'untitled')
})

// ── uniqueSlug ───────────────────────────────────────────────────────────────

test('uniqueSlug returns the base when it is free', () => {
  assert.equal(uniqueSlug('before', ['after', 'year']), 'before')
})

test('uniqueSlug suffixes a numeric counter on collision', () => {
  assert.equal(uniqueSlug('before', ['before']), 'before-2')
  assert.equal(uniqueSlug('before', ['before', 'before-2']), 'before-3')
})

// ── buildIndex ───────────────────────────────────────────────────────────────

function envelope(nodeCount, version = 3) {
  return {
    formatVersion: version,
    flow: { nodes: Array.from({ length: nodeCount }, (_, i) => ({ id: `n${i}` })) },
  }
}

test('buildIndex assembles the machine-readable index with per-flow metadata', () => {
  const idx = buildIndex(
    {
      sets: [
        {
          id: 'toc-baseline',
          title: 'TOC Baseline',
          flows: [
            { slug: 'before', title: 'Before', envelope: envelope(5), updatedAt: '2026-05-20T10:00:00.000Z' },
          ],
        },
      ],
    },
    { generatedAt: '2026-05-20T12:00:00.000Z' },
  )
  assert.equal(idx.indexVersion, 1)
  assert.equal(idx.generatedAt, '2026-05-20T12:00:00.000Z')
  assert.equal(idx.sets.length, 1)
  const flow = idx.sets[0].flows[0]
  assert.equal(flow.id, 'toc-baseline/before')
  assert.equal(flow.title, 'Before')
  assert.equal(flow.file, 'toc-baseline/before.flow.json')
  assert.equal(flow.formatVersion, 3)
  assert.equal(flow.nodeCount, 5)
  assert.equal(flow.updatedAt, '2026-05-20T10:00:00.000Z')
})

test('buildIndex sorts sets by id and flows by slug — a deterministic index', () => {
  const idx = buildIndex(
    {
      sets: [
        {
          id: 'zeta',
          title: 'Zeta',
          flows: [
            { slug: 'b', title: 'B', envelope: envelope(1), updatedAt: 't' },
            { slug: 'a', title: 'A', envelope: envelope(1), updatedAt: 't' },
          ],
        },
        { id: 'alpha', title: 'Alpha', flows: [] },
      ],
    },
    { generatedAt: 't' },
  )
  assert.deepEqual(idx.sets.map((s) => s.id), ['alpha', 'zeta'])
  assert.deepEqual(idx.sets[1].flows.map((f) => f.slug), ['a', 'b'])
})

test('buildIndex tolerates a missing / malformed envelope', () => {
  const idx = buildIndex(
    {
      sets: [
        {
          id: 's',
          title: 'S',
          flows: [{ slug: 'broken', title: 'Broken', envelope: null, updatedAt: 't' }],
        },
      ],
    },
    { generatedAt: 't' },
  )
  assert.equal(idx.sets[0].flows[0].nodeCount, 0)
  assert.equal(idx.sets[0].flows[0].formatVersion, null)
})
