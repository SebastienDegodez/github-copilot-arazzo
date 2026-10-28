// A document that uses every object, field and value Arazzo 1.0.x allows, valid by every rule of
// spectral:arazzo: what the rule tests break one piece at a time.
export const completeDocument = () => ({
  arazzo: '1.0.1',
  'x-generator': 'tests',
  info: { title: 'Adopt', summary: 'Adopt a pet', description: 'Find a pet and order it', version: '1.0.0', 'x-team': 'pets' },
  sourceDescriptions: [
    { name: 'petstore', url: 'petstore.yaml', type: 'openapi', 'x-owner': 'pets' },
    { name: 'flows', url: 'flows.arazzo.yaml', type: 'arazzo' },
  ],
  workflows: [
    {
      workflowId: 'adopt-pet', summary: 'Adopt a pet', description: 'Find a pet, read it, order it', 'x-order': 1,
      inputs: { type: 'object', properties: { status: { type: 'string' }, quantity: { type: 'integer' } } },
      dependsOn: ['browse', '$sourceDescriptions.flows.other'],
      parameters: [{ name: 'X-Trace', in: 'header', value: '$inputs.status', 'x-note': 'trace' }, { reference: '$components.parameters.page', value: 2 }],
      successActions: [{ name: 'finish', type: 'end', 'x-note': 'done' }, { reference: '$components.successActions.done' }],
      failureActions: [{ name: 'stop', type: 'end' }, { reference: '$components.failureActions.again' }],
      steps: [
        {
          stepId: 'findPets', description: 'Find the pets', operationId: 'findPets', 'x-note': 'first',
          parameters: [
            { name: 'status', in: 'query', value: '$inputs.status' }, { name: 'session', in: 'cookie', value: 'abc' },
            { name: 'note', in: 'body', value: 'x' }, { name: 'X-Url', in: 'header', value: '$url' }, { reference: '$components.parameters.page' },
          ],
          successCriteria: [
            { condition: '$statusCode == 200 && ($response.body#/ok == true' },
            { context: '$statusCode', condition: '$statusCode == 200', type: 'simple' },
            { context: '$response.body', condition: '$[?count > 0', type: 'jsonpath' },
            { context: '$response.body', condition: '//pet', type: 'xpath' },
            { context: '$response.body', condition: '/pets', type: { type: 'xpath', version: 'xpath-30' } },
          ],
          outputs: { petId: '$response.body#/0/id', 'pet.name': '$response.body#/0/name' },
          onSuccess: [{ name: 'next', type: 'goto', stepId: 'getPet', criteria: [{ condition: '$statusCode == 200' }] }, { reference: '$components.successActions.done' }],
          onFailure: [
            { name: 'again', type: 'retry', retryAfter: 1.5, retryLimit: 2, criteria: [{ context: '$statusCode', condition: '^5', type: 'regex' }] },
            { reference: '$components.failureActions.again' },
          ],
        },
        {
          stepId: 'getPet', description: 'Read the pet', operationId: '$sourceDescriptions.petstore.getPet',
          parameters: [{ name: 'petId', in: 'path', value: '$steps.findPets.outputs.petId' }],
          outputs: {
            name: '$response.body#/name', code: '$statusCode', found: '$steps.findPets.statusCode', method: '$method', url: '$url', header: '$response.header.X', request: '$request.body',
            message: '$message.payload', input: '$inputs.status', out: '$outputs.x', source: '$sourceDescriptions.petstore.url', input2: '$components.inputs.page',
            parameter: '$components.parameters.page', success: '$components.successActions.done', failure: '$components.failureActions.again',
            other: '$workflows.browse.outputs.list', otherStep: '$workflows.browse.steps.list.outputs.items',
          },
          onFailure: [{ name: 'flow', type: 'goto', workflowId: 'browse' }, { name: 'remote', type: 'goto', workflowId: '$sourceDescriptions.flows.other' }],
        },
        {
          stepId: 'placeOrder', description: 'Order the pet', operationId: 'placeOrder',
          requestBody: {
            contentType: 'application/json', 'x-note': 'body',
            payload: { petId: '$steps.getPet.outputs.name', quantity: '$inputs.quantity' },
            replacements: [{ target: '/note', value: '$steps.findPets.outputs.petId' }],
          },
        },
        { stepId: 'nested', description: 'Browse the pets', workflowId: 'browse', parameters: [{ name: 'page', value: 1 }] },
      ],
      outputs: { petId: '$steps.findPets.outputs.petId' },
    },
    {
      workflowId: 'browse', summary: 'Browse', description: 'Browse the pets', inputs: true,
      steps: [
        { stepId: 'list', description: 'List the pets', operationId: 'findPets', outputs: { items: '$response.body' } },
        { stepId: 'count', description: 'Count the pets', operationId: 'findPets' },
      ],
      outputs: { list: '$steps.list.outputs.items' },
    },
  ],
  components: {
    inputs: { page: { type: 'integer' } },
    parameters: { page: { name: 'page', in: 'query', value: 1 } },
    successActions: { done: { name: 'done', type: 'end' } },
    failureActions: { again: { name: 'again', type: 'retry', retryAfter: 1, retryLimit: 3 } },
    'x-shared': true,
  },
})
