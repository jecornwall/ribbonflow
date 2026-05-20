import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, resolveRng } from './rng.js'

test('mulberry32: same seed produces the same sequence', () => {
  const a = mulberry32(12345)
  const b = mulberry32(12345)
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b(), `draw ${i} diverged for identical seeds`)
  }
})

test('mulberry32: different seeds produce different sequences', () => {
  const a = mulberry32(1)
  const b = mulberry32(2)
  let anyDifferent = false
  for (let i = 0; i < 50; i++) {
    if (a() !== b()) anyDifferent = true
  }
  assert.ok(anyDifferent, 'distinct seeds should not yield identical streams')
})

test('mulberry32: every draw is in [0, 1)', () => {
  const r = mulberry32(99)
  for (let i = 0; i < 1000; i++) {
    const v = r()
    assert.ok(v >= 0 && v < 1, `draw ${i} = ${v} out of [0,1)`)
  }
})

test('mulberry32: draws are reasonably uniform', () => {
  const r = mulberry32(2026)
  const buckets = new Array(10).fill(0)
  const N = 100000
  for (let i = 0; i < N; i++) buckets[Math.floor(r() * 10)]++
  for (let i = 0; i < 10; i++) {
    const frac = buckets[i] / N
    assert.ok(Math.abs(frac - 0.1) < 0.02,
      `bucket ${i} fraction ${frac.toFixed(4)} should be near 0.1`)
  }
})

test('resolveRng: a numeric seed yields a deterministic generator', () => {
  const a = resolveRng(7)
  const b = resolveRng(7)
  assert.equal(a(), b())
})

test('resolveRng: undefined / null fall back to Math.random', () => {
  assert.equal(resolveRng(undefined), Math.random)
  assert.equal(resolveRng(null), Math.random)
})
