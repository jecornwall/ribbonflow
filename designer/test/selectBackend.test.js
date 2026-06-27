/**
 * selectBackend.test.js — the literal build-flag backend selection
 * (bd ai-engineer-zr7k §7.2, CONFIRMED with Jason 2026-06-28).
 *
 * localStorage is ALWAYS the default; the server/file backend is opt-in ONLY
 * when VITE_FLOW_BACKEND === 'server'. No runtime probe — selection is a
 * synchronous flag read, so flowStore needs no async-ready dance.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { selectBackend } from '../src/state/backends/selectBackend.js'

const fakes = { makeServer: () => ({ tag: 'srv' }), makeLocal: () => ({ tag: 'loc' }) }

test('VITE_FLOW_BACKEND=server selects the server backend', () => {
  const r = selectBackend({ env: { VITE_FLOW_BACKEND: 'server' }, ...fakes })
  assert.equal(r.kind, 'server')
  assert.equal(r.backend.tag, 'srv')
})

test('no flag → localStorage (the default)', () => {
  assert.equal(selectBackend({ env: {}, ...fakes }).kind, 'local')
})

test('VITE_FLOW_BACKEND=local → localStorage', () => {
  assert.equal(selectBackend({ env: { VITE_FLOW_BACKEND: 'local' }, ...fakes }).kind, 'local')
})

test('a junk flag value falls back to localStorage', () => {
  assert.equal(selectBackend({ env: { VITE_FLOW_BACKEND: 'nope' }, ...fakes }).kind, 'local')
})

test('a missing env object → localStorage', () => {
  assert.equal(selectBackend({ ...fakes }).kind, 'local')
})

test('the local default returns the makeLocal-built backend', () => {
  assert.equal(selectBackend({ env: {}, ...fakes }).backend.tag, 'loc')
})
