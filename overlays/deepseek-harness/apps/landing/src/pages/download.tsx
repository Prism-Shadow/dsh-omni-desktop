/**
 * Desktop download page: the landing's only screen. Download resolution,
 * platform detection, mirror switching and unsigned-build FAQ behavior remain
 * intact; the visual composition follows the supplied API landing reference.
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
import { WhaleParticles } from '../components/whale-particles'

const PLATFORMS: Platform[] = ['mac', 'windows', 'linux']

interface Mirror {
  tag: string
  base: string
}

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
    <details open={defaultOpen} className="api-faq-item group">
      <summary className="api-faq-summary">
        <span>{question}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="api-faq-body">{children}</div>
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
  const githubAvailable = GITHUB_LATEST_DOWNLOAD !== ''
  const viaMirror = mirror !== null && !forceGithub
  const resolved = viaMirror ? mirror : null
  const hrefFor = (file: string): string | undefined => {
    if (resolved !== null) return `${resolved.base}/${file}`
    if (githubAvailable) return `${GITHUB_LATEST_DOWNLOAD}/${file}`
    return undefined
  }

  const heroFile = detected ? DESKTOP_INSTALLERS[detected][0] : null
  const heroHref = heroFile ? hrefFor(heroFile.file) : '#installers'
  const heroLabel = detected
    ? S.download.downloadCtaFor(S.download.platforms[detected].name)
    : S.download.downloadCta
  const statusText = resolved !== null
    ? S.download.statusOss(resolved.tag)
    : githubAvailable
      ? S.download.statusGithub
      : S.download.statusPending
  const checksumHref = hrefFor(DESKTOP_SHA256SUMS)

  return (
    <main className="api-page">
      <div className="api-page-grid" aria-hidden="true" />
      <WhaleParticles />

      <section className="api-hero" aria-labelledby="download-title">
        <div className="api-hero-inner anim-rise">
          <p className="api-eyebrow">
            <span aria-hidden="true" />
            {S.download.eyebrow}
            <span aria-hidden="true" />
          </p>

          <h1 id="download-title" className="api-title">
            {S.download.title}
            {' '}
            <span>{S.download.titleAccent}</span>
          </h1>

          <p className="api-subtitle">{S.download.subtitle}</p>
          <p className="api-description">{S.download.description}</p>

          <div className="api-download-cluster">
            <div className="api-actions">
              <a
                href={heroHref ?? '#'}
                aria-disabled={heroHref === undefined}
                className={`api-primary-button ${heroHref === undefined ? 'api-primary-button-disabled' : ''}`}
              >
                <DownloadIcon className="h-5 w-5" />
                {heroLabel}
              </a>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="api-secondary-button">
                {S.download.cliHintLink}
                <ExternalLinkIcon className="h-4 w-4" />
              </a>
            </div>

            <p className="api-source-line">
              {statusText}
              {mirror !== null && (
                <>
                  <span aria-hidden="true">/</span>
                  <button type="button" className="api-text-link" onClick={() => { setForceGithub(!forceGithub) }}>
                    {forceGithub ? S.download.altOss : S.download.altGithub}
                  </button>
                </>
              )}
            </p>
          </div>

          <div className="api-utility-row">
            <details id="installers" className="api-utility">
              <summary>{S.download.platformTitle}</summary>
              <div className="api-utility-panel api-installers-panel">
                {PLATFORMS.map(platform => (
                  <section key={platform} className={detected === platform ? 'is-detected' : ''}>
                    <div>
                      <h2>{S.download.platforms[platform].name}</h2>
                      {detected === platform && <span>{S.download.recommended}</span>}
                    </div>
                    <p>{S.download.platforms[platform].require}</p>
                    <div className="api-installer-links">
                      {DESKTOP_INSTALLERS[platform].map(({ file, variant }) => (
                        hrefFor(file) === undefined
                          ? (
                            <span key={file} aria-disabled="true" className="api-installer-button is-disabled">
                              {variant}
                            </span>
                          )
                          : (
                            <a key={file} href={hrefFor(file)} className="api-installer-button">
                              {variant}
                            </a>
                          )
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </details>

            <details className="api-utility">
              <summary>{S.download.faq.title}</summary>
              <div className="api-utility-panel api-faq-panel">
                <p className="api-faq-intro">{S.download.faq.intro}</p>
                <FaqItem question={S.download.faq.mac.question} defaultOpen={detected === 'mac'}>
                  <p>{S.download.faq.mac.why}</p>
                  <ol>
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
            </details>

            {(checksumHref !== undefined || DESKTOP_RELEASES_URL !== '') && (
              <p className="api-status">
                {checksumHref !== undefined && (
                  <a href={checksumHref} className="api-text-link">{S.download.checksums}</a>
                )}
                {DESKTOP_RELEASES_URL !== '' && (
                  <>
                    {checksumHref !== undefined && <span aria-hidden="true">/</span>}
                    <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noreferrer" className="api-text-link">
                      {S.download.allReleases}
                    </a>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="api-preview-window" aria-label={S.download.screenshotTitle}>
            <div className="api-preview-body">
              <img
                src={`${import.meta.env.BASE_URL}desktop-preview.png`}
                alt={S.download.screenshotAlt}
                width="1920"
                height="1040"
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
