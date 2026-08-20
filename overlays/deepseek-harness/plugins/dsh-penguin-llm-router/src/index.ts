/**
 * Desktop platform login service (`ctx.platformAuth`): the B+verifier
 * one-time-code flow against the Penguin API Hub platform, credential and
 * settings provisioning for the chat/search/vision consumers, and the
 * account-status authority the web GUI polls.
 *
 * The service is the single authority for {@link PlatformAuthStatus}; the
 * `penguin-api-hub` settings namespace holds the non-secret account snapshot,
 * and the relay key lives in the credentials seam under `apiKeyRef`.
 * The web half (src/client) renders the login entry, signing-in overlay, and
 * account settings section over the same `platformAuth` namespace.
 * @module @prismshadow/dsh-penguin-llm-router
 */

import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace, SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import { PlatformClient, PlatformHttpError } from './platform-client.ts'
import { PLATFORM_AUTH_MANIFEST } from './typert.ts'
import type {
  PlatformAuthCode,
  PlatformAuthSecret,
  PlatformAuthSignOutReason,
  PlatformAuthStatus,
  PlatformBalance,
  PlatformPollResponse,
  PlatformUser,
} from './types.ts'

export type {
  PlatformAuthCode,
  PlatformAuthSecret,
  PlatformAuthSignOutReason,
  PlatformAuthStatus,
  PlatformBalance,
  PlatformByKeyResponse,
  PlatformPollResponse,
  PlatformPollStatus,
  PlatformProvisioning,
  PlatformStartResponse,
  PlatformUser,
} from './types.ts'
export { PlatformClient, PlatformHttpError } from './platform-client.ts'

/** Settings namespace holding the non-secret account snapshot. */
export const ACCOUNT_NAMESPACE = settingsNamespace('penguin-api-hub')

/** Consumer sections written at login so every LLM consumer routes through the platform. */
const LLM_DEEPSEEK_NS = settingsNamespace('llm-deepseek')
const LLM_PI_AI_NS = settingsNamespace('llm-pi-ai')
const WEB_SEARCH_NS = settingsNamespace('web-search-deepseek')

/** Account snapshot section schema; schemastery fields are optional unless required. */
const AccountSnapshotSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string(),
  }),
  // The delivery response carries no balance (it arrives via the by-key
  // revalidation), so the first write legitimately omits it; schemastery
  // object fields are optional unless marked required.
  balance: z.object({
    units: z.number(),
    currency: z.string(),
    display: z.string(),
  }),
  apiBaseURL: z.string(),
  geminiBaseURL: z.string(),
  anthropicBaseURL: z.string(),
  loggedInAt: z.number(),
})

/** Plugin config; every field has a default, and platformBaseURL is deployment-varying. */
export interface Config {
  /** Platform origin; `/api/...` login endpoints are appended. */
  platformBaseURL: string
  /** Credential reference the relay key is stored under. */
  apiKeyRef: string
  /** Poll cadence for the desktop code flow. */
  pollIntervalMs: number
  /** Hard cap on the signing-in phase. */
  loginTimeoutMs: number
  /** Revalidate the stored key through `/api/me/by-key` on boot. */
  verifyOnStart: boolean
  /** Client name recorded by the platform `start` endpoint. */
  clientName: string
  /** Optional client version recorded beside the name. */
  clientVersion?: string
}

const DEFAULT_PLATFORM_BASE_URL = 'https://token.penguin.ooo'

/** Model route the vision subcall (`describe_image`) resolves through pi-ai. */
const VISION_PROVIDER = 'google'
const VISION_MODEL = 'gemini-2.5-flash'

/**
 * Platform login orchestration and account status. Exposed to the Web client
 * as the `platformAuth` Typert Remote namespace (every public mutation and
 * read carries the `@Remote` marker), so the gateway serves
 * `/api/platformAuth/<method>` without any core RPC-table change.
 */
export default class PlatformAuth extends TypertRemoteService {
  static inject = ['settings', 'credentials', 'typert']

  static Config: z<Config> = z.object({
    platformBaseURL: z.string().default(DEFAULT_PLATFORM_BASE_URL),
    apiKeyRef: z.string().role('credential-ref').default('PENGUIN_API_HUB_KEY'),
    pollIntervalMs: z.natural().min(10).default(2000),
    loginTimeoutMs: z.natural().min(1000).default(300_000),
    verifyOnStart: z.boolean().default(true),
    clientName: z.string().default('dsh-desktop'),
    clientVersion: z.string(),
  })

