import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFlowSet, isRawFlowSet } from './flowSet.js'

test('isRawFlowSet: a bare states[] object with no formatVersion is a raw flow-set', () => {
  assert.equal(isRawFlowSet({ states: [{ key: 's0', flow: {} }] }), true)
})
test('isRawFlowSet: an enveloped flow-set (numeric formatVersion) is NOT raw', () => {
  assert.equal(isRawFlowSet({ formatVersion: 1, states: [] }), false)
})
test('isRawFlowSet: a single flow / null / string is not a raw flow-set', () => {
  assert.equal(isRawFlowSet({ nodes: [] }), false)
  assert.equal(isRawFlowSet(null), false)
  assert.equal(isRawFlowSet('{}'), false)
})
test('isFlowSet: true for a raw set', () => {
  assert.equal(isFlowSet({ states: [{ key: 's0', flow: {} }] }), true)
})
test('isFlowSet: false for a single flow object', () => {
  assert.equal(isFlowSet({ nodes: [], viewBox: { w: 100, h: 100 } }), false)
})
