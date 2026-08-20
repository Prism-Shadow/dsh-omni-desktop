/**
 * Desktop download page — the landing's only page. The buttons are static GitHub
 * `releases/latest/download/<name>` links when the desktop release repository is
 * configured, and swap to the OSS mirror's immutable per-tag URLs once the bucket's
 * `latest.json` pointer resolves. Plain-anchor downloads are never CORS-gated;
 * only this version lookup is.
 *
 * Layout is a focused, centered download page: hero headline + one platform-aware
 * primary button, then the three platform cards, then the first-launch FAQ (one
 * collapsible item per platform, with the visitor's own platform pre-expanded).
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { S } from '../lib/strings'
import {
  DESKTOP_INSTALLERS,
  DESKTOP_RELEASES_URL,
  DESKTOP_SHA256SUMS,
  DOCS_URL,
  GITHUB_LATEST_DOWNLOAD,
  LINUX_APPIMAGE_CHMOD_CMD,
  MAC_UNQUARANTINE_CMD,
  OSS_LATEST_JSON_URL,
  OSS_ORIGIN,
} from '../lib/links'
import { detectPlatform } from '../lib/platform'
import type { Platform } from '../lib/platform'
import { CodeCard } from '../components/code-card'
import { ChevronDownIcon, DownloadIcon, ExternalLinkIcon } from '../components/icons'

const PLATFORMS: Platform[] = ['mac', 'windows', 'linux']

interface Mirror {
  tag: string
  base: string
}

/**
 * One collapsible item of the first-launch FAQ. `defaultOpen` pre-expands the
 * visitor's own platform on mount; after that the element owns its open state
 * (React only writes the `open` property again if the rendered value changes,
 * which it never does here).
 */
function FaqItem({
  question,
  defaultOpen,
  children,
}: {
  question: string
  defaultOpen: boolean
  children: ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium tracking-tight [&::-webkit-details-marker]:hidden">
        {question}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180 dark:text-gray-500" />
      </summary>
      <div className="border-t border-gray-200 px-4 py-3 text-sm leading-6 text-gray-600 dark:border-gray-800 dark:text-gray-400">
        {children}
      </div>
    </details>
  )
}

/** latest.json validated like the installer forwarders validate it: schema 1, safe v-tag, fixed bucket base. */
function parseMirror(value: unknown): Mirror | null {
  if (typeof value !== 'object' || value === null) return null
  const manifest = value as { schemaVersion?: unknown; tag?: unknown; releaseBaseUrl?: unknown }
  if (manifest.schemaVersion !== 1 || typeof manifest.tag !== 'string') return null
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(manifest.tag)) return null
  if (manifest.releaseBaseUrl !== `${OSS_ORIGIN}/releases/${manifest.tag}`) return null
  return { tag: manifest.tag, base: manifest.releaseBaseUrl }
}

