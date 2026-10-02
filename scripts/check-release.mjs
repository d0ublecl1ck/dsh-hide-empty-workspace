#!/usr/bin/env node
/**
 * Release readiness check for this bundle.
 *
 * Offline on purpose: no network, no credentials, no build. It answers the
 * questions a release keeps getting wrong by hand — is the manifest complete,
 * do the entry points still resolve, does the browser half only require
 * platform-seed modules, and does the client module id still match the package
 * name (the Loader keys everything off it).
 *
 * Every failure names the file and the fix. Usage: `npm run check-release`.
 *
 * @module dsh-hide-empty-workspace/scripts/check-release
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []
const passes = []
const fail = (message) => failures.push(message)
const pass = (message) => passes.push(message)
const read = (path) => readFileSync(join(root, path), 'utf8')
const exists = (path) => existsSync(join(root, path))

/** The Web shell's platform module table; nothing outside it can be required. */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

// 1. Manifest completeness.
const pkg = JSON.parse(read('package.json'))
if (typeof pkg.name !== 'string' || !pkg.name.startsWith('dsh-')) fail('package.json: name must keep the dsh- prefix')
else pass('name: ' + pkg.name + '@' + pkg.version)
if (!/^\d+\.\d+\.\d+$/.test(String(pkg.version))) fail('package.json: version must be plain semver')
if ('private' in pkg) fail('package.json: drop "private" or the package can never be published')
if (typeof pkg.description !== 'string' || pkg.description.length < 20) fail('package.json: description is required and must say what the plugin does')
if (!Array.isArray(pkg.keywords) || pkg.keywords.length < 4) fail('package.json: keywords are how the package is found; list at least 4')
if (typeof pkg.repository?.url !== 'string' || !pkg.repository.url.includes('github.com')) fail('package.json: repository.url is required for a publishable package')
else pass('repository: ' + pkg.repository.url)
if (typeof pkg.homepage !== 'string') fail('package.json: homepage is required')
for (const file of pkg.files ?? []) if (!exists(file)) fail('package.json files lists a missing path: ' + file)
const patch = pkg.dsh?.bundle?.patch
if (typeof patch !== 'string' || !exists(patch)) fail('package.json: dsh.bundle.patch is missing or points at nothing (a package without it installs as a plain dependency)')
else if (!(pkg.files ?? []).some((file) => file.includes('cordis.patch.yml'))) fail('package.json files must include cordis.patch.yml, or a published tarball drops the layer')
else pass('bundle patch: ' + patch)
if (pkg.dsh?.client?.platform !== 'web') fail('package.json: dsh.client.platform must be "web"')
if (!Array.isArray(pkg.dsh?.client?.inject) || pkg.dsh.client.inject.length === 0) fail('package.json: dsh.client.inject must list the client modules this half registers into')

// 2. Entry points actually exist and are exported.
const entry = typeof pkg.main === 'string' ? pkg.main : pkg.exports?.['.']?.default
const clientEntry = pkg.exports?.['./client']?.default ?? pkg.exports?.['./client']
if (typeof entry !== 'string' || !exists(entry)) fail('package.json: main/exports["."] does not resolve to a file')
if (typeof clientEntry !== 'string' || !exists(clientEntry)) fail('package.json: exports["./client"] does not resolve to a file')
for (const doc of ['README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE', 'AGENTS.md']) {
  if (!exists(doc)) fail('missing release document: ' + doc)
}

// 3. Host entry keeps the named-export contract the Loader needs.
const host = read(entry)
if (!/export\s+function\s+apply\s*\(/.test(host)) fail(entry + ': must export a named apply(ctx) function')

// 4. Browser half: module id, and only platform-seed requires.
const client = read(clientEntry)
const idMatch = client.match(/id:\s*'([^']+)'/)
if (idMatch === null) fail(clientEntry + ': window.__ModuleLoader__.load({ id }) not found')
else if (idMatch[1] !== pkg.name) fail(clientEntry + ': module id "' + idMatch[1] + '" must equal the package name "' + pkg.name + '"')
else pass('client module id: ' + idMatch[1])
const required = [...client.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((match) => match[1])
const foreign = required.filter((name) => !PLATFORM_MODULES.has(name))
if (foreign.length > 0) fail(clientEntry + ': requires modules outside the platform seed: ' + foreign.join(', ') + ' (resolve them at build time or drop them)')
else if (required.length > 0) pass('client requires only platform-seed modules: ' + [...new Set(required)].join(', '))

// 5. Test files exist for the behaviour the manifest claims to ship.
const testScript = pkg.scripts?.test ?? ''
if (testScript === '') fail('package.json: a test script is required')
for (const file of testScript.match(/[\w./-]+\.mjs/g) ?? []) {
  if (!exists(file)) fail('package.json test script points at a missing file: ' + file)
}

// 6. The manifest and the changelog must agree on what is about to ship. Bumping
// one and forgetting the other is invisible until a tag or a publish goes out —
// 0.3.0 landed in CHANGELOG.md while package.json still said 0.2.0, and this gate
// had nothing to say about it.
const changelog = exists('CHANGELOG.md') ? read('CHANGELOG.md') : ''
const newest = changelog.match(/^## (\d+\.\d+\.\d+)/m)
if (newest === null) fail('CHANGELOG.md: no "## <x.y.z>" section to compare package.json against')
else if (newest[1] !== pkg.version) fail('version drift: package.json says ' + pkg.version + ' but the newest CHANGELOG.md section is ' + newest[1])
else pass('version matches the newest CHANGELOG.md section: ' + pkg.version)

console.log('check-release: ' + root)
for (const message of passes) console.log('  ok    ' + message)
for (const message of failures) console.log('  FAIL  ' + message)
console.log('')
if (failures.length > 0) {
  console.log(failures.length + ' problem(s); not release-ready')
  process.exitCode = 1
} else {
  console.log('release-ready (' + passes.length + ' checks)')
}
