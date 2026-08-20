/**
 * Vision subcall for the DeepSeek Harness: the model-facing `describe_image`
 * tool. Given a local image path or a session attachment id, it asks the user
 * once (the image leaves the machine and the call is billed), durably commits
 * the image, records the exact subcall request in the session log, and sends
 * it through `ctx.llm` on the platform Gemini route — the session's selected
 * model is irrelevant, so text-only sessions keep a working vision path.
 *
 * The route and model are plugin config; the connection facts (api key,
 * baseURL) belong to the pi-ai google route's settings section, which the
 * platform login writes.
 *
 * The web half (src/client) is declarative: pasted images ride the native
 * attachment flow, and the host half's `llm/stream` rewrite turns image
 * blocks into attachment-id markers at request time, so `describe_image` can
 * resolve them from the durable attachment store without any disk copy.
 * @module @prismshadow/dsh-deepseek-eyes
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session'
import {
  registerVisionRewrite, visionDescribe,
} from './bridge.ts'
import type { DescribeImageValue, VisionGeminiRequestEventData } from './types.ts'

export type {
  DescribeImageValue,
  VisionGeminiRequestEventData,
} from './types.ts'

/** Extensions `describe_image` accepts; magic-byte validation at the attachment service stays authoritative. */
const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** The platform Gemini route the subcall resolves through (pi-ai route key + catalog model). */
const DEFAULT_PROVIDER = 'google'
const DEFAULT_MODEL = 'gemini-3.1-flash-lite'
const DEFAULT_MAX_TOKENS = 1024

/** Stable vision-prompt instruction: return a plain-language description only. */
const DEFAULT_SYSTEM_PROMPT = [
  'Describe the attached image in detail and in plain text.',
  'State what the image shows, including any visible text, diagrams, UI elements, or errors.',
  'Return the description only, with no Markdown, XML, or terminal control codes.',
].join('\n')

/** Plugin config; every field is optional — apply fills the documented defaults. */
export interface Config {
  /** LLM provider route the subcall resolves through; defaults to the platform google route. */
  provider?: string
  /** Vision model id on that route. */
  model?: string
  /** Output-token cap of the subcall. */
  maxTokens?: number
  /** System prompt sent to the vision model. */
  systemPrompt?: string
}

export const name = 'dsh-deepseek-eyes'

/** The tool registry; attachments is optional at load and gates the tool's existence. */
export const inject = ['tools']
export const Config: z<Config> = z.object({
  provider: z.string(),
  model: z.string(),
  maxTokens: z.natural().min(1),
  systemPrompt: z.string(),
})

/** Config after apply fills every default; the tool body only sees this. */
type ResolvedConfig = Required<Config>