  private readonly settings: SettingsProvider
  private readonly credentials: CredentialProvider
  private readonly config: Config

  private state: PlatformAuthStatus = { kind: 'signed-out', reason: 'never-logged-in' }
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private active: { code: PlatformAuthCode; secret: PlatformAuthSecret; deadline: number } | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'platformAuth')
    this.config = config
    this.settings = ctx.get('settings') as SettingsProvider
    this.credentials = ctx.get('credentials') as CredentialProvider
    // Register the account snapshot section so `settings.update` may write it;
    // the service reads no derived values from it, so the hooks are no-ops.
    installSettingsSection(ctx, ACCOUNT_NAMESPACE, AccountSnapshotSchema, {}, {
      setSource: () => {},
      onChange: () => {},
    })
    // Claim the wire endpoints through the strict registry: the host gateway
    // resolves /api/platformAuth/<method> from this manifest (marker
    // independence across tsx gateway / profile-loaded plugin copies). The
    // Context merge exposes the sub-registries; the full contribution
    // register lives on the concrete TypertRegistry class.
    ;(ctx.typert as unknown as { register(contribution: typeof PLATFORM_AUTH_MANIFEST): unknown }).register(PLATFORM_AUTH_MANIFEST)
    // The poll timer is a registration: disposing the service cancels the loop.
    ctx.effect(() => () => {
      if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    })
    if (config.verifyOnStart) {
      void this.refresh().catch(() => {})
    }
  }

  /**
   * Read-only status snapshot; the service is the single authority.
   * @returns the current login state.
   */
  @Remote
  status(): PlatformAuthStatus {
    return this.state
  }

  /**
   * Start one desktop login: mint code + secret, pre-register at the
   * platform, open (via the caller) the authorization URL, and poll until
   * delivery, cancellation, or expiry.
   * @returns the authorization URL for the browser.
   */
  @Remote
  async login(): Promise<{ authorizeUrl: string }> {
    if (this.state.kind === 'signing-in') {
      throw new Error('platform-auth: a login is already in progress')
    }
    await this.assertCredentialWritable()

    const code = randomBytes(32).toString('base64url') as PlatformAuthCode
    const secret = randomBytes(32).toString('base64url') as PlatformAuthSecret
    const client = new PlatformClient({ baseURL: this.config.platformBaseURL })
    const started = await client.start(code, secret, {
      name: this.config.clientName,
      ...this.config.clientVersion === undefined ? {} : { version: this.config.clientVersion },
    })
    const expiresAt = Number.isFinite(Date.parse(started.expiresAt))
      ? Date.parse(started.expiresAt)
      : Date.now() + this.config.loginTimeoutMs
    const deadline = Math.min(expiresAt, Date.now() + this.config.loginTimeoutMs)
    const authorizeUrl = `${this.config.platformBaseURL.replace(/\/+$/, '')}/api/auth/oauth/desktop?code=${encodeURIComponent(code)}`

    this.active = { code, secret, deadline }
    this.state = { kind: 'signing-in', authorizeUrl, expiresAt: deadline }
    this.schedulePoll()
    return { authorizeUrl }
  }

  /** Cancel the in-flight login; a no-op otherwise. */
  @Remote
  cancel(): Record<string, never> {
    this.fail('cancelled')
    return {}
  }

  /**
   * Log out locally: cancel any flight, drop the relay key credential, and
   * clear the account snapshot. The platform-side key stays revocable by the
   * user in the web console.
   */
  @Remote
  async logout(): Promise<Record<string, never>> {
    this.fail('logout')
    // Core teardown: the relay key and the router-owned account snapshot.
    await this.credentials.unset(credentialRef(this.config.apiKeyRef))
    await this.settings.replace(ACCOUNT_NAMESPACE, {})
    // Consumer sections are shared namespaces owned by the consumer plugins;
    // remove exactly the fields the login wrote (path unset), never the whole
    // section. Best-effort: a profile without one consumer leaves that
    // namespace unregistered, which must not fail the logout.
    await this.unprovisionConsumers()
    return {}
  }

  /** Remove the consumer-section fields the login provisioned, tolerating an
   * unregistered namespace (consumer not mounted) and individual failures. */
  private async unprovisionConsumers(): Promise<void> {
    const edits: ReadonlyArray<readonly [SettingsNamespace, readonly SettingsPathOp[]]> = [
      [LLM_DEEPSEEK_NS, [
        { op: 'unset', path: ['baseURL'] },
        { op: 'unset', path: ['apiKeyEnv'] },
      ]],
      [WEB_SEARCH_NS, [
        { op: 'unset', path: ['baseURL'] },
        { op: 'unset', path: ['apiKeyEnv'] },
      ]],
      [LLM_PI_AI_NS, [
        { op: 'unset', path: ['providers', VISION_PROVIDER, 'apiKeyEnv'] },
        { op: 'unset', path: ['providers', VISION_PROVIDER, 'baseURL'] },
      ]],
    ]
    await Promise.all(edits.map(async ([ns, ops]) => {
      try {
        await this.settings.mutate(ns, ops)
      } catch (error) {
        console.error(`[platform-auth] logout: failed to clear consumer section "${ns}":`, error)
      }
    }))
  }

  /**
   * Revalidate the stored relay key through `/api/me/by-key` and refresh the
   * account snapshot; a 401 clears the local login state.
   */
  @Remote
  async refresh(): Promise<Record<string, never>> {
    const resolved = await this.credentials.resolve(credentialRef(this.config.apiKeyRef))
    const apiKey = resolved?.value
    if (apiKey === undefined || apiKey.length === 0) {
      this.state = { kind: 'signed-out', reason: 'never-logged-in' }
      return {}
    }
    try {
      const data = await new PlatformClient({ baseURL: this.config.platformBaseURL }).byKey(apiKey)
      const user = normalizeUser(data.user)
      const balance = normalizeBalance(data.balance)
      await this.settings.update(ACCOUNT_NAMESPACE, {
        user,
        balance,
        loggedInAt: Date.now(),
      })
      this.state = { kind: 'signed-in', user, balance, verifiedAt: Date.now() }
      return {}
    } catch (error) {
      if (error instanceof PlatformHttpError && error.status === 401) {
        await this.credentials.unset(credentialRef(this.config.apiKeyRef))
        await this.settings.replace(ACCOUNT_NAMESPACE, {})
        this.state = { kind: 'signed-out', reason: 'rejected' }
        return {}
      }
      throw error
    }
  }

  /** Fail fast when the launching environment would shadow the relay-key write. */
  private async assertCredentialWritable(): Promise<void> {
    const ref = credentialRef(this.config.apiKeyRef)
    const info = await this.credentials.describe(ref)
    if (info.configured && !info.writable) {
      throw new Error(
        `platform-auth: credential "${this.config.apiKeyRef}" is supplied read-only by the launching`
        + ' environment, so the login could not take effect; unset it before logging in',
      )
    }
  }

  private schedulePoll(): void {
    const active = this.active
    if (active === undefined) return
    this.pollTimer = setTimeout(() => {
      void this.pollOnce(active)
    }, this.config.pollIntervalMs)
  }

  private async pollOnce(active: { code: PlatformAuthCode; secret: PlatformAuthSecret; deadline: number }): Promise<void> {
    if (this.active !== active) return
    if (Date.now() >= active.deadline) {
      this.fail('expired')
      return
    }
    let result: PlatformPollResponse
    try {
      result = await new PlatformClient({ baseURL: this.config.platformBaseURL }).poll(active.code, active.secret)
    } catch (error) {
      if (error instanceof PlatformHttpError && error.status !== undefined && error.status >= 400 && error.status < 500) {
        // A 4xx is the platform refusing this flow (unknown code, rejected
        // secret, locked attempt); retrying until the deadline would only
        // hold the UI in "登录中", so treat it as terminal.
        this.fail('rejected')
        return
      }
      // Transient failure (network, rate limit, server error): keep polling until the deadline.
      this.schedulePoll()
      return
    }
    switch (result.status) {
      case 'pending':
        this.schedulePoll()
        return
      case 'claimed':
        this.stopPolling()
        await this.applyProvisioning(result)
        return
      case 'delivered':
        // The platform delivered once but this process lost the response.
        this.fail('delivery-lost')
        return
      case 'cancelled':
        this.fail('cancelled')
        return
      case 'expired':
        this.fail('expired')
        return
      case 'locked':
        this.fail('locked')
        return
      default:
        // The platform vocabulary may grow; refuse to guess.
        assertNever(result.status)
    }
  }

  /** Persist one claimed delivery: credential, account snapshot, and every consumer section. */
  private async applyProvisioning(result: PlatformPollResponse): Promise<void> {
    const { apiKey, apiBaseURL, geminiBaseURL, anthropicBaseURL } = result
    if (result.user === undefined || apiKey === undefined || apiBaseURL === undefined
      || geminiBaseURL === undefined || anthropicBaseURL === undefined) {
      this.fail('delivery-lost')
      return
    }
    const user = normalizeUser(result.user)
    // Snapshot the pre-login consumer sections: the settings writes are not
    // atomic, so the relay key is committed LAST and any earlier failure
    // restores every section already written — a partial provisioning never
    // leaves a live key behind.
    const before: ReadonlyArray<readonly [SettingsNamespace, unknown]> = [
      [ACCOUNT_NAMESPACE, this.settings.get(ACCOUNT_NAMESPACE)],
      [LLM_DEEPSEEK_NS, this.settings.get(LLM_DEEPSEEK_NS)],
      [LLM_PI_AI_NS, this.settings.get(LLM_PI_AI_NS)],
      [WEB_SEARCH_NS, this.settings.get(WEB_SEARCH_NS)],
    ]
    try {
      await this.settings.update(ACCOUNT_NAMESPACE, {
        user,
        apiBaseURL,
        geminiBaseURL,
        anthropicBaseURL,
        loggedInAt: Date.now(),
      })
      // Consumer sections: one credential reference, per-consumer endpoints.
      await this.settings.update(LLM_DEEPSEEK_NS, {
        baseURL: apiBaseURL,
        apiKeyEnv: this.config.apiKeyRef,
      })
      await this.settings.update(LLM_PI_AI_NS, {
        providers: {
          [VISION_PROVIDER]: {
            apiKeyEnv: this.config.apiKeyRef,
            baseURL: geminiBaseURL,
          },
        },
      })
      await this.settings.update(WEB_SEARCH_NS, {
        baseURL: anthropicBaseURL,
        apiKeyEnv: this.config.apiKeyRef,
      })
      // Commit point: the relay key lands only after every consumer section
      // is in place.
      await this.credentials.set(credentialRef(this.config.apiKeyRef), apiKey)
    } catch (error) {
      await this.restoreSections(before)
      console.error('[platform-auth] provisioning failed:', error)
      this.fail('write-failed')
      return
    }
    this.state = { kind: 'signed-in', user, verifiedAt: Date.now() }
    // Balance arrives via the by-key path, not the delivery response.
    void this.refresh().catch(() => {})
  }

  /** Best-effort restore of the pre-login sections after a failed provisioning write. */
  private async restoreSections(before: ReadonlyArray<readonly [SettingsNamespace, unknown]>): Promise<void> {
    for (const [ns, value] of before) {
      try {
        await this.settings.replace(ns, value === undefined ? {} : value as Record<string, unknown>)
      } catch {
        // Restore is best-effort; the relay key was never committed on this path.
      }
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
    this.active = undefined
  }

  private fail(reason: PlatformAuthSignOutReason): void {
    this.stopPolling()
    this.state = { kind: 'signed-out', reason }
  }
}

/** Exhaust the closed poll-status union; a future platform status fails loudly. */
function assertNever(value: never): never {
  throw new Error(`platform-auth: unexpected poll status ${JSON.stringify(value)}`)
}

/** Normalize the platform wire user (numeric ids from SQLite, nullable display fields) into the product user view. */
function normalizeUser(user: { id: number | string; username?: string | null; displayName?: string | null; avatarUrl?: string | null }): PlatformUser {
  return {
    id: String(user.id),
    ...user.username == null ? {} : { username: user.username },
    ...user.displayName == null ? {} : { displayName: user.displayName },
    ...user.avatarUrl == null ? {} : { avatarUrl: user.avatarUrl },
  }
}

/** Normalize the platform wire balance (units arrive as a numeric string). */
function normalizeBalance(balance: { units: number | string; currency: string; display: string }): PlatformBalance {
  return { ...balance, units: Number(balance.units) }
}

/** The vision-model route the `describe_image` tool resolves through pi-ai. */
export const visionRoute = { provider: VISION_PROVIDER, model: VISION_MODEL } as const
