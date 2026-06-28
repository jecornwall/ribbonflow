// flow/library/src/render/applySpec.js
/**
 * applySpec.js — the thin DOM applier for the vanilla renderer.
 *
 * This is the ONLY module in src/render/ that touches the DOM. Everything that
 * decides WHAT to render (sceneSpec.js, agentsLayer.js) is pure and produces
 * framework-free element-spec descriptors; applySpec turns one spec (and its
 * children) into real SVG elements under a parent. Kept deliberately tiny and
 * obvious — its correctness is "creates the right element in the SVG namespace
 * and sets exactly the non-null attributes"; visual correctness is the parity
 * harness's job (Phase 2c).
 */

/** The SVG namespace — every flow element is created in it. */
export const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Materialise one element-spec (and its children) as SVG DOM under `parent`.
 *
 * @param {Element} parent — the element to append the new node to
 * @param {{tag: string, attrs?: object, children?: Array, text?: string}} spec
 * @param {Document} [doc] — owning document; defaults to parent.ownerDocument
 * @returns {Element} the created element
 */
export function applySpec(parent, spec, doc = parent.ownerDocument) {
  const el = doc.createElementNS(SVG_NS, spec.tag)
  const attrs = spec.attrs || {}
  for (const name of Object.keys(attrs)) {
    const value = attrs[name]
    if (value === null || value === undefined) continue
    el.setAttribute(name, String(value))
  }
  if (spec.text !== undefined) el.textContent = spec.text
  const children = spec.children || []
  for (const child of children) applySpec(el, child, doc)
  parent.appendChild(el)
  return el
}
