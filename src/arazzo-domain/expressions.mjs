// Arazzo runtime expressions a workflow passes between its inputs, its steps and its outputs.
const INPUT = /\$inputs\.([A-Za-z0-9_-]+)/g
const STEP_OUTPUT = /\$steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g

export const inputExpression = (name) => `$inputs.${name}`
export const stepOutputExpression = (stepId, output) => `$steps.${stepId}.outputs.${output}`

/**
 * The workflow inputs and the step outputs a value refers to, however deep, in the order they
 * appear. An expression holds no quote nor backslash, so it reads the same in the JSON of the value.
 */
export const referencesIn = (value) => {
  const text = JSON.stringify([value])
  return {
    inputs: [...text.matchAll(INPUT)].map(([, name]) => name),
    outputs: [...text.matchAll(STEP_OUTPUT)].map(([, stepId, output]) => ({ stepId, output })),
  }
}
