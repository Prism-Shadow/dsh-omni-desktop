/**
 * Host Typert manifest for the platformAuth Remote namespace. Registered
 * through `ctx.typert.register` in the plugin body: the host gateway's
 * strict path resolves `/api/platformAuth/<method>` from this manifest and
 * the shared invocation descriptors, without consulting the `@Remote`
 * marker table — marker independence matters when a tsx-loaded gateway and a
 * profile-loaded plugin bundle hold separate copies of the decorator module
 * state (the same constraint dsh-at-file documents).
 */

import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { PLATFORM_AUTH_INVOCATIONS } from './client/contract/remote.ts'

/** The platformAuth namespace's host manifest (strict codecs shared with the client). */
export const PLATFORM_AUTH_MANIFEST: TypertContribution = {
  package: '@prismshadow/dsh-penguin-llm-router',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'platformAuth',
        exportName: 'PlatformAuth',
        description: 'Desktop platform login: B+verifier flow, credential/settings provisioning, and account status.',
        tags: [],
        members: [
          { kind: 'method', name: 'status', signature: 'status(): PlatformAuthStatus' },
          { kind: 'method', name: 'login', signature: 'login(): Promise<{ authorizeUrl: string }>' },
          { kind: 'method', name: 'cancel', signature: 'cancel(): {}' },
          { kind: 'method', name: 'logout', signature: 'logout(): Promise<{}>' },
          { kind: 'method', name: 'refresh', signature: 'refresh(): Promise<{}>' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: PLATFORM_AUTH_INVOCATIONS,
}
