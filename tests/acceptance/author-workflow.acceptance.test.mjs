// features/author-workflow.feature, through the studio use cases.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createStudio } from '../../src/arazzo-application/studio.mjs'
import { InMemoryDocuments, InMemorySources, PATH, RecordingAssistant, savedWorkflow, stepIdsOf, studioWith } from '../support/studio-world.mjs'

describe('Author an Arazzo workflow on a visual canvas', () => {
  test('Start a new workflow document', async () => {
    const documents = new InMemoryDocuments()
    const studio = createStudio({ documents, sources: new InMemorySources(), assistant: new RecordingAssistant() })

    const view = await studio.open({ path: PATH, sources: [{ name: 'petstore', url: 'petstore.yaml' }] })

    assert.deepEqual(documents.files.get(PATH), {
      arazzo: '1.0.1',
      info: { title: 'adopt', version: '1.0.0' },
      sourceDescriptions: [{ name: 'petstore', url: 'petstore.yaml', type: 'openapi' }],
      workflows: [{ workflowId: 'adopt', steps: [] }],
    })
    assert.equal(view.workflowId, 'adopt')
    assert.deepEqual(view.operations.map((operation) => `${operation.method} ${operation.path} ${operation.operationId}`),
      ['GET /pets findPets', 'GET /pets/{petId} getPet', 'POST /orders placeOrder'])
    assert.deepEqual(view.operations[1], {
      source: 'petstore', operationId: 'getPet', method: 'GET', path: '/pets/{petId}', summary: 'Get a pet',
      parameters: [{ name: 'petId', in: 'path', required: true }], body: false,
    })
    assert.equal(view.operations[2].body, true)
    assert.equal(view.operations[2].summary, '')
  })

  test('Start a new workflow document named after the workflow asked', async () => {
    const documents = new InMemoryDocuments()
    const studio = createStudio({ documents, sources: new InMemorySources(), assistant: new RecordingAssistant() })

    await studio.open({ path: 'flows/2026/orders.yaml', workflowId: 'place-order' })

    assert.deepEqual(documents.files.get('flows/2026/orders.yaml').info.title, 'orders')
    assert.deepEqual(documents.files.get('flows/2026/orders.yaml').workflows, [{ workflowId: 'place-order', steps: [] }])
  })

  test('Open an existing document without rewriting it', async () => {
    const { documents, studio } = await studioWith({ steps: ['findPets'] })
    assert.equal(documents.writes, 0)
    assert.deepEqual(stepIdsOf(studio), ['findPets'])
  })

  test('Drop an operation on the canvas to add a step', async () => {
    const { studio, documents } = await studioWith()

    const { stepId } = await studio.addStep({ operation: 'petstore.findPets' })

    assert.equal(stepId, 'findPets')
    assert.deepEqual(savedWorkflow(documents).steps, [{ stepId: 'findPets', operationId: 'findPets' }])
    assert.deepEqual(studio.view().workflow.steps[0], {
      stepId: 'findPets', operationId: 'findPets', outputs: {}, successCriteria: [],
      slots: [{ name: 'status', in: 'query', required: false, value: null }],
    })
  })

  test('Two drops of the same operation get distinct step ids', async () => {
    const { studio } = await studioWith({ steps: ['findPets'] })

    await studio.addStep({ operation: 'petstore.findPets' })
    await studio.addStep({ operation: 'petstore.findPets' })

    assert.deepEqual(stepIdsOf(studio), ['findPets', 'findPets-2', 'findPets-3'])
  })

  test('Drop an operation between two steps', async () => {
    const { studio } = await studioWith({ steps: ['findPets', 'placeOrder'] })

    await studio.addStep({ operation: 'petstore.getPet', before: 'placeOrder' })

    assert.deepEqual(stepIdsOf(studio), ['findPets', 'getPet', 'placeOrder'])
  })

  test('Name the step dropped', async () => {
    const { studio } = await studioWith()
    assert.deepEqual(await studio.addStep({ operationId: 'getPet', stepId: 'read-pet' }), { stepId: 'read-pet' })
    assert.deepEqual(studio.view().workflow.steps.map((step) => step.operationId), ['getPet'])
  })

  test('Steps calling an operation of one of several APIs name it with its API', async () => {
    const { studio, sources } = await studioWith()
    sources.apis.set('store.yaml', { paths: { '/stock': { get: { operationId: 'getStock' } } } })

    await studio.addSource({ name: 'store', url: 'store.yaml' })
    await studio.addStep({ operation: 'store.getStock' })

    assert.deepEqual(studio.view().workflow.steps.map((step) => step.operationId), ['$sourceDescriptions.store.getStock'])
    assert.deepEqual(studio.view().diagram.nodes[1].operation, { method: 'GET', path: '/stock', summary: '' })
  })

  test('Refuse an operation no described API offers', async () => {
    const { studio } = await studioWith()
    await assert.rejects(studio.addStep({ operation: 'petstore.deletePet' }), { name: 'RefusedEdit', message: 'no described API offers the operation "petstore.deletePet"' })
    await assert.rejects(studio.addStep({}), { message: 'a step needs the operation it calls' })
    await assert.rejects(studio.addStep({ operationId: 'getPet', stepId: 'read pet' }), { message: 'the step id "read pet" must only use letters, digits, "_" and "-"' })
    await assert.rejects(studio.addStep({ operationId: 'getPet', before: 'nope' }), { message: 'the workflow "adopt-pet" has no step "nope"' })
  })

  test('Reorder steps by dragging one onto another', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets', 'getPet', 'placeOrder'] })

    await studio.moveStep({ stepId: 'placeOrder', to: 0 })

    assert.deepEqual(stepIdsOf(studio), ['placeOrder', 'findPets', 'getPet'])
    assert.deepEqual(savedWorkflow(documents).steps.map((step) => step.stepId), ['placeOrder', 'findPets', 'getPet'])
    await studio.moveStep({ stepId: 'placeOrder', to: 2 })
    assert.deepEqual(stepIdsOf(studio), ['findPets', 'getPet', 'placeOrder'])
  })

  test('Refuse to move a step out of the workflow', async () => {
    const { studio } = await studioWith({ steps: ['findPets', 'getPet'] })
    for (const to of [-1, 2, 0.5]) {
      await assert.rejects(studio.moveStep({ stepId: 'getPet', to }), { message: 'a step of "adopt-pet" goes from position 0 to 1' })
    }
  })

  test('Pass a value from one step to a later one', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets', 'getPet'] })
    await studio.setStepOutput({ stepId: 'findPets', name: 'petId', expression: '$response.body#/0/id' })

    await studio.linkData({ from: { stepId: 'findPets', output: 'petId' }, to: { stepId: 'getPet', name: 'petId', in: 'path' } })

    assert.deepEqual(savedWorkflow(documents).steps[1].parameters, [{ name: 'petId', in: 'path', value: '$steps.findPets.outputs.petId' }])
    assert.deepEqual(studio.view().workflow.steps[1].slots, [{ name: 'petId', in: 'path', required: true, value: '$steps.findPets.outputs.petId' }])
    const edge = studio.view().diagram.edges.find((each) => each.kind === 'data')
    assert.deepEqual([edge.from, edge.to, edge.side, edge.label.lines], ['step:0', 'step:1', 'right', ['outputs.petId', '→ path petId']])
  })

  test('Pass a workflow input to a step', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets'] })
    await studio.addInput({ name: 'status' })

    await studio.linkData({ from: { input: 'status' }, to: { stepId: 'findPets', name: 'status', in: 'query' } })

    assert.deepEqual(savedWorkflow(documents).inputs, { type: 'object', properties: { status: { type: 'string' } } })
    assert.deepEqual(savedWorkflow(documents).steps[0].parameters, [{ name: 'status', in: 'query', value: '$inputs.status' }])
    assert.deepEqual(studio.view().workflow.inputs, ['status'])
    const edge = studio.view().diagram.edges.find((each) => each.kind === 'data')
    assert.deepEqual([edge.from, edge.to, edge.side, edge.label.lines], ['inputs', 'step:0', 'left', ['$inputs.status', '→ query status']])
  })

  test('Pass a value again replaces the one the parameter had', async () => {
    const { studio, documents } = await studioWith({ steps: [{ stepId: 'findPets', operationId: 'findPets', parameters: [{ name: 'status', in: 'header', value: 'x' }, { name: 'limit', in: 'query', value: '10' }, { name: 'status', in: 'query', value: 'old' }] }], inputs: ['status'] })

    await studio.linkData({ from: { input: 'status' }, to: { stepId: 'findPets', name: 'status', in: 'query' } })

    assert.deepEqual(savedWorkflow(documents).steps[0].parameters, [
      { name: 'status', in: 'header', value: 'x' },
      { name: 'limit', in: 'query', value: '10' },
      { name: 'status', in: 'query', value: '$inputs.status' },
    ])
    assert.deepEqual(studio.view().workflow.steps[0].slots, [
      { name: 'status', in: 'query', required: false, value: '$inputs.status' },
      { name: 'status', in: 'header', required: false, value: 'x' },
      { name: 'limit', in: 'query', required: false, value: '10' },
    ])
  })

  test('Pass a value in the body of a request', async () => {
    const { studio, documents } = await studioWith({ steps: ['getPet', 'placeOrder'] })
    await studio.setStepOutput({ stepId: 'getPet', name: 'id', expression: '$response.body#/id' })
    await studio.addInput({ name: 'quantity', type: 'integer' })

    await studio.linkData({ from: { stepId: 'getPet', output: 'id' }, to: { stepId: 'placeOrder', name: 'petId', in: 'body' } })
    await studio.linkData({ from: { input: 'quantity' }, to: { stepId: 'placeOrder', name: 'quantity', in: 'body' } })

    assert.deepEqual(savedWorkflow(documents).steps[1].requestBody, {
      contentType: 'application/json', payload: { petId: '$steps.getPet.outputs.id', quantity: '$inputs.quantity' },
    })
    assert.deepEqual(savedWorkflow(documents).inputs.properties.quantity, { type: 'integer' })
    assert.deepEqual(studio.view().workflow.steps[1].slots, [
      { name: 'petId', in: 'body', required: false, value: '$steps.getPet.outputs.id' },
      { name: 'quantity', in: 'body', required: false, value: '$inputs.quantity' },
    ])
    assert.deepEqual(studio.view().diagram.edges.filter((edge) => edge.kind === 'data').map((edge) => edge.label.lines),
      [['$inputs.quantity', '→ body quantity'], ['outputs.id', '→ body petId']])
  })

  test('Refuse to pass a value backwards', async () => {
    const { studio } = await studioWith({ steps: ['findPets', { stepId: 'getPet', operationId: 'getPet', outputs: { name: '$response.body#/name' } }] })

    await assert.rejects(studio.linkData({ from: { stepId: 'getPet', output: 'name' }, to: { stepId: 'findPets', name: 'status', in: 'query' } }),
      { name: 'RefusedEdit', message: '"getPet" runs after "findPets": a step only gets values from the steps before it' })
    await assert.rejects(studio.linkData({ from: { stepId: 'getPet', output: 'name' }, to: { stepId: 'getPet', name: 'x', in: 'query' } }),
      { message: '"getPet" runs after "getPet": a step only gets values from the steps before it' })
  })

  test('Refuse to pass a value nobody has', async () => {
    const { studio } = await studioWith({ steps: ['findPets', 'getPet'] })
    await assert.rejects(studio.linkData({ from: { stepId: 'findPets', output: 'petId' }, to: { stepId: 'getPet', name: 'petId', in: 'path' } }),
      { message: '"findPets" has no output "petId"' })
    await assert.rejects(studio.linkData({ from: { input: 'status' }, to: { stepId: 'findPets', name: 'status', in: 'query' } }),
      { message: 'the workflow "adopt-pet" has no input "status"' })
    await studio.addInput({ name: 'status' })
    await assert.rejects(studio.linkData({ from: { input: 'status' }, to: { stepId: 'findPets', name: 'status', in: 'form' } }),
      { message: 'a value goes in one of path, query, header, cookie, body, not "form"' })
    await assert.rejects(studio.addInput({ name: 'status' }), { message: 'the workflow "adopt-pet" already has an input "status"' })
    await assert.rejects(studio.setStepOutput({ stepId: 'findPets', name: 'petId' }), { message: 'the output "petId" needs the value it takes, such as $response.body#/id' })
  })

  test('Expose a step output as an output of the workflow', async () => {
    const { studio, documents } = await studioWith({ steps: [{ stepId: 'getPet', operationId: 'getPet', outputs: { name: '$response.body#/name' } }] })

    await studio.addWorkflowOutput({ name: 'petName', stepId: 'getPet', output: 'name' })

    assert.deepEqual(savedWorkflow(documents).outputs, { petName: '$steps.getPet.outputs.name' })
    assert.deepEqual(studio.view().workflow.outputs, { petName: '$steps.getPet.outputs.name' })
    assert.deepEqual(studio.view().workflow.steps[0].outputs, { name: '$response.body#/name' })
    await assert.rejects(studio.addWorkflowOutput({ name: 'petAge', stepId: 'getPet', output: 'age' }), { message: '"getPet" has no output "age"' })
  })

  test('Check that a step succeeded', async () => {
    const { studio, documents } = await studioWith({ steps: ['getPet'] })

    await studio.addSuccessCriterion({ stepId: 'getPet', condition: '$statusCode == 200' })
    await studio.addSuccessCriterion({ stepId: 'getPet', condition: '$response.body#/status == "available"' })

    assert.deepEqual(savedWorkflow(documents).steps[0].successCriteria, [{ condition: '$statusCode == 200' }, { condition: '$response.body#/status == "available"' }])
    assert.deepEqual(studio.view().workflow.steps[0].successCriteria, ['$statusCode == 200', '$response.body#/status == "available"'])
    await assert.rejects(studio.addSuccessCriterion({ stepId: 'getPet' }), { message: 'a success criterion needs a condition, such as $statusCode == 200' })
  })

  test('Retry a step and end on failure', async () => {
    const { studio, documents } = await studioWith({ steps: ['placeOrder'] })

    await studio.addAction({ stepId: 'placeOrder', on: 'failure', type: 'retry', retryLimit: 3, retryAfter: 2 })
    await studio.addAction({ stepId: 'placeOrder', on: 'failure', type: 'end' })

    assert.deepEqual(savedWorkflow(documents).steps[0].onFailure, [
      { name: 'retry', type: 'retry', retryLimit: 3, retryAfter: 2 },
      { name: 'end-on-failure', type: 'end' },
    ])
    const labels = studio.view().diagram.edges.filter((edge) => edge.label && edge.kind !== 'data').map((edge) => [edge.kind, edge.label.lines[0]])
    assert.deepEqual(labels, [['end', 'end on failure'], ['retry', 'retry ×3 · 2 s']])
  })

  test('Go to another step on success', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets', 'getPet', 'placeOrder'] })

    await studio.addAction({ stepId: 'findPets', on: 'success', type: 'goto', target: 'placeOrder' })
    await studio.addAction({ stepId: 'findPets', on: 'success', type: 'end' })

    assert.deepEqual(savedWorkflow(documents).steps[0].onSuccess, [{ name: 'goto-placeOrder', type: 'goto', stepId: 'placeOrder' }, { name: 'end-on-success', type: 'end' }])
    const goto = studio.view().diagram.edges.find((edge) => edge.kind === 'goto')
    assert.deepEqual([goto.from, goto.to, goto.label.lines], ['step:0', 'step:2', ['goto on success']])
  })

  test('Refuse an action a workflow cannot run', async () => {
    const { studio } = await studioWith({ steps: ['placeOrder'] })
    const refused = (action, message) => assert.rejects(studio.addAction({ stepId: 'placeOrder', ...action }), { message })
    await refused({ on: 'success', type: 'retry', retryLimit: 1 }, 'a step only retries on failure')
    await refused({ on: 'failure', type: 'retry', retryLimit: 0 }, 'a retry needs at least 1 attempt')
    await refused({ on: 'failure', type: 'retry', retryLimit: 1.5 }, 'a retry needs at least 1 attempt')
    await refused({ on: 'failure', type: 'retry' }, 'a retry needs at least 1 attempt')
    await refused({ on: 'failure', type: 'jump' }, 'an action is end, goto or retry, not "jump"')
    await refused({ on: 'always', type: 'end' }, 'an action runs on success or on failure, not "always"')
    await refused({ on: 'failure', type: 'goto', target: 'nope' }, 'the workflow "adopt-pet" has no step "nope"')
  })

  test('Retry without waiting', async () => {
    const { studio, documents } = await studioWith({ steps: ['placeOrder'] })
    await studio.addAction({ stepId: 'placeOrder', on: 'failure', type: 'retry', retryLimit: 1 })
    assert.deepEqual(savedWorkflow(documents).steps[0].onFailure, [{ name: 'retry', type: 'retry', retryLimit: 1 }])
    assert.deepEqual(studio.view().diagram.edges.find((edge) => edge.kind === 'retry').label.lines, ['retry ×1'])
  })

  test('Remove a step', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets', 'getPet'] })

    await studio.removeStep({ stepId: 'findPets' })

    assert.deepEqual(stepIdsOf(studio), ['getPet'])
    assert.deepEqual(savedWorkflow(documents).steps, [{ stepId: 'getPet', operationId: 'getPet' }])
    await assert.rejects(studio.removeStep({ stepId: 'findPets' }), { message: 'the workflow "adopt-pet" has no step "findPets"' })
  })

  test('Add a second workflow and switch between them', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets'] })

    await studio.addWorkflow({ workflowId: 'order-pet', summary: 'Order a pet' })
    assert.equal(studio.view().workflowId, 'order-pet')
    await studio.addStep({ operation: 'petstore.placeOrder' })
    await studio.addWorkflow({ workflowId: 'browse' })

    assert.deepEqual(studio.view().workflows, [
      { workflowId: 'adopt-pet', summary: '', steps: 1 },
      { workflowId: 'order-pet', summary: 'Order a pet', steps: 1 },
      { workflowId: 'browse', summary: '', steps: 0 },
    ])
    assert.deepEqual(documents.files.get(PATH).workflows[2], { workflowId: 'browse', steps: [] })
    await studio.selectWorkflow({ workflowId: 'adopt-pet' })
    assert.deepEqual(stepIdsOf(studio), ['findPets'])
    await studio.addStep({ operationId: 'getPet', workflowId: 'order-pet' })
    assert.equal(studio.view().workflowId, 'order-pet')
    assert.deepEqual(stepIdsOf(studio), ['placeOrder', 'getPet'])
    await assert.rejects(studio.selectWorkflow({ workflowId: 'nope' }), { message: 'the document has no workflow "nope"' })
    await assert.rejects(studio.addWorkflow({ workflowId: 'browse' }), { message: 'the document already has a workflow "browse"' })
  })

  test('Describe another API', async () => {
    const { studio, documents } = await studioWith()
    await assert.rejects(studio.addSource({ name: 'petstore', url: 'x.yaml' }), { message: 'the document already describes an API named "petstore"' })
    await assert.rejects(studio.addSource({ name: 'store' }), { message: 'the API description "store" needs a url' })
    await assert.rejects(studio.addSource({ name: 'my store', url: 'x' }), { message: 'the API description name "my store" must only use letters, digits, "_" and "-"' })
    await studio.addSource({ name: 'flows', url: 'other.arazzo.yaml', type: 'arazzo' })
    assert.deepEqual(documents.files.get(PATH).sourceDescriptions.at(-1), { name: 'flows', url: 'other.arazzo.yaml', type: 'arazzo' })
    assert.equal(studio.view().operations.length, 3)
    assert.deepEqual(studio.view().problems.map((problem) => problem.message), ['the workflow has no step yet: drop an operation on it'])
  })

  test('Follow the document when another tool changes its file', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets'] })
    let changes = 0
    const stop = studio.onChange(() => changes++)
    documents.files.get(PATH).workflows[0].steps.push({ stepId: 'getPet', operationId: 'getPet' })

    await studio.reload()
    assert.deepEqual(stepIdsOf(studio), ['findPets', 'getPet'])
    assert.equal(changes, 1)

    stop()
    documents.files.get(PATH).workflows[0].steps.pop()
    await studio.reload()
    assert.deepEqual(stepIdsOf(studio), ['findPets'])
    assert.equal(changes, 1)

    documents.files.delete(PATH)
    await studio.reload()
    assert.deepEqual(stepIdsOf(studio), ['findPets'])
  })

  test('Nothing to edit before a document is open', async () => {
    const studio = createStudio({ documents: new InMemoryDocuments(), sources: new InMemorySources(), assistant: new RecordingAssistant() })
    assert.throws(() => studio.view(), { name: 'RefusedEdit', message: 'no Arazzo document is open on the canvas' })
    await assert.rejects(studio.addStep({ operationId: 'x' }), { message: 'no Arazzo document is open on the canvas' })
    await assert.rejects(studio.open({}), { message: 'the canvas needs the path of the Arazzo document to open' })
  })

  test('Name workflows, inputs and outputs with letters, digits, "_" and "-" only', async () => {
    const { studio } = await studioWith({ steps: ['getPet'] })
    await assert.rejects(studio.addWorkflow({}), { message: 'the workflow id "" must only use letters, digits, "_" and "-"' })
    await assert.rejects(studio.addWorkflow({ workflowId: 'a b' }), { message: 'the workflow id "a b" must only use letters, digits, "_" and "-"' })
    await assert.rejects(studio.addInput({ name: 'a.b' }), { message: 'the input name "a.b" must only use letters, digits, "_" and "-"' })
    await assert.rejects(studio.setStepOutput({ stepId: 'getPet', name: '$x', expression: '$statusCode' }), { message: 'the output name "$x" must only use letters, digits, "_" and "-"' })
    await assert.rejects(studio.addWorkflowOutput({ name: 'a/b', stepId: 'getPet', output: 'x' }), { message: 'the output name "a/b" must only use letters, digits, "_" and "-"' })
  })

  test('Edit a document written by hand that leaves out its optional lists', async () => {
    const documents = new InMemoryDocuments()
    documents.files.set(PATH, { arazzo: '1.0.1', info: { title: 't', version: '1' }, workflows: [{ workflowId: 'bare' }] })
    const studio = createStudio({ documents, sources: new InMemorySources(), assistant: new RecordingAssistant() })
    await studio.open({ path: PATH })

    await studio.addSource({ name: 'petstore', url: 'petstore.yaml' })
    await studio.addStep({ operation: 'petstore.getPet' })

    assert.deepEqual(documents.files.get(PATH).sourceDescriptions, [{ name: 'petstore', url: 'petstore.yaml', type: 'openapi' }])
    assert.deepEqual(documents.files.get(PATH).workflows, [{ workflowId: 'bare', steps: [{ stepId: 'getPet', operationId: 'getPet' }] }])
  })

  test('The palette keeps the operations read when the document was opened, until it is read again', async () => {
    const { studio, sources } = await studioWith({ steps: ['findPets'] })
    sources.apis.set('petstore.yaml', { paths: { '/v2/pets': { get: { operationId: 'listPets' } } } })

    await studio.addInput({ name: 'status' })
    await studio.addWorkflow({ workflowId: 'other' })
    await studio.selectWorkflow({ workflowId: 'adopt-pet' })
    assert.deepEqual(studio.view().operations.map((operation) => operation.operationId), ['findPets', 'getPet', 'placeOrder'])

    await studio.reload()
    assert.deepEqual(studio.view().operations.map((operation) => operation.operationId), ['listPets'])
  })

  test('The palette lists the operations of every method, with their parameters', async () => {
    const { studio, sources } = await studioWith()
    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
    sources.apis.set('all.yaml', { paths: {
      '/things/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true }, { name: 'trace', in: 'header' }, { $ref: '#/components/parameters/x' }],
        ...Object.fromEntries(methods.map((method) => [method, { operationId: `${method}Thing` }])),
        get: { operationId: 'getThing', parameters: [{ name: 'trace', in: 'header', required: true }, { name: 'trace', in: 'query' }] },
      },
    } })
    sources.apis.set('empty.yaml', { openapi: '3.1.0' })

    await studio.addSource({ name: 'all', url: 'all.yaml' })
    await studio.addSource({ name: 'empty', url: 'empty.yaml' })

    const things = studio.view().operations.filter((operation) => operation.source === 'all')
    assert.deepEqual(things.map((operation) => operation.method), ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE'])
    assert.deepEqual(things[0].parameters, [
      { name: 'id', in: 'path', required: true },
      { name: 'trace', in: 'header', required: true },
      { name: 'trace', in: 'query', required: false },
    ])
    assert.equal(studio.view().operations.length, 11)
  })
})
