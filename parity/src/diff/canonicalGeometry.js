// flow/parity/src/diff/canonicalGeometry.js
/**
 * canonicalGeometry.js — pure helpers that canonicalise SVG geometry/colour so
 * two renderers' painted shapes compare equal when they are visually identical.
 *
 * No DOM, no imports — usable in node (linkedom tests) and in the browser
 * (page.evaluate of the extractor). Used by extractScene.js to build per-shape
 * keys for the Phase-2c geometric parity diff.
 */

// Matches any number: optional sign, int/decimal, optional exponent.
const NUM_RE = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g

/**
 * Round every number in a string (path `d`, polygon `points`, `transform`) to
 * `dp` decimals, so trivial float-formatting differences between the two
 * renderers don't read as geometry divergences. Non-number characters (command
 * letters, commas, spaces, parens) are preserved verbatim.
 *
 * @param {string} str
 * @param {number} [dp=2]
 * @returns {string}
 */
export function roundNums(str, dp = 2) {
  if (str == null) return ''
  const f = 10 ** dp
  return String(str).replace(NUM_RE, (m) => {
    const n = Number(m)
    if (!Number.isFinite(n)) return m
    // Normalise -0 → 0 and collapse sub-precision magnitudes.
    const r = Math.round(n * f) / f
    return String(r === 0 ? 0 : r)
  })
}

/**
 * Normalise a colour/paint string: lowercase, trim, expand 3-digit hex to
 * 6-digit. `none` stays `none`; `url(#…)` paint refs are preserved verbatim (id
 * differences are handled by the leaf-only extraction, not here). Absent → ''.
 *
 * @param {string|null|undefined} color
 * @returns {string}
 */
export function colorKey(color) {
  if (color == null) return ''
  const c = String(color).trim().toLowerCase()
  if (c === '') return ''
  // url(#id) paint refs: strip the renderer-specific id suffix (random in
  // FlowGraph, deterministic seq in mountFlow) — deviation #2, "compare
  // structure not literal id strings". url(#flow-hatch-438769224) and
  // url(#flow-hatch-0) both canonicalise to url(#flow-hatch).
  const ref = /^url\(#(.+?)\)$/.exec(c)
  if (ref) return `url(#${ref[1].replace(/-\d+$/, '')})`
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c)
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`
  return c
}

/**
 * Read a single CSS property value out of a `style` attribute string, tolerant
 * of spacing/terminator differences (`opacity: 0.85;` vs `opacity:0.85`) — both
 * renderers express opacity / font-size / text-transform as inline style
 * (UnoCSS-safe), but format the string differently. Absent → ''.
 *
 * @param {string|null|undefined} styleStr
 * @param {string} name
 * @returns {string}
 */
export function styleProp(styleStr, name) {
  if (styleStr == null) return ''
  for (const decl of String(styleStr).split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const k = decl.slice(0, idx).trim().toLowerCase()
    if (k === name.toLowerCase()) return decl.slice(idx + 1).trim()
  }
  return ''
}
