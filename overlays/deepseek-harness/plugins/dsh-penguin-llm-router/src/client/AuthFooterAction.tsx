/**
 * Sidebar footer action: the login entry / account chip beside Settings.
 * Styled after the harness footer badges (CordisPanel): a transparent capsule
 * that fills the foot in wide mode and collapses to a round rail icon.
 */

import { IconLoadingOutline16, IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthInjected } from './contract/slots.ts'
import { useLoginFlow } from './login-flow.ts'
import css from './AuthFooterAction.module.css'

/** Full component props. */
export type AuthFooterActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<AuthInjected>

/**
 * Render the sidebar-foot login entry.
 * @param props - composed slot props.
 * @returns the entry, or null while nothing may be shown.
 */
export function AuthFooterAction({ wide, usePlatformAuth, login }: AuthFooterActionProps) {
  const state = usePlatformAuth(snapshot => snapshot)
  const { status, busy, error } = state
  const handleLogin = useLoginFlow(login)
  const className = wide ? css.badge : `${css.badge} ${css.rail}`
  const iconSize = wide ? 14 : 18

  if (status.kind === 'signed-out') {
    return (
      <button
        type="button"
        className={className}
        disabled={busy}
        title={error}
        aria-label={error !== undefined ? `${loginLabel(status.reason)}（${error}）` : undefined}
        onClick={() => { void handleLogin() }}
      >
        <IconUserOutline16 className={css.icon} size={iconSize} />
        {wide && <span className={css.label}>{loginLabel(status.reason)}</span>}
      </button>
    )
  }
  if (status.kind === 'signing-in') {
    return (
      <button type="button" className={className} disabled aria-label="登录中">
        <IconLoadingOutline16 className={`${css.icon} ${css.spin}`} size={iconSize} />
        {wide && <span className={css.label}>登录中…</span>}
      </button>
    )
  }
  const name = status.user.displayName ?? status.user.username ?? status.user.id
  return (
    <button
      type="button"
      className={className}
      disabled
      title={error}
      aria-label={error !== undefined ? `${name}（${error}）` : undefined}
    >
      <IconUserOutline16 className={css.icon} size={iconSize} />
      {wide && (
        <span className={css.label}>
          <span className={css.name}>{name}</span>
          {status.balance !== undefined && <span className={css.balance}>{status.balance.display}</span>}
        </span>
      )}
    </button>
  )
}

/** Signed-out entry text: re-login reads better after a deliberate sign-out. */
function loginLabel(reason: string): string {
  return reason === 'logout' || reason === 'cancelled' || reason === 'expired' ? '重新登录' : '登录 / 注册'
}
