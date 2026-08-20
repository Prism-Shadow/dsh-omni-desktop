import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(pkgDir, '..', '..')
const stageDir = path.join(pkgDir, 'stage')
const appDir = path.join(stageDir, 'app')
const nodeDir = path.join(stageDir, 'node')
const npmDir = path.join(stageDir, 'npm')

function assertInside(parent, child) {
  const relative = path.relative(parent, child)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to operate outside ${parent}: ${child}`)
  }
}

function run(command, args, options = {}) {
  const isWindows = process.platform === 'win32'
  const executable = isWindows && command === 'pnpm' ? process.execPath : command
  const commandArgs =
    isWindows && command === 'pnpm'
      ? [resolveCorepack(), 'pnpm', ...args]
      : args
  execFileSync(
    executable,
    commandArgs,
    {
      cwd: options.cwd ?? repoRoot,
      stdio: options.stdio ?? 'inherit',
      env: Object.fromEntries(
        Object.entries({ ...process.env, CI: process.env.CI ?? 'true', ...options.env }).filter(
          ([key]) => !key.toLowerCase().startsWith('npm_config_'),
        ),
      ),
    },
  )
}

function resolveCorepack() {
  const adjacent = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  if (fs.existsSync(adjacent)) return adjacent

  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, 'node_modules', 'corepack', 'dist', 'corepack.js')
    if (fs.existsSync(candidate)) return candidate
  }

  throw new Error('Could not find corepack on PATH')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function slashPath(value) {
  return value.replaceAll(path.sep, '/')
}

function fileSpec(fromDir, file) {
  return `file:${slashPath(path.relative(fromDir, file))}`
}

function tarballName(packageName, version) {
  const unscoped = packageName.startsWith('@') ? packageName.slice(1).replace('/', '-') : packageName
  return `${unscoped}-${version}.tgz`
}

function childDirs(parent) {
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(parent, entry.name))
}

function packageDirs() {
  const dirs = []
  for (const parent of ['apps', 'vendor']) dirs.push(...childDirs(path.join(repoRoot, parent)))

  for (const groupDir of childDirs(path.join(repoRoot, 'packages'))) dirs.push(...childDirs(groupDir))
  dirs.push(...childDirs(path.join(repoRoot, 'native', 'landlock-run', 'packages')))

  return dirs
}

function hasLauncherBinary(dir) {
  return fs.existsSync(path.join(dir, 'bin', 'landlock-run'))
}

function shouldPackLocalPackage(dir, manifest) {
  if (manifest.private === true) return false
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return false
  if (!manifest.name.startsWith('@deepseek-ai/')) return false

  if (manifest.name.startsWith('@deepseek-ai/node-addon-landlock-run-linux-') && !hasLauncherBinary(dir)) {
    console.log(`[desktop:stage] skip ${manifest.name}: no built landlock-run binary`)
    return false
  }

  return true
}

function packLocalTarballs() {
  const tarballs = new Map()
  let packed = 0
  for (const dir of packageDirs().sort((left, right) => left.localeCompare(right))) {
    const manifestPath = path.join(dir, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const manifest = readJson(manifestPath)
    if (!shouldPackLocalPackage(dir, manifest)) continue

    const filename = tarballName(manifest.name, manifest.version)
    packed += 1
    console.log(`[desktop:stage] pack ${packed}: ${manifest.name}`)
    run('pnpm', [
      '--dir',
      slashPath(path.relative(repoRoot, dir)),
      'pack',
      '--pack-destination',
      npmDir,
    ], { stdio: 'ignore' })

    const tarball = path.join(npmDir, filename)
    if (!fs.existsSync(tarball)) throw new Error(`${manifest.name} produced no tarball at ${tarball}`)
    tarballs.set(manifest.name, tarball)
  }
  return tarballs
}

function copyCurrentNodeRuntime() {
  fs.mkdirSync(nodeDir, { recursive: true })
  if (process.platform === 'win32') {
    fs.copyFileSync(process.execPath, path.join(nodeDir, 'node.exe'))
    return path.join(nodeDir, 'node.exe')
  }

  const binDir = path.join(nodeDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  const nodePath = path.join(binDir, 'node')
  fs.copyFileSync(process.execPath, nodePath)
  fs.chmodSync(nodePath, 0o755)
  return nodePath
}

function copyNodeRuntime() {
  const override = process.env.DSH_DESKTOP_NODE_DIR
  if (!override) return copyCurrentNodeRuntime()

  const resolved = path.resolve(override)
  if (!fs.existsSync(resolved)) throw new Error(`DSH_DESKTOP_NODE_DIR does not exist: ${resolved}`)
  fs.cpSync(resolved, nodeDir, { recursive: true, dereference: true })
  return process.platform === 'win32'
    ? path.join(nodeDir, 'node.exe')
    : path.join(nodeDir, 'bin', 'node')
}

/**
 * Replace the single-architecture Node copy with one runtime per architecture.
 *
 * electron-builder packages both arm64 and x64 from the one staged tree on macOS,
 * so the installer for each architecture must carry the matching Node runtime; the
 * runner's own node binary is exactly one of the two. Download both official
 * tarballs at the runner's version and lay them out as node/<arch>/bin/node, which
 * apps/desktop/src/main.ts resolves by process.arch. The flat bin/node copy is
 * removed so the shared staged tree carries only the two target runtimes.
 */
function bundleDarwinNodeRuntimes(currentNodePath) {
  const version = execFileSync(currentNodePath, ['--version'], { encoding: 'utf8' }).trim()
  if (!/^v\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Unexpected node --version output: ${version}`)
  }

  const archivesDir = path.join(stageDir, '.node-archives')
  fs.mkdirSync(archivesDir, { recursive: true })
  try {
    for (const arch of ['arm64', 'x64']) {
      const name = `node-${version}-darwin-${arch}`
      const archivePath = path.join(archivesDir, `${name}.tar.gz`)
      execFileSync('curl', [
        '--proto', '=https', '--tlsv1.2', '-fsSL',
        `https://nodejs.org/dist/${version}/${name}.tar.gz`,
        '-o', archivePath,
      ], { stdio: 'inherit' })

      const archDir = path.join(nodeDir, arch)
      fs.rmSync(archDir, { recursive: true, force: true })
      fs.mkdirSync(archDir, { recursive: true })
      execFileSync('tar', ['-xzf', archivePath, '-C', archDir, '--strip-components', '1'], { stdio: 'inherit' })

      const nodeBin = path.join(archDir, 'bin', 'node')
      if (!fs.existsSync(nodeBin)) throw new Error(`${name} produced no bin/node at ${nodeBin}`)
      fs.chmodSync(nodeBin, 0o755)
      // A foreign-architecture binary cannot execute on the staging machine (an
      // arm64 node does not run on Intel), so only the native architecture gets
      // the version check; the other one is verified to be a non-empty file.
      if (arch === process.arch) {
        execFileSync(nodeBin, ['--version'], { stdio: 'inherit' })
      } else if (fs.statSync(nodeBin).size === 0) {
        throw new Error(`${name} produced an empty bin/node at ${nodeBin}`)
      }
    }
  } finally {
    fs.rmSync(archivesDir, { recursive: true, force: true })
  }

  fs.rmSync(path.join(nodeDir, 'bin'), { recursive: true, force: true })
}

