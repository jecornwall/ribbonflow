// flow/library/src/render/sceneSpec.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defsSpec } from './sceneSpec.js'

test('defsSpec: clipPath with a rect at the clip bounds', () => {
  const defs = {
    clipId: 'flow-clip-0',
    clipRect: { x: 0, y: 0, width: 1600, height: 900 },
    wobble: null,
    hatch: null,
  }
  const spec = defsSpec(defs)
  assert.equal(spec.tag, 'defs')
  const clip = spec.children.find((c) => c.tag === 'clipPath')
  assert.equal(clip.attrs.id, 'flow-clip-0')
  const rect = clip.children[0]
  assert.equal(rect.tag, 'rect')
  assert.deepEqual(
    [rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height],
    [0, 0, 1600, 900],
  )
  // No wobble / hatch → only the clipPath child.
  assert.equal(spec.children.length, 1)
})

test('defsSpec: ink-wobble filter present iff defs.wobble', () => {
  const spec = defsSpec({
    clipId: 'c', clipRect: { x: 0, y: 0, width: 10, height: 10 },
    wobble: { id: 'flow-wobble-0', baseFrequency: 0.012, scale: 1.6 }, hatch: null,
  })
  const filter = spec.children.find((c) => c.tag === 'filter')
  assert.equal(filter.attrs.id, 'flow-wobble-0')
  const turb = filter.children.find((c) => c.tag === 'feTurbulence')
  assert.equal(turb.attrs.baseFrequency, 0.012)
  assert.equal(turb.attrs.type, 'fractalNoise')
  const disp = filter.children.find((c) => c.tag === 'feDisplacementMap')
  assert.equal(disp.attrs.scale, 1.6)
  assert.equal(disp.attrs.in, 'SourceGraphic')
})

test('defsSpec: constraint-hatch pattern present iff defs.hatch', () => {
  const spec = defsSpec({
    clipId: 'c', clipRect: { x: 0, y: 0, width: 10, height: 10 }, wobble: null,
    hatch: { id: 'flow-hatch-0', tile: 6, rotate: 45, stroke: '#E2522B', strokeWidth: 0.6 },
  })
  const pattern = spec.children.find((c) => c.tag === 'pattern')
  assert.equal(pattern.attrs.id, 'flow-hatch-0')
  assert.equal(pattern.attrs.width, 6)
  assert.equal(pattern.attrs.height, 6)
  assert.equal(pattern.attrs.patternUnits, 'userSpaceOnUse')
  assert.equal(pattern.attrs.patternTransform, 'rotate(45)')
  const line = pattern.children[0]
  assert.equal(line.tag, 'line')
  assert.equal(line.attrs.stroke, '#E2522B')
  assert.equal(line.attrs['stroke-width'], 0.6)
})

test('defsSpec: wobble + hatch → clipPath + filter + pattern (3 children, clipPath first)', () => {
  const spec = defsSpec({
    clipId: 'c', clipRect: { x: 0, y: 0, width: 10, height: 10 },
    wobble: { id: 'w', baseFrequency: 0.012, scale: 1.6 },
    hatch: { id: 'h', tile: 6, rotate: 45, stroke: '#E2522B', strokeWidth: 0.6 },
  })
  assert.deepEqual(spec.children.map((c) => c.tag), ['clipPath', 'filter', 'pattern'])
})
