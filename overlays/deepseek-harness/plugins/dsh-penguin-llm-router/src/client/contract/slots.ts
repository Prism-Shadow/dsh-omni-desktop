/**
 * Platform-login slot contract: the injected business face every entry of
 * this plugin shares, and the wire-status vocabulary mirroring the auth RPC
 * domain. The plugin registers into slots other packages declare
 * (`sidebar.footer.action`, `settings.section`), so no SlotMap entry lives
 * here.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Platform user view carried by signed-in status. */
export interface PlatformUserView {
  id: string
  username?: string
  displayName?: string
  avatarUrl?: string
}

/** Platform balance view; `units` is the authoritative integer picodollar count. */
export interface PlatformBalanceView {
  units: number
  currency: string
  display: string
}

/** Wire status union mirroring the auth RPC domain (reason kept as an open string). */
export type AuthStatus =
  | { kind: 'signed-out'; reason: string }
  | { kind: 'signing-in'; authorizeUrl: string; expiresAt: number }
  | { kind: 'signed-in'; user: PlatformUserView; balance?: PlatformBalanceView; verifiedAt: number }

/** One shared snapshot published by the auth controller. */
export interface AuthSnapshot {
  /** Current login state (host authority). */
  status: AuthStatus
  /** True while a wire mutation is in flight. */
  busy: boolean
  /** Last failure text; undefined when clean. */
  error?: string
}

/** Registration-side business face shared by the entries. */
export interface AuthInjected {
  hooks: {
    /** Auth snapshot bound by the renderer as usePlatformAuth. */
    platformAuth: SnapshotStore<AuthSnapshot>
  }
  /**
   * Start one desktop login: the host mints the flow, then the opener
   * receives the authorize URL (a placeholder window opened in the click
   * gesture navigates to it).
   * @param opener - receives the authorize URL once minted; default opens a
   * new tab.
   * @returns true when the flow started, false when busy or the RPC failed.
   */
  login: (opener?: (url: string) => void) => Promise<boolean>
  /** Abort the in-flight login. */
  cancel: () => Promise<void>
  /** Log out locally. */
  logout: () => Promise<void>
  /** Revalidate the stored key and refresh the snapshot. */
  refresh: () => Promise<void>
}
