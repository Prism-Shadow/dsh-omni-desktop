/**
 * REAL-composition suite: llm + web + settings-file + credentials-local +
 * the three platform consumers (llm-deepseek, llm-pi-ai, web-search-deepseek)
 * + platform-auth over one temp harness home, with the platform itself
 * mocked as a loopback HTTP server speaking the §3.2 protocol.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import WebRuntime from '@deepseek-ai/dsh-web'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import * as WebSearchDeepSeek from '@deepseek-ai/dsh-web-search-deepseek'
import PlatformAuth from '../src/index.ts'
import { PlatformHttpError } from '../src/index.ts'

const KEY_REF = credentialRef('PENGUIN_API_HUB_KEY')
// Wire-shape fidelity: the platform answers SQLite ids as numbers and ledger
// units as a numeric string; the service must normalize both before writing.
const USER = { id: 417, username: 'alice', displayName: 'Alice', avatarUrl: null as string | null }
const CLAIMED = {
  status: 'claimed',
  user: USER,
  apiKey: 'ep_claimed-key',
  apiBaseURL: 'https://token.penguin.ooo/api',
  geminiBaseURL: 'https://token.penguin.ooo/api/v1beta',
  anthropicBaseURL: 'https://token.penguin.ooo/api/anthropic/v1',
}

const cleanups: Array<() => Promise<void>> = []
const servers: Server[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  while (servers.length > 0) {
    const server = servers.pop()
    if (server !== undefined) {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  }
  vi.unstubAllEnvs()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-penguin-llm-router-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

interface Handlers {
  start?: (body: Record<string, unknown>) => [status: number, body: unknown]
  poll?: (body: Record<string, unknown>) => [status: number, body: unknown]
  byKey?: (authorization: string | undefined) => [status: number, body: unknown]
}

interface MockPlatform {
  baseURL: string
  requests: Array<{
    method: string | undefined
    url: string | undefined
    body: unknown
    authorization: string | undefined
  }>
}

/** Loopback platform speaking the §3.2 protocol; unhandled routes answer 404. */
async function mockPlatform(handlers: Handlers): Promise<MockPlatform> {
  const requests: MockPlatform['requests'] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown : undefined
      requests.push({ method: req.method, url: req.url, body, authorization: req.headers.authorization })
      const selected = req.url?.startsWith('/api/auth/desktop/start')
        ? handlers.start?.(body as Record<string, unknown>)
        : req.url?.startsWith('/api/auth/desktop/poll')
          ? handlers.poll?.(body as Record<string, unknown>)
          : req.url?.startsWith('/api/me/by-key')
            ? handlers.byKey?.(req.headers.authorization)
            : undefined
      if (selected === undefined) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(selected[0], { 'content-type': 'application/json' })
      res.end(JSON.stringify(selected[1]))
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock platform did not bind')
  return { baseURL: `http://127.0.0.1:${String(address.port)}`, requests }
}

interface Harness {
  ctx: Context
  auth: PlatformAuth
  dir: string
  platform: MockPlatform
}

