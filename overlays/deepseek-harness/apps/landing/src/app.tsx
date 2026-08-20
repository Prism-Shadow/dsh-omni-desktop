/** App root: Locale -> Theme -> LocaleScope -> single-screen landing chrome. */
import type { ReactNode } from 'react'
import { LocaleProvider, LocaleScope } from './state/locale'
import { ThemeProvider } from './state/theme'
import { Nav } from './components/nav'

export function App({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <LocaleScope>
          <Nav />
          {children}
        </LocaleScope>
      </ThemeProvider>
    </LocaleProvider>
  )
}
