/**
 * Wire and product types shared by the platform-auth service, its HTTP
 * client, and tests.
 * @module @prismshadow/dsh-penguin-llm-router/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** One-time authorization code minted by the desktop host (URL-safe, ≥128-bit entropy). */
export type PlatformAuthCode = Branded<'PlatformAuthCode'>

/** Delivery secret held only by the desktop process (≥128-bit entropy, never in URLs). */
export type PlatformAuthSecret = Branded<'PlatformAuthSecret'>

/** Platform user snapshot as returned by the login delivery and `/api/me/by-key`. */
export interface PlatformUser {
  id: string
  username?: string
  displayName?: string
  avatarUrl?: string
}

/** Platform balance view; `units` is the authoritative integer picodollar count. */
export interface PlatformBalance {
  units: number
  currency: string
  display: string
}

/** `POST /api/auth/desktop/start` success body. */
export interface PlatformStartResponse {
  expiresAt: string
}

/** Terminal vocabulary of the platform desktop code flow. */
export type PlatformPollStatus = 'pending' | 'claimed' | 'delivered' | 'cancelled' | 'expired' | 'locked'

/** `POST /api/auth/desktop/poll` response body; delivery fields exist only on the first `claimed`. */
export interface PlatformPollResponse {
  status: PlatformPollStatus
  expiresInSeconds?: number
  user?: PlatformUser
  apiKey?: string
  apiBaseURL?: string
  geminiBaseURL?: string
  anthropicBaseURL?: string
}

/** `GET /api/me/by-key` success body. */
export interface PlatformByKeyResponse {
  user: PlatformUser
  balance: PlatformBalance
  key: { id: string; alias?: string; lastUsedAt?: string }
}

/** Provisioning facts the login flow persists after a claimed delivery. */
export interface PlatformProvisioning {
  user: PlatformUser
  apiKey: string
  apiBaseURL: string
  geminiBaseURL: string
  anthropicBaseURL: string
}

/** Signed-out reasons surfaced to the UI for readable recovery prompts. */
export type PlatformAuthSignOutReason =
  | 'never-logged-in'
  | 'cancelled'
  | 'expired'
  | 'locked'
  | 'delivery-lost'
  | 'write-failed'
  | 'logout'
  | 'rejected'

/** Read-only auth state; the service instance is the single authority. */
export type PlatformAuthStatus =
  | { kind: 'signed-out'; reason: PlatformAuthSignOutReason }
  | { kind: 'signing-in'; authorizeUrl: string; expiresAt: number }
  | { kind: 'signed-in'; user: PlatformUser; balance?: PlatformBalance; verifiedAt: number }
