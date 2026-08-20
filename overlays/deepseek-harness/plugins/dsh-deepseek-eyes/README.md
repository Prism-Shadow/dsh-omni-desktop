# `@prismshadow/dsh-deepseek-eyes`

Vision subcall for the DeepSeek Harness. Mounted by profiles that want the platform Gemini route to serve image understanding, it registers the model-facing `describe_image` tool: given a local image path (`file_path`) or a session image attachment (`attachment_id`), the tool asks the user once (the image leaves the machine and the call is billed), durably commits the image, records the exact subcall request as `vision/gemini-request`, and sends the image through `ctx.llm` on the configured route — the session's selected model is irrelevant, so text-only sessions keep a working vision path.

## Requirements

The paste route depends on the harness reading `model.inputModalities` from the profile's settings (so the official DeepSeek models can declare `image` input). That behavior ships in `0.1.0-rc.8` of `@deepseek-ai/dsh-llm` / `dsh-llm-deepseek`; older releases hardcode `inputModalities: ["text"]` and would reject pasted images at send admission. The package declares `@deepseek-ai/dsh-llm >=0.1.0-rc.8` as a peer dependency accordingly — upgrade the harness before installing this version.

## Paste route: the `llm/stream` rewrite

The official DeepSeek models declared by the profile declare `image` input in the profile's settings, so pasted images pass the host's send admission and the durable session keeps the native image blocks (composer thumbnail, inline history rendering). The host half registers a global `llm/stream` waterfall listener that rewrites every image block — including ones nested under `tool-result` content — into an attachment-id text marker (`[图片 attachment_id=…]`) inside the forwarded request, before the request reaches the official text-only API. The session log keeps the original image blocks, so the conversation keeps showing the pasted images while the official DeepSeek API (which rejects `image_url` content parts) only ever sees markers.

The plugin's web half (`exports "./client"`) is declarative: pasted images ride the native attachment flow, and the host rewrite resolves the markers back to the durable attachment store at `describe_image` time.

The tool is registered only while a durable attachment store and fs capability are mounted (`ctx.inject(['attachments', 'fs'], …)`); the route connection facts (api key, baseURL) belong to the pi-ai `google` route's settings section, which the platform login writes.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | `google` | LLM route the subcall resolves through (the pi-ai google route) |
| `model` | `gemini-3.5-flash-lite` | Vision model id on that route |
| `maxTokens` | `1024` | Output-token cap of the subcall |
| `systemPrompt` | plain-description instruction | System prompt sent to the vision model |

## Model Experience

### describe_image tool and its vision subcall

#### What the model sees

The model sees the `describe_image` tool with two string parameters: `file_path` (a local PNG/JPEG/WebP/GIF path) and `attachment_id` (a session image attachment id) — exactly one must be present. The tool's output is an object with the image `attachment` metadata, the subcall's `model` (`{ provider, model }`), and the plain-text `description`; it renders as text. The verbatim tool description below is the stable literal the harness exposes to the model.

##### Verbatim tool description

```markdown
查看图片内容：给定图片文件路径（file_path）或会话中已有图片的附件 id（attachment_id），把该图片发送到平台 Gemini 视觉模型，返回图片内容的详细文字描述。当用户要求看图、分析图表/截图/照片/界面时使用，且当前模型无法直接看到图片（纯文本模型）时，这是首选工具：不要先尝试 read_image（它要求模型本身支持图片输入，纯文本模型下必然失败）。会话中粘贴的图片会以 [图片 attachment_id=xxx] 标记出现在对话里：需要查看时，把标记中的 id 填入 attachment_id（不要用 file_path 去打开这个标记文本）。注意：图片会发送到平台并产生视觉计费，调用前会向用户确认。
```

#### Token effect

Fixed per call: one image block plus the fixed vision system prompt enter the subcall, and the output is capped by `maxTokens` (default 1024). The main conversation request is only ever rewritten by the paste-route listener (image blocks to markers, no new tokens); nothing else about it changes.

#### KV Cache effect

Independent model request: the subcall is a separate `ctx.llm` dispatch with its own messages and system prompt, so it never reuses the main conversation's prefix and every call starts a fresh request. Provider cache availability and eviction remain outside this package's contract.

## Known Limitations and Deferred Work

- Approval is best-effort by composition: with an approval service mounted (the desktop profile), the tool asks and fails closed on rejection; without one, there is no channel to ask, so the call proceeds — a headless composition must accept that images leave the machine and incur platform billing.
- The `file_path` path resolves against the fs seam's default cwd rules; the tool does not take an explicit cwd argument.
- The attachment-id lookup scans the calling session's logged events for the first image block carrying the id; an image stored only in memory elsewhere is not findable.
- The tool returns a text description, not the image itself; multi-modal reasoning over the raw image is the separate manual-route path (session model selection), not this package's role.
