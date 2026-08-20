/**
 * Web platform-login plugin, browser half: one controller, two entries —
 * the sidebar footer action and the platform account settings section.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merges of the shells this plugin registers into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: brings the ctx.remote merge (the gateway client) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { AuthController } from './auth-controller.ts'
import type { AuthInjected } from './contract/slots.ts'
import { PLATFORM_AUTH_REMOTE, type PlatformAuthRemoteFace } from './contract/remote.ts'
import { AuthFooterAction } from './AuthFooterAction.tsx'
import { PlatformAccountSection } from './PlatformAccountSection.tsx'

export type { AuthInjected, AuthSnapshot, AuthStatus, PlatformBalanceView, PlatformUserView } from './contract/slots.ts'
export { AuthController } from './auth-controller.ts'

/** Required services: the slot registry and the gateway Remote client. */
export const inject = ['slots', 'remote']

/** The three shared entries; the shell settings tab needs a nav identity. */
const SETTINGS_SECTION_ID = 'platform-account'

/**
 * Resolve one mounted Remote namespace through the service store. The dotted
 * `ctx.remote.platformAuth` read walks the fiber chain and stops at the
 * Loader's runtime-less internal forks; the store path resolves it by
 * isolation label instead (the same constraint dsh-at-file documents).
 * @param ctx - client root context.
 * @returns the mounted platformAuth face, or undefined before the mount settles.
 */
function mountedPlatformAuth(ctx: ClientContext): PlatformAuthRemoteFace | undefined {
  return (ctx.reflect as unknown as { get(name: string): unknown }).get('remote.platformAuth') as
    | PlatformAuthRemoteFace
    | undefined
}

/**
 * Client plugin body: one auth controller shared by both entries. The
 * controller owns the snapshot and the signing-in poll timer; entries get
 * the same inject face, so every surface converges on one state. The
 * platformAuth Remote namespace mounts asynchronously; the controller starts
 * polling only after the mount settles.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  let remoteFace: PlatformAuthRemoteFace | undefined
  const controller = new AuthController(() => remoteFace)

  ctx.effect(async () => {
    const dispose = await ctx.remote.$mount(PLATFORM_AUTH_REMOTE)
    remoteFace = mountedPlatformAuth(ctx)
    if (remoteFace === undefined) {
      void dispose()
      throw new Error('platform-auth: the platformAuth Remote namespace did not mount')
    }
    controller.start()
    return () => {
      controller.dispose()
      void dispose()
    }
  }, 'ui-platform-auth: remote mount')

  const face = (): AuthInjected => ({
    hooks: { platformAuth: controller.store },
    login: (opener) => controller.login(opener),
    cancel: () => controller.cancel(),
    logout: () => controller.logout(),
    refresh: () => controller.refresh(),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'platform-auth', children: {}, inject: face },
    AuthFooterAction,
  ))

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: SETTINGS_SECTION_ID,
      order: 30,
      label: () => '平台账号',
      children: {},
      inject: face,
    },
    PlatformAccountSection,
  ))
}
