/**
 * Platform vision seam for text-only official DeepSeek models. The official
 * route declares `image` input (the profile's settings), so pasted images
 * pass the host's send admission and the durable session keeps the native
 * image blocks (composer thumbnail, inline history rendering). The rewrite
 * owns the only transformation: at the `llm/stream` waterfall, image blocks
 * become attachment-id text markers inside the forwarded request — after the
 * session records the user message and before the request reaches the
 * upstream — so the history keeps the images while the official DeepSeek API
 * (which rejects `image_url` content parts) only ever sees markers. The
 * bytes already live in the durable attachment store, so no copy is written
 * to disk; `describe_image(attachment_id=…)` resolves the marker's id back
 * to that store.
 */

import {
  BlockAssembler, contentHasImage, createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, GenerateOptions, LlmRuntime, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** The text-only official DeepSeek route the rewrite protects. */
export const UPSTREAM_PROVIDER = 'deepseek-official'

/** Vision subcall facts the plugin converts image blocks with. */
export interface VisionRoute {
  provider: string
  model: string
  maxTokens: number
  systemPrompt: string
}

/** Translate terminal finish reasons into a vision subcall failure. */
function finishError(finish: { kind: string; failure?: { message: string; code?: string } }): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure?.message ?? 'unknown stream failure') as Error & { code?: string }
      if (finish.failure?.code !== undefined) error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('vision bridge: the vision description reached the output cap')
    case 'tool-calls':
      return new Error('vision bridge: the vision model unexpectedly requested a tool')
    default:
      return new Error(`vision bridge: unsupported finish reason "${finish.kind}"`)
  }
}

/**
 * Describe one durable image reference through the platform Gemini route. The
 * pi-ai google adapter resolves the attachment bytes itself, so only the llm
 * seam is needed here.
 * @param llm - the composed llm runtime.
 * @param route - vision subcall route facts.
 * @param ref - the durable image reference.
 * @param signal - caller/request lifetime.
 * @returns the plain-text description.
 */
export async function visionDescribe(
  llm: LlmRuntime,
  route: VisionRoute,
  ref: ImageAttachmentRef,
  signal: AbortSignal,
): Promise<string> {
  const message = createUserMessage({
    content: [{ type: 'image' as const, attachment: ref }],
    source: { kind: 'plugin', plugin: 'dsh-deepseek-eyes' },
  })
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [message],
    system: route.systemPrompt,
    maxTokens: route.maxTokens,
    signal,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream(options)) {
    assembler.push(chunk)
  }
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const text = assembler.blocks()
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .trim()
  if (text.length === 0) throw new Error('vision bridge: the vision model produced no description')
  return text
}

/** The marker an image block rewrites to; `describe_image` resolves the id. */
export function imageMarker(attachmentId: string): string {
  return `[图片 attachment_id=${attachmentId}]`
}

/**
 * Rewrite every image block of one message's content into an attachment-id
 * marker, so a text-only session model never receives raw image content. The
 * bytes stay in the durable attachment store (no disk copy), and
 * `describe_image(attachment_id=…)` resolves the marker's id from the session
 * log. Walks nested `tool-result` content so the rewrite stays in step with
 * the recursive {@link contentHasImage} detection the rewrite is keyed on —
 * an image nested under a tool result is rewritten to its marker just like a
 * top-level one.
 * @param content - the message content to rewrite.
 * @returns the rewritten content.
 */
export function rewriteImageBlocks(content: readonly ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const block of content) {
    if (block.type === 'image' && block.attachment !== undefined) {
      out.push({ type: 'text', text: imageMarker(block.attachment.attachmentId) })
      continue
    }
    if (block.type === 'tool-result' && block.content.length > 0) {
      out.push({ ...block, content: rewriteImageBlocks(block.content) })
      continue
    }
    out.push(block)
  }
  return out
}

/**
 * Register the request rewrite on the `llm/stream` waterfall. Every request
 * bound for {@link UPSTREAM_PROVIDER} has its image blocks rewritten to
 * attachment-id markers before the adapter serializes them. The forwarded
 * request re-enters the waterfall, so a WeakSet guard skips the rewrite on
 * the second pass; rewriting marker text is idempotent anyway, so concurrent
 * registrations (HMR) stay safe. The listener is global and non-prepend, so
 * the agent-loop reconstruction invariant and other prepend listeners still
 * see the original request first.
 * @param ctx - context with the composed llm runtime mounted.
 * @returns the listener disposer.
 */
export function registerVisionRewrite(ctx: Context): () => void {
  const rewritten = new WeakSet<GenerateOptions>()
  const listener = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> => {
    if (rewritten.has(options)) return next()
    if (options.provider !== UPSTREAM_PROVIDER) return next()
    let needsRewrite = false
    const messages = options.messages.map((message) => {
      if (!contentHasImage(message.content)) return message
      needsRewrite = true
      return { ...message, content: rewriteImageBlocks(message.content) }
    })
    if (!needsRewrite) return next()
    const forwarded = { ...options, messages }
    rewritten.add(forwarded)
    return ctx.llm.stream(forwarded)
  }
  return ctx.on('llm/stream', listener, { global: true })
}
