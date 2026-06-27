// flow/adapters/react/src/FlowEmbed.jsx
import { useRef, useEffect } from 'react'
import { mountFlowAuto } from '@flow-designer/library/render'

/**
 * React <FlowEmbed> — renders a flow (or flow-set) through the imperative
 * renderer via @flow-designer/library's mountFlowAuto. The kind-switch remount
 * and the visibility-gated rAF loop live in the library; this is lifecycle
 * wiring only. Becomes @ribbonflow/react at the repo split.
 *
 * @param {{ flow: object|string, showMetrics?: boolean }} props
 */
export function FlowEmbed({ flow, showMetrics = false }) {
  const rootEl = useRef(null)
  const handle = useRef(null)
  const skipFirst = useRef(true)

  // Mount once; tear down on unmount. showMetrics is read at mount (matches the
  // Vue adapter, which watches only `flow`).
  useEffect(() => {
    handle.current = mountFlowAuto(rootEl.current, flow, { showMetrics })
    return () => {
      if (handle.current) handle.current.destroy()
      handle.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap on `flow` identity change — skip the initial run (mount already
  // rendered the first flow), so this fires only on a real prop swap.
  // skipFirst starts true so the first invocation always skips, regardless
  // of effect execution order relative to the mount effect.
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return }
    if (handle.current) handle.current.update(flow)
  }, [flow])

  return <div ref={rootEl} className="flow-embed" style={{ width: '100%', height: '100%' }} />
}
