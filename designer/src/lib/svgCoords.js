/**
 * Convert a client-space pointer coordinate into the SVG's user space
 * (i.e. flow/viewBox coordinates).
 *
 * The editor canvas renders an SVG whose viewBox is the flow's viewBox, so a
 * node at (x, y) sits at the same logical point regardless of how the SVG is
 * letterboxed or scaled into the page. Dragging must therefore map screen
 * pixels back into viewBox units — this does that via the SVG's screen CTM.
 *
 * @param {SVGSVGElement} svg   the <svg> element being interacted with
 * @param {number} clientX      pointer clientX
 * @param {number} clientY      pointer clientY
 * @returns {{x:number, y:number}} the point in SVG user space
 */
export function clientToSvg(svg, clientX, clientY) {
  if (!svg || typeof svg.getScreenCTM !== 'function') {
    return { x: clientX, y: clientY }
  }
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}
