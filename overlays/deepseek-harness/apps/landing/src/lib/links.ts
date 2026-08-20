/** External links and shared constants used across the landing pages. */

export const PROJECT_REPO_URL = 'https://github.com/Prism-Shadow/dsh-omni-desktop'
export const PROJECT_OSS_ORIGIN = 'https://dsh-omni-desktop-releases.oss-cn-beijing.aliyuncs.com'
export const REPO_URL = 'https://github.com/deepseek-ai/deepseek-harness'
export const RELEASES_URL = `${REPO_URL}/releases`
export const LICENSE_URL = `${REPO_URL}/blob/master/LICENSE`
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`
export const DISCORD_URL = 'https://discord.gg/Ycq5dCaS4'
export const DSH_PLUGIN_TOPIC_URL = 'https://github.com/topics/dsh-plugin'
export const DEEPSEEK_KEYS_URL = 'https://platform.deepseek.com/api_keys'

/** Documentation remains hosted from the upstream source repository. */
export const DOCS_URL = `${REPO_URL}/tree/master/docs`
export const DOCS_PROVIDERS_URL = `${REPO_URL}/blob/master/docs/user/guide/providers.zh.md`
export const DOCS_PROVIDERS_EN_URL = `${REPO_URL}/blob/master/docs/user/guide/providers.md`

/**
 * Desktop app downloads. The release repository is configured by the site build
 * once the desktop distribution repository exists. The installers carry
 * version-less names (see apps/desktop/electron-builder.yml), which lets
 * GitHub's `releases/latest/download/<name>` serve the newest release. The OSS
 * mirror stores immutable per-tag directories instead, so mirror links need the
 * current tag from latest.json.
 */
export const DESKTOP_RELEASE_REPO_URL = (import.meta.env.VITE_DESKTOP_RELEASE_REPO_URL ?? PROJECT_REPO_URL).replace(/\/+$/, '')
export const OSS_ORIGIN = (import.meta.env.VITE_DESKTOP_OSS_ORIGIN ?? PROJECT_OSS_ORIGIN).replace(/\/+$/, '')
export const DESKTOP_RELEASES_URL = DESKTOP_RELEASE_REPO_URL === ''
  ? ''
  : `${DESKTOP_RELEASE_REPO_URL}/releases`
export const OSS_LATEST_JSON_URL = OSS_ORIGIN === '' ? '' : `${OSS_ORIGIN}/latest.json`
export const GITHUB_LATEST_DOWNLOAD = DESKTOP_RELEASE_REPO_URL === ''
  ? ''
  : `${DESKTOP_RELEASE_REPO_URL}/releases/latest/download`

export interface DesktopInstaller {
  /** Stable asset file name, identical on GitHub Releases and the OSS mirror. */
  file: string
  /** Language-neutral variant tag rendered on the button (arch / package format). */
  variant: string
}

/** Named separately: the first-launch FAQ's chmod command quotes this exact file name. */
const LINUX_APPIMAGE: DesktopInstaller = {
  file: 'deepseek-harness-desktop-linux-x86_64.AppImage',
  variant: 'AppImage',
}

/** Installers per platform card, in display order. */
export const DESKTOP_INSTALLERS: Record<'mac' | 'windows' | 'linux', DesktopInstaller[]> = {
  mac: [
    { file: 'deepseek-harness-desktop-darwin-arm64.dmg', variant: 'Apple Silicon' },
    { file: 'deepseek-harness-desktop-darwin-x64.dmg', variant: 'Intel' },
  ],
  windows: [{ file: 'deepseek-harness-desktop-win32-x64.exe', variant: 'x64' }],
  linux: [LINUX_APPIMAGE, { file: 'deepseek-harness-desktop-linux-amd64.deb', variant: 'deb' }],
}

/** Checksum list covering every desktop installer of a release. */
export const DESKTOP_SHA256SUMS = 'SHA256SUMS.desktop'

/**
 * First-launch fixes for the unsigned desktop builds (the download page FAQ).
 * The macOS one deletes the quarantine flag that makes Gatekeeper report the app
 * as "damaged"; the Linux one restores the execute bit browsers strip from a
 * downloaded AppImage.
 */
export const MAC_UNQUARANTINE_CMD = 'sudo xattr -rd com.apple.quarantine "/Applications/DeepSeek Harness.app"'
export const LINUX_APPIMAGE_CHMOD_CMD = `chmod +x ${LINUX_APPIMAGE.file}`
