// The operations an OpenAPI description offers, as a palette of steps to drop on a workflow.
import { listOf } from './lists.mjs'

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const QUALIFIED = /^\$sourceDescriptions\.([A-Za-z0-9_-]+)\.(.+)/

const parametersOf = (pathItem, operation) => {
  const byKey = new Map()
  for (const parameter of [...listOf(pathItem.parameters), ...listOf(operation.parameters)]) {
    if (parameter.name) byKey.set(`${parameter.in}:${parameter.name}`, { name: parameter.name, in: parameter.in, required: parameter.required === true })
  }
  return [...byKey.values()]
}

/** Every operation of an OpenAPI document that carries an operationId. */
export const operationsOf = (source, openapi) =>
  Object.entries(openapi.paths ?? {}).flatMap(([path, pathItem]) =>
    METHODS.filter((method) => pathItem[method]?.operationId).map((method) => {
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
    }))

/** The operation a step's operationId names, plain or qualified by its API description. */
export const findOperation = (operations, operationId) => {
  const [, source, id] = QUALIFIED.exec(operationId) ?? [null, null, operationId]
  return operations.find((operation) => operation.operationId === id && (source === null || operation.source === source))
}

/** How a step names an operation: plainly with a single API description, qualified with several. */
export const operationIdFor = (operation, sourceCount) =>
  sourceCount > 1 ? `$sourceDescriptions.${operation.source}.${operation.operationId}` : operation.operationId
