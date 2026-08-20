/**
 * Landing copy (bilingual): this file holds the Chinese dictionary `zh` and the
 * runtime active dictionary `S`; the English dictionary lives in strings-en.ts
 * (constrained to the same shape by the `Strings` type). Locale switching is
 * handled by state/locale.tsx, which calls `setActiveStrings` and remounts the
 * tree keyed by locale — keep `S.x` reads inside components.
 */

export interface Strings {
  siteName: string
  nav: {
    docs: string
    github: string
  }
  theme: { label: string; light: string; dark: string; system: string }
  lang: { label: string; zh: string; en: string; system: string }
  footer: {
    tagline: string
    resources: string
    repo: string
    docs: string
    releases: string
    license: string
    copyright: string
  }
  copy: { copy: string; copied: string }
  download: {
    eyebrow: string
    title: string
    titleAccent: string
    subtitle: string
    description: string
    highlightsLabel: string
    highlights: string[]
    downloadCta: string
    downloadCtaFor: (platform: string) => string
    recommended: string
    platformTitle: string
    platformHint: string
    previewKicker: string
    screenshotTitle: string
    screenshotHint: string
    screenshotAlt: string
    previewTags: string[]
    platforms: {
      mac: { name: string; require: string }
      windows: { name: string; require: string }
      linux: { name: string; require: string }
    }
    statusOss: (version: string) => string
    statusGithub: string
    statusPending: string
    altGithub: string
    altOss: string
    checksums: string
    allReleases: string
    faq: {
      kicker: string
      title: string
      intro: string
      mac: { question: string; why: string; stepDrag: string; stepTerminal: string; stepPaste: string; stepOpen: string }
      windows: { question: string; answer: string }
      linux: { question: string; answer: string }
    }
    cliHint: string
    cliHintLink: string
  }
}

export const zh: Strings = {
  siteName: 'DSH Omni Desktop',

  nav: {
    docs: '文档',
    github: 'GitHub',
  },

  theme: { label: '主题', light: '浅色', dark: '深色', system: '跟随系统' },
  lang: { label: '语言', zh: '中文', en: 'English', system: '跟随系统' },

  footer: {
    tagline: '全模态 DSH 桌面客户端。',
    resources: '资源',
    repo: 'GitHub 仓库',
    docs: '文档',
    releases: '发布记录',
    license: '开源协议',
    copyright: 'DSH Omni Desktop · MIT License',
  },

  copy: { copy: '复制', copied: '已复制' },

  download: {
    eyebrow: '全模态 DSH 桌面客户端',
    title: 'DSH OMNI',
    titleAccent: 'DESKTOP.',
    subtitle: '把多模态对话、工具调用与本地运行环境收束为一个桌面入口。',
    description: 'DSH Omni Desktop 面向日常开发与 Agent 工作流：内嵌 Node 运行时与本地服务，保留完整 Web 体验，安装后即可启动，无需再手动配置命令行环境。',
    highlightsLabel: '核心能力',
    highlights: ['桌面端完整 Web 体验', '内置运行时与本地服务', '多模态工作流入口'],
    downloadCta: '下载桌面客户端',
    downloadCtaFor: (platform: string) => `下载 ${platform} 客户端`,
    recommended: '当前系统',
    platformTitle: '选择安装包',
    platformHint: '保留全部平台下载入口',
    previewKicker: 'DESKTOP_PREVIEW::OMNI',
    screenshotTitle: '桌面端截图位',
    screenshotHint: 'DSH Omni Desktop 实际产品截图',
    screenshotAlt: 'DSH Omni Desktop 桌面客户端界面截图',
    previewTags: ['全模态', '本地运行', '插件化'],
    platforms: {
      mac: { name: 'macOS', require: 'macOS 11 及以上，dmg 安装镜像（按芯片选择）' },
      windows: { name: 'Windows', require: 'Windows 10 及以上（x64），NSIS 安装程序' },
      linux: { name: 'Linux', require: 'x64，AppImage 免安装运行，或 deb 交给包管理器' },
    },
    statusOss: (version: string) => `已连接 OSS 镜像（${version}），点击即从镜像高速下载。`,
    statusGithub: '下载指向 GitHub Releases 的最新版本。',
    statusPending: '桌面版发布仓库尚未配置，下载链接将在发布前启用。',
    altGithub: '改从 GitHub 下载',
    altOss: '改用 OSS 镜像下载',
    checksums: '校验和（SHA256SUMS.desktop）',
    allReleases: '全部版本',
    faq: {
      kicker: '首次启动',
      title: '启动提示',
      intro: '当前构建暂未签名，系统可能拦截首次启动——按对应系统的步骤解除即可，只需操作一次。',
      mac: {
        question: 'macOS 提示应用已损坏，无法打开？',
        why: 'macOS 会给从网络下载的文件加上隔离标记，应用未签名时会因此被误报「已损坏」。删除该标记即可解除：',
        stepDrag: '打开下载的 dmg，把应用拖入「应用程序（Applications）」文件夹。',
        stepTerminal: '打开终端：「启动台 → 其他 → 终端」。',
        stepPaste: '在终端粘贴这条命令并回车，然后输入开机密码（输入时屏幕不显示字符，输完回车即可）：',
        stepOpen: '执行完成后，双击即可正常打开应用。',
      },
      windows: {
        question: 'Windows SmartScreen 提示「Windows 已保护你的电脑」？',
        answer: '安装程序暂未签名，SmartScreen 会拦截首次运行：点「更多信息」，再点「仍要运行」即可继续安装，仅首次运行需要。',
      },
      linux: {
        question: 'Linux 双击 AppImage 没有反应？',
        answer: '浏览器下载的 AppImage 默认没有执行权限，赋权一次后即可正常启动（deb 包经包管理器安装，无此问题）：',
      },
    },
    cliHint: '只需要命令行或浏览器里的 Web 界面？',
    cliHintLink: '参见文档',
  },
}

let activeStrings: Strings = zh

/** The active copy dictionary; reads must stay inside components (locale switch remounts the tree). */
export const S: Strings = new Proxy({} as Strings, {
  get(_target, property) {
    return Reflect.get(activeStrings, property)
  },
})

export function setActiveStrings(next: Strings): void {
  activeStrings = next
}
