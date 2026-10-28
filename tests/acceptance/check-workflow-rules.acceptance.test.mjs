// features/check-workflow.feature, "The canvas applies the rules of spectral:arazzo", beyond its
// examples: each rule on each place of the document it checks, one mistake at a time in a document
// that uses everything Arazzo allows (a table, rather than a scenario per case).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { completeDocument } from '../support/complete-document.mjs'
import { PATH, petstore, studioOn } from '../support/studio-world.mjs'

const STORE = { openapi: '3.1.0', paths: { '/stock': { get: { operationId: 'getStock' } } } }

const openedWith = async (edit, prepare = () => {}) => {
  const world = studioOn()
  world.sources.apis.set('flows.arazzo.yaml', { arazzo: '1.0.1' })
  world.sources.apis.set('store.yaml', STORE)
  prepare(world.sources)
  const document = completeDocument()
  edit(document)
  world.documents.put(PATH, document)
  await world.studio.open({ path: PATH })
  return world
}

/** The problems of the document and of every workflow, as [rule, pointer, message]. */
const allProblems = async (studio) => {
  const seen = new Map()
  for (const { workflowId } of studio.view().workflows) {
    await studio.selectWorkflow({ workflowId })
    for (const { rule, pointer, message } of studio.view().problems) seen.set(`${rule} ${pointer} ${message}`, [rule, pointer, message])
  }
  if (!studio.view().workflows.length) for (const { rule, pointer, message } of studio.view().problems) seen.set(message, [rule, pointer, message])
  return [...seen.values()]
}

const flow = (d) => d.workflows[0]
const step = (d, index) => d.workflows[0].steps[index]
const SCHEMA = 'arazzo-document-schema'
const PARAMETERS = 'arazzo-step-parameters-validation'
const STEP = 'arazzo-step-validation'
const SUCCESS = 'arazzo-step-success-actions-validation'
const FAILURE = 'arazzo-step-failure-actions-validation'
const CRITERIA = 'arazzo-step-success-criteria-validation'
const S0 = '#/workflows/0/steps/0'
const S1 = '#/workflows/0/steps/1'
const S2 = '#/workflows/0/steps/2'

