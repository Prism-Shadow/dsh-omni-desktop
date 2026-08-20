/**
 * Typert Remote exposure of the platform login service: the gateway serves
 * `/api/platformAuth/<method>` purely from the `@Remote` markers on
 * {@link PlatformAuth}, with no core RPC-table involvement.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlatformAuth from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  vi.unstubAllEnvs()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-penguin-llm-router-typert-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(): Promise<{ ctx: Context; auth: PlatformAuth }> {
  const dir = await home()
  vi.stubEnv('DSH_HOME', dir)
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(PlatformAuth, {
    platformBaseURL: 'http://127.0.0.1:1',
    apiKeyRef: 'PENGUIN_API_HUB_KEY',
    clientName: 'dsh-desktop',
    pollIntervalMs: 10,
    loginTimeoutMs: 5000,
    verifyOnStart: false,
  })
  return { ctx, auth: ctx.get('platformAuth') as PlatformAuth }
}

describe('platform-auth Typert Remote', () => {
  it('serves status through the gateway without any core RPC-table entry', async () => {
    const { ctx } = await boot()
    const result = await ctx.typertGateway.invoke({
      namespace: 'platformAuth',
      method: 'status',
      args: {},
    })
    expect(result).toMatchObject({ kind: 'signed-out', reason: 'never-logged-in' })
  })

  it('serves cancel and logout as no-op transitions through the gateway', async () => {
    const { ctx } = await boot()
    await ctx.typertGateway.invoke({ namespace: 'platformAuth', method: 'cancel', args: {} })
    const status = await ctx.typertGateway.invoke({ namespace: 'platformAuth', method: 'status', args: {} })
    expect(status).toMatchObject({ kind: 'signed-out', reason: 'cancelled' })
    await ctx.typertGateway.invoke({ namespace: 'platformAuth', method: 'logout', args: {} })
    const after = await ctx.typertGateway.invoke({ namespace: 'platformAuth', method: 'status', args: {} })
    expect(after).toMatchObject({ kind: 'signed-out', reason: 'logout' })
  })
})
