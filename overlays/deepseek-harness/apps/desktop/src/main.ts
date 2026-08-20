import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, shell, type BrowserWindowConstructorOptions } from 'electron'
import type { AppUpdater } from 'electron-updater'

const require = createRequire(import.meta.url)
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const READY_RE = /\bdsh web:\s+(https?:\/\/[^\s]+)/i
const STARTUP_TIMEOUT_MS = 120_000
const STARTUP_WITH_PROFILE_PLUGINS_TIMEOUT_MS = 180_000
const SHUTDOWN_TIMEOUT_MS = 5_000

let mainWindow: BrowserWindow | undefined
let server: DshWebServer | undefined
let readyUrl: string | undefined
let readyOrigin: string | undefined
let quitting = false
let quitAfterServerStop = false
let updateServer: UpdateControlServer | undefined

function logPath(): string {
  return path.join(app.getPath('userData'), 'desktop.log')
}

function appendLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}${os.EOL}`
  const file = logPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, line, 'utf8')
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

function describeList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ')
}

function collectSensitiveEnvValues(env: NodeJS.ProcessEnv): string[] {
  const values: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value.length < 8) continue
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL|COOKIE)/i.test(name)) values.push(value)
  }
  return values
}

function redactSensitiveValues(text: string, sensitiveValues: readonly string[]): string {
  let redacted = text
  for (const value of sensitiveValues) {
    redacted = redacted.split(value).join('[redacted]')
  }
  return redacted
}

function resolveWindowIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png'), path.join(moduleDir, '..', 'build', 'icon.png')]
    : [path.join(moduleDir, '..', 'build', 'icon.png')]

  return candidates.find(candidate => fs.existsSync(candidate))
}

function loadingPage(): string {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>DeepSeek Harness</title>
  <style>
    html, body {
      height: 100%;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f1115;
      color: #f5f7fb;
    }
    body {
      display: grid;
      place-items: center;
    }
    main {
      width: min(480px, calc(100vw - 48px));
    }
    h1 {
      margin: 0 0 12px;
      font-size: 22px;
      font-weight: 650;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #b8c0cc;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <main>
    <h1>DeepSeek Harness</h1>
    <p>Starting the local workspace service...</p>
  </main>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function errorPage(message: string): string {
  const escaped = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>DeepSeek Harness</title>
  <style>
    html, body {
      height: 100%;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111318;
      color: #f5f7fb;
    }
    body {
      display: grid;
      place-items: center;
    }
    main {
      width: min(640px, calc(100vw - 48px));
    }
    h1 {
      margin: 0 0 12px;
      font-size: 22px;
      font-weight: 650;
      letter-spacing: 0;
    }
    p, pre {
      color: #c4ccd8;
      line-height: 1.5;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #1b1f2a;
      border-radius: 6px;
      padding: 12px;
    }
  </style>
</head>
<body>
  <main>
    <h1>DeepSeek Harness failed to start</h1>
    <p>Check the desktop log for the captured dsh web output.</p>
    <pre>${escaped}</pre>
  </main>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function resolveBundledNode(): string {
  const override = process.env.DSH_DESKTOP_NODE_PATH
  if (override) return override

  // macOS stages one runtime per architecture under node/<arch>/bin/node, because
  // electron-builder packages arm64 and x64 from the same tree; the flat layouts
  // remain as fallbacks for stages built before the split and for Linux.
  const resourceCandidates =
    process.platform === 'win32'
      ? [path.join(process.resourcesPath, 'node', 'node.exe')]
      : [
        path.join(process.resourcesPath, 'node', process.arch, 'bin', 'node'),
        path.join(process.resourcesPath, 'node', 'bin', 'node'),
        path.join(process.resourcesPath, 'node', 'node'),
      ]

  for (const candidate of resourceCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  if (!app.isPackaged) return 'node'

  throw new Error(`Bundled Node runtime was not found under ${process.resourcesPath}`)
}

function resolveDshBin(): string {
  const packageJsonPath = require.resolve('@deepseek-ai/dsh/package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    bin?: { dsh?: string }
  }
  const bin = packageJson.bin?.dsh
  if (!bin) throw new Error('@deepseek-ai/dsh package.json does not declare bin.dsh')
  return path.join(path.dirname(packageJsonPath), bin)
}

function isInternalNavigation(url: string): boolean {
  if (!readyOrigin) return false
  try {
    return new URL(url).origin === readyOrigin
  } catch {
    return false
  }
}

/**
 * Profile bundles this desktop ships on top of the standard web profile.
 * Currently empty: profile plugins install from the registry via
 * ensureProfilePlugins, so they can update independently with `dsh plugin
 * update`. Each name here would resolve from this app's node_modules (packed by
 * EXTRA_APP_DEPENDENCIES in scripts/stage.mjs) and be registered on first
 * launch so the shipped bundles compose without `dsh plugin add`.
 */
const SHIPPED_PROFILE_BUNDLES: readonly string[] = []

/**
 * Append every shipped profile bundle to the user's web profile manifest
 * (idempotent), so a fresh install composes the shipped plugins without the
 * user running `dsh plugin add`. The packages themselves resolve from this
 * app's node_modules through the profiles module fallback
 * (`healProfilesModuleFallback`), so only the bundle-layer registration is
 * written here — exactly what `dsh plugin` reconcile would append. The
 * profile directory is initialized if the user has never created it; every
 * existing manifest field is preserved.
 */
function ensureShippedProfileBundles(): void {
  if (SHIPPED_PROFILE_BUNDLES.length === 0) return
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const profileDir = path.join(home, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const manifestPath = path.join(profileDir, 'package.json')
  let manifest: {
    name?: string
    private?: boolean
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as typeof manifest
  } catch {
    manifest = { name: 'dsh-profile-web', private: true, dependencies: {} }
  }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  let changed = false
  for (const name of SHIPPED_PROFILE_BUNDLES) {
    if (!bundles.includes(name)) {
      bundles.push(name)
      changed = true
    }
  }
  if (!changed) return
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
}

/**
 * Profile plugins the desktop installs from the registry on first launch.
 * Unlike shipped bundles, these are NOT resolved from this app's node_modules:
 * they install into the user profile via `dsh plugin add`, so `dsh plugin
 * update` upgrades them independently of a desktop release.
 */
const PROFILE_PLUGINS: readonly { name: string; version: string }[] = [
  { name: '@prismshadow/dsh-deepseek-eyes', version: '^0.1.4' },
  { name: '@prismshadow/dsh-penguin-llm-router', version: '^0.1.4' },
]

interface ProfilePluginState {
  readonly bundles: readonly string[]
  readonly dependencies: Readonly<Record<string, string>>
}

interface ProfilePluginBootstrapResult {
  /** True when this launch successfully added or updated at least one profile plugin. */
  installed: boolean
  /** True when any desktop-managed profile plugin is active or was just ensured. */
  managedPluginsPresent: boolean
}

/** How long a first-launch plugin install may take before it is abandoned. */
const PLUGIN_INSTALL_TIMEOUT_MS = 120_000

function readProfilePluginState(profileDir: string): ProfilePluginState | undefined {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: unknown
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
      ? manifest.dsh.profile.bundles.map(String)
      : []
    const dependencies: Record<string, string> = {}
    if (manifest.dependencies !== null && typeof manifest.dependencies === 'object' && !Array.isArray(manifest.dependencies)) {
      for (const [name, spec] of Object.entries(manifest.dependencies)) {
        dependencies[name] = typeof spec === 'string' ? spec : String(spec)
      }
    }
    return { bundles, dependencies }
  } catch (error) {
    appendLog(`profile plugin manifest unavailable at ${path.join(profileDir, 'package.json')}: ${describeError(error)}`)
    return undefined
  }
}

function describeProfilePluginDependencies(dependencies: Readonly<Record<string, string>>): string[] {
  return Object.entries(dependencies).map(([name, spec]) => `${name}@${spec}`)
}

function appendProfilePluginState(label: string, profileDir: string): void {
  const state = readProfilePluginState(profileDir)
  if (state === undefined) return
  appendLog(
    `profile plugin ${label}: bundles=${describeList(state.bundles)}; dependencies=${describeList(describeProfilePluginDependencies(state.dependencies))}`,
  )
}

interface VersionFloor {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

function parseVersionFloor(spec: string): VersionFloor | undefined {
  const match = /^(?:[\^~]|>=)?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(spec.trim())
  const major = match?.groups?.major
  const minor = match?.groups?.minor
  const patch = match?.groups?.patch
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  }
}

function compareVersionFloors(left: VersionFloor, right: VersionFloor): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

function dependencyVersionMeetsTarget(currentSpec: string | undefined, targetSpec: string): boolean {
  if (currentSpec === undefined) return false
  if (currentSpec === targetSpec) return true
  const current = parseVersionFloor(currentSpec)
  const target = parseVersionFloor(targetSpec)
  if (current === undefined || target === undefined) return false
  return compareVersionFloors(current, target) >= 0
}

function managedProfilePluginsPresent(state: ProfilePluginState | undefined): boolean {
  if (state === undefined) return false
  return PROFILE_PLUGINS.some(({ name }) => state.bundles.includes(name))
}

function profilePluginInstallReason(
  plugin: { name: string; version: string },
  state: ProfilePluginState | undefined,
): string | undefined {
  if (state === undefined) return 'profile manifest unavailable'
  const listed = state.bundles.includes(plugin.name)
  const installedSpec = state.dependencies[plugin.name]
  if (!listed) return 'missing from profile bundle list'
  if (!dependencyVersionMeetsTarget(installedSpec, plugin.version)) {
    return `installed dependency is ${installedSpec ?? '(missing)'}, target is ${plugin.version}`
  }
  return undefined
}

function resolveBundledPnpmPathEntries(): { entries: string[]; packageJsonPath?: string; error?: string } {
  const entries = [path.join(moduleDir, '..', 'node_modules', '.bin')]
  try {
    const packageJsonPath = require.resolve('pnpm')
    const packageDir = path.dirname(packageJsonPath)
    return {
      packageJsonPath,
      entries: [
        ...entries,
        path.resolve(packageDir, '..', '.bin'),
        path.join(packageDir, 'bin'),
      ],
    }
  } catch (error) {
    return { entries, error: describeError(error) }
  }
}

function copyEnvValue(target: NodeJS.ProcessEnv, source: NodeJS.ProcessEnv, name: string): void {
  const value = source[name]
  if (value !== undefined) target[name] = value
}

function createPluginInstallEnv(home: string, pathEntries: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    DSH_DESKTOP: '1',
    DSH_HOME: home,
    PATH: pathEntries.join(path.delimiter),
  }
  for (const name of [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'COMSPEC',
    'PATHEXT',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]) {
    copyEnvValue(env, process.env, name)
  }
  return env
}

function childExitSummary(child: ChildProcess): string | undefined {
  if (child.exitCode === null && child.signalCode === null) return undefined
  return `exit=${child.exitCode ?? 'null'}, signal=${child.signalCode ?? 'null'}`
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<string> {
  const settled = childExitSummary(child)
  if (settled !== undefined) return Promise.resolve(settled)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve('exit wait timed out')
    }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve(`exit=${code ?? 'null'}, signal=${signal ?? 'null'}`)
    })
  })
}

function runProcessForExit(command: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false
    let child: ChildProcess
    try {
      child = spawn(command, [...args], {
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
      })
    } catch (error) {
      resolve(`failed to run ${command}: ${describeError(error)}`)
      return
    }
    const timeout = setTimeout(() => {
      if (!child.killed) child.kill()
      finish(`${command} timed out after ${timeoutMs}ms`)
    }, timeoutMs)
    const finish = (message: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(message)
    }
    child.once('error', (error) => {
      finish(`failed to run ${command}: ${describeError(error)}`)
    })
    child.once('exit', (code, signal) => {
      finish(`${command} exited with code=${code ?? 'null'}, signal=${signal ?? 'null'}`)
    })
  })
}

async function terminateProcessTree(child: ChildProcess): Promise<string> {
  const pid = child.pid
  if (pid === undefined) return 'child pid was unavailable'
  const settled = childExitSummary(child)
  if (settled !== undefined) return `child already exited (${settled})`

  if (process.platform === 'win32') {
    const killSummary = await runProcessForExit('taskkill.exe', ['/pid', String(pid), '/T', '/F'], SHUTDOWN_TIMEOUT_MS)
    const exitSummary = await waitForChildExit(child, SHUTDOWN_TIMEOUT_MS)
    return `${killSummary}; child ${exitSummary}`
  }

  const actions: string[] = []
  try {
    process.kill(-pid, 'SIGTERM')
    actions.push('sent SIGTERM to process group')
  } catch (error) {
    actions.push(`process group SIGTERM failed: ${describeError(error)}`)
    actions.push(`sent SIGTERM to child=${child.kill('SIGTERM')}`)
  }

  let exitSummary = await waitForChildExit(child, SHUTDOWN_TIMEOUT_MS)
  if (exitSummary === 'exit wait timed out') {
    try {
      process.kill(-pid, 'SIGKILL')
      actions.push('sent SIGKILL to process group')
    } catch (error) {
      actions.push(`process group SIGKILL failed: ${describeError(error)}`)
      actions.push(`sent SIGKILL to child=${child.kill('SIGKILL')}`)
    }
    exitSummary = await waitForChildExit(child, SHUTDOWN_TIMEOUT_MS)
  }

  return `${actions.join('; ')}; child ${exitSummary}`
}

/**
 * Install or update the profile plugins from the registry before the dsh web
 * child boots (fail-open). `dsh plugin --profile web add` initializes the
 * profile if needed and reconciles dsh.profile.bundles itself; this shell only
 * supplies the bundled node and pnpm on PATH. A plugin already present at the
 * target dependency range is skipped. Any failure is logged and the web child
 * starts after the installer process stops (retried on the next launch), so a
 * transient network issue cannot block the app; this function never throws.
 */
async function ensureProfilePlugins(): Promise<ProfilePluginBootstrapResult> {
  if (PROFILE_PLUGINS.length === 0) return { installed: false, managedPluginsPresent: false }
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const profileDir = path.join(home, 'profiles', 'web')
  try {
    appendLog(
      `profile plugin bootstrap: home=${home}; profileDir=${profileDir}; packaged=${app.isPackaged}; resourcesPath=${process.resourcesPath}`,
    )
    const before = readProfilePluginState(profileDir)
    appendProfilePluginState('before install', profileDir)
    const pending = PROFILE_PLUGINS.flatMap((plugin) => {
      const reason = profilePluginInstallReason(plugin, before)
      return reason === undefined ? [] : [{ ...plugin, reason }]
    })
    if (pending.length === 0) {
      appendLog('profile plugin bootstrap: all configured plugins are already listed at target versions')
      return { installed: false, managedPluginsPresent: managedProfilePluginsPresent(before) }
    }

    const nodePath = resolveBundledNode()
    const dshBin = resolveDshBin()
    const nodeDir = path.dirname(nodePath)
    // Packaged runs resolve the bundled pnpm; a dev run without one falls back
    // to whatever pnpm is on the developer's PATH.
    const pnpm = resolveBundledPnpmPathEntries()
    if (pnpm.packageJsonPath !== undefined) {
      appendLog(`profile plugin bootstrap: resolved bundled pnpm at ${pnpm.packageJsonPath}`)
    } else {
      appendLog(`profile plugin bootstrap: bundled pnpm was not resolved; falling back to PATH: ${pnpm.error ?? 'unknown error'}`)
    }
    const specs = pending.map(({ name, version }) => `${name}@${version}`)
    const pathEntries = [
      nodeDir,
      ...pnpm.entries,
      process.env.PATH ?? '',
    ].filter(entry => entry.length > 0)
    const pathPrefix = [nodeDir, ...pnpm.entries]
    appendLog(`profile plugin bootstrap: ensuring=${describeList(pending.map(({ name, version, reason }) => `${name}@${version} (${reason})`))}`)
    appendLog(`profile plugin bootstrap: node=${nodePath}; dshBin=${dshBin}; cwd=${app.getPath('home')}`)
    appendLog(`profile plugin bootstrap: prepended PATH entries=${describeList(pathPrefix)}`)
    const env = createPluginInstallEnv(home, pathEntries)
    const sensitiveValues = collectSensitiveEnvValues(process.env)

    let changedProfilePlugins = false
    await new Promise<void>((resolve) => {
      const args = [dshBin, 'plugin', '--profile', 'web', 'add', ...specs]
      appendLog(`profile plugin install command: ${nodePath} ${args.join(' ')}`)
      const child = spawn(nodePath, args, {
        cwd: app.getPath('home'),
        detached: process.platform !== 'win32',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      appendLog(`profile plugin install process started: pid=${child.pid ?? 'unknown'}`)
      let settled = false
      let timedOut = false
      const finish = (message: string | undefined, success = false): void => {
        if (settled) return
        settled = true
        changedProfilePlugins = success
        clearTimeout(timeout)
        if (message !== undefined) appendLog(`profile plugin install: ${message}`)
        appendProfilePluginState('after install attempt', profileDir)
        resolve()
      }
      const timeout = setTimeout(() => {
        timedOut = true
        appendLog(`profile plugin install timeout: terminating process tree for pid=${child.pid ?? 'unknown'}`)
        void terminateProcessTree(child).then((summary) => {
          finish(`timed out after ${PLUGIN_INSTALL_TIMEOUT_MS}ms; ${summary}; dsh web starts without profile plugins`)
        }).catch((error: unknown) => {
          finish(`timed out after ${PLUGIN_INSTALL_TIMEOUT_MS}ms; termination failed: ${describeError(error)}; dsh web starts without profile plugins`)
        })
      }, PLUGIN_INSTALL_TIMEOUT_MS)
      child.stdout.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          if (line.length > 0) appendLog(`[plugin install stdout] ${redactSensitiveValues(line, sensitiveValues)}`)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          if (line.length > 0) appendLog(`[plugin install stderr] ${redactSensitiveValues(line, sensitiveValues)}`)
        }
      })
      child.once('error', (error) => {
        if (timedOut) return
        finish(`spawn failed: ${describeError(error)}; dsh web starts without profile plugins`)
      })
      child.once('exit', (code, signal) => {
        if (timedOut) return
        if (code === 0) finish('done', true)
        else finish(`failed (exit=${code ?? 'null'}, signal=${signal ?? 'null'}); dsh web starts without profile plugins`)
      })
    })
    const after = readProfilePluginState(profileDir)
    return {
      installed: changedProfilePlugins,
      managedPluginsPresent: changedProfilePlugins || managedProfilePluginsPresent(after ?? before),
    }
  } catch (error) {
    appendLog(`profile plugin install skipped: ${describeError(error)}`)
    return { installed: false, managedPluginsPresent: managedProfilePluginsPresent(readProfilePluginState(profileDir)) }
  }
}

/**
 * Updater lifecycle vocabulary mirrored from the dsh-desktop-updater plugin's
 * control client (@prismshadow/dsh-desktop-updater, src/types.ts). The desktop
 * shell owns these shapes; the plugin only mirrors them over the control
 * channel, and the two copies must stay in lockstep.
 */
type UpdaterPhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error'

interface UpdaterProgress {
  transferred: number
  total: number
  bytesPerSecond: number
}

interface UpdaterWireStatus {
  /** False when the current build cannot self-update (dev run, unsupported platform). */
  enabled: boolean
  /** Current electron-updater lifecycle phase. */
  phase: UpdaterPhase
  /** Installed application version. */
  currentVersion: string
  /** Resolved newer version; null when none exists (update-not-available). */
  latestVersion: string | null
  /** Progress while `phase` is `downloading`; null otherwise. */
  progress: UpdaterProgress | null
  /** Terminal error text while `phase` is `error`; null otherwise. */
  error: string | null
  /** Optional human reason when `enabled` is false. */
  reason?: string
}

/**
 * electron-updater engine: maps the autoUpdater event stream onto the control
 * channel's wire status and mediates the two mutations the plugin may trigger
 * (check, quit-and-install). electron-updater must run inside Electron main;
 * the dsh web child never sees the package, only this loopback channel.
 */
class DesktopUpdaterEngine {
  #phase: UpdaterPhase = 'idle'
  #latestVersion: string | null = null
  #progress: UpdaterProgress | null = null
  #error: string | null = null
  #checking = false
  readonly #updater: AppUpdater

  constructor() {
    // electron-updater ships CommonJS with no exports map; a bare ESM named
    // import would depend on cjs-module-lexer detection, so resolve through
    // the module's own require instead.
    this.#updater = require('electron-updater').autoUpdater as AppUpdater
    // The plugin surfaces download progress and a "restart to install"
    // button, so the update is fetched automatically but installed only when
    // the user asks for it.
    this.#updater.autoDownload = true
    this.#updater.autoInstallOnAppQuit = false
    this.#updater.on('checking-for-update', () => {
      this.#phase = 'checking'
      this.#latestVersion = null
      this.#progress = null
      this.#error = null
    })
    this.#updater.on('update-available', (info) => {
      // autoDownload is on, so the download starts right after this event.
      this.#phase = 'downloading'
      this.#latestVersion = info.version
      this.#error = null
    })
    this.#updater.on('update-not-available', () => {
      this.#phase = 'idle'
      this.#latestVersion = null
      this.#error = null
    })
    this.#updater.on('download-progress', (progress) => {
      this.#phase = 'downloading'
      this.#progress = {
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      }
    })
    this.#updater.on('update-downloaded', (info) => {
      this.#phase = 'downloaded'
      this.#latestVersion = info.version
      this.#error = null
    })
    this.#updater.on('error', (error) => {
      this.#phase = 'error'
      this.#error = error instanceof Error ? error.message : String(error)
    })
  }

  /** Current control-channel status. */
  status(): UpdaterWireStatus {
    const currentVersion = app.getVersion()
    const shared = {
      phase: this.#phase,
      currentVersion,
      latestVersion: this.#latestVersion,
      progress: this.#progress,
      error: this.#error,
    }
    if (!app.isPackaged) {
      return { ...shared, enabled: false, reason: 'unpackaged dev build' }
    }
    return { ...shared, enabled: true }
  }

  /** Run one update check; an explicit feed switches to a generic provider. */
  check(feedUrl: string | undefined): void {
    if (this.#checking) return
    this.#checking = true
    if (feedUrl !== undefined) {
      this.#updater.setFeedURL({ provider: 'generic', url: feedUrl })
    }
    // Failures surface through the error event into the wire status; the
    // resolved promise carries nothing the UI needs.
    void this.#updater.checkForUpdates().catch(() => undefined).finally(() => {
      this.#checking = false
    })
  }

  /** Quit the app and install the already-downloaded update. */
  quitAndInstall(): void {
    this.#updater.quitAndInstall()
  }
}

/**
 * Loopback control channel the dsh-desktop-updater plugin drives. A per-launch
 * random bearer token gates every request; the base URL and token reach the
 * dsh web child through DSH_DESKTOP_UPDATE_URL / DSH_DESKTOP_UPDATE_TOKEN.
 */
class UpdateControlServer {
  readonly token = randomBytes(32).toString('base64url')
  #server: Server | undefined
  #url: string | undefined
  readonly #engine: DesktopUpdaterEngine

  constructor(engine: DesktopUpdaterEngine) {
    this.#engine = engine
  }

  /** Control channel base URL once started. */
  get url(): string | undefined {
    return this.#url
  }

  /** Bind the loopback listener and return the reachable base URL. */
  async start(): Promise<string> {
    if (this.#server) return this.#url ?? ''
    const server = createServer((request, response) => {
      void this.#handle(request, response)
    })
    this.#server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('control channel failed to bind a loopback port')
    }
    this.#url = `http://127.0.0.1:${address.port}`
    return this.#url
  }

  async stop(): Promise<void> {
    const server = this.#server
    if (!server) return
    this.#server = undefined
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        sendJson(response, 401, { ok: false, message: 'unauthorized' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      switch (url.pathname) {
        case '/v1/status':
          sendJson(response, 200, this.#engine.status())
          return
        case '/v1/check': {
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, message: 'method not allowed' })
            return
          }
          let feedUrl: string | undefined
          const body = await readBody(request)
          if (body.length > 0) {
            try {
              const parsed = JSON.parse(body) as { feed?: { url?: unknown } }
              if (typeof parsed.feed?.url === 'string') feedUrl = parsed.feed.url
            } catch {
              sendJson(response, 400, { ok: false, message: 'invalid JSON body' })
              return
            }
          }
          // Ack before the check so the plugin's request does not wait on the
          // network; progress flows through the status endpoint afterwards.
          this.#engine.check(feedUrl)
          sendJson(response, 200, { ok: true })
          return
        }
        case '/v1/install': {
          // The plugin's client issues install as a GET (no request body); the
          // published contract documents POST, so accept both.
          sendJson(response, 200, { ok: true })
          // Let the response flush before the app tears down.
          setTimeout(() => this.#engine.quitAndInstall(), 500)
          return
        }
        default:
          sendJson(response, 404, { ok: false, message: 'not found' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      appendLog(`control channel request failed: ${message}`)
      if (!response.headersSent) sendJson(response, 500, { ok: false, message: 'internal error' })
    }
  }
}

/** Serialize one control-channel JSON response. */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

/** Read a request body, capped so a hostile body cannot pin the channel. */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16_384) {
        request.destroy()
        reject(new Error('request body too large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

class DshWebServer {
  #child: ChildProcessByStdio<null, Readable, Readable> | undefined

  constructor(private readonly onExit: () => void) {}

  async start(timeoutMs = STARTUP_TIMEOUT_MS): Promise<string> {
    if (this.#child) throw new Error('dsh web is already starting')

    const nodePath = resolveBundledNode()
    const dshBin = resolveDshBin()
    appendLog(`starting dsh web with ${nodePath}`)

    const nodeDir = path.dirname(nodePath)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_DESKTOP: '1',
      PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}`,
    }
    if (updateServer?.url) {
      env.DSH_DESKTOP_UPDATE_URL = updateServer.url
      env.DSH_DESKTOP_UPDATE_TOKEN = updateServer.token
    }
    delete env.ELECTRON_RUN_AS_NODE
    // Profile-installed auth or router plugins can write credential
    // references and endpoint overrides through the settings/credentials
    // services. Values inherited from the launching shell would shadow those
    // writes, so strip exactly the conflicting LLM plane and keep every other
    // variable (PATH, proxies, certificates, localization, debugging).
    for (const name of [
      'DEEPSEEK_API_KEY',
      'DEEPSEEK_BASE_URL',
      'DEEPSEEK_SEARCH_BASE_URL',
      'PENGUIN_API_HUB_KEY',
      // Legacy relay-key name from before the platform rename; a stale shell
      // value must not shadow the login write either.
      'EMA_POWERBANK_KEY',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
    ]) {
      Reflect.deleteProperty(env, name)
    }

    const child = spawn(nodePath, [dshBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: app.getPath('home'),
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#child = child

    return await new Promise((resolve, reject) => {
      let settled = false
      let timedOut = false
      let stdoutLines = 0
      let stderrLines = 0
      let lastOutputLine: string | undefined
      const readinessDiagnostics = (): string =>
        `stdoutLines=${stdoutLines}, stderrLines=${stderrLines}, lastOutput=${lastOutputLine ?? '(none)'}`
      const finish = (error: Error | undefined, url?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(url ?? '')
      }

      const timeout = setTimeout(() => {
        timedOut = true
        const diagnostics = readinessDiagnostics()
        appendLog(`dsh web readiness timeout: pid=${child.pid ?? 'unknown'}; ${diagnostics}; terminating process tree`)
        void terminateProcessTree(child).then((summary) => {
          finish(new Error(`Timed out waiting for dsh web readiness after ${timeoutMs}ms; ${diagnostics}; termination: ${summary}`))
        }).catch((error: unknown) => {
          finish(new Error(`Timed out waiting for dsh web readiness after ${timeoutMs}ms; ${diagnostics}; termination failed: ${describeError(error)}`))
        })
      }, timeoutMs)

      const handleOutput = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        for (const line of text.split(/\r?\n/)) {
          if (line.length > 0) {
            if (stream === 'stdout') stdoutLines += 1
            else stderrLines += 1
            lastOutputLine = `[dsh ${stream}] ${line}`
            appendLog(lastOutputLine)
          }
          const match = READY_RE.exec(line)
          if (match?.[1]) finish(undefined, match[1])
        }
      }

      child.stdout.on('data', (chunk: Buffer) => { handleOutput('stdout', chunk) })
      child.stderr.on('data', (chunk: Buffer) => { handleOutput('stderr', chunk) })
      child.once('error', (error) => {
        if (timedOut) return
        finish(error)
      })
      child.once('exit', (code, signal) => {
        this.#child = undefined
        this.onExit()
        if (!settled && !timedOut) {
          finish(new Error(`dsh web exited before readiness (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
        }
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.#child
    if (!child) return
    this.#child = undefined

    appendLog(`stopping dsh web process tree: pid=${child.pid ?? 'unknown'}`)
    appendLog(`dsh web stop: ${await terminateProcessTree(child)}`)
  }
}

async function createWindow(): Promise<void> {
  const windowIcon = resolveWindowIcon()
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'DeepSeek Harness',
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  }
  if (windowIcon) windowOptions.icon = windowIcon

  mainWindow = new BrowserWindow(windowOptions)

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
  // Window-open policy: same-origin pages and blank OAuth placeholders may
  // create child windows; every other target goes to the system browser. The
  // placeholder is created hidden so the gesture has no visible flash, and its
  // later external navigation is handed to the browser below.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalNavigation(url)) return { action: 'allow' }
    if (url === 'about:blank' || url === '') {
      return { action: 'allow', overrideBrowserWindowOptions: { show: false } }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Child OAuth placeholders get the same policy; an external navigation is
  // handed to the system browser and the placeholder closes, mirroring the
  // browser's new-tab login flow.
  mainWindow.webContents.on('did-create-window', (child) => {
    child.webContents.on('will-navigate', (event, url) => {
      if (isInternalNavigation(url) || url === 'about:blank' || url === '') return
      event.preventDefault()
      void shell.openExternal(url)
      child.close()
    })
    child.webContents.setWindowOpenHandler(({ url }) => {
      if (isInternalNavigation(url)) return { action: 'allow' }
      if (url === 'about:blank' || url === '') {
        return { action: 'allow', overrideBrowserWindowOptions: { show: false } }
      }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  await mainWindow.loadURL(loadingPage())

  // Register the shipped profile bundles (currently none) and install the
  // profile plugins from the registry before the dsh web child boots, so its
  // composition sees them from the first launch. Plugin install is fail-open:
  // a failure leaves the app usable and retries on the next launch.
  ensureShippedProfileBundles()
  const profilePluginBootstrap = await ensureProfilePlugins()

  if (readyUrl) {
    await mainWindow.loadURL(readyUrl)
    return
  }

  try {
    const nextServer = new DshWebServer(() => {
      if (server === nextServer) server = undefined
      readyUrl = undefined
      readyOrigin = undefined
    })
    server = nextServer
    const startupTimeoutMs = profilePluginBootstrap.managedPluginsPresent
      ? STARTUP_WITH_PROFILE_PLUGINS_TIMEOUT_MS
      : STARTUP_TIMEOUT_MS
    if (startupTimeoutMs !== STARTUP_TIMEOUT_MS) {
      appendLog(`dsh web startup timeout set to ${startupTimeoutMs}ms because managed profile plugins are present`)
    }
    const url = await nextServer.start(startupTimeoutMs)
    readyUrl = url
    readyOrigin = new URL(url).origin
    await mainWindow.loadURL(url)
  } catch (error) {
    const failedServer = server
    server = undefined
    readyUrl = undefined
    readyOrigin = undefined
    if (failedServer) void failedServer.stop().catch((stopError: unknown) => {
      const stopMessage = stopError instanceof Error ? stopError.stack ?? stopError.message : String(stopError)
      appendLog(`startup cleanup failed: ${stopMessage}`)
    })
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    appendLog(`startup failed: ${message}`)
    await mainWindow.loadURL(errorPage(`${message}${os.EOL}${os.EOL}Log: ${logPath()}`))
    dialog.showErrorBox('DeepSeek Harness failed to start', `${message}${os.EOL}${os.EOL}Log: ${logPath()}`)
  }
}

app.on('before-quit', (event) => {
  quitting = true
  if (updateServer) {
    const closing = updateServer
    updateServer = undefined
    void closing.stop().catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      appendLog(`control channel shutdown failed: ${message}`)
    })
  }
  if (quitAfterServerStop || !server) return

  event.preventDefault()
  const currentServer = server
  server = undefined
  readyUrl = undefined
  readyOrigin = undefined
  void currentServer.stop().finally(() => {
    quitAfterServerStop = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow && !quitting) void createWindow()
})

// The single-instance lock: one shell per user data directory. A second
// launch focuses the running window and exits instead of spawning another
// dsh web over the same $DSH_HOME, where concurrent profile/settings writes
// would race. macOS dock activation keeps re-creating the one window.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady()
    .then(async () => {
      // The control channel must be up before the dsh web child spawns, so
      // its plugin can reach the updater on the first status poll. A bind
      // failure only disables the update path; the app still starts.
      const engine = new DesktopUpdaterEngine()
      const control = new UpdateControlServer(engine)
      updateServer = control
      try {
        await control.start()
      } catch (error) {
        updateServer = undefined
        const message = error instanceof Error ? error.stack ?? error.message : String(error)
        appendLog(`control channel failed to start: ${message}`)
      }
      await createWindow()
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      appendLog(`app startup failed: ${message}`)
      dialog.showErrorBox('DeepSeek Harness failed to start', `${message}${os.EOL}${os.EOL}Log: ${logPath()}`)
    })
}