describe('Every rule of spectral:arazzo, on each place it checks', () => {
  test('a document using everything Arazzo allows has no problem', async () => {
    const { studio } = await openedWith(() => {})
    assert.deepEqual(await allProblems(studio), [])
    assert.equal(studio.view().status, 'valid')
  })

  const ROWS = [
    // arazzo-document-schema: the kinds of the fields
    ['a title that is not a string', (d) => (d.info.title = 42), [[SCHEMA, '#/info/title', 'the info.title of the document must be a string']]],
    ['a retryAfter that is not a number', (d) => (step(d, 0).onFailure[0].retryAfter = 'soon'), [[SCHEMA, `${S0}/onFailure/0/retryAfter`, 'the retryAfter of the action must be a number']]],
    ['a retryLimit that is not an integer', (d) => (step(d, 0).onFailure[0].retryLimit = 1.5), [[SCHEMA, `${S0}/onFailure/0/retryLimit`, 'the retryLimit of the action must be an integer']]],
    ['a request body that is not an object', (d) => (step(d, 2).requestBody = 'x'), [[SCHEMA, `${S2}/requestBody`, 'the requestBody of the step must be an object']]],
    ['inputs that are not a JSON schema', (d) => (d.workflows[1].inputs = 'x'), [[SCHEMA, '#/workflows/1/inputs', 'the inputs of the workflow must be a JSON schema']]],
    ['a parameter in an unknown place', (d) => (step(d, 0).parameters[0].in = 'form'),
      [[SCHEMA, `${S0}/parameters/0/in`, 'the in of the parameter must be one of "path", "query", "header", "cookie", "body"']]],
    ['workflows that are not a list', (d) => (d.workflows = {}), [[SCHEMA, '#/workflows', 'the workflows of the document must be a list']]],
    ['no workflow', (d) => (d.workflows = []), [[SCHEMA, '#/workflows', 'the document has no workflow']]],
    ['a step that is not an object', (d) => d.workflows.push({ workflowId: 'w', summary: 's', description: 'd', steps: ['x'] }),
      [
        [SCHEMA, '#/workflows/2/steps/0', 'item 1 of the steps of the workflow must be an object'],
        [STEP, '#/workflows/2/steps/0', 'a step calls exactly one of operationId, operationPath or workflowId'],
        ['arazzo-step-description', '#/workflows/2/steps/0/description', 'the step has no description'],
      ]],
    ['an output that is not a string', (d) => (step(d, 0).outputs.petId = 42), [
      [SCHEMA, `${S0}/outputs/petId`, '"petId" of the outputs of the step must be a string'],
      ['arazzo-step-output-validation', `${S0}/outputs/petId`, '"42" is not a runtime expression'],
    ]],
    ['an API description named with a number', (d) => d.sourceDescriptions.push({ name: 12, url: 'petstore.yaml', type: 'openapi' }),
      [[SCHEMA, '#/sourceDescriptions/2/name', 'the name of the API description must be made of letters, digits, "_" and "-"']]],
    ['an API description named with a space', (d) => d.sourceDescriptions.push({ name: 'my store', url: 'store.yaml', type: 'openapi' }),
      [[SCHEMA, '#/sourceDescriptions/2/name', 'the name of the API description must be made of letters, digits, "_" and "-"']]],
    ['an empty successCriteria', (d) => (step(d, 0).successCriteria = []), [[SCHEMA, `${S0}/successCriteria`, 'the step has no criterion in its successCriteria']]],
    // arazzo-document-schema: the fields each object allows
    ['an unknown field in a parameter', (d) => (step(d, 0).parameters[0].default = 'x'), [[SCHEMA, `${S0}/parameters/0/default`, 'the parameter has an unknown field "default"']]],
    ['an unknown field or an extension in a reference', (d) => Object.assign(step(d, 0).parameters[4], { default: 1, 'x-note': 'n' }), [
      [SCHEMA, `${S0}/parameters/4/default`, 'the reference has an unknown field "default"'],
      [SCHEMA, `${S0}/parameters/4/x-note`, 'the reference has an unknown field "x-note"'],
    ]],
    ['an unknown field in a criterion', (d) => (step(d, 0).successCriteria[0].kind = 'simple'), [[SCHEMA, `${S0}/successCriteria/0/kind`, 'the criterion has an unknown field "kind"']]],
    ['an unknown field in a success action', (d) => (step(d, 0).onSuccess[0].target = 'x'), [[SCHEMA, `${S0}/onSuccess/0/target`, 'the action has an unknown field "target"']]],
    ['an unknown field in a request body', (d) => (step(d, 2).requestBody.contentTyp = 'x'), [[SCHEMA, `${S2}/requestBody/contentTyp`, 'the request body has an unknown field "contentTyp"']]],
    ['an unknown field in a replacement', (d) => (step(d, 2).requestBody.replacements[0].path = 'x'), [[SCHEMA, `${S2}/requestBody/replacements/0/path`, 'the replacement has an unknown field "path"']]],
    ['an unknown field in the components', (d) => (d.components.schemas = {}), [[SCHEMA, '#/components/schemas', 'the components object has an unknown field "schemas"']]],
    ['a replacement without its target', (d) => delete step(d, 2).requestBody.replacements[0].target, [[SCHEMA, `${S2}/requestBody/replacements/0/target`, 'the replacement needs target']]],
    // arazzo-workflowId-unique and arazzo-workflow-stepId-unique
    ['two workflows without id', (d) => d.workflows.push({ summary: 's', description: 'd', steps: [] }, { summary: 's', description: 'd', steps: [] }), [
      [SCHEMA, '#/workflows/2/workflowId', 'the workflow needs workflowId'],
      [SCHEMA, '#/workflows/2/steps', 'the workflow has no step yet: drop an operation on it'],
      [SCHEMA, '#/workflows/3/workflowId', 'the workflow needs workflowId'],
      [SCHEMA, '#/workflows/3/steps', 'the workflow has no step yet: drop an operation on it'],
    ]],
    // arazzo-workflow-output-validation and arazzo-step-output-validation
    ['an output named with a space', (d) => (step(d, 0).outputs['my id'] = '$statusCode'),
      [['arazzo-step-output-validation', `${S0}/outputs/my id`, 'the output "my id" may only use letters, digits, ".", "_" and "-"']]],
    ['a workflow output reading a workflow the document does not have', (d) => (flow(d).outputs.petId = '$workflows.gone.outputs.x'),
      [['arazzo-workflow-output-validation', '#/workflows/0/outputs/petId', 'the document has no workflow "gone"']]],
    ['a workflow output reading a step another workflow does not have', (d) => (flow(d).outputs.petId = '$workflows.browse.steps.gone.outputs.x'),
      [['arazzo-workflow-output-validation', '#/workflows/0/outputs/petId', 'the workflow "browse" has no step "gone"']]],
    ['a workflow output reading a step another workflow has', (d) => (flow(d).outputs.petId = '$workflows.browse.steps.list.outputs.items'), []],
    // arazzo-step-parameters-validation
    ['a parameter reading a step the workflow does not have', (d) => (step(d, 0).parameters[0].value = '$steps.ghost.status'),
      [[PARAMETERS, `${S0}/parameters/0/value`, 'the workflow has no step "ghost"']]],
    ['a parameter reading an output its step does not expose', (d) => (step(d, 1).parameters[0].value = '$steps.findPets.outputs.nope'),
      [[PARAMETERS, `${S1}/parameters/0/value`, '"findPets" has no output "nope"']]],
    ['a parameter reading its own step', (d) => (step(d, 1).parameters[0].value = '$steps.getPet.outputs.name'),
      [[PARAMETERS, `${S1}/parameters/0/value`, '"getPet" does not run before "getPet"']]],
    ['a parameter of the workflow reading a step the workflow does not have', (d) => (flow(d).parameters[0].value = '$steps.ghost.outputs.x'),
      [[PARAMETERS, '#/workflows/0/parameters/0/value', 'the workflow has no step "ghost"']]],
    ['a parameter reading a component the document does not have', (d) => (step(d, 0).parameters[0].value = '$components.parameters.missing'),
      [[PARAMETERS, `${S0}/parameters/0/value`, 'the components hold no parameters.missing']]],
    ['references that do not name a parameter of the components', (d) => step(d, 0).parameters.push(
      { reference: 'x$components.parameters.page' }, { reference: '$components.parameters.page.name' }, { reference: '$components.successActions.done' }), [
      [PARAMETERS, `${S0}/parameters/5`, '"x$components.parameters.page" is not a reference to the parameters of the components'],
      [PARAMETERS, `${S0}/parameters/6`, '"$components.parameters.page.name" is not a reference to the parameters of the components'],
      [PARAMETERS, `${S0}/parameters/7`, '"$components.successActions.done" is not a reference to the parameters of the components'],
    ]],
    ['the same reference twice', (d) => step(d, 0).parameters.push({ reference: '$components.parameters.page' }),
      [[PARAMETERS, `${S0}/parameters/5`, 'the $components.parameters.page is sent twice']]],
    ['parameters with and without "in"', (d) => step(d, 0).parameters.push({ name: 'limit', value: 10 }), [
      [PARAMETERS, `${S0}/parameters`, 'the parameters all say where they go with "in", or none does'],
      [PARAMETERS, `${S0}/parameters`, 'a step calling an operation says where each parameter goes with "in"'],
    ]],
    ['a step calling a workflow with a parameter in the query', (d) => (step(d, 3).parameters[0].in = 'query'),
      [[PARAMETERS, '#/workflows/0/steps/3/parameters', 'a step calling a workflow sends its parameters without "in"']]],
    // arazzo-step-success-actions-validation and arazzo-step-failure-actions-validation
    ['two success actions of the workflow named alike', (d) => flow(d).successActions.push({ name: 'finish', type: 'end' }),
      [[SUCCESS, '#/workflows/0/successActions/2/name', 'two actions are named "finish"']]],
    ['two failure actions of the workflow named alike', (d) => flow(d).failureActions.push({ name: 'stop', type: 'end' }),
      [[FAILURE, '#/workflows/0/failureActions/2/name', 'two actions are named "stop"']]],
    ['actions referring to what the components do not hold', (d) => {
      step(d, 0).onSuccess.push({ reference: '$components.successActions.gone' }, { reference: '$components.failureActions.again' })
      step(d, 0).onFailure.push({ reference: '$components.failureActions.gone' }, { reference: '$components.successActions.done' })
      flow(d).successActions.push({ reference: '$components.parameters.page' })
      flow(d).failureActions.push({ reference: '$components.failureActions.gone' })
    }, [
      [SUCCESS, '#/workflows/0/successActions/2', '"$components.parameters.page" is not a reference to the successActions of the components'],
      [SUCCESS, `${S0}/onSuccess/2`, 'the components hold no successActions.gone'],
      [SUCCESS, `${S0}/onSuccess/3`, '"$components.failureActions.again" is not a reference to the successActions of the components'],
      [FAILURE, '#/workflows/0/failureActions/2', 'the components hold no failureActions.gone'],
      [FAILURE, `${S0}/onFailure/2`, 'the components hold no failureActions.gone'],
      [FAILURE, `${S0}/onFailure/3`, '"$components.successActions.done" is not a reference to the failureActions of the components'],
    ]],
    ['a goto going nowhere, or to a workflow the document does not have', (d) => {
      step(d, 0).onSuccess.push({ name: 'nowhere', type: 'goto' })
      step(d, 1).onFailure[0].workflowId = 'gone'
    }, [
      [SUCCESS, `${S0}/onSuccess/2`, 'a goto goes either to a stepId or to a workflowId'],
      [FAILURE, `${S1}/onFailure/0`, 'the document has no workflow "gone"'],
    ]],
    ['a retry without retryAfter', (d) => delete step(d, 0).onFailure[0].retryAfter, [[FAILURE, `${S0}/onFailure/0`, 'a retry needs retryAfter, the seconds it waits']]],
    ['a criterion of an action without condition', (d) => (step(d, 0).onSuccess[0].criteria[0].condition = ' '),
      [[CRITERIA.replace('step-success-criteria', 'step-success-actions'), `${S0}/onSuccess/0/criteria/0/condition`, 'a criterion needs a condition']]],
    // arazzo-workflow-depends-on-validation
    ['dependencies twice on a workflow, or on what no API description holds', (d) => flow(d).dependsOn.push('browse', '$foo', '$sourceDescriptions.gone.x', '$sourceDescriptions.petstore.x'), [
      ['arazzo-workflow-depends-on-validation', '#/workflows/0/dependsOn/2', 'the workflow depends twice on "browse"'],
      ['arazzo-workflow-depends-on-validation', '#/workflows/0/dependsOn/3', '"$foo" names no API description of the document'],
      ['arazzo-workflow-depends-on-validation', '#/workflows/0/dependsOn/4', '"$sourceDescriptions.gone.x" names no API description of the document'],
      ['arazzo-workflow-depends-on-validation', '#/workflows/0/dependsOn/5', 'the API description "petstore" is not an Arazzo document: it has no workflow to call'],
    ]],
    // arazzo-step-success-criteria-validation
    ['criteria without condition, of an unknown type, or of a type object without version', (d) => step(d, 0).successCriteria.push(
      { condition: 42 }, { condition: '' }, { context: '$statusCode', condition: 'x', type: 'regexp' }, { context: '$statusCode', condition: 'x', type: { type: 'jsonpath' } }), [
      [SCHEMA, `${S0}/successCriteria/5/condition`, 'the condition of the criterion must be a string'],
      [CRITERIA, `${S0}/successCriteria/5/condition`, 'a criterion needs a condition'],
      [CRITERIA, `${S0}/successCriteria/6/condition`, 'a criterion needs a condition'],
      [CRITERIA, `${S0}/successCriteria/7/type`, 'the type of a criterion is one of simple, regex, jsonpath, xpath, not "regexp"'],
      [CRITERIA, `${S0}/successCriteria/8/type`, 'the type of a criterion names its type and its version'],
    ]],
    ['a condition reading a step the workflow does not have', (d) => (step(d, 0).successCriteria[0].condition = '$steps.ghost.outputs.ok == true'),
      [[CRITERIA, `${S0}/successCriteria/0/condition`, 'the workflow has no step "ghost"']]],
    // arazzo-step-request-body-validation
    ['content types that are not media types', (d) => {
      step(d, 2).requestBody.contentType = 'xapplication/json'
      d.workflows[1].steps[0].requestBody = { contentType: 'application/json;charset=utf-8' }
    }, [
      ['arazzo-step-request-body-validation', `${S2}/requestBody/contentType`, '"xapplication/json" is not a media type such as application/json'],
      ['arazzo-step-request-body-validation', '#/workflows/1/steps/0/requestBody/contentType', '"application/json;charset=utf-8" is not a media type such as application/json'],
    ]],
    ['a payload and a replacement that are not runtime expressions', (d) => {
      step(d, 2).requestBody.payload = '$foo'
      step(d, 2).requestBody.replacements[0].value = '$bar'
    }, [
      ['arazzo-step-request-body-validation', `${S2}/requestBody/payload`, '"$foo" is not a runtime expression'],
      ['arazzo-step-request-body-validation', `${S2}/requestBody/replacements/0/value`, '"$bar" is not a runtime expression'],
    ]],
    // arazzo-step-validation
    ['operation paths of no known form or API', (d) => {
      delete step(d, 1).operationId
      step(d, 1).operationPath = 'x{$sourceDescriptions.petstore.url}#/paths'
      delete d.workflows[1].steps[0].operationId
      d.workflows[1].steps[0].operationPath = '{$sourceDescriptions.gone.url}#/paths'
      delete d.workflows[1].steps[1].operationId
      d.workflows[1].steps[1].operationPath = '{$sourceDescriptions.flows.url}#/workflows/0'
    }, [
      [STEP, `${S1}/operationPath`, '"x{$sourceDescriptions.petstore.url}#/paths" names an operation as {$sourceDescriptions.<name>.url}#<JSON pointer>'],
      ['arazzo-step-operationPath', `${S1}/operationPath`, 'the step calls an operationPath: an operationId names the operation better'],
      [STEP, '#/workflows/1/steps/0/operationPath', '"{$sourceDescriptions.gone.url}#/paths" names no API description of the document'],
      ['arazzo-step-operationPath', '#/workflows/1/steps/0/operationPath', 'the step calls an operationPath: an operationId names the operation better'],
      ['arazzo-step-operationPath', '#/workflows/1/steps/1/operationPath', 'the step calls an operationPath: an operationId names the operation better'],
    ]],
    ['operations named of no known form or API', (d) => {
      step(d, 0).operationId = '$petstore.findPets'
      step(d, 1).operationId = '$sourceDescriptions.gone.getPet'
      step(d, 2).operationId = '$sourceDescriptions.store.placeOrder'
      d.sourceDescriptions.push({ name: 'store', url: 'store.yaml', type: 'openapi' })
      d.workflows[1].steps[0].operationId = 'x$sourceDescriptions.petstore.findPets'
    }, [
      [STEP, `${S0}/operationId`, '"$petstore.findPets" names an operation as $sourceDescriptions.<name>.<operationId>'],
      [STEP, `${S1}/operationId`, '"$sourceDescriptions.gone.getPet" names no API description of the document'],
      [STEP, `${S2}/operationId`, '"$sourceDescriptions.store.placeOrder" is not an operation of "store"'],
      [STEP, '#/workflows/1/steps/0/operationId', '"x$sourceDescriptions.petstore.findPets" is not an operation of "petstore", "store"'],
    ]],
    ['an operation of an API that cannot be read', (d) => {
      d.sourceDescriptions.push({ name: 'store', url: 'store.yaml', type: 'openapi' })
      step(d, 2).operationId = '$sourceDescriptions.store.placeOrder'
      d.workflows[1].steps[0].operationId = 'searchPets'
    }, [
      [STEP, '#/sourceDescriptions/2/url', 'the API description "store" cannot be read: "store.yaml" is larger than 5 MB'],
    ], (sources) => sources.states.set('store.yaml', { state: 'too large' })],
    ['no API description', (d) => {
      d.sourceDescriptions = []
      delete flow(d).dependsOn
      step(d, 1).onFailure.pop()
    }, [[STEP, '#/sourceDescriptions', 'the document describes no API: add the OpenAPI description its steps call']]],
    // arazzo-no-script-tags-in-markdown, and the warnings
    ['a description holding a script, and a summary', (d) => {
      step(d, 0).description = 'Find <script>x</script>'
      flow(d).summary = 'Adopt <script>x</script>'
    }, [['arazzo-no-script-tags-in-markdown', `${S0}/description`, 'the description holds a <script> tag']]],
    ['no info.summary', (d) => delete d.info.summary, [['arazzo-info-summary', '#/info/summary', 'the document has no info.summary']]],
  ]

  for (const [mistake, edit, expected, prepare] of ROWS) {
    test(mistake, async () => {
      const { studio } = await openedWith(edit, prepare)
      assert.deepEqual(await allProblems(studio), expected)
    })
  }

  test('the version of Arazzo is 1.0.x', async () => {
    const problemsOf = async (arazzo) => (await allProblems((await openedWith((d) => (d.arazzo = arazzo))).studio))
    for (const valid of ['1.0.0', '1.0.12', '1.0.1-rc']) assert.deepEqual(await problemsOf(valid), [], valid)
    for (const invalid of ['1.1.0', 'x1.0.1', '1.0.1 final', '1.0', 101]) {
      assert.deepEqual(await problemsOf(invalid), [[SCHEMA, '#/arazzo', 'the arazzo of the document must be an Arazzo version 1.0.x']], String(invalid))
    }
  })

  test('a problem of the document belongs to no workflow, a problem of a workflow to no step', async () => {
    const { studio } = await openedWith((d) => {
      delete d.sourceDescriptions[1].type
      flow(d).dependsOn.push('gone')
    })
    assert.deepEqual(studio.view().problems.map(({ line, ...problem }) => problem), [
      { rule: 'arazzo-workflow-depends-on-validation', severity: 'error', pointer: '#/workflows/0/dependsOn/2', workflowId: 'adopt-pet', message: 'the document has no workflow "gone"' },
      { rule: 'arazzo-source-descriptions-type', severity: 'warning', pointer: '#/sourceDescriptions/1/type', message: 'the API description "flows" does not say its type, openapi or arazzo' },
    ])
  })

  test('a document holding anything where it expects a list or an object stays open', async () => {
    const world = studioOn()
    world.documents.put(PATH, {
      arazzo: '1.0.1', info: { title: 't', summary: 's', description: 'd', version: '1' },
      sourceDescriptions: [null, { name: 'petstore', url: 'petstore.yaml', type: 'openapi' }],
      workflows: [{
        workflowId: 'w', summary: 's', description: 'd', inputs: { properties: 'x' }, dependsOn: 'x', outputs: 'x', parameters: [null],
        steps: [null, { stepId: 'a', description: 'd', operationId: 'findPets', parameters: 'x', outputs: 'x', onSuccess: [null], successCriteria: [null], requestBody: { payload: { a: 1 }, replacements: 'x' } }],
      }, null],
    })
    await world.studio.open({ path: PATH })
    assert.deepEqual(world.studio.view().diagram.nodes.map((node) => node.stepId), [undefined, undefined, 'a', undefined])
    assert.deepEqual(world.studio.view().workflow.steps.map((step) => [step.stepId, step.slots.length, step.successCriteria]), [[undefined, 0, []], ['a', 2, [undefined]]])
    assert.deepEqual((await allProblems(world.studio)).map(([rule, pointer, message]) => `${rule} ${pointer} ${message}`), [
      'arazzo-document-schema #/sourceDescriptions/0 item 1 of the sourceDescriptions of the document must be an object',
      'arazzo-document-schema #/workflows/0/dependsOn the dependsOn of the workflow must be a list',
      'arazzo-document-schema #/workflows/0/outputs the outputs of the workflow must be an object',
      'arazzo-document-schema #/workflows/0/parameters/0 item 1 of the parameters of the workflow must be an object',
      'arazzo-document-schema #/workflows/0/steps/0 item 1 of the steps of the workflow must be an object',
      'arazzo-document-schema #/workflows/0/steps/1/parameters the parameters of the step must be a list',
      'arazzo-document-schema #/workflows/0/steps/1/outputs the outputs of the step must be an object',
      'arazzo-document-schema #/workflows/0/steps/1/onSuccess/0 item 1 of the onSuccess of the step must be an object',
      'arazzo-document-schema #/workflows/0/steps/1/successCriteria/0 item 1 of the successCriteria of the step must be an object',
      'arazzo-document-schema #/workflows/0/steps/1/requestBody/replacements the replacements of the request body must be a list',
      'arazzo-step-success-criteria-validation #/workflows/0/steps/1/successCriteria/0/condition a criterion needs a condition',
      'arazzo-step-validation #/sourceDescriptions/0/url the API description "undefined" cannot be read: no file "undefined" exists next to the document',
      'arazzo-step-validation #/workflows/0/steps/0 a step calls exactly one of operationId, operationPath or workflowId',
      'arazzo-source-descriptions-type #/sourceDescriptions/0/type the API description "undefined" does not say its type, openapi or arazzo',
      'arazzo-step-description #/workflows/0/steps/0/description the step has no description',
      'arazzo-document-schema #/workflows/1 item 2 of the workflows of the document must be an object',
      'arazzo-workflow-description #/workflows/1/description the workflow has no description',
      'arazzo-workflow-summary #/workflows/1/summary the workflow has no summary',
    ])
  })
})
