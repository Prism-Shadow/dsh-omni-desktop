/**
 * Vision rewrite suite: the `llm/stream` waterfall listener that turns image
 * blocks into attachment-id markers before a request reaches the official
 * text-only upstream route. Exercised through a real LlmRuntime with a
 * recording adapter answering the stream; a second provider route confirms
 * the rewrite never touches non-upstream requests.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  UPSTREAM_PROVIDER, registerVisionRewrite, rewriteImageBlocks,
} from '../src/bridge.ts'

/** A complete text-only reply: block open, delta, close, stop. */
const TEXT_CHUNKS: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'a cat on a desk' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'a cat on a desk' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

const REF: ImageAttachmentRef = {
  attachmentId: AttachmentId('img-a1'),
  mediaType: 'image/png',
  bytes: 4,
  width: 1,
  height: 1,
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** Records every dispatched request; answers with a scripted text reply. */
class RecordingAdapter extends LlmAdapter {
  readonly options: GenerateOptions[] = []
  async listModels(): Promise<LlmModelInfo[]> {
    return [
      { provider: UPSTREAM_PROVIDER, id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text', 'image'] },
      { provider: UPSTREAM_PROVIDER, id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', inputModalities: ['text'] },
    ]
  }
  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, inputModalities: ['text', 'image'] }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.options.push(options)
    yield* TEXT_CHUNKS
  }
}

/** A real LlmRuntime with the recording adapter on the upstream and a decoy route. */
async function bootRuntime(): Promise<{ ctx: Context; adapter: RecordingAdapter }> {
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter([UPSTREAM_PROVIDER, 'google'], adapter)
  registerVisionRewrite(ctx)
  return { ctx, adapter }
}

describe('registerVisionRewrite', () => {
  it('rewrites image blocks into attachment markers before the upstream adapter', async () => {
    const { ctx, adapter } = await bootRuntime()
    const message = createUserMessage({
      content: [{ type: 'image', attachment: REF }, { type: 'text', text: 'look' }],
      source: { kind: 'user' },
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: UPSTREAM_PROVIDER,
      model: 'deepseek-v4-flash',
      messages: [message],
      signal: new AbortController().signal,
    })) {
      chunks.push(chunk)
    }
    expect(chunks).toHaveLength(TEXT_CHUNKS.length)
    expect(adapter.options).toHaveLength(1)
    const content = adapter.options[0]!.messages[0]!.content
    expect(content).toHaveLength(2)
    const text = content[0] as { type: 'text'; text: string }
    expect(text.type).toBe('text')
    expect(text.text).toBe('[图片 attachment_id=img-a1]')
    expect(content[1]).toMatchObject({ type: 'text', text: 'look' })
  })

  it('passes image-free requests through unchanged', async () => {
    const { ctx, adapter } = await bootRuntime()
    const message = createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    })
    for await (const _chunk of ctx.llm.stream({
      provider: UPSTREAM_PROVIDER,
      model: 'deepseek-v4-flash',
      messages: [message],
      signal: new AbortController().signal,
    })) { /* drain */ }
    expect(adapter.options).toHaveLength(1)
    expect(adapter.options[0]!.messages[0]!.content[0]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('leaves requests to other providers untouched', async () => {
    const { ctx, adapter } = await bootRuntime()
    const message = createUserMessage({
      content: [{ type: 'image', attachment: REF }],
      source: { kind: 'user' },
    })
    for await (const _chunk of ctx.llm.stream({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      messages: [message],
      signal: new AbortController().signal,
    })) { /* drain */ }
    expect(adapter.options).toHaveLength(1)
    expect(adapter.options[0]!.messages[0]!.content[0]).toMatchObject({ type: 'image', attachment: REF })
  })
})

describe('rewriteImageBlocks', () => {
  it('keeps non-image content untouched', () => {
    const content = [{ type: 'text' as const, text: 'hello' }]
    expect(rewriteImageBlocks(content)).toEqual(content)
  })

  it('leaves an image block without an attachment untouched', () => {
    const content = [{ type: 'image' as const }]
    expect(rewriteImageBlocks(content)).toEqual(content)
  })

  it('recurses into tool-result content and rewrites nested images', () => {
    const content = [
      {
        type: 'tool-result' as const,
        toolCallId: CallId('call-1'),
        content: [
          { type: 'image' as const, attachment: REF },
          { type: 'text' as const, text: 'nested tail' },
        ],
      },
    ]
    const result = rewriteImageBlocks(content)
    expect(result[0]).toMatchObject({ type: 'tool-result', toolCallId: 'call-1' })
    const nested = result[0] as { type: 'tool-result'; content: ContentBlock[] }
    expect(nested.content).toEqual([
      { type: 'text', text: '[图片 attachment_id=img-a1]' },
      { type: 'text', text: 'nested tail' },
    ])
  })

  it('leaves a tool-result with no nested images untouched', () => {
    const block = {
      type: 'tool-result' as const,
      toolCallId: CallId('call-1'),
      content: [{ type: 'text' as const, text: 'no image here' }],
    }
    const result = rewriteImageBlocks([block])
    expect(result).toEqual([block])
  })
})
