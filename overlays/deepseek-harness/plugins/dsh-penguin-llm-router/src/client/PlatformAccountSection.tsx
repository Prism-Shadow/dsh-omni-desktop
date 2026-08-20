/**
 * Settings section: the platform account page (user, balance, refresh,
 * logout). Layout and tokens follow the harness settings sections; the
 * registrant owns every string.
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthInjected } from './contract/slots.ts'
import { useLoginFlow } from './login-flow.ts'
import css from './PlatformAccountSection.module.css'

/** Full component props. */
export type PlatformAccountSectionProps =
  PropsRuntime<'settings.section'>
  & InjectFace<AuthInjected>

/**
 * Render the platform account settings page.
 * @param props - composed slot props.
 * @returns the account page for the current auth state.
 */
export function PlatformAccountSection({
  usePlatformAuth, login, logout, refresh,
}: PlatformAccountSectionProps) {
  const state = usePlatformAuth(snapshot => snapshot)
  const { status, busy, error } = state
  const handleLogin = useLoginFlow(login)

  if (status.kind === 'signed-out') {
    return (
      <div className={css.section}>
        <p className={css.lead}>尚未登录 API 平台。登录后，对话、搜索与视觉请求将全部经由平台计费。</p>
        {error !== undefined && <p className={css.error} role="alert">错误：{error}</p>}
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void handleLogin() }}>登录 / 注册</Button>
        </div>
      </div>
    )
  }
  if (status.kind === 'signing-in') {
    return (
      <div className={css.section}>
        <p className={css.lead}>正在等待授权完成，请在新打开的页面中完成登录…</p>
        {error !== undefined && <p className={css.error} role="alert">错误：{error}</p>}
      </div>
    )
  }
  const name = status.user.displayName ?? status.user.username ?? status.user.id
  return (
    <div className={css.section}>
      <div className={css.account}>
        <div className={css.identity}>
          <span className={css.name}>{name}</span>
          {status.user.username !== undefined && status.user.username !== name && (
            <span className={css.handle}>{`@${status.user.username}`}</span>
          )}
        </div>
        {status.balance !== undefined && (
          <div className={css.balance}>
            <span className={css.balanceLabel}>余额</span>
            <span className={css.balanceValue}>{status.balance.display}</span>
          </div>
        )}
      </div>
      {error !== undefined && <p className={css.error} role="alert">错误：{error}</p>}
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void refresh() }}>刷新</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void logout() }}>退出登录</Button>
      </div>
    </div>
  )
}
