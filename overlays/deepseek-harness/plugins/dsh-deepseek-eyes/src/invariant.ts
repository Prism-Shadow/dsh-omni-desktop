/**
 * Package-owned invariant companion for `@prismshadow/dsh-deepseek-eyes`.
 * @module @prismshadow/dsh-deepseek-eyes/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@prismshadow/dsh-deepseek-eyes'

/** Cordis companion plugin name. */
export const name = 'dsh-deepseek-eyes-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the durable relation this package owns — the
 * `vision/gemini-request` event is appended before the subcall dispatch and
 * names the same provider/model/maxTokens as the dispatched request — is
 * enforced by the single `describeImage` write path and pinned by this
 * package's suite; no event stream crosses the package boundary to check.
 */
const install: InvariantInstaller = (_ctx: Context, _fail: InvariantFailure) => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
