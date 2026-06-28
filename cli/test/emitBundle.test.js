// flow/cli/test/emitBundle.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emitBundle } from '../src/emitBundle.js'

// A hand-built collection keeps the emitter test independent of the front-end.
function fixtureCollection() {
  return {
    flows: {
      'a/one': { key: 'a/one', title: 'One', isSet: false, flow: { nodes: [{ id: 'x' }] } },
      'b-two': { key: 'b-two', title: 'Two', isSet: true, flow: { states: [{ key: 's', flow: { nodes: [] } }] } },
    },
    errors: [],
  }
}

test('emitBundle: returns the three bundle files as path → string (pure, no writes)', () => {
  const { files } = emitBundle(fixtureCollection())
  assert.deepEqual(Object.keys(files).sort(), ['README.md', 'flows.js', 'index.js'])
  for (const v of Object.values(files)) assert.equal(typeof v, 'string')
})

test('emitBundle: flows.js exports every key', () => {
  const { files } = emitBundle(fixtureCollection())
  const js = files['flows.js']
  assert.match(js, /export const flows =/)
  assert.match(js, /"a\/one"/)
  assert.match(js, /"b-two"/)
  // the value is the normalized flow object, not an envelope
  assert.match(js, /"states"/)
  assert.doesNotMatch(js, /"formatVersion"/)
})

test('emitBundle: index.js imports the renderer specifier and exports mount()', () => {
  const { files } = emitBundle(fixtureCollection())
  const js = files['index.js']
  assert.match(js, /import \{ mountFlowAuto \} from 'ribbonflow'/)
  assert.match(js, /import \{ flows \} from '\.\/flows\.js'/)
  assert.match(js, /export function mount\(/)
  assert.match(js, /mountFlowAuto\(el, flows\[key\]/)
  assert.match(js, /export \{ flows \}/)
})

test('emitBundle: a custom rendererSpecifier is honoured', () => {
  const { files } = emitBundle(fixtureCollection(), { rendererSpecifier: '@ribbonflow/core' })
  assert.match(files['index.js'], /from '@ribbonflow\/core'/)
})
