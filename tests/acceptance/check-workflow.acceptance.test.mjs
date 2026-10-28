// features/check-workflow.feature and features/ask-copilot.feature, through the studio use cases.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { adoptDocument, describedStep, PATH, studioOn, studioWith } from '../support/studio-world.mjs'

const stepOf = (document, index) => document.workflows[0].steps[index]

/** The adopt-pet document with findPets, getPet and placeOrder and the input "status", changed by `edit`. */
const openedWith = async (edit, world = studioOn()) => {
  const document = adoptDocument({ steps: ['findPets', 'getPet', 'placeOrder'], inputs: ['status'] })
  edit(document)
  world.documents.put(PATH, document)
  await world.studio.open({ path: PATH })
  return world
}

const found = (studio) => studio.view().problems.map(({ rule, severity, pointer, message }) => [rule, severity, pointer, message])

describe('See what is wrong with a workflow while authoring it', () => {
  test('A valid document has no problem', async () => {
    const { studio } = await openedWith(() => {})
    assert.deepEqual(studio.view().problems, [])
    assert.equal(studio.view().status, 'valid')
  })

  test('Each problem tells its rule, its severity, where it is and why', async () => {
    const { studio } = await studioWith({ steps: ['findPets', { ...describedStep('getPet'), parameters: [{ name: 'petId', in: 'path', value: '$inputs.status' }] }, 'placeOrder'] })

    const error = {
      rule: 'arazzo-step-parameters-validation', severity: 'error', pointer: '#/workflows/0/steps/1/parameters/0/value', line: 25,
      workflowId: 'adopt-pet', stepId: 'getPet', message: 'the input "status" is not declared',
    }
    assert.deepEqual(studio.view().problems, [error])
    assert.deepEqual(studio.view().diagram.nodes.map((node) => node.problems), [undefined, [], [{ severity: 'error', message: error.message }], [], undefined])
  })

  test('The problems of another workflow are not mixed with those of the workflow shown', async () => {
    const { studio } = await openedWith((document) => document.workflows.push({ workflowId: 'test', summary: 'Test', description: 'A test', steps: [] }))

    assert.deepEqual(studio.view().problems, [])
    assert.deepEqual(studio.view().otherWorkflows, [{ workflowId: 'test', problems: 1 }])
    assert.equal(studio.view().status, 'valid')
    await studio.selectWorkflow({ workflowId: 'test' })
    assert.deepEqual(found(studio), [['arazzo-document-schema', 'error', '#/workflows/1/steps', 'the workflow has no step yet: drop an operation on it']])
    assert.deepEqual(studio.view().otherWorkflows, [])
  })

  test('The problems of the document are shown on every workflow', async () => {
    const { studio } = await openedWith((document) => {
      delete document.info.version
      document.workflows.push({ workflowId: 'other', summary: 'Other', description: 'Another workflow', steps: [describedStep('getPet')] })
    })
    const documentProblem = ['arazzo-document-schema', 'error', '#/info/version', 'the document needs info.version']
    assert.deepEqual(found(studio), [documentProblem])
    await studio.selectWorkflow({ workflowId: 'other' })
    assert.deepEqual(found(studio), [documentProblem])
    assert.equal(studio.view().problems[0].line, 2)
  })

  test('The status tells errors and warnings apart', async () => {
    const status = async (edit) => (await openedWith(edit)).studio.view().status
    assert.equal(await status((document) => {
      stepOf(document, 0).operationId = 'deletePet'
      delete document.info.summary
      delete document.workflows[0].summary
      delete stepOf(document, 1).description
    }), '1 error · 3 warnings')
    assert.equal(await status((document) => {
      stepOf(document, 0).operationId = 'deletePet'
      stepOf(document, 1).operationId = 'deletePet'
    }), '2 errors')
    assert.equal(await status((document) => delete document.info.summary), '1 warning')
  })

  const RULES = [
    ['the arazzo field is missing', (d) => delete d.arazzo,
      ['arazzo-document-schema', 'error', '#/arazzo', 'the document needs arazzo']],
    ['a step holds an unknown field "operatonId"', (d) => (stepOf(d, 1).operatonId = 'getPet'),
      ['arazzo-document-schema', 'error', '#/workflows/0/steps/1/operatonId', 'the step has an unknown field "operatonId"']],
    ['two workflows are named "adopt-pet"', (d) => d.workflows.push(structuredClone(d.workflows[0])),
      ['arazzo-workflowId-unique', 'error', '#/workflows/1/workflowId', 'two workflows are named "adopt-pet"']],
    ['two steps of "adopt-pet" are named "getPet"', (d) => (stepOf(d, 2).stepId = 'getPet'),
      ['arazzo-workflow-stepId-unique', 'error', '#/workflows/0/steps/2/stepId', 'two steps are named "getPet"']],
    ['a workflow output is "$foo"', (d) => (d.workflows[0].outputs = { pet: '$foo' }),
      ['arazzo-workflow-output-validation', 'error', '#/workflows/0/outputs/pet', '"$foo" is not a runtime expression']],
    ['a workflow output reads an output no step exposes', (d) => (d.workflows[0].outputs = { pet: '$steps.getPet.outputs.name' }),
      ['arazzo-workflow-output-validation', 'error', '#/workflows/0/outputs/pet', '"getPet" has no output "name"']],
    ['a step output is "$foo"', (d) => (stepOf(d, 0).outputs = { petId: '$foo' }),
      ['arazzo-step-output-validation', 'error', '#/workflows/0/steps/0/outputs/petId', '"$foo" is not a runtime expression']],
    ['a step sends twice the query parameter "status"', (d) => (stepOf(d, 0).parameters = [{ name: 'status', in: 'query', value: 'a' }, { name: 'status', in: 'query', value: 'b' }]),
      ['arazzo-step-parameters-validation', 'error', '#/workflows/0/steps/0/parameters/1', 'the query parameter "status" is sent twice']],
    ['a step parameter is "$foo"', (d) => (stepOf(d, 0).parameters = [{ name: 'status', in: 'query', value: '$foo' }]),
      ['arazzo-step-parameters-validation', 'error', '#/workflows/0/steps/0/parameters/0/value', '"$foo" is not a runtime expression']],
    ['a step parameter reads an output of a step that runs after it', (d) => {
      stepOf(d, 1).outputs = { id: '$response.body#/id' }
      stepOf(d, 0).parameters = [{ name: 'status', in: 'query', value: '$steps.getPet.outputs.id' }]
    }, ['arazzo-step-parameters-validation', 'error', '#/workflows/0/steps/0/parameters/0/value', '"getPet" does not run before "findPets"']],
    ['a step parameter refers to "$components.parameters.missing"', (d) => (stepOf(d, 0).parameters = [{ reference: '$components.parameters.missing' }]),
      ['arazzo-step-parameters-validation', 'error', '#/workflows/0/steps/0/parameters/0', 'the components hold no parameters.missing']],
    ['two success actions of a step are both named "done"', (d) => (stepOf(d, 0).onSuccess = [{ name: 'done', type: 'end' }, { name: 'done', type: 'end' }]),
      ['arazzo-step-success-actions-validation', 'error', '#/workflows/0/steps/0/onSuccess/1/name', 'two actions are named "done"']],
    ['a success action names both a stepId and a workflowId', (d) => (stepOf(d, 0).onSuccess = [{ name: 'next', type: 'goto', stepId: 'getPet', workflowId: 'adopt-pet' }]),
      ['arazzo-step-success-actions-validation', 'error', '#/workflows/0/steps/0/onSuccess/0', 'a goto goes either to a stepId or to a workflowId']],
    ['a failure action goes to the step "gone" the workflow does not have', (d) => (stepOf(d, 0).onFailure = [{ name: 'back', type: 'goto', stepId: 'gone' }]),
      ['arazzo-step-failure-actions-validation', 'error', '#/workflows/0/steps/0/onFailure/0', 'goes to the step "gone" the workflow does not have']],
    ['a workflow depends on the workflow "gone"', (d) => (d.workflows[0].dependsOn = ['gone']),
      ['arazzo-workflow-depends-on-validation', 'error', '#/workflows/0/dependsOn/0', 'the document has no workflow "gone"']],
    ['a success criterion has a type but no context', (d) => (stepOf(d, 0).successCriteria = [{ condition: '$statusCode == 200', type: 'simple' }]),
      ['arazzo-step-success-criteria-validation', 'error', '#/workflows/0/steps/0/successCriteria/0/context', 'a criterion with a type needs a context']],
    ['a regex success criterion has the condition "^(200"', (d) => (stepOf(d, 0).successCriteria = [{ context: '$statusCode', condition: '^(200', type: 'regex' }]),
      ['arazzo-step-success-criteria-validation', 'error', '#/workflows/0/steps/0/successCriteria/0/condition', '"^(200" is not a regular expression']],
    ['a success criterion has the context "hello"', (d) => (stepOf(d, 0).successCriteria = [{ context: 'hello', condition: '^200$', type: 'regex' }]),
      ['arazzo-step-success-criteria-validation', 'error', '#/workflows/0/steps/0/successCriteria/0/context', '"hello" is not a runtime expression']],
    ['a step calls both an operationId and a workflowId', (d) => (stepOf(d, 0).workflowId = 'adopt-pet'),
      ['arazzo-step-validation', 'error', '#/workflows/0/steps/0', 'a step calls exactly one of operationId, operationPath or workflowId']],
    ['a step calls "deletePet", which no described API offers', (d) => (stepOf(d, 0).operationId = 'deletePet'),
      ['arazzo-step-validation', 'error', '#/workflows/0/steps/0/operationId', '"deletePet" is not an operation of "petstore"']],
    ['a request body has the content type "json"', (d) => (stepOf(d, 2).requestBody = { contentType: 'json', payload: { id: 1 } }),
      ['arazzo-step-request-body-validation', 'error', '#/workflows/0/steps/2/requestBody/contentType', '"json" is not a media type such as application/json']],
    ['the title holds a "<script>" tag', (d) => (d.info.title = 'Adopt <script>alert(1)</script>'),
      ['arazzo-no-script-tags-in-markdown', 'error', '#/info/title', 'the title holds a <script> tag']],
    ['the document has no info.description', (d) => delete d.info.description,
      ['arazzo-info-description', 'warning', '#/info/description', 'the document has no info.description']],
    ['an API description has no type', (d) => delete d.sourceDescriptions[0].type,
      ['arazzo-source-descriptions-type', 'warning', '#/sourceDescriptions/0/type', 'the API description "petstore" does not say its type, openapi or arazzo']],
    ['a workflow is named "adopt pet"', (d) => (d.workflows[0].workflowId = 'adopt pet'),
      ['arazzo-workflow-workflowId', 'warning', '#/workflows/0/workflowId', 'the workflow id "adopt pet" should only use letters, digits, "_" and "-"']],
    ['a workflow has no description', (d) => delete d.workflows[0].description,
      ['arazzo-workflow-description', 'warning', '#/workflows/0/description', 'the workflow has no description']],
    ['a workflow has no summary', (d) => delete d.workflows[0].summary,
      ['arazzo-workflow-summary', 'warning', '#/workflows/0/summary', 'the workflow has no summary']],
    ['a step is named "get pet"', (d) => (stepOf(d, 1).stepId = 'get pet'),
      ['arazzo-step-stepId', 'warning', '#/workflows/0/steps/1/stepId', 'the step id "get pet" should only use letters, digits, "_" and "-"']],
    ['a step has no description', (d) => delete stepOf(d, 1).description,
      ['arazzo-step-description', 'warning', '#/workflows/0/steps/1/description', 'the step has no description']],
    ['a step calls an operationPath', (d) => {
      delete stepOf(d, 0).operationId
      stepOf(d, 0).operationPath = '{$sourceDescriptions.petstore.url}#/paths/~1pets/get'
    }, ['arazzo-step-operationPath', 'warning', '#/workflows/0/steps/0/operationPath', 'the step calls an operationPath: an operationId names the operation better']],
  ]

  describe('The canvas applies the rules of spectral:arazzo', () => {
    for (const [mistake, edit, problem] of RULES) {
      test(`a document where ${mistake}`, async () => {
        const { studio } = await openedWith(edit)
        assert.deepEqual(found(studio), [problem])
      })
    }
  })

  test('A document opened with mistakes stays editable', async () => {
    const { studio } = await studioWith({ steps: ['getPet', 'getPet'] })
    assert.deepEqual(found(studio), [['arazzo-workflow-stepId-unique', 'error', '#/workflows/0/steps/1/stepId', 'two steps are named "getPet"']])
    assert.deepEqual(studio.view().diagram.nodes.filter((node) => node.kind === 'step').map((node) => node.stepId), ['getPet', 'getPet'])
    assert.deepEqual(studio.view().diagram.nodes.map((node) => node.problems?.length), [undefined, 0, 1, undefined])
    await studio.addStep({ operation: 'petstore.findPets' })
    assert.equal(studio.view().diagram.nodes.length, 5)
  })
})

