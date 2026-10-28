// The workspace adapters on real files: the Arazzo document, its API descriptions, the search, the
// preferences of the developer.
import assert from 'node:assert/strict'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { filePreferences, fileDocuments, fileSources, findArazzoDocuments } from '../../src/infrastructure/workspace.mjs'

const FIXTURE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))
const workspace = async () => {
  const root = await mkdtemp(join(tmpdir(), 'arazzo-'))
  await cp(FIXTURE, root, { recursive: true })
  return root
}

describe('Arazzo documents as workspace files', () => {
  test('reads the text of a document and writes a text back, creating its folders', async () => {
    const root = await workspace()
    const documents = fileDocuments({ root })
    const text = await documents.read('adopt.arazzo.yaml')
    assert.ok(text.startsWith('# Adopt a pet'), text)

    await documents.write('flows/new/order.arazzo.json', '{}\n')
    assert.equal(await readFile(join(root, 'flows/new/order.arazzo.json'), 'utf8'), '{}\n')
    assert.equal(await documents.read(join(root, 'flows/new/order.arazzo.json')), '{}\n')
  })

  test('reads no document where there is no file, and fails on a file it cannot read', async () => {
    const documents = fileDocuments({ root: await workspace() })
    assert.equal(await documents.read('missing.arazzo.yaml'), null)
    await assert.rejects(documents.read('apis'), { code: 'EISDIR' })
  })

  test('says in words why a document cannot be written', async () => {
    const root = await workspace()
    const documents = fileDocuments({ root })
    await chmod(root, 0o500)
    await assert.rejects(documents.write('adopt.arazzo.yaml', 'x'), { message: 'permission denied' })
    await chmod(root, 0o700)
    await assert.rejects(documents.write('apis', 'x'), { message: 'the file system refused it' })
  })

  test('tells when another tool changes the file, not when the canvas writes it', async () => {
    const root = await workspace()
    const documents = fileDocuments({ root, pollInterval: 20 })
    let changes = 0
    const stop = documents.watch('adopt.arazzo.yaml', () => changes++)
    await sleep(60)

    await documents.write('adopt.arazzo.yaml', 'arazzo: 1.0.1\n')
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

describe('API descriptions a document names', () => {
  test('reads a description next to the document', async () => {
    const root = await workspace()
    const read = await fileSources({ root }).load('adopt.arazzo.yaml', { url: 'apis/petstore.yaml' })
    assert.equal(read.state, 'read')
    assert.equal(read.description.paths['/pets'].get.operationId, 'findPets')
    assert.deepEqual(await fileSources({ root }).load('nested/doc.arazzo.yaml', { url: '../apis/petstore.yaml' }), read)
  })

  test('tells why a file cannot be read, without naming any path of the machine', async () => {
    const root = await workspace()
    await writeFile(join(root, 'apis/broken.yaml'), 'openapi: [3.0\n')
    await writeFile(join(root, 'apis/notes.yaml'), 'just some notes\n')
    await writeFile(join(root, 'apis/huge.yaml'), `openapi: 3.0.3\nx: "${'x'.repeat(5 * 1024 * 1024)}"\n`)
    await writeFile(join(root, 'apis/limit.yaml'), `x: "${'x'.repeat(5 * 1024 * 1024 - 7)}"\n`)
    const load = (url) => fileSources({ root }).load('adopt.arazzo.yaml', { url })
    assert.deepEqual(await load('apis/missing.yaml'), { state: 'not found' })
    assert.deepEqual(await load('apis'), { state: 'not found' })
    assert.deepEqual(await fileSources({ root }).load('adopt.arazzo.yaml', {}), { state: 'not found' })
    assert.deepEqual(await load('apis/broken.yaml'), { state: 'invalid' })
    assert.deepEqual(await load('apis/notes.yaml'), { state: 'read', description: 'just some notes' })
    assert.deepEqual(await load('apis/huge.yaml'), { state: 'too large' })
    assert.equal((await load('apis/limit.yaml')).state, 'read')
  })

  test('fetches a description over HTTP, and tells why it cannot', async () => {
    const answers = {
      '/openapi.json': [200, '{"openapi": "3.1.0", "paths": {}}'],
      '/missing.json': [404, ''],
      '/huge.yaml': [200, 'x'.repeat(5 * 1024 * 1024 + 1)],
    }
    const server = createServer((req, res) => {
      if (req.url === '/slow') return
      const [status, body] = answers[req.url]
      res.writeHead(status).end(body)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const sources = fileSources({ root: '/', timeout: 200 })
    try {
      assert.deepEqual(await sources.load('a.arazzo.yaml', { url: `${base}/openapi.json` }), { state: 'read', description: { openapi: '3.1.0', paths: {} } })
      assert.deepEqual(await sources.load('a.arazzo.yaml', { url: `${base}/missing.json` }), { state: 'unreachable', detail: 'HTTP 404' })
      assert.deepEqual(await sources.load('a.arazzo.yaml', { url: `${base}/huge.yaml` }), { state: 'too large' })
      assert.deepEqual(await sources.load('a.arazzo.yaml', { url: `${base}/slow` }), { state: 'unreachable', detail: 'no answer within 0.2 s' })
      assert.deepEqual(await sources.load('a.arazzo.yaml', { url: 'http://127.0.0.1:1/closed' }), { state: 'unreachable', detail: 'no answer' })
      const https = []
      await fileSources({ root: '/', fetch: async (url) => https.push(url) && { ok: true, text: async () => '{}' } }).load('a.yaml', { url: 'https://example.com/o.json' })
      assert.deepEqual(https, ['https://example.com/o.json'])
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  test('proposes the OpenAPI and Arazzo descriptions of the workspace, relative to the document', async () => {
    const root = await workspace()
    for (const [path, text] of [['apis/store.json', '{ "openapi": "3.1.0" }'], ['flows/other.arazzo.yaml', 'arazzo: 1.0.1\n'],
      ['apis/v2/swagger.yml', 'swagger: "2.0"\n'], ['apis/notes.yaml', 'title: notes\n'], ['apis/readme.md', 'openapi: 3\n'],
      ['node_modules/x/openapi.yaml', 'openapi: 3.0.0\n'], ['apis/huge.yaml', `openapi: 3.0.3\nx: "${'x'.repeat(5 * 1024 * 1024)}"\n`]]) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), text)
    }
    assert.deepEqual(await fileSources({ root }).candidates('flows/adopt.arazzo.yaml'),
      ['../adopt.arazzo.yaml', '../apis/petstore.yaml', '../apis/store.json', 'other.arazzo.yaml', '../apis/v2/swagger.yml'])
    assert.deepEqual(await fileSources({ root }).candidates('adopt.arazzo.yaml'),
      ['apis/petstore.yaml', 'apis/store.json', 'flows/other.arazzo.yaml', 'apis/v2/swagger.yml'])
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

describe('The choices of the developer', () => {
  test('are kept in the settings of the extension under the Copilot home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'copilot-home-'))
    const preferences = filePreferences({ home })
    assert.deepEqual(await preferences.read(), {})

    await preferences.write({ autosave: false })
    await preferences.write({ theme: 'dark' })

    assert.deepEqual(await filePreferences({ home }).read(), { autosave: false, theme: 'dark' })
    assert.equal(await readFile(join(home, 'extensions/arazzo-canvas/artifacts/settings.json'), 'utf8'), '{\n  "autosave": false,\n  "theme": "dark"\n}\n')
  })

  test('are forgotten when their file is not an object', async () => {
    const home = await mkdtemp(join(tmpdir(), 'copilot-home-'))
    await mkdir(join(home, 'extensions/arazzo-canvas/artifacts'), { recursive: true })
    for (const text of ['not json', '42', 'null']) {
      await writeFile(join(home, 'extensions/arazzo-canvas/artifacts/settings.json'), text)
      assert.deepEqual(await filePreferences({ home }).read(), {}, text)
    }
  })
})
