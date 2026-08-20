/**
 * Site footer: brand + tagline and a single resources column. The container is
 * max-w-7xl to frame the page like the nav, while content sections stay max-w-6xl.
 */
import { S } from '../lib/strings'
import { DOCS_URL, LICENSE_URL, RELEASES_URL, REPO_URL } from '../lib/links'

export function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
              <span className="text-[15px] font-semibold tracking-tight">{S.siteName}</span>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{S.footer.tagline}</p>
          </div>
          <div className="text-sm">
            <p className="mb-3 font-medium">{S.footer.resources}</p>
            <ul className="space-y-2 text-gray-500 dark:text-gray-400">
              <li>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-gray-900 dark:hover:text-gray-100"
                >
                  {S.footer.repo}
                </a>
              </li>
              <li>
                <a href={DOCS_URL} className="hover:text-gray-900 dark:hover:text-gray-100">
                  {S.footer.docs}
                </a>
              </li>
              <li>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-gray-900 dark:hover:text-gray-100"
                >
                  {S.footer.releases}
                </a>
              </li>
              <li>
                <a
                  href={LICENSE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-gray-900 dark:hover:text-gray-100"
                >
                  {S.footer.license}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-10 border-t border-gray-200 pt-6 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
          {S.footer.copyright}
        </p>
      </div>
    </footer>
  )
}
