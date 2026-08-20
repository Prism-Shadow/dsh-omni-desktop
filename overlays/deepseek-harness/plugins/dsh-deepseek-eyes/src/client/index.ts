/**
 * dsh-deepseek-eyes web half: no browser behavior. Image pastes ride the native
 * attachment flow (composer thumbnail, durable image blocks, inline history
 * rendering); the host half's `llm/stream` rewrite turns image blocks into
 * attachment-id markers at request time, so a text-only session model never
 * receives raw image content and the conversation keeps showing the pasted
 * images. The `describe_image` tool resolves those markers (and plain file
 * paths) back to image content.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Required services: none — the web half is purely declarative. */
export const inject: string[] = []

/** No browser half behavior today; kept as the bundle's web entry. */
export function apply(_ctx: ClientContext): void {
  // Intentional no-op: see the module comment.
}
