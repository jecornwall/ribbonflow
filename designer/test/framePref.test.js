/**
 * framePref.test.js — headless unit tests for the remembered frame preset
 * (src/lib/framePref.js, bd ai-engineer-zr7k §7.1).
 *
 * The frame lives on the flow (its viewBox); the remembered preset is a tiny
 * app preference that seeds the viewBox of NEW flows. Pure read/write over a
 * storage shim, default '16:9', junk-tolerant.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFramePref, writeFramePref } from '../src/lib/framePref.js'

function shim() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  }
}

test('readFramePref defaults to 16:9 when unset', () => {
  assert.equal(readFramePref(shim()), '16:9')
})

test('writeFramePref round-trips a known preset', () => {
  const s = shim()
  writeFramePref('4:3', s)
  assert.equal(readFramePref(s), '4:3')
})

test('readFramePref rejects a junk value and returns the default', () => {
  const s = shim()
  s.setItem('ribbonflow.designer.framePref.v1', 'bogus')
  assert.equal(readFramePref(s), '16:9')
})

test('readFramePref tolerates a missing storage object', () => {
  assert.equal(readFramePref(null), '16:9')
})

test('writeFramePref ignores an unknown preset and tolerates missing storage', () => {
  const s = shim()
  writeFramePref('21:9', s) // unknown — must not be written
  assert.equal(readFramePref(s), '16:9')
  // no throw with a missing storage object
  assert.doesNotThrow(() => writeFramePref('1:1', null))
})