describe('Ask Copilot about the workflow', () => {
  test('Ask about a selected step', async () => {
    const getPet = { ...describedStep('getPet'), parameters: [{ name: 'petId', in: 'path', value: '$steps.findPets.outputs.petId' }, { name: 'id', in: 'query', value: '$inputs.id' }] }
    const { studio, assistant } = await studioWith({ steps: ['findPets', getPet] })

    assert.deepEqual(await studio.ask({ question: '  how do I pass the pet id?  ', stepId: 'getPet' }), { asked: true })

    assert.equal(assistant.prompts[0], [
      `About the Arazzo workflow "adopt-pet" in ${PATH}, step "getPet":`,
      'how do I pass the pet id?',
      '',
      'The step:',
      JSON.stringify(getPet, null, 2),
      '',
      'Its problems:',
      '- line 25, error arazzo-step-parameters-validation: "findPets" has no output "petId"',
      '- line 28, error arazzo-step-parameters-validation: the input "id" is not declared',
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
    const { studio, documents, assistant } = studioOn()
    documents.put(PATH, { arazzo: '1.0.1', info: { title: 't', version: '1' } })
    await studio.open({ path: PATH })
    await studio.ask({ question: 'how do I start?' })
    assert.equal(assistant.prompts[0], [
      `About the Arazzo document ${PATH}:`, 'how do I start?', '',
      `The document:\n${JSON.stringify({ arazzo: '1.0.1', info: { title: 't', version: '1' } }, null, 2)}`, '',
      'Its problems:',
      '- line 1, error arazzo-document-schema: the document needs sourceDescriptions',
      '- line 1, error arazzo-document-schema: the document needs workflows',
      '- line 1, error arazzo-step-validation: the document describes no API: add the OpenAPI description its steps call',
      '- line 2, warning arazzo-info-description: the document has no info.description',
      '- line 2, warning arazzo-info-summary: the document has no info.summary', '',
      'Change the workflow through the actions of the "arazzo" canvas (get_workflow, add_step, link_data, …) so the developer sees it.',
    ].join('\n'))
  })

  test('Ask about the workflow shown', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets'] })
    await studio.addWorkflow({ workflowId: 'order-pet' })
    await studio.ask({ question: 'what now?' })
    assert.ok(assistant.prompts[0].startsWith(`About the Arazzo workflow "order-pet" in ${PATH}:\nwhat now?\n\nThe workflow:\n{\n  "workflowId": "order-pet",`), assistant.prompts[0])
  })

  test('Ask about the whole workflow, one of its steps having no id', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets', { description: 'Read', operationId: 'getPet' }] })
    await studio.ask({ question: 'what is missing?' })
    const prompt = assistant.prompts[0]
    assert.ok(prompt.startsWith(`About the Arazzo workflow "adopt-pet" in ${PATH}:\nwhat is missing?\n\nThe workflow:\n{\n  "workflowId": "adopt-pet",`), prompt)
    assert.ok(prompt.includes('\n\nIts problems:\n- line 19, error arazzo-document-schema: the step needs stepId\n\n'), prompt)
  })

  test('Ask about a workflow keeps the problems of the document and of that workflow only', async () => {
    const { studio, assistant } = await studioWith({ steps: ['deletePet'] })
    await studio.addWorkflow({ workflowId: 'other', summary: 'Other' })
    await studio.selectWorkflow({ workflowId: 'adopt-pet' })
    await studio.ask({ question: 'why?' })
    assert.ok(assistant.prompts[0].includes('Its problems:\n- line 18, error arazzo-step-validation: "deletePet" is not an operation of "petstore"\n\n'), assistant.prompts[0])
  })

  test('Ask with nothing to ask, or about a step the workflow does not have', async () => {
    const { studio, assistant } = await studioWith({ steps: ['findPets'] })
    await assert.rejects(studio.ask({ question: '  ' }), { name: 'RefusedEdit', message: 'ask a question first' })
    await assert.rejects(studio.ask({}), { message: 'ask a question first' })
    await assert.rejects(studio.ask({ question: 'why?', stepId: 'nope' }), { message: 'the workflow "adopt-pet" has no step "nope"' })
    assert.deepEqual(assistant.prompts, [])
  })
})
