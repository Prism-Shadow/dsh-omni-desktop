/**
 * Component presentation: each entry renders its own state from the inject
 * face and routes every verb through the injected callbacks. The login
 * gesture opens a placeholder window synchronously and navigates it once the
 * authorize URL arrives.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AuthSnapshot, AuthInjected } from '../src/client/contract/slots.ts'
import { AuthFooterAction, type AuthFooterActionProps } from '../src/client/AuthFooterAction.tsx'
import { PlatformAccountSection, type PlatformAccountSectionProps } from '../src/client/PlatformAccountSection.tsx'
import { createTestSnapshotStore } from './test-store.ts'

const SIGNED_OUT: AuthSnapshot = { status: { kind: 'signed-out', reason: 'never-logged-in' }, busy: false }
const SIGNING_IN: AuthSnapshot = {
  status: { kind: 'signing-in', authorizeUrl: 'https://token.penguin.ooo/x', expiresAt: Date.now() + 300_000 },
  busy: false,
}
const SIGNED_IN: AuthSnapshot = {
  status: {
    kind: 'signed-in',
    user: { id: 'u-1', username: 'alice', displayName: 'Alice' },
    balance: { units: 1000, currency: 'USD', display: '$0.01' },
    verifiedAt: Date.now(),
  },
  busy: false,
}

/** A stand-in window: the popup blocker (or jsdom) answers null instead. */
function fakeWindow(): Window & { location: Location } {
  const win: { closed: boolean; close: () => void; location: { href: string } } = {
    closed: false,
    close() { this.closed = true },
    location: { href: '' },
  }
  return win as Window & { location: Location }
}

/** Build the inject face over one snapshot; the hook stub is the bare selector application. */
function face(snapshot: AuthSnapshot): AuthInjected {
  const store = createTestSnapshotStore<AuthSnapshot>(snapshot)
  return {
    hooks: { platformAuth: store },
    login: vi.fn(() => Promise.resolve(true)),
    cancel: vi.fn(() => Promise.resolve()),
    logout: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
  }
}

/** The renderer binds the hooks compartment; tests apply the bare source directly. */
function bind(injected: AuthInjected): AuthInjected {
  return {
    ...injected,
    hooks: { platformAuth: injected.hooks.platformAuth },
    usePlatformAuth: ((selector: (s: AuthSnapshot) => unknown) => selector(injected.hooks.platformAuth.getSnapshot())) as never,
  } as AuthInjected
}

describe('AuthFooterAction', () => {
  it('shows the login entry while signed out and starts a login on click', () => {
    // The login gesture opens a placeholder window; jsdom has none.
    vi.stubGlobal('open', vi.fn(() => null))
    const injected = bind(face(SIGNED_OUT))
    const props = { ...injected, wide: true } as unknown as AuthFooterActionProps
    const view = render(<AuthFooterAction {...props} />)
    expect(screen.getByRole('button').textContent).toContain('登录')
    screen.getByRole('button').click()
    expect(injected.login).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
    view.unmount()
  })

  it('opens a placeholder window in the click gesture and navigates it with the authorize URL', async () => {
    const open = vi.fn(() => fakeWindow())
    vi.stubGlobal('open', open)
    const injected = bind(face(SIGNED_OUT))
    ;(injected.login as ReturnType<typeof vi.fn>).mockImplementation((opener?: (url: string) => void) => {
      opener?.('https://token.penguin.ooo/api/auth/oauth/desktop?code=abc')
      return Promise.resolve(true)
    })
    const props = { ...injected, wide: true } as unknown as AuthFooterActionProps
    const view = render(<AuthFooterAction {...props} />)
    screen.getByRole('button').click()
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledWith('', '_blank')
    })
    const win = open.mock.results[0]!.value as { location: { href: string } }
    expect(win.location.href).toBe('https://token.penguin.ooo/api/auth/oauth/desktop?code=abc')
    vi.unstubAllGlobals()
    view.unmount()
  })

  it('closes the placeholder window when the login flow does not start', async () => {
    const win = fakeWindow()
    vi.stubGlobal('open', vi.fn(() => win))
    const injected = bind(face(SIGNED_OUT))
    ;(injected.login as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const props = { ...injected, wide: true } as unknown as AuthFooterActionProps
    const view = render(<AuthFooterAction {...props} />)
    screen.getByRole('button').click()
    await vi.waitFor(() => {
      expect(win.closed).toBe(true)
    })
    vi.unstubAllGlobals()
    view.unmount()
  })

  it('collapses to a round rail icon when the sidebar is narrow', () => {
    const injected = bind(face(SIGNED_OUT))
    const props = { ...injected, wide: false } as unknown as AuthFooterActionProps
    const view = render(<AuthFooterAction {...props} />)
    // No text in rail mode: the icon button keeps its accessible name.
    expect(screen.getByRole('button').textContent).toBe('')
    view.unmount()
  })

  it('shows the account chip while signed in', () => {
    const injected = bind(face(SIGNED_IN))
    const props = { ...injected, wide: true } as unknown as AuthFooterActionProps
    const view = render(<AuthFooterAction {...props} />)
    expect(screen.getByRole('button').textContent).toContain('Alice')
    expect(screen.getByRole('button').textContent).toContain('$0.01')
    view.unmount()
  })
})

describe('PlatformAccountSection', () => {
  it('offers login while signed out', () => {
    // The login gesture opens a placeholder window; jsdom has none.
    vi.stubGlobal('open', vi.fn(() => null))
    const injected = bind(face(SIGNED_OUT))
    const props = { ...injected, close: () => {} } as unknown as PlatformAccountSectionProps
    const view = render(<PlatformAccountSection {...props} />)
    screen.getByRole('button', { name: '登录 / 注册' }).click()
    expect(injected.login).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
    view.unmount()
  })

  it('shows account, balance, refresh and logout while signed in', () => {
    const injected = bind(face(SIGNED_IN))
    const props = { ...injected, close: () => {} } as unknown as PlatformAccountSectionProps
    const view = render(<PlatformAccountSection {...props} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText('$0.01')).toBeTruthy()
    screen.getByRole('button', { name: '刷新' }).click()
    expect(injected.refresh).toHaveBeenCalledOnce()
    screen.getByRole('button', { name: '退出登录' }).click()
    expect(injected.logout).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('explains the pending authorization while signing in', () => {
    const injected = bind(face(SIGNING_IN))
    const props = { ...injected, close: () => {} } as unknown as PlatformAccountSectionProps
    const view = render(<PlatformAccountSection {...props} />)
    expect(screen.getByText('正在等待授权完成，请在新打开的页面中完成登录…')).toBeTruthy()
    view.unmount()
  })
})
