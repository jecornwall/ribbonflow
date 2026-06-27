// flow/parity/src/diff/extractScene.js
/**
 * extractScene.js — generic leaf-shape geometric extractor for the Phase-2c
 * parity gate.
 *
 * Given a rendered flow <svg> (from EITHER renderer — legacy Vue FlowGraph or
 * the new imperative mountFlow), collect every PAINTED LEAF shape
 * (path/circle/line/text/polygon/rect/ellipse) into a per-tag multiset of
 * canonical, float-rounded keys, plus the viewBox. This is the "geometric, not
 * structural" comparison the bead's KEY FINDING demands: the two renderers emit
 * DIFFERENT DOM trees, so we compare the SET of painted shapes, not the tree.
 *
 * By collecting only leaf shapes it auto-whitelists the 3 known-inert deviations:
 *   - wobble filter wraps a <g> (not a leaf) — its child paths are identical;
 *   - random clip/wobble/hatch ids live on <defs>/<g> refs — leaves carry none;
 *   - legend z-order is order-independent under the multiset compare.
 * Agents (anything with data-agent-id) and <defs> internals are excluded.
 *
 * Pure DOM API only (getAttribute/querySelectorAll/textContent) — runs both in
 * node (linkedom tests) and in the browser (page.evaluate during capture).
 */
import { roundNums, colorKey, styleProp } from './canonicalGeometry.js'

const SHAPE_TAGS = new Set(['path', 'circle', 'line', 'text', 'polygon', 'rect', 'ellipse'])

const tag = (el) => (el.tagName || '').toLowerCase()

// True if `el` is inside a <defs> subtree (clip/filter/pattern internals — not
// painted geometry; both renderers emit an identical clip rect there).
function inDefs(el) {
  let p = el.parentNode
  while (p && p.tagName) {
    if (tag(p) === 'defs') return true
    p = p.parentNode
  }
  return false
}

const num = (el, name) => roundNums(el.getAttribute(name) ?? '')
const col = (el, name) => colorKey(el.getAttribute(name))
const raw = (el, name) => (el.getAttribute(name) ?? '').trim()
const sty = (el, prop) => styleProp(el.getAttribute('style'), prop)
// EFFECTIVE opacity = the leaf's own opacity × every ancestor <g>'s opacity, up
// to the svg root. SVG opacity multiplies down the tree, so a renderer that dims
// a marker via a parent <g style="opacity:0.3"> (FlowGraph's ghost-markers) and
// one that bakes 0.3 into the leaf (mountFlow) paint IDENTICALLY — resolving the
// inheritance makes them compare equal. `opacity:1`/absent ≡ 1; a genuine non-1
// effective opacity still differs.
const ownOpacity = (el) => {
  const s = sty(el, 'opacity')
  if (s !== '') return Number(s)
  const a = el.getAttribute('opacity')
  if (a != null && a !== '') return Number(a)
  return 1
}
const opacity = (el) => {
  let o = 1
  let cur = el
  while (cur && cur.tagName && tag(cur) !== 'svg') {
    const own = ownOpacity(cur)
    if (Number.isFinite(own)) o *= own
    cur = cur.parentNode
  }
  return String(Math.round(o * 1000) / 1000)
}
// text-transform:none is the CSS default ≡ absent (FlowGraph emits `none`,
// mountFlow omits it).
const textTransform = (el) => {
  const t = sty(el, 'text-transform')
  return t === 'none' ? '' : t
}
// url(#id) refs a LEAF may carry (clip-path / filter / mask). colorKey strips
// the renderer-specific id suffix (deviation #2) but keeps the ref KIND, so a
// random vs deterministic id matches while clip/filter present-vs-absent (a real
// structural difference) still surfaces.
const refs = (el) => `clip=${col(el, 'clip-path')}|filt=${col(el, 'filter')}|mask=${col(el, 'mask')}`