async function boot(
  dir: string,
  handlers: Handlers,
  config: Record<string, unknown> = {},
  options: { omitConsumers?: readonly string[] } = {},
): Promise<Harness> {
  const omit = new Set(options.omitConsumers ?? [])
  vi.stubEnv('DSH_HOME', dir)
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(WebRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  if (!omit.has('deepseek')) await ctx.plugin(LlmDeepSeek, {})
  if (!omit.has('pi-ai')) await ctx.plugin(LlmPiAi, {})
  if (!omit.has('search')) await ctx.plugin(WebSearchDeepSeek, {})
  // PlatformAuth's inject list requires the typert registry; without it the
  // plugin is silently skipped and no platformAuth service is registered.
  await ctx.plugin(TypertRegistry)
  const platform = await mockPlatform(handlers)
  await ctx.plugin(PlatformAuth, {
    platformBaseURL: platform.baseURL,
    apiKeyRef: 'PENGUIN_API_HUB_KEY',
    clientName: 'dsh-desktop',
    pollIntervalMs: 10,
    loginTimeoutMs: 5000,
    verifyOnStart: true,
    ...config,
  })
  return { ctx, auth: ctx.get('platformAuth') as PlatformAuth, dir, platform }
}

async function settingsText(dir: string): Promise<string> {
  return readFile(join(dir, 'settings.yaml'), 'utf8')
}

async function credentialsText(dir: string): Promise<string> {
  return readFile(join(dir, '.credentials.yaml'), 'utf8')
}

describe('platform-auth login', () => {
  it('logs in, delivers once, and provisions credential + every consumer section', async () => {
    const dir = await home()
    let polls = 0
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
      poll: () => {
        polls += 1
        return polls === 1 ? [200, { status: 'pending', expiresInSeconds: 30 }] : [200, CLAIMED]
      },
      byKey: () => [200, { user: USER, balance: { units: '1000', currency: 'USD', display: '$0.01' }, key: { id: 'k-1', alias: 'dsh-desktop' } }],
    })

    const { authorizeUrl } = await auth.login()
    expect(authorizeUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/oauth\/desktop\?code=[A-Za-z0-9_-]+$/)

    await vi.waitFor(() => { expect(auth.status().kind).toBe('signed-in') })
    expect(polls).toBe(2)
    const state = auth.status()
    if (state.kind !== 'signed-in') throw new Error('expected signed-in')
    expect(state.user.username).toBe('alice')

    expect(await credentialsText(dir)).toContain('ep_claimed-key')
    const settings = await settingsText(dir)
    expect(settings).toContain('penguin-api-hub')
    expect(settings).toContain(CLAIMED.apiBaseURL)
    expect(settings).toContain(CLAIMED.geminiBaseURL)
    expect(settings).toContain(CLAIMED.anthropicBaseURL)
    expect(settings).toContain('llm-deepseek')
    expect(settings).toContain('llm-pi-ai')
    expect(settings).toContain('web-search-deepseek')
    expect(settings).toContain(KEY_REF)
  })

  it('lands signed-out with a readable reason when the browser flow is cancelled', async () => {
    const dir = await home()
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
      poll: () => [200, { status: 'cancelled' }],
    })
    await auth.login()
    await vi.waitFor(() => { expect(auth.status()).toMatchObject({ kind: 'signed-out', reason: 'cancelled' }) })
  })

  it('expires at the platform deadline even while poll keeps answering pending', async () => {
    const dir = await home()
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 150).toISOString() }],
      poll: () => [200, { status: 'pending', expiresInSeconds: 30 }],
    })
    await auth.login()
    await vi.waitFor(() => { expect(auth.status()).toMatchObject({ kind: 'signed-out', reason: 'expired' }) })
  })

  it('rejects a second login while one is in flight', async () => {
    const dir = await home()
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
      poll: () => [200, { status: 'pending', expiresInSeconds:30 }],
    })
    await auth.login()
    await expect(auth.login()).rejects.toThrow('already in progress')
  })

  it('refuses to follow a redirect on the credential-bearing start endpoint', async () => {
    const dir = await home()
    const { auth } = await boot(dir, {
      start: () => [302, {}],
    })
    await expect(auth.login()).rejects.toSatisfy((error: unknown) =>
      error instanceof PlatformHttpError && /redirect/.test(error.message))
  })

  it('treats a 4xx poll answer as terminal instead of retrying until expiry', async () => {
    const dir = await home()
    let polls = 0
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
      poll: () => {
        polls += 1
        return [404, { error: 'flow not found' }]
      },
    })
    await auth.login()
    await vi.waitFor(() => { expect(auth.status()).toMatchObject({ kind: 'signed-out', reason: 'rejected' }) })
    // The flow failed terminally, so no further polls are scheduled.
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(polls).toBe(1)
  })

  it('keeps polling through transient 5xx answers and completes after recovery', async () => {
    const dir = await home()
    let polls = 0
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
      poll: () => {
        polls += 1
        return polls <= 2 ? [500, { error: 'server error' }] : [200, CLAIMED]
      },
      byKey: () => [200, { user: USER, balance: { units: '0', currency: 'USD', display: '$0' }, key: { id: 'k-1' } }],
    })
    await auth.login()
    await vi.waitFor(() => { expect(auth.status().kind).toBe('signed-in') })
    expect(polls).toBeGreaterThanOrEqual(3)
  })

  it('rolls back a half-written provisioning and never commits the relay key', async () => {
    const dir = await home()
    let polls = 0
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
      poll: () => {
        polls += 1
        return polls === 1 ? [200, { status: 'pending', expiresInSeconds: 30 }] : [200, CLAIMED]
      },
      byKey: () => [200, { user: USER, balance: { units: '0', currency: 'USD', display: '$0' }, key: { id: 'k-1' } }],
      // llm-pi-ai is not mounted, so its settings namespace is unregistered
      // and the provisioning write fails after the account and llm-deepseek
      // sections were already persisted.
    }, {}, { omitConsumers: ['pi-ai'] })
    await auth.login()
    await vi.waitFor(() => { expect(auth.status()).toMatchObject({ kind: 'signed-out', reason: 'write-failed' }) })
    // The relay key is committed last, so a failed provisioning leaves none:
    // the credentials file is never even created.
    await expect(readFile(join(dir, '.credentials.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    // The already-written sections were restored to their pre-login state.
    const settings = await settingsText(dir)
    expect(settings).not.toContain('username: alice')
    expect(settings).not.toContain(CLAIMED.apiBaseURL)
    expect(settings).not.toContain(CLAIMED.geminiBaseURL)
  })
})

