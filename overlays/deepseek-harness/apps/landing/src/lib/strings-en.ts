/** English landing copy; constrained to the same shape as the Chinese dictionary by the `Strings` type. */
import type { Strings } from './strings'

export const en: Strings = {
  siteName: 'DSH Omni Desktop',

  nav: {
    docs: 'Docs',
    github: 'GitHub',
  },

  theme: { label: 'Theme', light: 'Light', dark: 'Dark', system: 'System' },
  lang: { label: 'Language', zh: '中文', en: 'English', system: 'System' },

  footer: {
    tagline: 'The all-modal DSH desktop client.',
    resources: 'Resources',
    repo: 'GitHub repository',
    docs: 'Documentation',
    releases: 'Releases',
    license: 'License',
    copyright: 'DSH Omni Desktop · MIT License',
  },

  copy: { copy: 'Copy', copied: 'Copied' },

  download: {
    eyebrow: 'All-modal DSH desktop client',
    title: 'DSH OMNI',
    titleAccent: 'DESKTOP.',
    subtitle: 'Bring multimodal chat, tool use, and the local runtime into one desktop entry.',
    description: 'DSH Omni Desktop is built for daily development and agent workflows: it bundles the Node runtime and local service, keeps the full Web experience, and starts without manual command-line setup.',
    highlightsLabel: 'Core capabilities',
    highlights: ['Full desktop Web experience', 'Bundled runtime and local service', 'Multimodal workflow entry'],
    downloadCta: 'Download desktop client',
    downloadCtaFor: (platform: string) => `Download for ${platform}`,
    recommended: 'Detected',
    platformTitle: 'Choose an installer',
    platformHint: 'All platform links stay available',
    previewKicker: 'DESKTOP_PREVIEW::OMNI',
    screenshotTitle: 'Desktop screenshot slot',
    screenshotHint: 'Real DSH Omni Desktop product screenshot',
    screenshotAlt: 'DSH Omni Desktop desktop client interface screenshot',
    previewTags: ['All-modal', 'Local runtime', 'Plugin-ready'],
    platforms: {
      mac: { name: 'macOS', require: 'macOS 11 or later, dmg image (pick your chip)' },
      windows: { name: 'Windows', require: 'Windows 10 or later (x64), NSIS installer' },
      linux: { name: 'Linux', require: 'x64, AppImage runs without install, or deb for your package manager' },
    },
    statusOss: (version: string) => `Connected to the OSS mirror (${version}) — downloads now come from the mirror.`,
    statusGithub: 'Downloads point at the latest GitHub Release.',
    statusPending: 'The desktop release repository is not configured yet; downloads will be enabled before release.',
    altGithub: 'Use GitHub instead',
    altOss: 'Use the OSS mirror',
    checksums: 'Checksums (SHA256SUMS.desktop)',
    allReleases: 'All releases',
    faq: {
      kicker: 'First launch',
      title: 'Launch notes',
      intro: 'The current builds are unsigned, so the OS may block the first launch — follow the steps for your system once.',
      mac: {
        question: 'macOS says the app is damaged and cannot be opened?',
        why: 'macOS quarantines files downloaded from the web, and unsigned apps get misreported as "damaged". Removing the flag fixes it:',
        stepDrag: 'Open the downloaded dmg and drag the app into Applications.',
        stepTerminal: 'Open Terminal (Launchpad → Other → Terminal).',
        stepPaste: 'Paste this command into the terminal, press Enter, then type your password (nothing shows while typing; press Enter):',
        stepOpen: 'After it finishes, double-click the app to open it normally.',
      },
      windows: {
        question: 'Windows SmartScreen says "Windows protected your PC"?',
        answer: 'The installer is not signed yet, so SmartScreen blocks the first run: click More info, then Run anyway — only the first run needs this.',
      },
      linux: {
        question: 'Nothing happens when you double-click the AppImage?',
        answer: 'AppImages downloaded through a browser have no execute permission; grant it once and it starts normally (the deb installs via your package manager, no such issue):',
      },
    },
    cliHint: 'Only need the CLI or the Web UI in a browser?',
    cliHintLink: 'See the docs',
  },
}
