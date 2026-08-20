/**
 * Typed HTTP client for the Penguin API Hub desktop login endpoints. All
 * requests carry credentials or credential-adjacent material, so every
 * response follows the repo-wide rule: redirects are refused rather than
 * followed (`redirect: 'manual'` plus an explicit status check).
 * @module @prismshadow/dsh-penguin-llm-router/platform-client
 */

import type {
  PlatformAuthCode,
  PlatformAuthSecret,
  PlatformByKeyResponse,
  PlatformPollResponse,
  PlatformStartResponse,
} from './types.ts'

/** Status codes that must never be followed on credential-bearing requests. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Client metadata recorded by the platform's `start` endpoint for audit. */
export interface PlatformClientInfo {
  name: string
  version?: string
}

/** Failure carrying the upstream HTTP status (undefined for network-level failures). */
export class PlatformHttpError extends Error {
  /** Upstream HTTP status; undefined for network-level failures. */
  readonly status: number | undefined

  constructor(message: string, status: number | undefined) {
    super(message)
    this.name = 'PlatformHttpError'
    this.status = status
  }
}

/** Construction options; `fetchImpl` exists for test interception. */
export interface PlatformClientOptions {
  baseURL: string
  fetchImpl?: typeof fetch
}

/** Read one error body bounded to a short diagnostic fragment. */
async function errorFragment(response: Response): Promise<string> {
  const text = (await response.text()).trim().slice(0, 200)
  return text.length === 0 ? 'no body' : text
}

/**
 * Narrow client for the desktop login protocol: start (register the code),
 * poll (secret-guarded single delivery), and by-key (account revalidation).
 */
export class PlatformClient {
  private readonly base: string
  private readonly fetchImpl: typeof fetch

  constructor(options: PlatformClientOptions) {
    this.base = options.baseURL.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  /** Send one request, refusing redirects on the credential-bearing plane. */
  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(`${this.base}${path}`, { ...init, redirect: 'manual' })
    if (REDIRECT_STATUSES.has(response.status)) {
      throw new PlatformHttpError(
        `platform endpoint ${path} answered ${response.status}; refusing to follow a credential-bearing redirect`,
        response.status,
      )
    }
    return response
  }

  /** Expect a JSON body from one response, mapping HTTP failures to errors with the body fragment. */
  private async json<T>(response: Response, path: string): Promise<T> {
    if (!response.ok) {
      throw new PlatformHttpError(
        `platform endpoint ${path} answered ${response.status}: ${await errorFragment(response)}`,
        response.status,
      )
    }
    return await response.json() as T
  }

  /**
   * Pre-register one login attempt: the code enters the browser URL, the
   * secret stays in the caller's process and guards delivery.
   * @param code - one-time authorization code.
   * @param secret - delivery secret.
   * @param client - audit metadata.
   * @returns the platform-issued expiry timestamp.
   */
  async start(
    code: PlatformAuthCode,
    secret: PlatformAuthSecret,
    client: PlatformClientInfo,
  ): Promise<PlatformStartResponse> {
    const response = await this.request('/api/auth/desktop/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceSecret: secret, client }),
    })
    return this.json<PlatformStartResponse>(response, '/api/auth/desktop/start')
  }

  /**
   * Poll the delivery state. Only the first `claimed` response carries the
   * key and provisioning URLs; later polls report `delivered`.
   * @param code - one-time authorization code.
   * @param secret - delivery secret guarding the single delivery.
   * @returns the platform's current flow state.
   */
  async poll(code: PlatformAuthCode, secret: PlatformAuthSecret): Promise<PlatformPollResponse> {
    const response = await this.request('/api/auth/desktop/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceSecret: secret }),
    })
    return this.json<PlatformPollResponse>(response, '/api/auth/desktop/poll')
  }

  /**
   * Revalidate one relay key and refresh the account snapshot.
   * @param apiKey - the stored relay key value.
   * @returns the platform's account view for that key.
   */
  async byKey(apiKey: string): Promise<PlatformByKeyResponse> {
    const response = await this.request('/api/me/by-key', {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
    })
    return this.json<PlatformByKeyResponse>(response, '/api/me/by-key')
  }
}
