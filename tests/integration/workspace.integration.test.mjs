// The workspace adapters on real files: the Arazzo document, its OpenAPI descriptions, the search.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fileDocuments, fileSources, findArazzoDocuments } from '../../src/infrastructure/workspace.mjs'

const FIXTURE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))
const workspace = async () => {
  const root = await mkdtemp(join(tmpdir(), 'arazzo-'))
  await cp(FIXTURE, root, { recursive: true })
  return root
}

describe('Arazzo documents as workspace files', () => {
  test('reads a YAML document and writes it back as YAML', async () => {
    const root = await workspace()
    const documents = fileDocuments({ root })
    const document = await documents.read('adopt.arazzo.yaml')
    assert.equal(document.workflows[0].steps[0].outputs.petId, '$response.body#/0/id')

    document.workflows[0].summary = `${'Adopt a pet, a very long summary '.repeat(5)}end`
    await documents.write('adopt.arazzo.yaml', document)

    const text = await readFile(join(root, 'adopt.arazzo.yaml'), 'utf8')
    assert.ok(text.startsWith('arazzo: 1.0.1\ninfo:\n  title: Adopt a pet\n'), text)
    assert.ok(text.includes(`    summary: ${document.workflows[0].summary}`), 'long lines are not folded')
    assert.deepEqual(await documents.read('adopt.arazzo.yaml'), document)
  })

  test('writes a JSON document as JSON, creating its folders', async () => {
    const root = await workspace()
    const documents = fileDocuments({ root })
    await documents.write('flows/new/order.arazzo.json', { arazzo: '1.0.1' })
    assert.equal(await readFile(join(root, 'flows/new/order.arazzo.json'), 'utf8'), '{\n  "arazzo": "1.0.1"\n}\n')
    assert.deepEqual(await documents.read(join(root, 'flows/new/order.arazzo.json')), { arazzo: '1.0.1' })
  })

  test('reads no document where there is no file', async () => {
    assert.equal(await fileDocuments({ root: await workspace() }).read('missing.arazzo.yaml'), null)
  })

  test('refuses a file that holds no document', async () => {
    const root = await workspace()
    await writeFile(join(root, 'broken.yaml'), 'arazzo: [1.0\n')
    await writeFile(join(root, 'list.yaml'), '- a\n')
    await writeFile(join(root, 'empty.yaml'), '')
    await writeFile(join(root, 'text.yaml'), 'just some text\n')
    const documents = fileDocuments({ root })
    await assert.rejects(documents.read('broken.yaml'), { name: 'UnreadableDocument', message: /^broken\.yaml is neither YAML nor JSON: [^\n]{20,}$/ })
    await assert.rejects(documents.read('text.yaml'), { message: 'text.yaml does not hold an object' })
    await assert.rejects(documents.read('list.yaml'), { name: 'UnreadableDocument', message: 'list.yaml does not hold an object' })
    await assert.rejects(documents.read('empty.yaml'), { message: 'empty.yaml does not hold an object' })
    await assert.rejects(documents.read('apis'), { code: 'EISDIR' })
  })

  test('tells when another tool changes the file, not when the canvas writes it', async () => {
    const root = await workspace()
    const documents = fileDocuments({ root, pollInterval: 20 })
    let changes = 0
    const stop = documents.watch('adopt.arazzo.yaml', () => changes++)
    await sleep(60)

    await documents.write('adopt.arazzo.yaml', { arazzo: '1.0.1' })
    await sleep(150)
    assert.equal(changes, 0)

    await writeFile(join(root, 'adopt.arazzo.yaml'), 'arazzo: 1.0.0\n')
    await sleep(150)
    assert.equal(changes, 1)

    stop()
    await writeFile(join(root, 'adopt.arazzo.yaml'), 'arazzo: 1.0.2\n')
    await sleep(150)
    assert.equal(changes, 1)
  })

  test('does not tell a change of a file that disappears', async () => {
    const root = await workspace()
    const documents = fileDocuments({ root, pollInterval: 20 })
    let changes = 0
    const stop = documents.watch('later.arazzo.yaml', () => changes++)
    await sleep(60)
    assert.equal(changes, 0)
    await writeFile(join(root, 'later.arazzo.yaml'), 'arazzo: 1.0.1\n')
    await sleep(150)
    assert.equal(changes, 1)
    await rm(join(root, 'later.arazzo.yaml'))
    await sleep(150)
    stop()
    assert.equal(changes, 1)
  })
})

describe('OpenAPI descriptions a document names', () => {
  test('reads a description next to the document', async () => {
    const root = await workspace()
    const openapi = await fileSources({ root }).load('adopt.arazzo.yaml', { url: 'apis/petstore.yaml' })
    assert.equal(openapi.paths['/pets'].get.operationId, 'findPets')
    const again = await fileSources({ root }).load('nested/doc.arazzo.yaml', { url: '../apis/petstore.yaml' })
    assert.deepEqual(again, openapi)
  })

  test('fetches a description over HTTP', async () => {
    const calls = []
    const fetch = async (url, options) => {
      calls.push([url, options.signal instanceof AbortSignal])
      return { ok: true, text: async () => '{"openapi": "3.1.0", "paths": {}}' }
    }
    const openapi = await fileSources({ root: '/', fetch }).load('a.arazzo.yaml', { url: 'https://example.com/openapi.json' })
    assert.deepEqual(openapi, { openapi: '3.1.0', paths: {} })
    assert.deepEqual(calls, [['https://example.com/openapi.json', true]])
    await fileSources({ root: '/', fetch }).load('a.arazzo.yaml', { url: 'http://example.com/o.yaml' })
    assert.equal(calls.length, 2)
  })

  test('says why a description cannot be read', async () => {
    const fetch = async () => ({ ok: false, status: 404 })
    await assert.rejects(fileSources({ root: '/', fetch }).load('a.yaml', { url: 'https://example.com/missing.json' }), { message: 'HTTP 404' })
    await assert.rejects(fileSources({ root: await workspace() }).load('a.yaml', {}), { code: 'EISDIR' })
    const slow = (_url, { signal }) => new Promise((_resolve, reject) => {
      const alive = setTimeout(() => {}, 5000)
      signal.addEventListener('abort', () => reject(signal.reason, clearTimeout(alive)))
    })
    await assert.rejects(fileSources({ root: '/', fetch: slow, timeout: 10 }).load('a.yaml', { url: 'https://example.com/slow' }), { name: 'TimeoutError' })
  })
})

describe('Arazzo documents of a workspace', () => {
  test('finds them nearest first, skipping dependencies and hidden folders', async () => {
    const root = await workspace()
    for (const path of ['a/deep/far.arazzo.yaml', 'z/one.arazzo.yml', 'z/deep/a/b/too-deep.arazzo.yaml', 'node_modules/x.arazzo.yaml',
      'dist/x.arazzo.yaml', 'build/x.arazzo.yaml', 'target/x.arazzo.yaml', '.github/y.arazzo.yaml', 'b.arazzo.json', 'openapi.yaml',
      'old.arazzo.yaml.bak', 'z/deep/a/found.arazzo.yaml', 'b/near.arazzo.yaml']) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), '{}')
    }
    assert.deepEqual(await findArazzoDocuments(root), [
      'adopt.arazzo.yaml', 'b.arazzo.json', 'b/near.arazzo.yaml', 'z/one.arazzo.yml', 'a/deep/far.arazzo.yaml', 'z/deep/a/found.arazzo.yaml',
    ])
    assert.deepEqual(await findArazzoDocuments(join(root, 'missing')), [])
  })
})
