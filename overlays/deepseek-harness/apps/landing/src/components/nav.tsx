/**
 * Minimal sticky header: logo + product name on the left, docs + GitHub links and
 * language/theme toggles on the right. Docs opens outside the React router.
 */
import { S } from '../lib/strings'
import { DOCS_URL, PROJECT_REPO_URL } from '../lib/links'
import { GitHubIcon } from './icons'
import { ThemeToggle } from './theme-toggle'
import { LangToggle } from './lang-toggle'

export function Nav() {
  const linkCls =
    'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white'

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/88 backdrop-blur-xl dark:border-white/10 dark:bg-gray-950/86">
      <div className="mx-auto grid h-14 max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6">
        <a href="./" className="flex items-center gap-2 justify-self-start">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-6 w-6" />
          <span className="text-[15px] font-extrabold tracking-tight text-gray-950 dark:text-white">DSH OMNI DESKTOP</span>
        </a>

        <nav className="hidden items-center gap-5 justify-self-center md:flex" aria-label="Primary">
          <a href="./" className={linkCls}>
            Desktop
          </a>
          <a href="#installers" className={linkCls}>
            Download
          </a>
          <a href={DOCS_URL} className={`${linkCls} hidden sm:inline-flex`}>
            {S.nav.docs}
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-1 justify-self-end">
          <a
            href={PROJECT_REPO_URL}
            target="_blank"
            rel="noreferrer"
            title={S.nav.github}
            aria-label={S.nav.github}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-gray-950 dark:text-gray-300 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white"
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
