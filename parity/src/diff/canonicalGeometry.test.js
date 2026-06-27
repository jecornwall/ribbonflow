// flow/parity/src/diff/canonicalGeometry.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roundNums, colorKey, styleProp } from './canonicalGeometry.js'

test('roundNums: rounds every number in a path/points/transform string to dp', () => {
  assert.equal(roundNums('M0.123 4.567 L10 -3.14159', 2), 'M0.12 4.57 L10 -3.14')
  assert.equal(roundNums('translate(100.001 200.999)', 2), 'translate(100 201)')
  assert.equal(roundNums('40,833 160,821 160,849', 2), '40,833 160,821 160,849')
})

test('roundNums: tiny magnitudes collapse to 0; integers pass through', () => {
  assert.equal(roundNums('M1e-8 0 L2 3', 2), 'M0 0 L2 3')
  assert.equal(roundNums('M0 0 L1600 900', 2), 'M0 0 L1600 900')
})

test('roundNums: default dp is 2', () => {
  assert.equal(roundNums('M1.005 2.004'), 'M1 2')
})

test('colorKey: lowercases, expands 3-digit hex, trims; none stays none; empty for absent', () => {
  assert.equal(colorKey('#15171A'), '#15171a')
  assert.equal(colorKey('#ABC'), '#aabbcc')
  assert.equal(colorKey('  #FFF '), '#ffffff')
  assert.equal(colorKey('none'), 'none')
  assert.equal(colorKey(null), '')
  assert.equal(colorKey(undefined), '')
})

test('colorKey: url(#id) paint refs canonicalise away the renderer-specific id suffix (deviation #2)', () => {
  // FlowGraph uses a random hatch id; mountFlow a deterministic seq. Both are
  // "the hatch pattern" — strip the trailing -<n> so structure compares, not ids.
  assert.equal(colorKey('url(#flow-hatch-438769224)'), 'url(#flow-hatch)')
  assert.equal(colorKey('url(#flow-hatch-0)'), 'url(#flow-hatch)')
  assert.equal(colorKey('url(#flow-wobble-12)'), 'url(#flow-wobble)')
})

test('styleProp: parses a CSS property from a style attribute regardless of spacing', () => {
  // Vue renders "opacity: 0.85;"; mountFlow renders "opacity:0.85" — same value.
  assert.equal(styleProp('opacity: 0.85;', 'opacity'), '0.85')
  assert.equal(styleProp('opacity:0.85', 'opacity'), '0.85')
  assert.equal(styleProp('font-size: 24px; opacity: 0.3;', 'font-size'), '24px')
  assert.equal(styleProp('font-size:24px;opacity:0.3', 'opacity'), '0.3')
  assert.equal(styleProp('', 'opacity'), '')
  assert.equal(styleProp(null, 'opacity'), '')
  assert.equal(styleProp('text-transform: lowercase;', 'text-transform'), 'lowercase')
})
