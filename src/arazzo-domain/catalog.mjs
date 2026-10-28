// The API descriptions a document names, as the canvas could read them, and the operations of the
// OpenAPI ones as a palette of steps to drop on a workflow.
import { mapOf, objectsOf } from './lists.mjs'

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const QUALIFIED = /^\$sourceDescriptions\.([A-Za-z0-9_-]+)\.(.+)/

const parametersOf = (pathItem, operation) => {
  const byKey = new Map()
  for (const parameter of [...objectsOf(pathItem.parameters), ...objectsOf(operation.parameters)]) {
    if (parameter.name) byKey.set(`${parameter.in}:${parameter.name}`, { name: parameter.name, in: parameter.in, required: parameter.required === true })
  }
  return [...byKey.values()]
}

/** Every operation of an OpenAPI document that carries an operationId. */
export const operationsOf = (source, openapi) =>
  Object.entries(mapOf(openapi.paths)).flatMap(([path, item]) => {
    const pathItem = mapOf(item)
    return METHODS.filter((method) => pathItem[method]?.operationId).map((method) => {
      const operation = pathItem[method]
      return {
        source,
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? '',
        parameters: parametersOf(pathItem, operation),
        body: Boolean(operation.requestBody),
      }
    })
  })

/** The operation a step's operationId names, plain or qualified by its API description. */
export const findOperation = (operations, operationId) => {
  const [, source, id] = QUALIFIED.exec(operationId) ?? [null, null, operationId]
  return operations.find((operation) => operation.operationId === id && (source === null || operation.source === source))
}

/** How a step names an operation: plainly with a single API description, qualified with several. */
export const operationIdFor = (operation, sourceCount) =>
  sourceCount > 1 ? `$sourceDescriptions.${operation.source}.${operation.operationId}` : operation.operationId

const kindOf = (description) => {
  if (description?.openapi !== undefined || description?.swagger !== undefined) return 'openapi'
  return description?.arazzo === undefined ? null : 'arazzo'
}

const WHY = {
  'not found': (url) => `no file "${url}" exists next to the document`,
  invalid: (url) => `"${url}" is neither YAML nor JSON`,
  'not a description': (url) => `"${url}" is not an OpenAPI or Arazzo description`,
  'too large': (url) => `"${url}" is larger than 5 MB`,
  unreachable: (url, detail) => `"${url}" cannot be fetched: ${detail}`,
}

/**
 * An API description as the canvas read it: its state (read, not found, invalid, not a description,
 * too large or unreachable), why it cannot be read — naming its url as the document writes it — and
 * the operations it offers.
 * @param {object} source the source description of the document
 * @param {{ state: string, description?: object, detail?: string }} loaded what reading its url gave
 */
export const readSource = (source, loaded) => {
  const kind = kindOf(loaded.description)
  const state = loaded.state === 'read' && kind === null ? 'not a description' : loaded.state
  const operations = kind === 'openapi' ? operationsOf(source.name, loaded.description) : []
  return {
    source: {
      name: source.name, url: source.url, type: source.type ?? kind, state, operations: operations.length,
      ...(state === 'read' ? {} : { message: WHY[state](source.url, loaded.detail) }),
    },
    operations,
  }
}

const callsSource = (step, name, offered) =>
  [step.operationId, step.workflowId].some((call) => typeof call === 'string' && call.startsWith(`$sourceDescriptions.${name}.`))
  || String(step.operationPath).startsWith(`{$sourceDescriptions.${name}.`)
  || offered.includes(step.operationId)

/** The ids of the steps, of any workflow, that call an API description. */
export const stepsCalling = (document, name, operations) => {
  const offered = operations.filter((operation) => operation.source === name).map((operation) => operation.operationId)
  return objectsOf(document.workflows).flatMap((workflow) => objectsOf(workflow.steps))
    .filter((step) => callsSource(step, name, offered)).map((step) => step.stepId)
}

