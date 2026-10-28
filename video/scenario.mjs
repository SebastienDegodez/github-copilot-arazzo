// The story the video tells, played on the real studio of the canvas with in-memory ports: every
// diagram, problem and line of YAML the video shows is what the plugin computes for that edit.
import { createStudio } from '../src/arazzo-application/studio.mjs'
import { yamlCodec } from '../src/infrastructure/yaml-codec.mjs'

export const PATH = 'workflows/adopt.arazzo.yaml'

export const QUESTION = 'Pass the pet found to getPet, retry the order if it fails, and return the order id.'

const petstore = {
  openapi: '3.0.3',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': { get: { operationId: 'findPets', summary: 'Find pets by status', parameters: [{ name: 'status', in: 'query' }] } },
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true }],
      get: { operationId: 'getPet', summary: 'Get a pet' },
    },
    '/orders': { post: { operationId: 'placeOrder', summary: 'Order a pet', requestBody: { content: { 'application/json': {} } } } },
  },
}

/**
 * The edits of the video, in order. `by` says who makes it: the developer on the canvas, or Copilot
 * through the canvas action named `action`.
 */
export const EDITS = [
  { id: 'open', by: 'copilot', action: 'open_canvas', label: 'arazzo', run: (studio) => studio.open({ path: PATH, workflowId: 'adopt-pet', sources: [{ name: 'petstore', url: '../apis/petstore.yaml' }] }) },
  { id: 'input', by: 'copilot', action: 'add_input', label: 'status', run: (studio) => studio.addInput({ name: 'status', type: 'string' }) },
  { id: 'findPets', by: 'developer', run: (studio) => studio.addStep({ operation: 'petstore.findPets' }) },
  { id: 'getPet', by: 'developer', run: (studio) => studio.addStep({ operation: 'petstore.getPet' }) },
  { id: 'placeOrder', by: 'developer', run: (studio) => studio.addStep({ operation: 'petstore.placeOrder' }) },
  { id: 'status', by: 'developer', run: (studio) => studio.linkData({ from: { input: 'status' }, to: { stepId: 'findPets', name: 'status', in: 'query' } }) },
  { id: 'petIdOut', by: 'copilot', action: 'set_step_output', label: 'findPets.petId', run: (studio) => studio.setStepOutput({ stepId: 'findPets', name: 'petId', expression: '$response.body#/0/id' }) },
  { id: 'petIdIn', by: 'copilot', action: 'link_data', label: 'petId → getPet', run: (studio) => studio.linkData({ from: { stepId: 'findPets', output: 'petId' }, to: { stepId: 'getPet', name: 'petId', in: 'path' } }) },
  { id: 'retry', by: 'copilot', action: 'add_action', label: 'placeOrder · retry ×3', run: (studio) => studio.addAction({ stepId: 'placeOrder', on: 'failure', type: 'retry', retryLimit: 3, retryAfter: 2 }) },
  { id: 'orderIdOut', by: 'copilot', action: 'set_step_output', label: 'placeOrder.orderId', run: (studio) => studio.setStepOutput({ stepId: 'placeOrder', name: 'orderId', expression: '$response.body#/id' }) },
  { id: 'orderId', by: 'copilot', action: 'add_workflow_output', label: 'orderId', run: (studio) => studio.addWorkflowOutput({ name: 'orderId', stepId: 'placeOrder', output: 'orderId' }) },
]

/**
 * Plays the edits on a fresh studio.
 * @returns {Promise<{ states: Record<string, { view: object, yaml: string }>, prompt: string }>}
 *   the view and saved YAML after each edit, and the prompt "Ask Copilot" hands to the chat
 */
export const playScenario = async () => {
  const files = new Map()
  const prompts = []
  const studio = createStudio({
    documents: {
      read: async (path) => files.get(path) ?? null,
      write: async (path, text) => void files.set(path, text),
    },
    codec: yamlCodec(),
    sources: { load: async () => ({ state: 'read', description: petstore }), candidates: async () => [] },
    preferences: { read: async () => ({ autosave: true }), write: async () => {} },
    assistant: { ask: async (prompt) => void prompts.push(prompt) },
    clock: { now: () => new Date(0) },
  })
  const states = {}
  for (const edit of EDITS) {
    await edit.run(studio)
    states[edit.id] = { view: structuredClone(studio.view()), yaml: files.get(PATH) }
    if (edit.id === 'status') await studio.ask({ question: QUESTION, stepId: 'getPet' })
  }
  return { states, prompt: prompts[0] }
}
