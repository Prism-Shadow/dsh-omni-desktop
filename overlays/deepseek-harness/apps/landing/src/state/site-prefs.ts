/**
 * Persisted landing-site preferences (theme, language): one helper set shared by
 * the theme and locale contexts. Other same-origin tabs follow writes through the
 * storage event.
 */
export const THEME_KEY = 'dsh-landing-theme'
export const LANG_KEY = 'dsh-landing-lang'

export function readPref<T extends string>(key: string, allowed: readonly T[]): T | null {
  const value = localStorage.getItem(key)
  return value !== null && allowed.includes(value as T) ? (value as T) : null
}

export function writePref(key: string, value: string): void {
  localStorage.setItem(key, value)
}

/** Follow another tab writing the same preference key. */
export function subscribePref<T extends string>(
  key: string,
  allowed: readonly T[],
  onValue: (value: T) => void,
): () => void {
  const onChange = (event: StorageEvent) => {
    if (event.key !== key || event.newValue === null) return
    if (allowed.includes(event.newValue as T)) onValue(event.newValue as T)
  }
  window.addEventListener('storage', onChange)
  return () => { window.removeEventListener('storage', onChange) }
}
