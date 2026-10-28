// features/api-descriptions.feature, through the studio use cases.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { adoptDocument, PATH, petstore, studioOn } from '../support/studio-world.mjs'

const store = () => ({ openapi: '3.1.0', info: { title: 'Store', version: '1' }, paths: { '/stock': { get: { operationId: 'getStock' } } } })

/** The adopt document describing petstore from apis/petstore.yaml, its three steps calling it. */
const opened = async ({ edit = () => {}, prepare = () => {} } = {}) => {
  const world = studioOn()
  world.sources.apis.clear()
  world.sources.apis.set('apis/petstore.yaml', petstore())
  const document = adoptDocument({ steps: ['findPets', 'getPet', 'placeOrder'] })
  document.sourceDescriptions[0].url = 'apis/petstore.yaml'
  edit(document)
  prepare(world.sources)
  world.documents.put(PATH, document)
  await world.studio.open({ path: PATH })
  return world
}

const PETSTORE = { name: 'petstore', url: 'apis/petstore.yaml', type: 'openapi', state: 'read', operations: 3 }

describe('Describe the APIs a workflow calls', () => {
  test('See the APIs of the document', async () => {
    const { studio } = await opened()
    assert.deepEqual(studio.view().sources, [PETSTORE])
    assert.deepEqual(studio.view().problems, [])
  })

  test('Add an API that can be read', async () => {
    const { studio, sources, documents } = await opened()
    sources.apis.set('apis/store.yaml', store())

    await studio.addSource({ name: 'store', url: 'apis/store.yaml' })

    assert.deepEqual(studio.view().sources, [PETSTORE, { name: 'store', url: 'apis/store.yaml', type: 'openapi', state: 'read', operations: 1 }])
    assert.deepEqual(documents.saved().sourceDescriptions.at(-1), { name: 'store', url: 'apis/store.yaml', type: 'openapi' })
    assert.deepEqual(studio.view().operations.map((operation) => operation.operationId), ['findPets', 'getPet', 'placeOrder', 'getStock'])
  })

  test('Add an Arazzo description, of the type it is', async () => {
    const { studio, sources, documents } = await opened()
    sources.apis.set('flows/other.arazzo.yaml', { arazzo: '1.0.1' })
    await studio.addSource({ name: 'flows', url: 'flows/other.arazzo.yaml' })
    assert.deepEqual(documents.saved().sourceDescriptions.at(-1), { name: 'flows', url: 'flows/other.arazzo.yaml', type: 'arazzo' })
    assert.deepEqual(studio.view().sources.at(-1), { name: 'flows', url: 'flows/other.arazzo.yaml', type: 'arazzo', state: 'read', operations: 0 })
  })

  test('Add a Swagger description, as an OpenAPI one', async () => {
    const { studio, sources } = await opened()
    sources.apis.set('apis/legacy.yaml', { swagger: '2.0', paths: { '/legacy': { get: { operationId: 'getLegacy' } } } })
    await studio.addSource({ name: 'legacy', url: 'apis/legacy.yaml' })
    assert.deepEqual(studio.view().sources.at(-1), { name: 'legacy', url: 'apis/legacy.yaml', type: 'openapi', state: 'read', operations: 1 })
  })

  describe('Refuse an API that cannot be read', () => {
    for (const [location, prepare, reason] of [
      ['apis/missing.yaml', () => {}, 'no file "apis/missing.yaml" exists next to the document'],
      ['apis/broken.yaml', (sources) => sources.states.set('apis/broken.yaml', { state: 'invalid' }), '"apis/broken.yaml" is neither YAML nor JSON'],
      ['apis/notes.yaml', (sources) => sources.apis.set('apis/notes.yaml', { title: 'notes' }), '"apis/notes.yaml" is not an OpenAPI or Arazzo description'],
      ['apis/empty.yaml', (sources) => sources.apis.set('apis/empty.yaml', null), '"apis/empty.yaml" is not an OpenAPI or Arazzo description'],
      ['apis/huge.yaml', (sources) => sources.states.set('apis/huge.yaml', { state: 'too large' }), '"apis/huge.yaml" is larger than 5 MB'],
      ['https://example.com/store.yaml', (sources) => sources.states.set('https://example.com/store.yaml', { state: 'unreachable', detail: 'HTTP 404' }),
        '"https://example.com/store.yaml" cannot be fetched: HTTP 404'],
    ]) {
      test(`from ${location}`, async () => {
        const { studio, sources, documents } = await opened()
        prepare(sources)
        const before = documents.files.get(PATH)

        await assert.rejects(studio.addSource({ name: 'store', url: location }), { name: 'RefusedEdit', message: `the API "store" cannot be added: ${reason}` })

        assert.equal(documents.files.get(PATH), before)
        assert.deepEqual(studio.view().sources, [PETSTORE])
      })
    }
  })

  test('Pick the file of an API among those of the workspace', async () => {
    const { studio, sources } = await opened()
    sources.apis.set('apis/store.yaml', store())
    assert.deepEqual(await studio.listSourceCandidates(), { candidates: ['apis/store.yaml'] })
  })

  test('An API of the document that can no longer be read', async () => {
    const { studio, sources } = await opened()
    sources.apis.delete('apis/petstore.yaml')

    await studio.reload()

    assert.deepEqual(studio.view().sources, [{ ...PETSTORE, state: 'not found', operations: 0, message: 'no file "apis/petstore.yaml" exists next to the document' }])
    assert.deepEqual(studio.view().problems.map(({ rule, pointer, message }) => [rule, pointer, message]), [
      ['arazzo-step-validation', '#/sourceDescriptions/0/url', 'the API description "petstore" cannot be read: no file "apis/petstore.yaml" exists next to the document'],
    ])
    assert.equal(studio.view().problems[0].line, 9)
  })

  test('A step calling an operation of an API read is checked, even when another API cannot be read', async () => {
    const { studio } = await opened({ edit: (document) => {
      document.sourceDescriptions.push({ name: 'store', url: 'apis/store.yaml', type: 'openapi' })
      document.workflows[0].steps[0].operationId = '$sourceDescriptions.petstore.deletePet'
      document.workflows[0].steps[1].operationId = 'deletePet'
    } })
    assert.deepEqual(studio.view().problems.map(({ message }) => message), [
      'the API description "store" cannot be read: no file "apis/store.yaml" exists next to the document',
      '"$sourceDescriptions.petstore.deletePet" is not an operation of "petstore"',
    ])
  })

  test('Remove an API no step calls', async () => {
    const { studio, documents } = await opened({
      edit: (document) => document.sourceDescriptions.push({ name: 'store', url: 'apis/store.yaml', type: 'openapi' }),
      prepare: (sources) => sources.apis.set('apis/store.yaml', store()),
    })

    await studio.removeSource({ name: 'store' })

    assert.deepEqual(documents.saved().sourceDescriptions.map((source) => source.name), ['petstore'])
    assert.deepEqual(studio.view().sources, [PETSTORE])
    await assert.rejects(studio.removeSource({ name: 'store' }), { name: 'RefusedEdit', message: 'the document describes no API named "store"' })
  })

  test('Refuse to remove an API a step calls', async () => {
    const { studio, documents } = await opened()
    const before = documents.files.get(PATH)
    await assert.rejects(studio.removeSource({ name: 'petstore' }),
      { name: 'RefusedEdit', message: 'the API "petstore" cannot be removed: the steps "findPets", "getPet" and "placeOrder" call it' })
    assert.equal(documents.files.get(PATH), before)
  })

  test('Refuse to remove an API a single step calls, by its name, its path or a workflow it holds', async () => {
    const calling = (step) => opened({ edit: (document) => {
      document.sourceDescriptions.push({ name: 'store', url: 'apis/store.yaml', type: 'openapi' })
      document.workflows[0].steps = [{ stepId: 'a', description: 'a', ...step }]
    }, prepare: (sources) => sources.apis.set('apis/store.yaml', store()) })
    for (const step of [{ operationId: '$sourceDescriptions.store.getStock' }, { operationPath: '{$sourceDescriptions.store.url}#/paths/~1stock/get' },
      { workflowId: '$sourceDescriptions.store.flow' }, { operationId: 'getStock' }]) {
      const { studio } = await calling(step)
      await assert.rejects(studio.removeSource({ name: 'store' }), { message: 'the API "store" cannot be removed: the step "a" calls it' }, JSON.stringify(step))
    }
    const { studio } = await calling({ operationId: 'findPets' })
    await studio.removeSource({ name: 'store' })
  })
})