describe('platform-auth refresh and logout', () => {
  it('revalidates a stored key and refreshes the account snapshot', async () => {
    const dir = await home()
    const { ctx, auth } = await boot(dir, {
      byKey: () => [200, { user: USER, balance: { units: '2500', currency: 'USD', display: '$0.02' }, key: { id: 'k-1' } }],
    })
    await (ctx.get('credentials') as CredentialProvider).set(KEY_REF, 'ep_stored')
    await auth.refresh()
    const state = auth.status()
    expect(state).toMatchObject({ kind: 'signed-in', user: { username: 'alice' } })
    if (state.kind !== 'signed-in') throw new Error('expected signed-in')
    expect(state.balance?.units).toBe(2500)
  })

  it('clears the local login when the platform rejects the stored key with 401', async () => {
    const dir = await home()
    const { ctx, auth } = await boot(dir, {
      byKey: () => [401, { error: 'invalid_key' }],
    })
    await (ctx.get('credentials') as CredentialProvider).set(KEY_REF, 'ep_revoked')
    await auth.refresh()
    expect(auth.status()).toMatchObject({ kind: 'signed-out', reason: 'rejected' })
    expect(await credentialsText(dir)).not.toContain('ep_revoked')
  })

  it('logout drops the credential and clears the account snapshot', async () => {
    const dir = await home()
    const { ctx, auth } = await boot(dir, {
      byKey: () => [200, { user: USER, balance: { units: '0', currency: 'USD', display: '$0' }, key: { id: 'k-1' } }],
    })
    await (ctx.get('credentials') as CredentialProvider).set(KEY_REF, 'ep_stored')
    await auth.refresh()
    await auth.logout()
    expect(auth.status()).toMatchObject({ kind: 'signed-out', reason: 'logout' })
    expect(await credentialsText(dir)).not.toContain('ep_stored')
    expect(await settingsText(dir)).not.toContain('username: alice')
  })

  it('logout removes the consumer sections the login provisioned', async () => {
    const dir = await home()
    let polls = 0
    const { auth } = await boot(dir, {
      start: () => [200, { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
      poll: () => {
        polls += 1
        return polls === 1 ? [200, { status: 'pending', expiresInSeconds: 30 }] : [200, CLAIMED]
      },
      byKey: () => [200, { user: USER, balance: { units: '1000', currency: 'USD', display: '$0.01' }, key: { id: 'k-1' } }],
    })

    await auth.login()
    await vi.waitFor(() => { expect(auth.status().kind).toBe('signed-in') })
    // Provisioning wrote the platform endpoints and the key reference into
    // the shared consumer sections.
    expect(await settingsText(dir)).toContain(CLAIMED.apiBaseURL)
    expect(await settingsText(dir)).toContain(CLAIMED.geminiBaseURL)
    expect(await settingsText(dir)).toContain('apiKeyEnv: PENGUIN_API_HUB_KEY')

    await auth.logout()
    const settings = await settingsText(dir)
    expect(settings).not.toContain(CLAIMED.apiBaseURL)
    expect(settings).not.toContain(CLAIMED.geminiBaseURL)
    expect(settings).not.toContain(CLAIMED.anthropicBaseURL)
    expect(settings).not.toContain('apiKeyEnv')
  })
})
