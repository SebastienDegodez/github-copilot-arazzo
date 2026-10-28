// Arazzo runtime expressions a workflow passes between its inputs, its steps and its outputs.
const INPUT = /\$inputs\.([A-Za-z0-9_-]+)/g
const STEP = /\$steps\.([A-Za-z0-9_-]+)(?:\.outputs\.([A-Za-z0-9_-]+))?/g
const PREFIXES = ['$url', '$method', '$statusCode', '$request.', '$response.', '$message.', '$inputs.', '$outputs.', '$steps.',
  '$workflows.', '$sourceDescriptions.', '$components.inputs.', '$components.parameters.', '$components.successActions.', '$components.failureActions.']

export const inputExpression = (name) => `$inputs.${name}`
export const stepOutputExpression = (stepId, output) => `$steps.${stepId}.outputs.${output}`

/** Whether a value is a runtime expression of the Arazzo specification, by the source it reads. */
export const isRuntimeExpression = (value) => typeof value === 'string' && PREFIXES.some((prefix) => value.startsWith(prefix))

/**
 * The workflow inputs and the steps a value refers to, however deep, in the order they appear: `outputs`
 * holds the step outputs it reads. An expression holds no quote nor backslash, so it reads the same in
 * the JSON of the value.
 */
export const referencesIn = (value) => {
  const text = JSON.stringify([value])
  const steps = [...text.matchAll(STEP)].map(([, stepId, output]) => ({ stepId, output }))
  return {
    inputs: [...text.matchAll(INPUT)].map(([, name]) => name),
    steps,
    outputs: steps.filter((step) => step.output !== undefined),
  }
}
