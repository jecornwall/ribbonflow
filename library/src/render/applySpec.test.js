// flow/library/src/render/applySpec.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { applySpec, SVG_NS } from './applySpec.js'

// A fresh headless document per call.
function doc() {
  return parseHTML('<!doctype html><html><body></body></html>').document
}

test('applySpec: creates an element in the SVG namespace with its attributes', () => {
  const d = doc()
  const parent = d.createElementNS(SVG_NS, 'svg')
  const el = applySpec(parent, { tag: 'circle', attrs: { cx: 10, cy: 20, r: 3, fill: '#F4F2ED' } }, d)
  assert.equal(el.namespaceURI, SVG_NS)
  assert.equal(el.tagName.toLowerCase(), 'circle')
  assert.equal(el.getAttribute('cx'), '10')
  assert.equal(el.getAttribute('fill'), '#F4F2ED')
  assert.equal(parent.childNodes.length, 1)
  assert.equal(parent.firstChild, el)
})

test('applySpec: skips null and undefined attribute values', () => {
  const d = doc()
  const parent = d.createElementNS(SVG_NS, 'svg')
  const el = applySpec(parent, { tag: 'path', attrs: { d: 'M0 0', fill: null, stroke: undefined } }, d)
  assert.equal(el.getAttribute('d'), 'M0 0')
  assert.equal(el.hasAttribute('fill'), false, 'null fill is not written')
  assert.equal(el.hasAttribute('stroke'), false, 'undefined stroke is not written')
})

test('applySpec: preserves zero and empty-string attribute values', () => {
  const d = doc()
  const parent = d.createElementNS(SVG_NS, 'svg')
  const el = applySpec(parent, { tag: 'rect', attrs: { x: 0, width: 0, fill: '' } }, d)
  assert.equal(el.getAttribute('x'), '0')
  assert.equal(el.getAttribute('width'), '0')
  assert.equal(el.getAttribute('fill'), '')
})

test('applySpec: appends children recursively and sets text content', () => {
  const d = doc()
  const parent = d.createElementNS(SVG_NS, 'svg')
  const g = applySpec(
    parent,
    {
      tag: 'g',
      attrs: { 'clip-path': 'url(#c)' },
      children: [{ tag: 'text', attrs: { x: 1, y: 2 }, text: 'hello' }],
    },
    d,
  )
  assert.equal(g.childNodes.length, 1)
  const text = g.firstChild
  assert.equal(text.tagName.toLowerCase(), 'text')
  assert.equal(text.textContent, 'hello')
})

test('applySpec: defaults the document to parent.ownerDocument', () => {
  const d = doc()
  const parent = d.createElementNS(SVG_NS, 'svg')
  // No explicit doc arg — must fall back to parent.ownerDocument.
  const el = applySpec(parent, { tag: 'rect', attrs: { x: 0, y: 0, width: 5, height: 5 } })
  assert.equal(el.namespaceURI, SVG_NS)
  assert.equal(el.getAttribute('width'), '5')
})
