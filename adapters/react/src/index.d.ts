import type { FC } from 'react'

export interface FlowEmbedProps {
  /** A flow object / serialized flow, OR a flow-set object / serialized flow-set. */
  flow: object | string
  /** Surface the renderer's read-only metrics overlay. */
  showMetrics?: boolean
}

/** React <FlowEmbed> — renders a flow (or flow-set) through the imperative renderer. */
export declare const FlowEmbed: FC<FlowEmbedProps>
