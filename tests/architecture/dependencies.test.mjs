// The dependency rule, checked on the import statements of the sources: the domain imports only
// itself, the application only the domain, the adapters never each other, and only the extension
// entry imports the Copilot SDK.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm

const sourcesOf = async (dir) => (await readdir(join(ROOT, dir), { recursive: true }))
  .filter((file) => file.endsWith('.mjs') && !file.includes('vendor/'))
  .map((file) => join(dir, file))

const importsOf = async (file) => {
  const text = await readFile(join(ROOT, file), 'utf8')
  return [...text.matchAll(IMPORT)].map((match) => match[1] ?? match[2] ?? match[3])
    .map((target) => (target.startsWith('.') ? relative(ROOT, resolve(dirname(join(ROOT, file)), target)) : target))
}

const layerOf = (target) => (target.startsWith('node:') ? 'node' : target.split('/').slice(0, 2).join('/'))

const RULES = {
  'src/arazzo-domain': ['src/arazzo-domain'],
  'src/arazzo-application': ['src/arazzo-domain', 'src/arazzo-application'],
  'src/infrastructure': ['node', 'src/infrastructure'],
  'src/presentation': ['node', 'src/presentation'],
}

for (const [layer, allowed] of Object.entries(RULES)) {
  test(`${layer} only depends on ${allowed.join(', ')}`, async () => {
    const files = await sourcesOf(layer)
    assert.ok(files.length > 0)
    for (const file of files) {
      for (const target of await importsOf(file)) {
        assert.ok(allowed.includes(layerOf(target)), `${file} imports ${target}`)
      }
    }
  })
}

test('only the extension entry imports the Copilot SDK, and the plugin has no runtime dependency', async () => {
  const files = [...await sourcesOf('src'), 'com.github.copilot/extensions/arazzo-canvas/extension.mjs']
  const users = []
  for (const file of files) {
    const imports = await importsOf(file)
    if (imports.some((target) => target.startsWith('@github/copilot-sdk'))) users.push(file)
    assert.deepEqual(imports.filter((target) => !target.startsWith('node:') && !target.startsWith('src/') && !target.startsWith('@github/copilot-sdk')), [], file)
  }
  assert.deepEqual(users, ['com.github.copilot/extensions/arazzo-canvas/extension.mjs'])
})
