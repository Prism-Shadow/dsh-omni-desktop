/**
 * Package-owned invariant companion for `@prismshadow/dsh-penguin-llm-router`.
 * @module @prismshadow/dsh-penguin-llm-router/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@prismshadow/dsh-penguin-llm-router'

/** Cordis companion plugin name. */
export const name = 'dsh-penguin-llm-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the durable relation this package owns — the relay
 * key credential (`PENGUIN_API_HUB_KEY`) and the `penguin-api-hub` account
 * snapshot changing together on login/logout/rejection — is enforced by the
 * service's own write paths (applyProvisioning, logout, refresh) and pinned
 * by its package suite; no event stream crosses the package boundary to
 * check. Other packages' sections this service writes (llm-deepseek,
 * llm-pi-ai, web-search-deepseek) own their own invariants. The web half
 * renders this same state through the slot system and mutates it only
 * through the platformAuth Remote domain; the slot registrations prove
 * disposal through this package's apply suite.
 */
const install: InvariantInstaller = (_ctx: Context, _fail: InvariantFailure) => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
