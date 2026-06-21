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

// ── Task 3: static[] primitives → element-specs ──────────────────────────────
import { staticSpec } from './sceneSpec.js'

// helper: find the single spec produced for a one-primitive static list
function specFor(prim) {
  const list = staticSpec([prim])
  assert.equal(list.length, 1)
  return list[0]
}

test('staticSpec: ribbon/path → <path d fill>', () => {
  const r = specFor({ kind: 'ribbon', d: 'M0 0 L1 1', fill: '#e8d8b0' })
  assert.equal(r.tag, 'path')
  assert.equal(r.attrs.d, 'M0 0 L1 1')
  assert.equal(r.attrs.fill, '#e8d8b0')

  const p = specFor({ kind: 'path', key: 'seg-0-0', d: 'M2 2', fill: '#3aa' })
  assert.equal(p.tag, 'path')
  assert.equal(p.attrs.fill, '#3aa')
})

test('staticSpec: disc → <circle cx cy r fill>', () => {
  const c = specFor({ kind: 'disc', key: 'junction-x', cx: 5, cy: 6, r: 7, fill: '#15171A' })
  assert.equal(c.tag, 'circle')
  assert.deepEqual([c.attrs.cx, c.attrs.cy, c.attrs.r, c.attrs.fill], [5, 6, 7, '#15171A'])
})

test('staticSpec: line → <line> with kebab stroke-width, round cap, inline opacity', () => {
  const l = specFor({ kind: 'line', key: 'anchor-a', x1: 1, y1: 2, x2: 1, y2: 9, stroke: '#555555', strokeWidth: 2.5, linecap: 'round', opacity: 0.85 })
  assert.equal(l.tag, 'line')
  assert.deepEqual([l.attrs.x1, l.attrs.y1, l.attrs.x2, l.attrs.y2], [1, 2, 1, 9])
  assert.equal(l.attrs.stroke, '#555555')
  assert.equal(l.attrs['stroke-width'], 2.5)
  assert.equal(l.attrs['stroke-linecap'], 'round')
  // opacity rides an inline style, never a bare attribute (UnoCSS-safe).
  assert.equal(l.attrs.style, 'opacity:0.85')
  assert.equal('opacity' in l.attrs, false)
})

test('staticSpec: text → <text> with font/style mapping, textContent, inline style', () => {
  const t = specFor({ kind: 'text', key: 'marker-x-label', x: 10, y: 20, text: 'review', font: 'ET Book, Georgia, serif', fontStyle: 'italic', fontSize: 24, fill: '#E2522B', anchor: 'middle', textTransform: 'lowercase', opacity: 0.3, baseline: 'middle' })
  assert.equal(t.tag, 'text')
  assert.equal(t.text, 'review')
  assert.equal(t.attrs.x, 10)
  assert.equal(t.attrs['font-family'], 'ET Book, Georgia, serif')
  assert.equal(t.attrs['font-style'], 'italic')
  assert.equal(t.attrs['text-anchor'], 'middle')
  assert.equal(t.attrs['dominant-baseline'], 'middle')
  // font-size, text-transform, opacity ALL ride the inline style (UnoCSS-safe).
  assert.ok(t.attrs.style.includes('font-size:24px'))
  assert.ok(t.attrs.style.includes('text-transform:lowercase'))
  assert.ok(t.attrs.style.includes('opacity:0.3'))
  assert.equal('font-size' in t.attrs, false)
})

test('staticSpec: polygon → <polygon points fill> + optional stroke', () => {
  const box = specFor({ kind: 'polygon', key: 'box-a', points: '0,0 1,0 1,1 0,1', fill: 'none', stroke: '#15171A', strokeWidth: 1.2 })
  assert.equal(box.tag, 'polygon')
  assert.equal(box.attrs.points, '0,0 1,0 1,1 0,1')
  assert.equal(box.attrs.fill, 'none')
  assert.equal(box.attrs.stroke, '#15171A')
  assert.equal(box.attrs['stroke-width'], 1.2)

  const swatch = specFor({ kind: 'polygon', key: 'legend-swatch', points: '40,833 160,821 160,849 40,837', fill: '#15171A' })
  assert.equal(swatch.attrs.fill, '#15171A')
  assert.equal('stroke' in swatch.attrs, false, 'no stroke when not provided')
})

