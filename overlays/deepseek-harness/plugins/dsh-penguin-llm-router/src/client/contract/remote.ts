/**
 * Client Typert Remote contribution for the platformAuth namespace. The host
 * half of this package carries the `@Remote` markers; this web half mounts
 * the strict wire descriptors so `ctx.remote.$mount` serves
 * `/api/platformAuth/<method>` through the standard gateway — no core
 * RPC-table involvement. The gateway client requires strict codecs on every
 * mounted descriptor, so each result carries a zod schema.
 */

import { z } from 'zod'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { AuthStatus } from './slots.ts'

/** Strict codec schema for the wire status union. */
const authStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signed-out'), reason: z.string() }),
  z.object({ kind: z.literal('signing-in'), authorizeUrl: z.string(), expiresAt: z.number() }),
  z.object({
    kind: z.literal('signed-in'),
    user: z.object({
      id: z.string(),
      username: z.string().optional(),
      displayName: z.string().optional(),
      avatarUrl: z.string().optional(),
    }),
    balance: z.object({
      units: z.number(),
      currency: z.string(),
      display: z.string(),
    }).optional(),
    verifiedAt: z.number(),
  }),
])

/** Empty mutation result: the host returns `{}` for a no-value mutation. */
const emptyResultSchema = z.object({}).strict()

/** One strict wire descriptor per parameterless public method. */
function descriptor(method: string, result: { typeSymbol: string; schema: z.ZodType }): InvocationDescriptor {
  return {
    id: `@prismshadow/dsh-penguin-llm-router#platformAuth/${method}`,
    service: 'platformAuth',
    namespace: 'platformAuth',
    method,
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'strict', typeSymbol: result.typeSymbol, schema: result.schema },
  }
}

/** Wire descriptors for the five platformAuth methods. */
export const PLATFORM_AUTH_INVOCATIONS: readonly InvocationDescriptor[] = [
  descriptor('status', { typeSymbol: '@prismshadow/dsh-penguin-llm-router#AuthStatus', schema: authStatusSchema }),
  descriptor('login', { typeSymbol: '@prismshadow/dsh-penguin-llm-router#AuthorizeUrl', schema: z.object({ authorizeUrl: z.string() }).strict() }),
  descriptor('cancel', { typeSymbol: '@prismshadow/dsh-penguin-llm-router#Empty', schema: emptyResultSchema }),
  descriptor('logout', { typeSymbol: '@prismshadow/dsh-penguin-llm-router#Empty', schema: emptyResultSchema }),
  descriptor('refresh', { typeSymbol: '@prismshadow/dsh-penguin-llm-router#Empty', schema: emptyResultSchema }),
]

/** Client contribution mounted into `ctx.remote`. */
export const PLATFORM_AUTH_REMOTE: TypertRemoteContribution = {
  package: '@prismshadow/dsh-penguin-llm-router',
  descriptors: PLATFORM_AUTH_INVOCATIONS,
}

/** The mounted namespace's callable face, matching the host `@Remote` methods. */
export interface PlatformAuthRemoteFace {
  status(): Promise<RemoteResult<AuthStatus>>
  login(): Promise<RemoteResult<{ authorizeUrl: string }>>
  cancel(): Promise<RemoteResult<Record<string, never>>>
  logout(): Promise<RemoteResult<Record<string, never>>>
  refresh(): Promise<RemoteResult<Record<string, never>>>
}
