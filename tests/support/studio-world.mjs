// In-memory doubles of the studio's ports, and the builders the acceptance tests speak through. The
// codec is the real one: it is a pure translation between the text of a document and its object.
import { createStudio } from '../../src/arazzo-application/studio.mjs'
import { yamlCodec } from '../../src/infrastructure/yaml-codec.mjs'

export const codec = yamlCodec()
export const PATH = 'workflows/adopt.arazzo.yaml'
export const NOW = '2026-10-28T16:50:00.000Z'

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

/** The document files, as texts. */
export class InMemoryDocuments {
  files = new Map()
  writes = 0
  failure = null
  async read(path) {
    return this.files.get(path) ?? null
  }
  async write(path, text) {
    if (this.failure) throw new Error(this.failure)
    this.writes++
    this.files.set(path, text)
  }
  /** Writes a document as another tool would. */
  put(path, document) {
    this.files.set(path, codec.merge(path, null, document))
  }
  /** The document the file holds. */
  saved(path = PATH) {
    return codec.parse(this.files.get(path)).document
  }
}

/** The API descriptions of the workspace, by url; a url may be given a state the canvas reads it in. */
export class InMemorySources {
  apis = new Map([['petstore.yaml', petstore()]])
  states = new Map()
  async load(_documentPath, source) {
    if (this.states.has(source.url)) return this.states.get(source.url)
    return this.apis.has(source.url) ? { state: 'read', description: this.apis.get(source.url) } : { state: 'not found' }
  }
  async candidates() {
    return [...this.apis.keys()]
  }
}

export class InMemoryPreferences {
  settings = {}
  async read() {
    return { ...this.settings }
  }
  async write(settings) {
    Object.assign(this.settings, settings)
  }
}

export class RecordingAssistant {
  prompts = []
  async ask(prompt) {
    this.prompts.push(prompt)
  }
}

export const clock = { now: () => new Date(NOW) }

/** A studio on in-memory ports; `preferences` carries the choices of an earlier session. */
export const studioOn = ({ documents = new InMemoryDocuments(), sources = new InMemorySources(), preferences = new InMemoryPreferences(), assistant = new RecordingAssistant() } = {}) =>
  ({ studio: createStudio({ documents, codec, sources, preferences, assistant, clock }), documents, sources, preferences, assistant })

/** A step as the builders write it: an id calling the operation of the same name, described. */
export const describedStep = (stepId) => ({ stepId, description: `The step ${stepId}`, operationId: stepId })

/** A valid document with the petstore API and a workflow "adopt-pet" with the steps given. */
export const adoptDocument = ({ steps = [], inputs = [], outputs = {}, edit = (workflow) => workflow } = {}) => ({
  arazzo: '1.0.1',
  info: { title: 'Adopt', summary: 'Adopt a pet', description: 'Find a pet and order it', version: '1.0.0' },
  sourceDescriptions: [{ name: 'petstore', url: 'petstore.yaml', type: 'openapi' }],
  workflows: [edit({
    workflowId: 'adopt-pet',
    summary: 'Adopt a pet',
    description: 'Find a pet, read it and order it',
    ...(inputs.length ? { inputs: { type: 'object', properties: Object.fromEntries(inputs.map((name) => [name, { type: 'string' }])) } } : {}),
    steps: steps.map((step) => (typeof step === 'string' ? describedStep(step) : step)),
    ...(Object.keys(outputs).length ? { outputs } : {}),
  })],
})

/** A studio with the petstore API, its document open on a workflow "adopt-pet" with the steps given. */
export const studioWith = async (options = {}) => {
  const world = studioOn(options)
  world.documents.put(PATH, adoptDocument(options))
  await world.studio.open({ path: PATH })
  return world
}

export const stepIdsOf = (studio) => studio.view().workflow.steps.map((step) => step.stepId)
export const savedWorkflow = (documents) => documents.saved().workflows[0]
export const messagesOf = (studio) => studio.view().problems.map((problem) => problem.message)
export const errorsOf = (studio) => studio.view().problems.filter((problem) => problem.severity === 'error').map((problem) => problem.message)
