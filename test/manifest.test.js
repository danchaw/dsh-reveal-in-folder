import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

test('every entry in files exists on disk', () => {
  for (const entry of pkg.files) {
    if (entry.includes('*')) continue
    assert.ok(existsSync(path.join(root, entry)), `missing ${entry}`)
  }
})

test('exports resolve to real modules', () => {
  for (const [specifier, target] of Object.entries(pkg.exports)) {
    if (specifier.includes('*') || target.includes('*')) continue
    assert.ok(existsSync(path.join(root, target)), `${specifier} -> ${target} is missing`)
  }
  assert.equal(pkg.main, 'lib/index.js')
})

test('icon is declared, local, and small enough', () => {
  const icon = pkg.exports['./icon']
  assert.equal(icon, pkg.icon)
  assert.ok(!path.isAbsolute(icon) && !icon.includes('..'), 'icon must stay inside the package')
  const bytes = statSync(path.join(root, icon)).size
  assert.ok(bytes > 0 && bytes <= 256 * 1024, `icon is ${bytes} bytes`)
})

test('bundle metadata exists in every shipped language, with the same keys', () => {
  const en = JSON.parse(read('locale/en.json'))
  const zh = JSON.parse(read('locale/zh.json'))
  const keys = (value) => Object.keys(value.meta).sort().join(',')
  assert.equal(keys(en), keys(zh))
  for (const locale of [en, zh]) {
    assert.ok(locale.meta.title.length > 0)
    assert.ok(locale.meta.description.length > 0)
  }
})

test('the patch inserts this package under a namespaced id', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /- insert:\n {4}- id: reveal-in-folder\n {6}name: dsh-reveal-in-folder/)
  assert.ok(pkg.dsh.bundle.patch.startsWith('./'), 'bundle patch must be a package-local path')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0)
})

test('the client half is a module-loader bundle with no host-side surface', () => {
  const client = read('lib/client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{\s*\n\s*id: 'dsh-reveal-in-folder'/)
  assert.match(client, /ctx\.slots\.inject\('conversation\.chat\.turnTail'/)
  assert.match(client, /ctx\.uiConversation\.events\.register\(/)
  assert.match(client, /react\.createElement/)
  // Reveal goes through the single Host entry point, never through local plumbing.
  assert.match(client, /openWorkspacePath\(\{ path, action: 'reveal' \}\)/)
  assert.match(client, /canOpenWorkspacePath\(\)/)
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'execFile', 'child_process', 'require(\'fs']) {
    assert.ok(!client.includes(forbidden), `client must not use ${forbidden}`)
  }
})

test('the host half stays empty', () => {
  assert.equal(typeof apply, 'function')
  assert.equal(apply.length, 0)
  assert.equal(apply(), undefined)
})

test('the bundle ships no runtime dependencies', () => {
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.peerDependencies, undefined)
})
