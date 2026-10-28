// features/check-workflow.feature and features/ask-copilot.feature, through the studio use cases.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createStudio } from '../../src/arazzo-application/studio.mjs'
import { InMemoryDocuments, InMemorySources, messagesOf, PATH, RecordingAssistant, studioWith } from '../support/studio-world.mjs'

const problemsOfStep = (studio, stepId) => studio.view().problems.filter((problem) => problem.stepId === stepId)

describe('See what is wrong with a workflow while authoring it', () => {
  test('A valid workflow has no problem', async () => {
    const { studio } = await studioWith({ steps: ['findPets'] })
    assert.deepEqual(studio.view().problems, [])
  })

  test('A step calls an operation no API describes', async () => {
    const { studio } = await studioWith({ steps: ['deletePet', 'findPets'] })
    assert.deepEqual(problemsOfStep(studio, 'deletePet'), [{ workflowId: 'adopt-pet', stepId: 'deletePet', message: '"deletePet" is not an operation of "petstore"' }])
    assert.deepEqual(studio.view().diagram.nodes[1].problems, ['"deletePet" is not an operation of "petstore"'])
    assert.equal(studio.view().diagram.nodes[1].operation, null)
    assert.deepEqual(studio.view().workflow.steps[0].slots, [])
    assert.deepEqual(studio.view().diagram.nodes[2].problems, [])
  })

  test('A step is checked against every API the document describes', async () => {
    const { studio, sources } = await studioWith({ steps: ['deletePet'] })
    sources.apis.set('store.yaml', { paths: {} })
    await studio.addSource({ name: 'store', url: 'store.yaml' })
    assert.deepEqual(problemsOfStep(studio, 'deletePet').map((problem) => problem.message), ['"deletePet" is not an operation of "petstore", "store"'])
  })

  test('A step shows the problems of its own workflow only', async () => {
    const { studio } = await studioWith({ steps: ['getPet'] })
    await studio.addWorkflow({ workflowId: 'other' })
    await studio.addStep({ operationId: 'deletePet', stepId: 'getPet' })
    await studio.selectWorkflow({ workflowId: 'adopt-pet' })
    assert.deepEqual(studio.view().diagram.nodes[1].problems, [])
  })

  test('A step names an operation of another API than the one offering it', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'a', operationId: '$sourceDescriptions.store.getPet' }, { stepId: 'b', operationId: '$sourceDescriptions.petstore.getPet' }, { stepId: 'c', operationId: 'x$sourceDescriptions.petstore.getPet' }] })
    assert.deepEqual(studio.view().problems.map((problem) => [problem.stepId, problem.message]), [
      ['a', '"$sourceDescriptions.store.getPet" is not an operation of "petstore"'],
      ['c', '"x$sourceDescriptions.petstore.getPet" is not an operation of "petstore"'],
    ])
  })

  test('A step is only checked against the APIs the canvas could read', async () => {
    const { studio, sources } = await studioWith({ steps: ['deletePet'] })
    sources.apis.clear()
    await studio.reload()
    assert.deepEqual(messagesOf(studio), ['the API description "petstore" cannot be read from petstore.yaml: no such file'])
    assert.deepEqual(studio.view().operations, [])
  })

  test('A step calls no operation or more than one', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'none' }, { stepId: 'two', operationId: 'getPet', workflowId: 'other' }, { stepId: 'path', operationPath: '{$sourceDescriptions.petstore.url}#/paths/~1pets/get' }, { stepId: 'flow', workflowId: 'other' }] })
    assert.deepEqual(studio.view().problems.map((problem) => [problem.stepId, problem.message]), [
      ['none', 'must call exactly one of operationId, operationPath or workflowId'],
      ['two', 'must call exactly one of operationId, operationPath or workflowId'],
    ])
    assert.deepEqual(studio.view().workflow.steps.map((step) => step.operationId), [null, 'getPet', '{$sourceDescriptions.petstore.url}#/paths/~1pets/get', 'other'])
  })

  test('A step uses an input the workflow does not declare', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'findPets', operationId: 'findPets', parameters: [{ name: 'status', in: 'query', value: '$inputs.status' }] }] })
    assert.deepEqual(messagesOf(studio), ['the input "status" is not declared'])
  })

  test('A step uses an output no step exposes', async () => {
    const { studio } = await studioWith({ steps: ['findPets', { stepId: 'getPet', operationId: 'getPet', parameters: [{ name: 'petId', in: 'path', value: '$steps.findPets.outputs.petId' }] }] })
    assert.deepEqual(problemsOfStep(studio, 'getPet').map((problem) => problem.message), ['"findPets" has no output "petId"'])
    assert.deepEqual(studio.view().diagram.edges.filter((edge) => edge.kind === 'data').length, 1)
  })

  test('A step uses an output of a step that does not run before it', async () => {
    const { studio } = await studioWith({ steps: [
      { stepId: 'findPets', operationId: 'findPets', requestBody: { payload: { id: '{$steps.getPet.outputs.id}' } }, successCriteria: [{ condition: '$steps.ghost.outputs.ok == true' }] },
      { stepId: 'getPet', operationId: 'getPet', outputs: { id: '$response.body#/id' } },
    ] })
    assert.deepEqual(problemsOfStep(studio, 'findPets').map((problem) => problem.message), ['no step "getPet" runs before', 'no step "ghost" runs before'])
    assert.deepEqual(studio.view().diagram.edges.filter((edge) => edge.kind === 'data'), [])
  })

  test('A step uses the output of the step it names, not of another one', async () => {
    const { studio } = await studioWith({ steps: ['findPets', { stepId: 'getPet', operationId: 'getPet', outputs: { id: '$response.body#/id' } },
      { stepId: 'placeOrder', operationId: 'placeOrder', requestBody: { payload: { petId: '$steps.getPet.outputs.id', none: null, count: 1, ok: true } } }] })
    assert.deepEqual(studio.view().problems, [])
    assert.deepEqual(studio.view().diagram.edges.filter((edge) => edge.kind === 'data').map((edge) => [edge.from, edge.to]), [['step:1', 'step:2']])
  })

  test('A step uses its own output, or the output of a step the workflow does not have', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'getPet', operationId: 'getPet', outputs: { id: '$response.body#/id' },
      parameters: [{ name: 'petId', in: 'path', value: '$steps.getPet.outputs.id' }, { name: 'x', in: 'query', value: '$steps.ghost.outputs.id' }] }] })
    assert.deepEqual(messagesOf(studio), ['no step "getPet" runs before', 'no step "ghost" runs before'])
    assert.deepEqual(studio.view().diagram.edges.filter((edge) => edge.kind === 'data'), [])
  })

  test('A workflow output refers to what no step exposes', async () => {
    const { studio } = await studioWith({ steps: ['getPet'], outputs: { name: '$steps.getPet.outputs.name', who: '$inputs.who' } })
    assert.deepEqual(studio.view().problems, [
      { workflowId: 'adopt-pet', message: 'the input "who" is not declared' },
      { workflowId: 'adopt-pet', message: '"getPet" has no output "name"' },
    ])
  })

  test('A step goes to a step the workflow does not have', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'getPet', operationId: 'getPet', onFailure: [{ name: 'x', type: 'goto', stepId: 'gone' }, { name: 'y', type: 'goto', workflowId: 'other' }], onSuccess: [{ name: 'z', type: 'goto', stepId: 'gone2' }] }] })
    assert.deepEqual(messagesOf(studio), ['goes to a step "gone2" the workflow does not have', 'goes to a step "gone" the workflow does not have'])
    assert.deepEqual(studio.view().diagram.edges.filter((edge) => edge.kind === 'goto'), [])
  })

  test('A document opened with mistakes stays editable', async () => {
    const { studio } = await studioWith({ steps: ['getPet', 'getPet'] })
    assert.deepEqual(studio.view().problems, [
      { workflowId: 'adopt-pet', stepId: 'getPet', message: 'two steps are named "getPet"' },
      { workflowId: 'adopt-pet', stepId: 'getPet', message: 'two steps are named "getPet"' },
    ])
    assert.deepEqual(studio.view().diagram.nodes.filter((node) => node.kind === 'step').map((node) => node.stepId), ['getPet', 'getPet'])
    await studio.addStep({ operation: 'petstore.findPets' })
    assert.equal(studio.view().diagram.nodes.length, 5)
  })

  test('A document declares the Arazzo version it follows', async () => {
    const documents = new InMemoryDocuments()
    const studio = createStudio({ documents, sources: new InMemorySources(), assistant: new RecordingAssistant() })
    const versionProblem = async (arazzo) => {
      documents.files.set(PATH, { arazzo, info: { title: 't', version: '1' }, sourceDescriptions: [{ name: 'petstore', url: 'petstore.yaml' }], workflows: [{ workflowId: 'w', steps: [{ stepId: 'findPets', operationId: 'findPets' }] }] })
      await studio.open({ path: PATH })
      return studio.view().problems.map((problem) => problem.message)
    }
    for (const valid of ['1.0.0', '1.0.1', '1.10.0', '1.0.12']) assert.deepEqual(await versionProblem(valid), [], valid)
    for (const invalid of ['21.0.0', '1.0.1-rc', '1.0', 'v1.0.0']) {
      assert.deepEqual(await versionProblem(invalid), [`the document must declare an Arazzo version 1.x.y, not "${invalid}"`], invalid)
    }
  })

  test('A document missing what Arazzo requires', async () => {
    const documents = new InMemoryDocuments()
    documents.files.set(PATH, { arazzo: '2.0.0', workflows: [{ workflowId: 'a' }, { workflowId: 'a', steps: [{ operationId: 'getPet' }] }, { steps: [] }] })
    const studio = createStudio({ documents, sources: new InMemorySources(), assistant: new RecordingAssistant() })
    await studio.open({ path: PATH })
    assert.deepEqual(studio.view().problems, [
      { message: 'the document must declare an Arazzo version 1.x.y, not "2.0.0"' },
      { message: 'the document needs a title in info.title' },
      { message: 'the document needs a version in info.version' },
      { message: 'the document describes no API: add the OpenAPI description its steps call' },
      { message: 'two workflows are named "a"' },
      { workflowId: 'a', message: 'the workflow has no step yet: drop an operation on it' },
      { workflowId: 'a', stepId: undefined, message: 'needs a stepId' },
      { workflowId: undefined, message: 'a workflow needs a workflowId' },
      { workflowId: undefined, message: 'the workflow has no step yet: drop an operation on it' },
    ])
    assert.deepEqual(studio.view().workflows.map((workflow) => workflow.steps), [0, 1, 0])
    assert.deepEqual(studio.view().workflow.steps, [])
    assert.deepEqual(studio.view().diagram.nodes.map((node) => node.id), ['inputs', 'outputs'])
  })

  test('A step without id and the actions of another one are drawn as they are', async () => {
    const { studio } = await studioWith({ steps: [{ operationId: 'getPet' }, { stepId: 'findPets', operationId: 'findPets', onSuccess: [{ name: 'done', type: 'end' }] }] })
    assert.deepEqual(studio.view().diagram.edges.map((edge) => edge.kind), ['sequence', 'sequence', 'sequence', 'end'])
  })

  test('A document without any workflow', async () => {
    const documents = new InMemoryDocuments()
    documents.files.set(PATH, { info: { title: 't', version: '1' }, sourceDescriptions: [{ name: 'petstore', url: 'petstore.yaml' }] })
    const studio = createStudio({ documents, sources: new InMemorySources(), assistant: new RecordingAssistant() })
    const view = await studio.open({ path: PATH })
    assert.deepEqual([view.workflowId, view.workflow, view.diagram, view.workflows], [null, null, null, []])
    assert.deepEqual(view.problems.map((problem) => problem.message), ['the document must declare an Arazzo version 1.x.y, not ""', 'the document has no workflow'])
    assert.equal(view.operations.length, 3)
  })
})

