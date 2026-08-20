/**
 * REAL-composition suite: ToolRuntime + LlmRuntime with the test replay
 * adapter answering the vision subcall, stub attachment/fs/approval seams,
 * and the real plugin. The platform Gemini route is never contacted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { installLlmReplay } from '@deepseek-ai/dsh-llm-replay'
import * as VisionGemini from '../src/index.ts'
import type { DescribeImageValue } from '../src/types.ts'

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

const LIMITS = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 4096,
  maxImagePixels: 1_000_000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

interface Harness {
  ctx: Context
  dir: string
  saveImage: ReturnType<typeof vi.fn>
  readBytes: ReturnType<typeof vi.fn>
  approvalRequest: ReturnType<typeof vi.fn>
  appended: Array<[string, unknown]>
  agent: object
}

async function boot(options: { llm?: boolean; approval?: boolean } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-deepseek-eyes-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
  })
  ctx.provide('systemPrompt', { tools: () => {} } as never)
  await ctx.plugin(ToolRuntime)
  if (options.llm !== false) {
    await ctx.plugin(LlmRuntime)
    // The replay adapter answers every request with the scripted text chunks.
    const overrideFile = join(dir, 'replay.override.json')
    await writeFile(overrideFile, JSON.stringify([{ kind: 'chunks', chunks: TEXT_CHUNKS }]), 'utf8')
    installLlmReplay(ctx, { file: join(dir, 'none.jsonl'), overrideFile })
  }
  const saveImage = vi.fn(async (input: { data: Uint8Array; mediaType: string; name?: string }) => ({
    ...REF,
    mediaType: input.mediaType,
    bytes: input.data.length,
    ...input.name === undefined ? {} : { name: input.name },
  }))
  ctx.provide('attachments', { imageLimits: LIMITS, saveImage } as never)
  const readBytes = vi.fn(async () => new Uint8Array([1, 2, 3, 4]))
  ctx.provide('fs', { resolve: async (path: string) => ({ path }), readBytes } as never)
  const approvalRequest = vi.fn(async () => 'allowed-once' as const)
  if (options.approval !== false) ctx.provide('approval', { request: approvalRequest } as never)
  const appended: Array<[string, unknown]> = []
  const agent = {
    session: {
      id: 'session-1' as never,
      events: [{
        type: 'user/message',
        data: { content: [{ type: 'image', attachment: REF }] },
      }],
      append: (name: string, data: unknown) => { appended.push([name, data]) },
    },
  }
  await ctx.plugin(VisionGemini, {})
  return { ctx, dir, saveImage, readBytes, approvalRequest, appended, agent }
}

async function execute(harness: Harness, args: { file_path?: string; attachment_id?: string }, agent?: object) {
  const result = await harness.ctx.tools.execute({
    callId: CallId('vision-call'),
    name: 'describe_image',
    arguments: args,
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent } as never,
  })
  return result as unknown as { error?: Error; value?: DescribeImageValue }
}

describe('describe_image', () => {
  it('approves, persists the file image, records the request, and returns the description', async () => {
    const h = await boot()
    const result = await execute(h, { file_path: 'shot.png' }, h.agent)
    expect(result.error).toBeUndefined()
    expect(result.value?.description).toBe('a cat on a desk')
    expect(result.value?.model).toEqual({ provider: 'google', model: 'gemini-3.5-flash-lite' })
    expect(h.saveImage).toHaveBeenCalledOnce()
    expect(h.readBytes).toHaveBeenCalledOnce()
    expect(h.approvalRequest).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'describe_image' }))
    expect(h.appended[0]?.[0]).toBe('vision/gemini-request')
    expect(h.appended[0]?.[1]).toMatchObject({ provider: 'google', model: 'gemini-3.5-flash-lite' })
  })

  it('resolves an attachment_id from the session log without touching the filesystem', async () => {
    const h = await boot()
    const result = await execute(h, { attachment_id: 'img-a1' }, h.agent)
    expect(result.value?.description).toBe('a cat on a desk')
    expect(result.value?.attachment.attachmentId).toBe('img-a1')
    expect(h.saveImage).not.toHaveBeenCalled()
    expect(h.readBytes).not.toHaveBeenCalled()
  })

  it('rejects the call when the user declines the approval', async () => {
    const h = await boot()
    h.approvalRequest.mockResolvedValueOnce('rejected')
    const result = await execute(h, { file_path: 'shot.png' }, h.agent)
    expect(result.error?.message).toBe('the user rejected sending this image to the vision model')
  })

  it('requires exactly one input', async () => {
    const h = await boot()
    const none = await execute(h, {})
    expect(none.error?.message).toContain('exactly one')
    const both = await execute(h, { file_path: 'a.png', attachment_id: 'img-a1' }, h.agent)
    expect(both.error?.message).toContain('exactly one')
  })

  it('refuses unknown extensions before any I/O', async () => {
    const h = await boot()
    const result = await execute(h, { file_path: 'notes.txt' }, h.agent)
    expect(result.error?.message).toContain('PNG/JPEG/WebP/GIF')
    expect(h.saveImage).not.toHaveBeenCalled()
    expect(h.readBytes).not.toHaveBeenCalled()
  })

  it('fails loudly when no llm service is mounted', async () => {
    const h = await boot({ llm: false })
    const result = await execute(h, { file_path: 'shot.png' }, h.agent)
    expect(result.error?.message).toContain('no llm service')
  })
})