// Per-tag canonical key. Field order is fixed so the string is stable across
// renderers; only visually-meaningful attributes are included. Opacity /
// font-size / text-transform are read from inline style (both renderers emit
// them there, UnoCSS-safe). Every key carries the leaf's url(#…) refs suffix.
function keyFor(el) {
  const b = baseKey(el)
  return b ? `${b}|${refs(el)}` : ''
}

function baseKey(el) {
  const t = tag(el)
  switch (t) {
    case 'path':
      return [
        `d=${roundNums(raw(el, 'd'))}`,
        `fill=${col(el, 'fill')}`,
        `stroke=${col(el, 'stroke')}`,
        `sw=${num(el, 'stroke-width')}`,
        `dash=${raw(el, 'stroke-dasharray')}`,
        `cap=${raw(el, 'stroke-linecap')}`,
        `join=${raw(el, 'stroke-linejoin')}`,
        `xf=${roundNums(raw(el, 'transform'))}`,
        `op=${opacity(el)}`,
      ].join('|')
    case 'circle':
      return `cx=${num(el, 'cx')}|cy=${num(el, 'cy')}|r=${num(el, 'r')}|fill=${col(el, 'fill')}|stroke=${col(el, 'stroke')}|sw=${num(el, 'stroke-width')}`
    case 'line':
      return [
        `x1=${num(el, 'x1')}`, `y1=${num(el, 'y1')}`,
        `x2=${num(el, 'x2')}`, `y2=${num(el, 'y2')}`,
        `stroke=${col(el, 'stroke')}`, `sw=${num(el, 'stroke-width')}`,
        `cap=${raw(el, 'stroke-linecap')}`, `op=${opacity(el)}`,
      ].join('|')
    case 'text':
      return [
        `x=${num(el, 'x')}`, `y=${num(el, 'y')}`,
        `t=${(el.textContent || '').trim()}`,
        `anchor=${raw(el, 'text-anchor')}`,
        `baseline=${raw(el, 'dominant-baseline')}`,
        `fill=${col(el, 'fill')}`,
        `font=${raw(el, 'font-family')}`,
        `fstyle=${raw(el, 'font-style')}`,
        `fsize=${sty(el, 'font-size')}`,
        `ttrans=${textTransform(el)}`,
        `op=${opacity(el)}`,
      ].join('|')
    case 'polygon':
      return `points=${roundNums(raw(el, 'points'))}|fill=${col(el, 'fill')}|stroke=${col(el, 'stroke')}|sw=${num(el, 'stroke-width')}`
    case 'rect':
      return `x=${num(el, 'x')}|y=${num(el, 'y')}|w=${num(el, 'width')}|h=${num(el, 'height')}|fill=${col(el, 'fill')}|op=${opacity(el)}`
    case 'ellipse':
      return `cx=${num(el, 'cx')}|cy=${num(el, 'cy')}|rx=${num(el, 'rx')}|ry=${num(el, 'ry')}|fill=${col(el, 'fill')}`
    default:
      return ''
  }
}

/**
 * @param {Element} rootEl — the flow <svg> (or a container holding exactly one).
 * @returns {{ viewBox: string, byTag: Record<string, string[]> }}
 */
export function extractScene(rootEl) {
  const svg = tag(rootEl) === 'svg' ? rootEl : rootEl.querySelector('svg')
  if (!svg) return { viewBox: '', byTag: {} }

  const byTag = {}
  const all = svg.querySelectorAll('path, circle, line, text, polygon, rect, ellipse')
  for (const el of all) {
    const t = tag(el)
    if (!SHAPE_TAGS.has(t)) continue
    if (el.hasAttribute('data-agent-id')) continue // agents — both renderers stamp this
    if (inDefs(el)) continue // clip/filter/pattern internals
    ;(byTag[t] ||= []).push(keyFor(el))
  }

  return { viewBox: (svg.getAttribute('viewBox') || '').trim(), byTag }
}
