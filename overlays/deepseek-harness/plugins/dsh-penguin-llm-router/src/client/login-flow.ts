/**
 * One login gesture, shared by every entry that starts a desktop login. The
 * popup blocker only tolerates `window.open` inside the user gesture, but the
 * authorize URL only exists after the host RPC round-trip, so the click opens
 * a blank placeholder window synchronously and the controller's opener
 * navigates it once the URL arrives. A flow that never starts (busy, or a
 * failed RPC) closes the placeholder again.
 */

import { useRef } from 'react'
import type { AuthInjected } from './contract/slots.ts'

/**
 * Bind a login button to the injected login verb with placeholder-window
 * handling.
 * @param login - the injected login verb (host RPC + browser open).
 * @returns a click handler starting one login flow.
 */
export function useLoginFlow(login: AuthInjected['login']): () => Promise<void> {
  const opened = useRef<Window | null>(null)
  return async (): Promise<void> => {
    // Keep the reference across the async RPC; a blocked popup answers null
    // and the opener falls back to a plain window.open after the URL exists.
    const win = window.open('', '_blank')
    opened.current = win
    const started = await login((url) => {
      const target = opened.current
      if (target !== null && !target.closed) {
        target.location.href = url
      } else {
        window.open(url, '_blank', 'noopener')
      }
    })
    if (!started) {
      const target = opened.current
      if (target !== null && !target.closed) target.close()
    }
  }
}
