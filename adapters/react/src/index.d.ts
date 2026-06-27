import type { FC } from 'react'

/**
 * A flow or flow-set the embed can render: a flow / flow-set object, or its
 * serialized (JSON string) form. The library auto-detects which.
 */
export type FlowInput = object | string

export interface FlowEmbedProps {
  /** A flow object / serialized flow, OR a flow-set object / serialized flow-set. */
  flow: FlowInput
  /** Surface the renderer's read-only metrics overlay. */
  showMetrics?: boolean
}

/** React <FlowEmbed> — renders a flow (or flow-set) through the imperative renderer. */
export declare const FlowEmbed: FC<FlowEmbedProps>
