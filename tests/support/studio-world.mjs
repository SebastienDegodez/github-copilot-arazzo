// In-memory doubles of the studio's ports, and the builders the acceptance tests speak through.
import { createStudio } from '../../src/arazzo-application/studio.mjs'

export const petstore = () => ({
  openapi: '3.0.3',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { operationId: 'findPets', summary: 'Find pets', parameters: [{ name: 'status', in: 'query' }] },
      post: { summary: 'An operation without id' },
    },
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true }],
      get: { operationId: 'getPet', summary: 'Get a pet' },
    },
    '/orders': { post: { operationId: 'placeOrder', requestBody: { content: {} } } },
  },
})

export class InMemoryDocuments {
  files = new Map()
  writes = 0
  async read(path) {
    return this.files.has(path) ? structuredClone(this.files.get(path)) : null
  }
  async write(path, document) {
    this.writes++
    this.files.set(path, structuredClone(document))
  }
}

export class InMemorySources {
  apis = new Map([['petstore.yaml', petstore()]])
  async load(_documentPath, source) {
    if (!this.apis.has(source.url)) throw new Error('no such file')
    return this.apis.get(source.url)
  }
}

export class RecordingAssistant {
  prompts = []
  async ask(prompt) {
    this.prompts.push(prompt)
  }
}

export const PATH = 'workflows/adopt.arazzo.yaml'

/** A studio with the petstore API, its document open on a workflow "adopt-pet" with the steps given. */
export const studioWith = async ({ steps = [], inputs = [], outputs = {}, edit = (workflow) => workflow } = {}) => {
  const documents = new InMemoryDocuments()
  const sources = new InMemorySources()
  const assistant = new RecordingAssistant()
  documents.files.set(PATH, {
    arazzo: '1.0.1',
    info: { title: 'Adopt', version: '1.0.0' },
    sourceDescriptions: [{ name: 'petstore', url: 'petstore.yaml', type: 'openapi' }],
    workflows: [edit({
      workflowId: 'adopt-pet',
      ...(inputs.length ? { inputs: { type: 'object', properties: Object.fromEntries(inputs.map((name) => [name, { type: 'string' }])) } } : {}),
      steps: steps.map((step) => (typeof step === 'string' ? { stepId: step, operationId: step } : step)),
      ...(Object.keys(outputs).length ? { outputs } : {}),
    })],
  })
  const studio = createStudio({ documents, sources, assistant })
  await studio.open({ path: PATH })
  return { studio, documents, sources, assistant }
}

export const stepIdsOf = (studio) => studio.view().workflow.steps.map((step) => step.stepId)
export const savedWorkflow = (documents) => documents.files.get(PATH).workflows[0]
export const messagesOf = (studio) => studio.view().problems.map((problem) => problem.message)
