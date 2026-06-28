// flow/cli/test/emitGallery.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emitGallery } from '../src/emitGallery.js'

function fixtureCollection() {
  return {
    flows: {
      'a/one': { key: 'a/one', title: 'One', isSet: false, flow: { nodes: [{ id: 'x', kind: 'source' }] } },
      'b-two': { key: 'b-two', title: 'Two', isSet: true, flow: { states: [{ key: 's', flow: { nodes: [] } }] } },
    },
    errors: [],
  }
}

test('emitGallery: index.html lists and links every flow', () => {
  const { files } = emitGallery(fixtureCollection())
  const html = files['index.html']
  assert.ok(html, 'index.html present')
  // visible title is the original key
  assert.match(html, /a\/one/)
  assert.match(html, /b-two/)
  // links to each flattened page
  assert.match(html, /href="\.\/a__one\.html"/)
  assert.match(html, /href="\.\/b-two\.html"/)
})

test('emitGallery: one standalone page per flow, flattened to the gallery root', () => {
  const { files } = emitGallery(fixtureCollection())
  assert.ok(files['a__one.html'], 'flattened nested key → a__one.html')
  assert.ok(files['b-two.html'], 'flat key → b-two.html')
})

test('emitGallery: each page inlines its flow JSON and imports the renderer asset', () => {
  const { files } = emitGallery(fixtureCollection())
  const page = files['a__one.html']
  assert.match(page, /<script type="application\/json" id="flow-data">/)
  // the inlined JSON is the flow object
  assert.match(page, /"kind": ?"source"/)
  // module script imports the vanilla renderer asset
  assert.match(page, /import \{ mountFlowAuto \} from '\.\/assets\/ribbonflow\.mjs'/)
  assert.match(page, /mountFlowAuto\(/)
  // original key shown as the page title
  assert.match(page, /a\/one/)
})

test('emitGallery: a custom rendererAsset path is honoured', () => {
  const { files } = emitGallery(fixtureCollection(), { rendererAsset: '../shared/rf.mjs' })
  assert.match(files['a__one.html'], /from '\.\.\/shared\/rf\.mjs'/)
})
