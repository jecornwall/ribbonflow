// flow/parity/src/diff/diffScenes.js
/**
 * diffScenes.js — multiset comparison of two extracted scenes (extractScene.js).
 *
 * The Phase-2c geometric parity verdict for one flow state: compare the golden
 * (FlowGraph) scene against the candidate (mountFlow) scene tag-by-tag as
 * MULTISETS (order-independent — so the legend z-order deviation is inert), plus
 * the viewBox. A clean diff (no missing, no extra, matching viewBox) is GREEN;
 * any leaf-shape that appears on only one side is a parity divergence (a REAL
 * candidate — the 3 known deviations are already excluded by extraction).
 *
 * Pure; no DOM.
 */

function countMap(keys) {
  const m = new Map()
  for (const k of keys) m.set(k, (m.get(k) || 0) + 1)
  return m
}

/** Multiset difference: keys (with multiplicity) in golden-not-candidate and vice versa. */
function multisetDiff(goldKeys = [], candKeys = []) {
  const gc = countMap(goldKeys)
  const cc = countMap(candKeys)
  const missing = []
  const extra = []
  for (const [k, n] of gc) {
    const d = n - (cc.get(k) || 0)
    for (let i = 0; i < d; i++) missing.push(k)
  }
  for (const [k, n] of cc) {
    const d = n - (gc.get(k) || 0)
    for (let i = 0; i < d; i++) extra.push(k)
  }
  return { matched: goldKeys.length - missing.length, missing, extra }
}

/**
 * @param {{viewBox:string, byTag:Record<string,string[]>}} golden — FlowGraph scene
 * @param {{viewBox:string, byTag:Record<string,string[]>}} candidate — mountFlow scene
 * @returns {{ok:boolean, viewBoxMatch:boolean, goldenViewBox:string,
 *   candidateViewBox:string, perTag:Record<string,{matched:number,missing:string[],extra:string[]}>}}
 */
export function diffScenes(golden, candidate) {
  const tags = new Set([...Object.keys(golden.byTag || {}), ...Object.keys(candidate.byTag || {})])
  const perTag = {}
  let ok = true
  for (const t of [...tags].sort()) {
    const d = multisetDiff(golden.byTag[t] || [], candidate.byTag[t] || [])
    perTag[t] = d
    if (d.missing.length || d.extra.length) ok = false
  }
  const viewBoxMatch = (golden.viewBox || '') === (candidate.viewBox || '')
  if (!viewBoxMatch) ok = false
  return {
    ok,
    viewBoxMatch,
    goldenViewBox: golden.viewBox || '',
    candidateViewBox: candidate.viewBox || '',
    perTag,
  }
}
