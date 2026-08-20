/**
 * Stamp a desktop release tag into the workspace-root manifest.
 *
 * The desktop staging script records the workspace-root version into the staged
 * app manifest, which electron-builder reads for installer metadata. Tag-triggered
 * runs require the tag to match that version, so a tag of an unbumped repo fails
 * before any installer is built; manual dispatches warn and continue, keeping
 * retries of legacy tags possible.
 *
 * The npm release line owns the package versions it publishes. This script checks
 * the public dsh-family package versions, then only patches the private workspace
 * root, which no registry consumer can see.
 *
 * Environment: TAG (required), EVENT_NAME (optional; `push` makes the version
 * match a hard requirement).
 */

import fs from 'node:fs'
import path from 'node:path'

const tag = process.env.TAG ?? ''
const requireMatch = process.env.EVENT_NAME === 'push'
const manifestPath = 'package.json'
const workspaceRoots = ['apps', 'packages']

if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(tag)) {
  console.error(`error: release tag must start with v followed by an alphanumeric: ${tag}`)
  process.exit(1)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function childDirs(parent) {
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(parent, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

function publicDshManifests() {
  const manifests = []
  for (const root of workspaceRoots) {
    for (const entry of childDirs(root)) {
      const directManifest = path.join(entry, 'package.json')
      if (fs.existsSync(directManifest)) manifests.push(directManifest)
      if (root === 'packages') {
        for (const child of childDirs(entry)) {
          const manifest = path.join(child, 'package.json')
          if (fs.existsSync(manifest)) manifests.push(manifest)
        }
      }
    }
  }
  return manifests
}

function reportMismatch(message) {
  if (requireMatch) {
    console.error(`error: ${message}`)
    process.exitCode = 1
  } else {
    console.warn(`warning: ${message} (continuing: manual dispatch)`)
  }
}

const version = tag.slice(1)
const manifest = readJson(manifestPath)
if (typeof manifest.version !== 'string' || manifest.version === '') {
  console.error(`error: ${manifestPath} has no string version field.`)
  process.exit(1)
}

for (const packageManifestPath of publicDshManifests()) {
  const packageManifest = readJson(packageManifestPath)
  if (packageManifest.private === true) continue
  if (typeof packageManifest.name !== 'string' || !packageManifest.name.startsWith('@deepseek-ai/')) continue
  if (packageManifest.version !== version) {
    reportMismatch(`${packageManifestPath} version ${packageManifest.version ?? '<missing>'} does not match ${tag}`)
  }
}
if (process.exitCode) process.exit(process.exitCode)

if (manifest.version === version) {
  console.log(`Workspace-root version already ${version} for ${tag}.`)
  process.exit(0)
}

const message = `tag ${tag} does not match the repo version ${manifest.version}; ` +
  'bump the workspace-root version during release prep, then re-tag.'
if (requireMatch) {
  console.error(`error: ${message}`)
  process.exit(1)
}
console.warn(`warning: ${message} (continuing: manual dispatch)`)

manifest.version = version
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Stamped workspace-root version ${version} for ${tag}.`)
