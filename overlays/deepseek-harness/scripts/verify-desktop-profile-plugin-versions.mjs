import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const desktopMainPath = path.join(repoRoot, 'apps/desktop/src/main.ts')

const plugins = [
  {
    name: '@prismshadow/dsh-deepseek-eyes',
    packageJsonPath: 'plugins/dsh-deepseek-eyes/package.json',
  },
  {
    name: '@prismshadow/dsh-penguin-llm-router',
    packageJsonPath: 'plugins/dsh-penguin-llm-router/package.json',
  },
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const desktopMain = fs.readFileSync(desktopMainPath, 'utf8')
const errors = []

for (const plugin of plugins) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, plugin.packageJsonPath), 'utf8'))
  const expectedVersion = `^${packageJson.version}`
  const entryPattern = new RegExp(
    String.raw`\{\s*name:\s*['"]${escapeRegExp(plugin.name)}['"]\s*,\s*version:\s*['"]([^'"]+)['"]\s*\}`,
  )
  const match = desktopMain.match(entryPattern)

  if (match === null) {
    errors.push(`${plugin.name} is missing from PROFILE_PLUGINS`)
    continue
  }

  const actualVersion = match[1]
  if (actualVersion !== expectedVersion) {
    errors.push(`${plugin.name} desktop version is ${actualVersion}, expected ${expectedVersion}`)
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`)
  }
  process.exit(1)
}

console.log('Desktop profile plugin versions match plugin package versions.')
