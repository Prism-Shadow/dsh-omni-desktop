/** App root: Locale -> Theme -> LocaleScope -> page chrome composition. */
import type { ReactNode } from 'react'
import { LocaleProvider, LocaleScope } from './state/locale'
import { ThemeProvider } from './state/theme'
import { Nav } from './components/nav'
import { Footer } from './components/footer'

export function App({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <LocaleScope>
          <Nav />
          {children}
          <Footer />
        </LocaleScope>
      </ThemeProvider>
    </LocaleProvider>
  )
}
