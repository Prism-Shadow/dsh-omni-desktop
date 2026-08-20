/**
 * AuthController behavior: status mirroring, mutations, error surfaces, and
 * the signing-in poll timer — all against a stubbed platformAuth Remote
 * face (the mounted namespace the gateway serves).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
// The controller imports the official client runtime bundle, which needs the
// harness module loader; tests substitute the store surface only.
vi.mock('@deepseek-ai/dsh-client-runtime/client', async () => {
  const { createTestSnapshotStore } = await import('./test-store.ts')
  return { createSnapshotStore: createTestSnapshotStore }
})
import { AuthController } from '../src/client/auth-controller.ts'
import type { AuthStatus } from '../src/client/contract/slots.ts'
import type { PlatformAuthRemoteFace } from '../src/client/contract/remote.ts'

const SIGNED_OUT: AuthStatus = { kind: 'signed-out', reason: 'never-logged-in' }
const SIGNING_IN = {
  kind: 'signing-in',
  authorizeUrl: 'https://token.penguin.ooo/api/auth/oauth/desktop?code=abc',
  expiresAt: Date.now() + 300_000,
} as const
const SIGNED_IN: AuthStatus = {
  kind: 'signed-in',
  user: { id: 'u-1', username: 'alice', displayName: 'Alice' },
  balance: { units: 1000, currency: 'USD', display: '$0.01' },
  verifiedAt: Date.now(),
}

/** Signed-in revalidation cadence; must match the controller's REFRESH_MS. */
const REFRESH_INTERVAL = 60_000

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function fail(message: string): { ok: false; error: { code: 'internal'; message: string; details: {} } } {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

interface Stub {
  face: PlatformAuthRemoteFace
  status: ReturnType<typeof vi.fn>
  login: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
}

function stub(initial: AuthStatus = SIGNED_OUT): Stub {
  const status = vi.fn<PlatformAuthRemoteFace['status']>(() => Promise.resolve(ok(initial)))
  const login = vi.fn<PlatformAuthRemoteFace['login']>(() => Promise.resolve(ok({ authorizeUrl: SIGNING_IN.authorizeUrl })))
  const logout = vi.fn<PlatformAuthRemoteFace['logout']>(() => Promise.resolve(ok({})))
  const cancel = vi.fn<PlatformAuthRemoteFace['cancel']>(() => Promise.resolve(ok({})))
  const refresh = vi.fn<PlatformAuthRemoteFace['refresh']>(() => Promise.resolve(ok({})))
  return { face: { status, login, logout, cancel, refresh }, status, login, logout, cancel, refresh }
}

function controller(s: Stub): AuthController {
  return new AuthController(() => s.face)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AuthController', () => {
  it('publishes the signed-in status on start', async () => {
    const s = stub(SIGNED_IN)
    const c = controller(s)
    c.start()
    await vi.waitFor(() => { expect(c.store.getSnapshot().status.kind).toBe('signed-in') })
    c.dispose()
  })

  it('starts a login through the Remote face and mirrors the host status', async () => {
    const s = stub()
    const c = controller(s)
    c.start()
    await vi.waitFor(() => { expect(s.status).toHaveBeenCalled() })
    expect(await c.login()).toBe(true)
    expect(s.login).toHaveBeenCalledOnce()
    // The login response carries only the URL; the host state is authoritative.
    expect(s.status).toHaveBeenCalledTimes(2)
  })

  it('hands the authorize URL to the opener and refuses a concurrent login', async () => {
    const s = stub()
    const c = controller(s)
    const opened: string[] = []
    // Hold the first login in flight so the second call observes busy.
    let release!: () => void
    s.login.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve(ok({ authorizeUrl: SIGNING_IN.authorizeUrl }))
    }))
    const first = c.login(url => { opened.push(url) })
    expect(await c.login(url => { opened.push(url) })).toBe(false)
    expect(s.login).toHaveBeenCalledOnce()
    expect(opened).toEqual([])
    release()
    expect(await first).toBe(true)
    expect(opened).toEqual([SIGNING_IN.authorizeUrl])
  })

  it('polls status while the host reports signing-in and stops when signed-out', async () => {
    vi.useFakeTimers()
    let calls = 0
    const status = vi.fn<PlatformAuthRemoteFace['status']>(() => {
      calls += 1
      const value = calls < 3 ? SIGNING_IN : SIGNED_OUT
      return Promise.resolve(ok(value))
    })
    const s: Stub = {
      face: {
        status,
        login: vi.fn<PlatformAuthRemoteFace['login']>(),
        logout: vi.fn<PlatformAuthRemoteFace['logout']>(),
        cancel: vi.fn<PlatformAuthRemoteFace['cancel']>(),
        refresh: vi.fn<PlatformAuthRemoteFace['refresh']>(),
      },
      status,
      login: vi.fn(),
      logout: vi.fn(),
      cancel: vi.fn(),
    }
    const c = controller(s)
    c.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1500)
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(1500)
    expect(calls).toBe(3)
    await vi.advanceTimersByTimeAsync(5000)
    // Signed-out stops the poll: no further calls.
    expect(calls).toBe(3)
    expect(c.store.getSnapshot().status.kind).toBe('signed-out')
    c.dispose()
  })

  it('surfaces a wire failure as the snapshot error', async () => {
    const s = stub()
    s.login.mockResolvedValueOnce(fail('platform-auth: a login is already in progress'))
    const c = controller(s)
    await c.login()
    expect(c.store.getSnapshot().error).toBe('platform-auth: a login is already in progress')
  })

  it('surfaces a transport rejection as the snapshot error', async () => {
    const s = stub()
    s.status.mockRejectedValueOnce(new Error('network down'))
    const c = controller(s)
    await c.refresh()
    expect(c.store.getSnapshot().error).toBe('network down')
  })

  it('logout goes through the Remote face and re-reads the host status', async () => {
    const s = stub(SIGNED_IN)
    const c = controller(s)
    await c.logout()
    expect(s.logout).toHaveBeenCalledOnce()
    expect(s.status).toHaveBeenCalled()
    c.dispose()
  })

  it('revalidates through the host by-key refresh and mirrors the new balance', async () => {
    const s = stub(SIGNED_OUT)
    const c = controller(s)
    // The host refresh (by-key) lands a fresh balance; status then mirrors it.
    s.status.mockResolvedValueOnce(ok(SIGNED_IN))
    await c.refresh()
    expect(s.refresh).toHaveBeenCalledOnce()
    expect(s.status).toHaveBeenCalledOnce()
    expect(c.store.getSnapshot().status.kind).toBe('signed-in')
    c.dispose()
  })

  it('keeps revalidating on a fixed cadence while signed in, so the balance follows usage', async () => {
    vi.useFakeTimers()
    const s = stub(SIGNED_IN)
    const c = controller(s)
    c.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.refresh).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL)
    expect(s.refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL)
    expect(s.refresh).toHaveBeenCalledTimes(2)
    c.dispose()
  })

  it('reschedules the signed-in revalidation after a transient failure', async () => {
    vi.useFakeTimers()
    const s = stub(SIGNED_IN)
    const c = controller(s)
    c.start()
    await vi.advanceTimersByTimeAsync(0)
    s.refresh.mockRejectedValueOnce(new Error('network down'))
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL)
    expect(c.store.getSnapshot().error).toBe('network down')
    // The signed-in state is preserved and the next revalidation is armed.
    expect(c.store.getSnapshot().status.kind).toBe('signed-in')
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL)
    expect(s.refresh).toHaveBeenCalledTimes(2)
    c.dispose()
  })
})
