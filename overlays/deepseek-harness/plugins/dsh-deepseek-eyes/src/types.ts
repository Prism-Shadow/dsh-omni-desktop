/**
 * Vision-subcall vocabulary: the log-only request event and the canonical
 * tool outcome shared by the plugin and its tests.
 * @module @prismshadow/dsh-deepseek-eyes/types
 */

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Exact model-visible request recorded before one vision subcall dispatch. */
export interface VisionGeminiRequestEventData {
  /** LLM route the subcall resolves through (the pi-ai google route). */
  provider: string
  /** Vision model id on that route. */
  model: string
  /** Durable image reference carried by the request's image block. */
  attachment: ImageAttachmentRef
  /** Exact system prompt sent to the vision model. */
  system: string
  /** Output-token cap of the subcall. */
  maxTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one vision subcall. */
    'vision/gemini-request': VisionGeminiRequestEventData
  }
}

/** Canonical outcome declared by the `describe_image` output schema. */
export interface DescribeImageValue {
  attachment: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
  model: { provider: string; model: string }
  description: string
}