/**
 * Mount the `describe_image` tool while a durable attachment store exists.
 * Config fields all default, so hand-built compositions may pass a partial
 * object or none.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved: ResolvedConfig = {
    provider: config?.provider ?? DEFAULT_PROVIDER,
    model: config?.model ?? DEFAULT_MODEL,
    maxTokens: config?.maxTokens ?? DEFAULT_MAX_TOKENS,
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  }
  // The vision rewrite: the official DeepSeek route declares image input in
  // the profile's settings, so pasted images pass the host's send admission.
  // The rewrite owns the only transformation: at the llm/stream waterfall it
  // turns image blocks into attachment-id markers inside the forwarded
  // request, after the session records the user message and before the
  // request reaches the official API — the history keeps the native image
  // blocks, the official text model only ever sees markers that
  // `describe_image` resolves back to the durable attachment store.
  ctx.inject(['llm'], (scope) => {
    registerVisionRewrite(scope)
  })
  // describe_image reads the pasted bytes through the fs capability, so the
  // tool scope must inject fs alongside the durable attachment store.
  ctx.inject(['attachments', 'fs'], (scope) => {
    scope.tools.register(defineTool({
      name: 'describe_image',
      description: '查看图片内容：给定图片文件路径（file_path）或会话中已有图片的附件 id（attachment_id），'
        + '把该图片发送到平台 Gemini 视觉模型，返回图片内容的详细文字描述。'
        + '当用户要求看图、分析图表/截图/照片/界面时使用，且当前模型无法直接看到图片（纯文本模型）时，'
        + '这是首选工具：不要先尝试 read_image（它要求模型本身支持图片输入，纯文本模型下必然失败）。'
        + '会话中粘贴的图片会以 [图片 attachment_id=xxx] 标记出现在对话里：需要查看时，把标记中的 id 填入 attachment_id'
        + '（不要用 file_path 去打开这个标记文本）。'
        + '注意：图片会发送到平台并产生视觉计费，调用前会向用户确认。',
      parameters: {
        file_path: { type: 'string', description: '本地图片文件路径（PNG/JPEG/WebP/GIF）。与 attachment_id 二选一。' },
        attachment_id: { type: 'string', description: '会话中已有图片的附件 id。与 file_path 二选一。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            attachment: {
              type: 'object',
              additionalProperties: false,
              required: true,
              properties: {
                attachmentId: { type: 'string', required: true },
                mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
                bytes: { type: 'integer', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
                name: { type: 'string' },
              },
            },
            model: {
              type: 'object',
              additionalProperties: false,
              required: true,
              properties: {
                provider: { type: 'string', required: true },
                model: { type: 'string', required: true },
              },
            },
            description: { type: 'string', required: true },
          },
        },
        render: (_args, value: DescribeImageValue) => [
          { type: 'text' as const, text: value.description },
        ],
      },
      // The subcall only reads; content-addressed attachment writes are idempotent.
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return describeImage(scope, resolved, args, exec)
      },
      presentCall(args): GenericCallView {
        const path = args.file_path
        return {
          card: 'generic',
          title: `Describe image ${args.file_path ?? args.attachment_id ?? ''}`,
          kind: 'read',
          ...path === undefined ? {} : { locations: [{ path }] },
        }
      },
    }))
  })
}

/** Minimal structural face of the approval seam (`ctx.approval`). */
interface Approver {
  request(req: {
    agent: object
    toolName: string
    callId: unknown
    reason: string
    signal?: AbortSignal
  }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}

/** The caller-supplied input pair (exactly one present; validated in execute). */
interface DescribeImageArgs {
  file_path?: string
  attachment_id?: string
}

/**
 * Map a model-supplied path to its declared image media type by extension.
 * @param filePath - the raw `file_path` argument (not yet resolved).
 * @returns the declared media type, or undefined when the path does not claim an image.
 */
export function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

/**
 * Ask once before the image leaves the machine and the call is billed. A
 * missing approval service means the deployment has no channel to ask, so the
 * call proceeds (composition choice; the desktop profile always composes one).
 * @param ctx - plugin context carrying the optional approval service.
 * @param exec - tool-execution context supplying the calling agent.
 */
async function approveSend(ctx: Context, exec: ToolExecution): Promise<void> {
  const approver = ctx.get('approval') as Approver | undefined
  if (approver === undefined || exec.agent === undefined) return
  const outcome = await approver.request({
    agent: exec.agent,
    toolName: 'describe_image',
    callId: exec.callId,
    reason: 'the image will be sent to the platform Gemini vision model and billed',
    signal: exec.signal,
  })
  switch (outcome) {
    case 'allowed-once':
      return
    case 'rejected':
      throw new Error('the user rejected sending this image to the vision model')
    case 'cancelled':
      throw new Error('vision approval was cancelled')
    case 'unavailable':
      throw new Error('vision approval channel is unavailable')
    default:
      return assertNever(outcome, 'ApprovalOutcome')
  }
}

/** Find the durable image reference for one attachment id inside the session log. */
function referenceFor(
  events: readonly unknown[],
  attachmentId: string,
): ImageAttachmentRef | undefined {
  const find = (blocks: readonly unknown[]): ImageAttachmentRef | undefined => {
    for (const block of blocks) {
      const image = block as { type?: string; attachment?: ImageAttachmentRef; content?: unknown[] }
      if (image.type === 'image' && image.attachment !== undefined
        && image.attachment.attachmentId === attachmentId) {
        return image.attachment
      }
      if (image.type === 'tool-result' && Array.isArray(image.content)) {
        const nested = find(image.content)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }
  for (const event of events) {
    const data = event as {
      type?: string
      data?: { content?: unknown[]; message?: { content?: unknown[] }; chunk?: { type?: string; block?: unknown } }
    }
    if (data.type === 'user/message' && data.data !== undefined) {
      const direct = data.data.content !== undefined ? find(data.data.content) : undefined
      if (direct !== undefined) return direct
      const wrapped = data.data.message?.content !== undefined ? find(data.data.message.content) : undefined
      if (wrapped !== undefined) return wrapped
    }
    if (data.type === 'assistant/chunk' && data.data?.chunk?.type === 'block-end' && data.data.chunk.block !== undefined) {
      const ended = find([data.data.chunk.block])
      if (ended !== undefined) return ended
    }
  }
  return undefined
}

/**
 * Run one vision subcall: approve, resolve the image to a durable reference,
 * record the exact request, and stream the description through `ctx.llm`.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 * @param args - the caller-supplied input pair.
 * @param exec - tool-execution context.
 * @returns the canonical outcome.
 */
async function describeImage(
  ctx: Context,
  config: ResolvedConfig,
  args: DescribeImageArgs,
  exec: ToolExecution,
): Promise<DescribeImageValue> {
  const filePath = args.file_path?.trim() ?? ''
  const attachmentId = args.attachment_id?.trim() ?? ''
  const hasPath = filePath.length > 0
  const hasId = attachmentId.length > 0
  if (hasPath === hasId) {
    throw new Error('describe_image requires exactly one of file_path or attachment_id')
  }
  await approveSend(ctx, exec)

  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('describe_image: no attachment service is mounted')
  }

  let ref: ImageAttachmentRef
  if (hasPath) {
    const mediaType = imageMediaTypeForPath(filePath)
    if (mediaType === undefined) {
      throw new Error(`describe_image only accepts PNG/JPEG/WebP/GIF paths: "${filePath}"`)
    }
    if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
      throw new Error(`describe_image: ${mediaType} images are not accepted by this deployment`)
    }
    const target = await ctx.fs.resolve(filePath)
    const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
    const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
    try {
      ref = await attachments.saveImage({ data, mediaType, name: basename(filePath) })
    } catch (error: unknown) {
      if (!(error instanceof AttachmentError) || error.code !== 'IMAGE_TYPE_MISMATCH') throw error
      throw new Error(
        `describe_image: "${filePath}" declares ${mediaType}, but the bytes use a different image format`,
        { cause: error },
      )
    }
  } else {
    const session = exec.agent?.session
    if (session === undefined) {
      throw new Error('describe_image: attachment_id requires the call to run inside a session')
    }
    const found = referenceFor(session.events, attachmentId)
    if (found === undefined) {
      throw new Error(`describe_image: attachment "${attachmentId}" not found in this session`)
    }
    ref = found
  }

  const session = exec.agent?.session
  if (session !== undefined) {
    session.append('vision/gemini-request', {
      provider: config.provider,
      model: config.model,
      attachment: ref,
      system: config.systemPrompt,
      maxTokens: config.maxTokens,
    } satisfies VisionGeminiRequestEventData)
  }
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error('describe_image: no llm service is mounted for the vision subcall')
  }
  const text = await visionDescribe(llm, {
    provider: config.provider,
    model: config.model,
    maxTokens: config.maxTokens,
    systemPrompt: config.systemPrompt,
  }, ref, exec.signal)
  return {
    attachment: {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...ref.name === undefined ? {} : { name: ref.name },
    },
    model: { provider: config.provider, model: config.model },
    description: text,
  }
}

/** Exhaust the closed approval-outcome union. */
function assertNever(value: never, label: string): never {
  throw new Error(`describe_image: unexpected ${label} ${JSON.stringify(value)}`)
}

export { AttachmentId }
