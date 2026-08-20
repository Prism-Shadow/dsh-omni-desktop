/**
 * Platform-login controller: one React-free owner of the auth snapshot.
 * Every mutation goes through the platformAuth Typert Remote namespace, the
 * host stays the authority, and this controller only mirrors what `status`
 * answers — polling while a login is in flight, revalidating through the
 * host's by-key refresh while signed in (so the shown balance tracks usage),
 * idle otherwise.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AuthSnapshot, AuthStatus } from './contract/slots.ts'
import type { PlatformAuthRemoteFace } from './contract/remote.ts'

/** Poll cadence while the host reports a signing-in state. */
const POLL_MS = 1500

/** Signed-in refresh cadence: the balance shown in the UI follows usage without a restart. */
const REFRESH_MS = 60_000

/** Default opener: a plain new tab; entries usually pass a gesture-held window instead. */
function defaultOpener(url: string): void {
  // A browser-less host (headless tests) simply has no tab to open.
  if (typeof window === 'undefined') return
  window.open(url, '_blank', 'noopener')
}

/** Initial snapshot: not logged in, nothing in flight, nothing failed. */
const INITIAL: AuthSnapshot = { status: { kind: 'signed-out', reason: 'never-logged-in' }, busy: false }

/**
 * Human text for a rejected wire call or a transport rejection.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Own the auth snapshot and the refresh timers. The store is the single
 * published source; every mutation re-reads `status` so a write from another
 * tab or window converges instead of diverging. The remote face is bound
 * lazily: the gateway namespace mounts asynchronously after the plugin body
 * runs, and `start()` is called only once it is available.
 */
export class AuthController {
  /** The single published snapshot source every entry's inject face shares. */
  readonly store: SnapshotStore<AuthSnapshot>
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly remote: () => PlatformAuthRemoteFace | undefined) {
    this.store = createSnapshotStore<AuthSnapshot>(INITIAL)
  }

  /** Kick off the first status read (and the poll loop when signing in). */
  start(): void {
    void this.readStatus()
  }

  /** Stop the refresh timer; the controller is not reusable after disposal. */
  dispose(): void {
    this.stopTimer()
  }

  /**
   * Start one desktop login; the host mints the flow and the opener receives
   * the authorize URL.
   * @param opener - optional receiver of the authorize URL (the click gesture
   * holds a placeholder window); defaults to a new tab.
   * @returns true when the flow started, false when busy or the RPC failed.
   */
  async login(opener?: (url: string) => void): Promise<boolean> {
    if (this.store.getSnapshot().busy) return false
    const face = this.remote()
    if (face === undefined) {
      this.fail('platform auth remote is not mounted')
      return false
    }
    this.setBusy(true)
    let response
    try {
      response = await face.login()
    } catch (error) {
      this.setBusy(false)
      this.fail(messageOf(error))
      return false
    }
    this.setBusy(false)
    if (!response.ok) {
      this.fail(response.error.message)
      return false
    }
    ;(opener ?? defaultOpener)(response.value.authorizeUrl)
    await this.readStatus()
    return true
  }

  /** Abort the in-flight login and re-read the host state. */
  async cancel(): Promise<void> {
    const face = this.remote()
    if (face === undefined) return
    await face.cancel()
    await this.readStatus()
  }

  /** Log out locally and re-read the host state. */
  async logout(): Promise<void> {
    if (this.store.getSnapshot().busy) return
    const face = this.remote()
    if (face === undefined) {
      this.fail('platform auth remote is not mounted')
      return
    }
    this.setBusy(true)
    let response
    try {
      response = await face.logout()
    } catch (error) {
      this.setBusy(false)
      this.fail(messageOf(error))
      return
    }
    this.setBusy(false)
    if (!response.ok) {
      this.fail(response.error.message)
      return
    }
    await this.readStatus()
  }

  /**
   * Revalidate the account through the host's by-key refresh, then mirror the
   * authoritative status. The settings page's refresh verb and the signed-in
   * timer use this, so the shown balance tracks platform usage instead of the
   * boot/login snapshot.
   */
  async refresh(): Promise<void> {
    const face = this.remote()
    if (face === undefined) return
    let status: AuthStatus
    try {
      const revalidated = await face.refresh()
      if (!revalidated.ok) {
        this.fail(revalidated.error.message)
        this.scheduleAfterFailure()
        return
      }
      const response = await face.status()
      if (!response.ok) {
        this.fail(response.error.message)
        this.scheduleAfterFailure()
        return
      }
      status = response.value
    } catch (error) {
      this.fail(messageOf(error))
      this.scheduleAfterFailure()
      return
    }
    this.publish(status)
  }

  /** Mirror the host's authoritative status without a revalidation round trip. */
  private async readStatus(): Promise<void> {
    const face = this.remote()
    if (face === undefined) return
    let status: AuthStatus
    try {
      const response = await face.status()
      if (!response.ok) {
        this.fail(response.error.message)
        return
      }
      status = response.value
    } catch (error) {
      this.fail(messageOf(error))
      return
    }
    this.publish(status)
  }

  /** Publish one status and arm the timer the state implies. */
  private publish(status: AuthStatus): void {
    this.store.update((draft) => {
      draft.status = status
      delete draft.error
    })
    if (status.kind === 'signing-in') this.schedulePoll()
    else if (status.kind === 'signed-in') this.scheduleRefresh()
    else this.stopTimer()
  }

  /** Keep the signed-in revalidation alive after a transient failure (recovery). */
  private scheduleAfterFailure(): void {
    if (this.store.getSnapshot().status.kind === 'signed-in') this.scheduleRefresh()
  }

  private schedulePoll(): void {
    this.stopTimer()
    this.timer = setTimeout(() => {
      void this.readStatus()
    }, POLL_MS)
  }

  private scheduleRefresh(): void {
    this.stopTimer()
    this.timer = setTimeout(() => {
      void this.refresh()
    }, REFRESH_MS)
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private setBusy(busy: boolean): void {
    this.store.update((draft) => {
      draft.busy = busy
    })
  }

  private fail(message: string): void {
    this.store.update((draft) => {
      draft.error = message
    })
  }
}