export function DownloadPage() {
  const [mirror, setMirror] = useState<Mirror | null>(null)
  const [forceGithub, setForceGithub] = useState(false)
  useEffect(() => {
    if (OSS_LATEST_JSON_URL === '') return
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 5000)
    fetch(OSS_LATEST_JSON_URL, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const parsed = parseMirror(body)
        if (parsed) setMirror(parsed)
      })
      .catch(() => {}) // The GitHub links already work; the mirror is a progressive upgrade.
      .finally(() => { clearTimeout(timer) })
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const detected = detectPlatform()
  const viaMirror = mirror !== null && !forceGithub
  const resolved = viaMirror ? mirror : null
  const hrefFor = (file: string): string | undefined => {
    if (resolved !== null) return `${resolved.base}/${file}`
    if (GITHUB_LATEST_DOWNLOAD !== '') return `${GITHUB_LATEST_DOWNLOAD}/${file}`
    return undefined
  }
  const downloadLinkClass =
    'inline-flex items-center justify-center gap-1.5 rounded-md bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300'
  const disabledDownloadClass =
    'inline-flex items-center justify-center gap-1.5 rounded-md bg-gray-200 px-3.5 py-2 text-sm font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400'

  const textLink =
    'inline-flex items-center gap-1 text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-600 dark:text-brand-300 dark:decoration-brand-700'

  // The hero's primary button resolves to the visitor's own platform when detected,
  // otherwise it points at the platform cards below.
  const heroFile = detected ? DESKTOP_INSTALLERS[detected][0] : null
  const heroHref = heroFile ? hrefFor(heroFile.file) : '#platforms'
  const heroLabel = detected
    ? S.download.downloadCtaFor(S.download.platforms[detected].name)
    : S.download.downloadCta
  const statusText = resolved !== null
    ? S.download.statusOss(resolved.tag)
    : GITHUB_LATEST_DOWNLOAD !== ''
      ? S.download.statusGithub
      : S.download.statusPending

  return (
    <main>
      {/* Hero: headline + platform-aware primary download button. */}
      <section className="relative overflow-hidden text-center">
        <div className="mx-auto max-w-3xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24 sm:pb-20">
          <div className="anim-rise flex items-center justify-center gap-3.5">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
              className="h-12 w-12 sm:h-14 sm:w-14"
            />
            <span className="text-3xl font-semibold tracking-tight sm:text-4xl">{S.siteName}</span>
          </div>
          <h1
            className="anim-rise mx-auto mt-8 text-3xl font-semibold tracking-tight text-balance sm:text-5xl"
            style={{ animationDelay: '80ms' }}
          >
            {S.download.title}
          </h1>
          <p
            className="anim-rise mx-auto mt-5 max-w-2xl text-base leading-7 text-gray-600 text-pretty sm:text-lg dark:text-gray-300"
            style={{ animationDelay: '140ms' }}
          >
            {S.download.subtitle}
          </p>
          <div className="anim-rise mt-9" style={{ animationDelay: '200ms' }}>
            <a
              href={heroHref ?? '#'}
              aria-disabled={heroHref === undefined}
              className={`inline-flex h-12 items-center gap-2.5 rounded-xl px-7 text-base font-medium transition-colors ${
                heroHref === undefined
                  ? 'pointer-events-none bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white'
              }`}
            >
              <DownloadIcon className="h-5 w-5" />
              {heroLabel}
            </a>
          </div>
          <p
            className="anim-rise mt-7 text-sm text-gray-600 dark:text-gray-400"
            style={{ animationDelay: '240ms' }}
          >
            {statusText}
            {mirror !== null && (
              <>
                <span className="mx-2 text-gray-300 dark:text-gray-700">·</span>
                <button type="button" className={textLink} onClick={() => { setForceGithub(!forceGithub) }}>
                  {forceGithub ? S.download.altOss : S.download.altGithub}
                </button>
              </>
            )}
            {hrefFor(DESKTOP_SHA256SUMS) !== undefined && (
              <>
                <span className="mx-2 text-gray-300 dark:text-gray-700">·</span>
                <a href={hrefFor(DESKTOP_SHA256SUMS)} className={textLink}>
                  {S.download.checksums}
                </a>
              </>
            )}
            {DESKTOP_RELEASES_URL !== '' && (
              <>
                <span className="mx-2 text-gray-300 dark:text-gray-700">·</span>
                <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noreferrer" className={textLink}>
                  {S.download.allReleases}
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              </>
            )}
          </p>
        </div>
      </section>

      {/* Platform cards: every installer, current platform highlighted. */}
      <section id="platforms" className="px-4 pb-16 sm:px-6">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {PLATFORMS.map(platform => (
            <div
              key={platform}
              className={`flex flex-col rounded-xl border bg-white p-5 dark:bg-gray-900 ${
                detected === platform
                  ? 'border-brand-500 ring-1 ring-brand-500'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold tracking-tight">
                  {S.download.platforms[platform].name}
                </h3>
                {detected === platform && (
                  <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">
                    {S.download.recommended}
                  </span>
                )}
              </div>
              <p className="mt-1 mb-4 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {S.download.platforms[platform].require}
              </p>
              <div className="mt-auto flex flex-col gap-2">
                {DESKTOP_INSTALLERS[platform].map(({ file, variant }) => (
                  hrefFor(file) === undefined
                    ? (
                      <span key={file} aria-disabled="true" className={disabledDownloadClass}>
                        <DownloadIcon className="h-4 w-4" />
                        {variant}
                      </span>
                    )
                    : (
                      <a key={file} href={hrefFor(file)} className={downloadLinkClass}>
                        <DownloadIcon className="h-4 w-4" />
                        {variant}
                      </a>
                    )
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* First-launch FAQ: one collapsible item per platform. */}
      <section className="px-4 pb-16 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-center text-base font-semibold tracking-tight">
            {S.download.faq.title}
          </h2>
          <p className="mt-1 text-center text-sm leading-6 text-gray-600 dark:text-gray-400">
            {S.download.faq.intro}
          </p>
          <div className="mt-4 flex flex-col gap-3 text-left">
            <FaqItem question={S.download.faq.mac.question} defaultOpen={detected === 'mac'}>
              <p>{S.download.faq.mac.why}</p>
              <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5">
                <li>{S.download.faq.mac.stepDrag}</li>
                <li>{S.download.faq.mac.stepTerminal}</li>
                <li>
                  {S.download.faq.mac.stepPaste}
                  <CodeCard code={MAC_UNQUARANTINE_CMD} label="Terminal" className="mt-2 mb-1" />
                </li>
                <li>{S.download.faq.mac.stepOpen}</li>
              </ol>
            </FaqItem>
            <FaqItem question={S.download.faq.windows.question} defaultOpen={detected === 'windows'}>
              <p>{S.download.faq.windows.answer}</p>
            </FaqItem>
            <FaqItem question={S.download.faq.linux.question} defaultOpen={detected === 'linux'}>
              <p>{S.download.faq.linux.answer}</p>
              <CodeCard code={LINUX_APPIMAGE_CHMOD_CMD} label="shell" className="mt-2" />
            </FaqItem>
          </div>
        </div>
      </section>

      <section className="px-4 pb-16 text-center sm:px-6">
        <p className="mx-auto max-w-4xl text-sm leading-5 text-gray-500 dark:text-gray-400">
          {S.download.cliHint}{' '}
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className={textLink}>
            {S.download.cliHintLink}
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </p>
      </section>
    </main>
  )
}
