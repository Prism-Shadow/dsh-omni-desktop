/**
 * Registration suite (dsh-loop style): the two entries land in their
 * declared slots through the injected slot registry, the gateway namespace
 * mounts once, and the shared inject face reaches the same controller store.
 * The official client runtime is never imported: the plugin body runs against
 * a minimal ctx stub, which is how third-party client plugins test.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
// The plugin body imports the official client runtime bundle, which needs the
// harness module loader; tests substitute the store surface only.
vi.mock('@deepseek-ai/dsh-client-runtime/client', async () => {
  const { createTestSnapshotStore } = await import('./test-store.ts')
  return { createSnapshotStore: createTestSnapshotStore }
})
import { apply } from '../src/client/index.ts'
import { AuthFooterAction } from '../src/client/AuthFooterAction.tsx'
import { PlatformAccountSection } from '../src/client/PlatformAccountSection.tsx'
import type { AuthInjected } from '../src/client/contract/slots.ts'
import { createTestSnapshotStore } from './test-store.ts'

/** The two seats this plugin fills (slot name → expected component). */
const SEATS = [
  ['sidebar.footer.action', AuthFooterAction],
  ['settings.section', PlatformAccountSection],
] as const

interface Bench {
  slotNames: string[]
  registered: Array<{ name: string; id: string; component: unknown; inject: () => AuthInjected }>
  mountedPackages: string[]
}

async function bench(): Promise<Bench> {
  const slotNames: string[] = []
  const registered: Bench['registered'] = []
  const mountedPackages: string[] = []
  const face = {
    status: vi.fn(() => Promise.resolve({ ok: true as const, value: { kind: 'signed-out' as const, reason: 'never-logged-in' } })),
    login: vi.fn(() => Promise.resolve({ ok: true as const, value: { authorizeUrl: 'https://token.penguin.ooo/x' } })),
    cancel: vi.fn(() => Promise.resolve({ ok: true as const, value: {} })),
    logout: vi.fn(() => Promise.resolve({ ok: true as const, value: {} })),
    refresh: vi.fn(() => Promise.resolve({ ok: true as const, value: {} })),
  }
  const ctx = {
    effect: (handler: () => unknown) => {
      const dispose = handler()
      return () => { if (typeof dispose === 'function') void (dispose as () => void)() }
    },
    slots: {
      inject: (name: string, factory: () => unknown) => {
        slotNames.push(name)
        factory()
      },
      register: (definition: { name: string; id: string; inject?: () => AuthInjected }, component: unknown) => {
        registered.push({
          name: definition.name,
          id: definition.id,
          component,
          inject: definition.inject ?? (() => ({
            hooks: { platformAuth: createTestSnapshotStore({ status: { kind: 'signed-out' as const, reason: 'never-logged-in' }, busy: false }) },
            login: vi.fn(),
            cancel: vi.fn(),
            logout: vi.fn(),
            refresh: vi.fn(),
          })),
        })
        return () => {}
      },
    },
    remote: {
      $mount: async (contribution: { package: string }) => {
        mountedPackages.push(contribution.package)
        return () => {}
      },
    },
    reflect: {
      get: () => face,
    },
  }
  await apply(ctx as never)
  return { slotNames, registered, mountedPackages }
}

describe('ui-platform-auth apply', () => {
  it('registers the two entries and mounts the platformAuth namespace', async () => {
    const b = await bench()
    expect(b.slotNames).toEqual(['sidebar.footer.action', 'settings.section'])
    expect(b.registered).toHaveLength(2)
    for (const [name, component] of SEATS) {
      expect(b.registered.some(entry => entry.name === name && entry.component === component)).toBe(true)
    }
    const section = b.registered.find(entry => entry.name === 'settings.section')!
    expect(section.id).toBe('platform-account')
    expect(b.mountedPackages).toContain('@prismshadow/dsh-penguin-llm-router')
  })

  it('hands every entry one shared controller through the inject face', async () => {
    const b = await bench()
    const faces = b.registered.map(entry => entry.inject())
    expect(faces.length).toBe(2)
    // One controller: the hook source identity is shared across entries.
    expect(faces[0]!.hooks.platformAuth).toBe(faces[1]!.hooks.platformAuth)
  })
})