test('staticSpec: rect → <rect> with inline opacity', () => {
  const h = specFor({ kind: 'rect', key: 'hatch-x', x: 1, y: 2, width: 200, height: 14, fill: 'url(#flow-hatch-0)', opacity: 0.6 })
  assert.equal(h.tag, 'rect')
  assert.deepEqual([h.attrs.x, h.attrs.y, h.attrs.width, h.attrs.height], [1, 2, 200, 14])
  assert.equal(h.attrs.fill, 'url(#flow-hatch-0)')
  assert.equal(h.attrs.style, 'opacity:0.6')
})

test('staticSpec: glyph → <path> with transform, fill:none, kebab joins, inline opacity', () => {
  const g = specFor({ kind: 'glyph', key: 'xform-a', d: 'M-8 0 L-1 0', transform: 'translate(5 6)', fill: 'none', stroke: '#15171A', strokeWidth: 1.6, opacity: 0.8, linecap: 'round', linejoin: 'round' })
  assert.equal(g.tag, 'path')
  assert.equal(g.attrs.transform, 'translate(5 6)')
  assert.equal(g.attrs.fill, 'none')
  assert.equal(g.attrs['stroke-linecap'], 'round')
  assert.equal(g.attrs['stroke-linejoin'], 'round')
  assert.equal(g.attrs.style, 'opacity:0.8')
})

test('staticSpec: rejectionArc → <g> with dotted <path> + arrowhead <polygon>', () => {
  const arc = specFor({ kind: 'rejectionArc', key: 'rej-0', d: 'M0 0 Q5 5 10 0', arrowPoints: '9,1 11,1 10,3', stroke: '#b5524b', strokeWidth: 1.6, dasharray: '1 5' })
  assert.equal(arc.tag, 'g')
  const path = arc.children.find((c) => c.tag === 'path')
  assert.equal(path.attrs.d, 'M0 0 Q5 5 10 0')
  assert.equal(path.attrs.fill, 'none')
  assert.equal(path.attrs.stroke, '#b5524b')
  assert.equal(path.attrs['stroke-dasharray'], '1 5')
  assert.equal(path.attrs['stroke-linecap'], 'round')
  const poly = arc.children.find((c) => c.tag === 'polygon')
  assert.equal(poly.attrs.points, '9,1 11,1 10,3')
  assert.equal(poly.attrs.fill, '#b5524b', 'arrowhead filled in the arc colour')
  assert.equal(poly.attrs.stroke, 'none')
})

test('staticSpec: maps a whole list preserving paint order', () => {
  const list = staticSpec([
    { kind: 'ribbon', d: 'M0 0', fill: '#a' },
    { kind: 'disc', cx: 1, cy: 1, r: 1, fill: '#b' },
  ])
  assert.deepEqual(list.map((s) => s.tag), ['path', 'circle'])
})

test('staticSpec: throws on an unknown primitive kind', () => {
  assert.throws(() => staticSpec([{ kind: 'wormhole' }]), /unknown primitive kind "wormhole"/)
})

test('staticSpec: text-transform:none is dropped from the inline style', () => {
  const t = specFor({ kind: 'text', x: 0, y: 0, text: 'x', font: 'ET Book', fontStyle: 'italic', fontSize: 18, fill: '#333', anchor: 'middle', textTransform: 'none' })
  assert.ok(!(t.attrs.style || '').includes('text-transform'), 'no-op text-transform:none not emitted')
})

test('staticSpec: a line with no opacity emits no style attribute', () => {
  const l = specFor({ kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#555555', strokeWidth: 0.8, linecap: 'round' })
  assert.equal(l.attrs.style, undefined, 'no style attr when there is no opacity')
})