describe('Ask Copilot about the workflow', () => {
  test('Ask about a selected step', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets', { stepId: 'getPet', operationId: 'getPet', parameters: [{ name: 'petId', in: 'path', value: '$steps.findPets.outputs.petId' }, { name: 'id', in: 'query', value: '$inputs.id' }] }] })

    assert.deepEqual(await studio.ask({ question: '  how do I pass the pet id?  ', stepId: 'getPet' }), { asked: true })

    assert.equal(assistant.prompts[0], [
      `About the Arazzo workflow "adopt-pet" in ${PATH}, step "getPet":`,
      'how do I pass the pet id?',
      '',
      'The step:',
      JSON.stringify({ stepId: 'getPet', operationId: 'getPet', parameters: [{ name: 'petId', in: 'path', value: '$steps.findPets.outputs.petId' }, { name: 'id', in: 'query', value: '$inputs.id' }] }, null, 2),
      '',
      'Its problems:',
      '- the input "id" is not declared',
      '- "findPets" has no output "petId"',
      '',
      'Change the workflow through the actions of the "arazzo" canvas (get_workflow, add_step, link_data, …) so the developer sees it.',
    ].join('\n'))
  })

  test('Ask about a step leaves out the problems of the other steps', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets', 'deletePet'] })
    await studio.ask({ question: 'ok?', stepId: 'findPets' })
    assert.ok(assistant.prompts[0].includes('\n\nIt has no problem.\n\n'), assistant.prompts[0])
  })

  test('Ask about a document without any workflow', async () => {
    const documents = new InMemoryDocuments()
    documents.files.set(PATH, { arazzo: '1.0.1', info: { title: 't', version: '1' } })
    const assistant = new RecordingAssistant()
    const studio = createStudio({ documents, sources: new InMemorySources(), assistant })
    await studio.open({ path: PATH })
    await studio.ask({ question: 'how do I start?' })
    assert.equal(assistant.prompts[0], [
      `About the Arazzo document ${PATH}:`, 'how do I start?', '',
      `The document:\n${JSON.stringify({ arazzo: '1.0.1', info: { title: 't', version: '1' } }, null, 2)}`, '',
      'Its problems:\n- the document describes no API: add the OpenAPI description its steps call\n- the document has no workflow', '',
      'Change the workflow through the actions of the "arazzo" canvas (get_workflow, add_step, link_data, …) so the developer sees it.',
    ].join('\n'))
  })

  test('Ask about the workflow shown', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets'] })
    await studio.addWorkflow({ workflowId: 'order-pet' })
    await studio.ask({ question: 'what now?' })
    assert.ok(assistant.prompts[0].startsWith(`About the Arazzo workflow "order-pet" in ${PATH}:\nwhat now?\n\nThe workflow:\n{\n  "workflowId": "order-pet",`), assistant.prompts[0])
  })

  test('Ask about the whole workflow', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets', { operationId: 'getPet' }] })
    await studio.ask({ question: 'what is missing?' })
    const prompt = assistant.prompts[0]
    assert.ok(prompt.startsWith(`About the Arazzo workflow "adopt-pet" in ${PATH}:\nwhat is missing?\n\nThe workflow:\n{\n  "workflowId": "adopt-pet",`), prompt)
    assert.ok(prompt.includes('\n\nIts problems:\n- needs a stepId\n\n'), prompt)
  })

  test('Ask about a workflow keeps the problems of the document and of that workflow only', async () => {
    const { studio, assistant } = await studioWith({ steps: ['deletePet'] })
    await studio.addWorkflow({ workflowId: 'other' })
    await studio.selectWorkflow({ workflowId: 'adopt-pet' })
    await studio.ask({ question: 'why?' })
    assert.ok(assistant.prompts[0].includes('Its problems:\n- "deletePet" is not an operation of "petstore"\n\n'), assistant.prompts[0])
  })

  test('Ask with nothing to ask, or about a step the workflow does not have', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets'] })
    await assert.rejects(studio.ask({ question: '  ' }), { name: 'RefusedEdit', message: 'ask a question first' })
    await assert.rejects(studio.ask({}), { message: 'ask a question first' })
    await assert.rejects(studio.ask({ question: 'why?', stepId: 'nope' }), { message: 'the workflow "adopt-pet" has no step "nope"' })
    assert.deepEqual(assistant.prompts, [])
  })
})