function writeStagedWorkspaceConfig(overrides) {
  const overrideLines = Object.entries(overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
  const subprocessLocalSpec = overrides['@deepseek-ai/dsh-subprocess-local']
  const subprocessLocalBuild = subprocessLocalSpec
    ? [`  ${JSON.stringify(`@deepseek-ai/dsh-subprocess-local@${subprocessLocalSpec}`)}: true`]
    : []

  fs.writeFileSync(
    path.join(appDir, 'pnpm-workspace.yaml'),
    [
      'packages:',
      '  - .',
      'overrides:',
      ...overrideLines,
      'allowBuilds:',
      '  esbuild: true',
      '  node-pty: true',
      '  koffi: true',
      "  '@deepseek-ai/dsh-subprocess-local': true",
      ...subprocessLocalBuild,
      "  '@google/genai': false",
      '  protobufjs: false',
      '  node-addon-require-builtin: false',
      '',
    ].join('\n'),
  )
}

function resolveFrom(packageJsonPath, specifier) {
  return createRequire(packageJsonPath).resolve(specifier)
}

assertInside(pkgDir, stageDir)
fs.rmSync(stageDir, { recursive: true, force: true })
fs.mkdirSync(appDir, { recursive: true })
fs.mkdirSync(npmDir, { recursive: true })

console.log('[desktop:stage] packing local npm tarballs')
const tarballs = packLocalTarballs()
const dshTarball = tarballs.get('@deepseek-ai/dsh')
if (!dshTarball) throw new Error('Missing packed @deepseek-ai/dsh tarball')

const rootManifest = readJson(path.join(repoRoot, 'package.json'))
const overrides = Object.fromEntries(
  [...tarballs.entries()].map(([name, tarball]) => [name, fileSpec(appDir, tarball)]),
)

/**
 * Extra registry-only dependencies shipped in the app. These are NOT packed
 * from the workspace: `pnpm install` fetches them from the registry when the
 * staged tree is installed. The desktop shell's first-launch plugin bootstrap
 * runs `dsh plugin add`, which spawns `pnpm` on PATH, so the packaged app
 * carries a bundled pnpm for that nested install. Profile plugins
 * (@prismshadow/dsh-deepseek-eyes, @prismshadow/dsh-penguin-llm-router) are
 * intentionally not bundled: they install from the registry into the user
 * profile at first launch and update independently via `dsh plugin update`.
 */
const EXTRA_APP_DEPENDENCIES = {
  pnpm: '^11.7.0',
}

const dependencies = {
  ...Object.fromEntries([...Object.entries(overrides)].sort(([left], [right]) => left.localeCompare(right))),
  ...EXTRA_APP_DEPENDENCIES,
  'electron-updater': '^6.8.9',
}

fs.cpSync(path.join(pkgDir, 'lib'), path.join(appDir, 'lib'), { recursive: true })
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'deepseek-harness-desktop',
      version: rootManifest.version,
      productName: 'DeepSeek Harness',
      description: 'DeepSeek Harness desktop shell.',
      author: 'DeepSeek',
      private: true,
      type: 'module',
      main: 'lib/main.js',
      homepage: 'https://github.com/Prism-Shadow/dsh-omni-desktop',
      dependencies,
    },
    null,
    2,
  )}\n`,
)
writeStagedWorkspaceConfig(overrides)

console.log('[desktop:stage] installing staged runtime dependencies')
run('pnpm', ['install', '--prod', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'], { cwd: appDir })
fs.rmSync(path.join(appDir, 'pnpm-workspace.yaml'), { force: true })
fs.rmSync(path.join(appDir, 'pnpm-lock.yaml'), { force: true })

const nodePath = copyNodeRuntime()
execFileSync(nodePath, ['--version'], { stdio: 'inherit' })
if (process.platform === 'darwin') bundleDarwinNodeRuntimes(nodePath)

const dshPackagePath = path.join(appDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const dshBasePackagePath = resolveFrom(dshPackagePath, '@deepseek-ai/dsh-base/package.json')
const sandboxLocalPackagePath = resolveFrom(dshBasePackagePath, '@deepseek-ai/dsh-sandbox-local/package.json')
const landlockPackagePath = resolveFrom(sandboxLocalPackagePath, '@deepseek-ai/node-addon-landlock-run/package.json')
const webAppPackagePath = resolveFrom(dshPackagePath, '@deepseek-ai/dsh-web-app/package.json')
const webFrontendPackagePath = resolveFrom(webAppPackagePath, '@deepseek-ai/dsh-web-frontend/package.json')

const requiredFiles = [
  ['desktop main', path.join(appDir, 'lib', 'main.js')],
  ['dsh package', dshPackagePath],
  ['dsh CLI entry', path.join(path.dirname(dshPackagePath), 'lib', 'bin.js')],
  ['landlock package', landlockPackagePath],
  ['web app package', webAppPackagePath],
  ['web frontend index', path.join(path.dirname(webFrontendPackagePath), 'dist', 'index.html')],
]

for (const [label, file] of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${label}: ${file}. Run pnpm --workspace-root run build first.`)
  }
}

console.log('[desktop:stage] done:', appDir)
