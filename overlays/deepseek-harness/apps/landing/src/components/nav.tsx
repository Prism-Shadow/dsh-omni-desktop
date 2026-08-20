/**
 * Minimal sticky header: logo + product name on the left, docs + GitHub links and the
 * language/theme toggles on the right. Docs opens outside the React router. On small
 * screens the docs label collapses to the icon row; no menu overlay is needed.
 */
import { S } from '../lib/strings'
import { DOCS_URL, REPO_URL } from '../lib/links'
import { GitHubIcon } from './icons'
import { ThemeToggle } from './theme-toggle'
import { LangToggle } from './lang-toggle'

export function Nav() {
  const linkCls =
    'inline-flex h-9 items-center rounded-lg px-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100'

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <a href="./" className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight">{S.siteName}</span>
        </a>

        <div className="ml-auto flex items-center gap-1">
          <a href={DOCS_URL} className={`${linkCls} hidden sm:inline-flex`}>
            {S.nav.docs}
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            title={S.nav.github}
            aria-label={S.nav.github}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-100"
          >
            <GitHubIcon className="h-[18px] w-[18px]" />
          </a>
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
