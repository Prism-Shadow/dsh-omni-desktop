/**
 * Stamp a desktop release tag into the workspace-root manifest.
 *
 * The desktop staging script records the workspace-root version into the staged
 * app manifest, which electron-builder reads for installer metadata. Desktop
 * distribution tags are allowed to move independently from upstream harness
 * package versions, so this script only stamps the private workspace-root
 * manifest used by staging.
 *
 * The npm release line owns the public package versions it publishes. Do not
 * require those upstream package versions to match the desktop installer tag.
 *
 * Environment: TAG (required).
 */

import fs from 'node:fs'

const tag = process.env.TAG ?? ''
const manifestPath = 'package.json'

if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(tag)) {
  console.error(`error: release tag must start with v followed by an alphanumeric: ${tag}`)
  process.exit(1)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const version = tag.slice(1)
const manifest = readJson(manifestPath)
if (typeof manifest.version !== 'string' || manifest.version === '') {
  console.error(`error: ${manifestPath} has no string version field.`)
  process.exit(1)
}

if (manifest.version === version) {
  console.log(`Workspace-root version already ${version} for ${tag}.`)
  process.exit(0)
}

console.log(`Stamping workspace-root version ${manifest.version} -> ${version} for desktop tag ${tag}.`)
manifest.version = version
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Stamped workspace-root version ${version} for ${tag}.`)
