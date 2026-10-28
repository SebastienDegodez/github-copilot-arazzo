// Edits of an Arazzo document. Each takes a document and returns a new one, or refuses with a
// RefusedEdit telling why; the document given is never changed.
import { stepsCalling } from './catalog.mjs'
import { inputExpression, stepOutputExpression } from './expressions.mjs'
import { listOf, mapOf, objectsOf } from './lists.mjs'
import { RefusedEdit } from './refused-edit.mjs'

export const ARAZZO_VERSION = '1.0.1'
const NAME = /^[A-Za-z0-9_-]+$/
const PARAMETER_PLACES = ['path', 'query', 'header', 'cookie', 'body']

export const newDocument = ({ title, workflowId }) => ({
  arazzo: ARAZZO_VERSION,
  info: { title, version: '1.0.0' },
  sourceDescriptions: [],
  workflows: [{ workflowId, steps: [] }],
})

const named = (kind, name) => {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new RefusedEdit(`${kind} "${name ?? ''}" must only use letters, digits, "_" and "-"`)
  }
  return name
}

export const workflowsOf = (document) => objectsOf(document.workflows)

export const findWorkflow = (document, workflowId) => {
  const workflow = workflowsOf(document).find((each) => each.workflowId === workflowId)
  if (!workflow) throw new RefusedEdit(`the document has no workflow "${workflowId}"`)
  return workflow
}

const stepsOf = (workflow) => objectsOf(workflow.steps)

const indexOfStep = (workflow, stepId) => {
  const index = stepsOf(workflow).findIndex((step) => step.stepId === stepId)
  if (index < 0) throw new RefusedEdit(`the workflow "${workflow.workflowId}" has no step "${stepId}"`)
  return index
}

/** Applies a change to a copy of one workflow of a copy of the document. */
const changeWorkflow = (document, workflowId, change) => {
  const copy = structuredClone(document)
  change(findWorkflow(copy, workflowId))
  return copy
}

const changeStep = (document, workflowId, stepId, change) =>
  changeWorkflow(document, workflowId, (workflow) => change(workflow.steps[indexOfStep(workflow, stepId)], workflow))

export const addSource = (document, { name, url, type = 'openapi' }) => {
  named('the API description name', name)
  if (!url) throw new RefusedEdit(`the API description "${name}" needs a url`)
  if (objectsOf(document.sourceDescriptions).some((source) => source.name === name)) {
    throw new RefusedEdit(`the document already describes an API named "${name}"`)
  }
  const copy = structuredClone(document)
  copy.sourceDescriptions = [...listOf(copy.sourceDescriptions), { name, url, type }]
  return copy
}

const quoted = (names) => names.map((name) => `"${name}"`)
const sentence = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0])

/** Removes an API description no step calls. */
export const removeSource = (document, { name }, operations) => {
  const index = objectsOf(document.sourceDescriptions).findIndex((source) => source.name === name)
  if (index < 0) throw new RefusedEdit(`the document describes no API named "${name}"`)
  const callers = stepsCalling(document, name, operations)
  if (callers.length) {
    throw new RefusedEdit(`the API "${name}" cannot be removed: the step${callers.length > 1 ? 's' : ''} ${sentence(quoted(callers))} call${callers.length > 1 ? '' : 's'} it`)
  }
  const copy = structuredClone(document)
  copy.sourceDescriptions.splice(index, 1)
  return copy
}

export const addWorkflow = (document, { workflowId, summary }) => {
  named('the workflow id', workflowId)
  if (workflowsOf(document).some((workflow) => workflow.workflowId === workflowId)) {
    throw new RefusedEdit(`the document already has a workflow "${workflowId}"`)
  }
  const copy = structuredClone(document)
  copy.workflows = [...listOf(copy.workflows), { workflowId, ...(summary ? { summary } : {}), steps: [] }]
  return copy
}

/** The id a new step gets: the one asked, or its operation's name, made unique with a number. */
const freeStepId = (workflow, wanted) => {
  const taken = new Set(stepsOf(workflow).map((step) => step.stepId))
  let stepId = wanted
  for (let n = 2; taken.has(stepId); n++) stepId = `${wanted}-${n}`
  return stepId
}

export const addStep = (document, workflowId, { operationId, stepId, before }) => {
  if (!operationId) throw new RefusedEdit('a step needs the operation it calls')
  const wanted = named('the step id', stepId ?? operationId.split('.').at(-1))
  let added
  const copy = changeWorkflow(document, workflowId, (workflow) => {
    const at = before === undefined ? stepsOf(workflow).length : indexOfStep(workflow, before)
    added = freeStepId(workflow, wanted)
    workflow.steps = listOf(workflow.steps).toSpliced(at, 0, { stepId: added, operationId })
  })
  return { document: copy, stepId: added }
}

export const moveStep = (document, workflowId, { stepId, to }) =>
  changeWorkflow(document, workflowId, (workflow) => {
    const from = indexOfStep(workflow, stepId)
    if (!Number.isInteger(to) || to < 0 || to >= workflow.steps.length) {
      throw new RefusedEdit(`a step of "${workflowId}" goes from position 0 to ${workflow.steps.length - 1}`)
    }
    const [step] = workflow.steps.splice(from, 1)
    workflow.steps.splice(to, 0, step)
  })

export const removeStep = (document, workflowId, { stepId }) =>
  changeWorkflow(document, workflowId, (workflow) => {
    workflow.steps.splice(indexOfStep(workflow, stepId), 1)
  })

export const declaredInputs = (workflow) => Object.keys(mapOf(mapOf(workflow.inputs).properties))

export const addInput = (document, workflowId, { name, type = 'string' }) =>
  changeWorkflow(document, workflowId, (workflow) => {
    named('the input name', name)
    if (declaredInputs(workflow).includes(name)) {
      throw new RefusedEdit(`the workflow "${workflowId}" already has an input "${name}"`)
    }
    const inputs = workflow.inputs ?? { type: 'object' }
    workflow.inputs = { ...inputs, properties: { ...inputs.properties, [name]: { type } } }
  })

export const setStepOutput = (document, workflowId, { stepId, name, expression }) =>
  changeStep(document, workflowId, stepId, (step) => {
    named('the output name', name)
    if (!expression) throw new RefusedEdit(`the output "${name}" needs the value it takes, such as $response.body#/id`)
    step.outputs = { ...step.outputs, [name]: expression }
  })

/** The expression of a value given to a step: a workflow input, or an output of a step that runs before it. */
const valueFrom = (workflow, from, targetIndex) => {
  if (from.input !== undefined) {
    if (!declaredInputs(workflow).includes(from.input)) {
      throw new RefusedEdit(`the workflow "${workflow.workflowId}" has no input "${from.input}"`)
    }
    return inputExpression(from.input)
  }
  const sourceIndex = indexOfStep(workflow, from.stepId)
  if (sourceIndex >= targetIndex) {
    throw new RefusedEdit(`"${from.stepId}" runs after "${workflow.steps[targetIndex].stepId}": a step only gets values from the steps before it`)
  }
  if (!Object.hasOwn(workflow.steps[sourceIndex].outputs ?? {}, from.output)) {
    throw new RefusedEdit(`"${from.stepId}" has no output "${from.output}"`)
  }
  return stepOutputExpression(from.stepId, from.output)
}

const placeOf = (place) => {
  if (!PARAMETER_PLACES.includes(place)) throw new RefusedEdit(`a value goes in one of ${PARAMETER_PLACES.join(', ')}, not "${place}"`)
  return place
}

/** Sends a value as a parameter of a step, or as a property of its JSON request body. */
const send = (step, { name, in: place }, value) => {
  if (place === 'body') {
    step.requestBody = { contentType: 'application/json', ...step.requestBody, payload: { ...step.requestBody?.payload, [name]: value } }
    return
  }
  const others = listOf(step.parameters).filter((each) => each.name !== name || each.in !== place)
  step.parameters = [...others, { name, in: place, value }]
}

export const linkData = (document, workflowId, { from, to }) =>
  changeWorkflow(document, workflowId, (workflow) => {
    const index = indexOfStep(workflow, to.stepId)
    const value = valueFrom(workflow, from, index)
    send(workflow.steps[index], { name: to.name, in: placeOf(to.in) }, value)
  })

/** Gives a step a value to send: a fixed value, or a runtime expression the problems then check. */
export const setStepValue = (document, workflowId, { stepId, name, in: place, value }) =>
  changeStep(document, workflowId, stepId, (step) => {
    if (!name) throw new RefusedEdit('a parameter needs a name')
    if (value === undefined) throw new RefusedEdit(`the ${place} parameter "${name}" needs a value`)
    send(step, { name, in: placeOf(place) }, value)
  })

/** Stops sending a parameter, or a property of the request body. */
export const clearStepValue = (document, workflowId, { stepId, name, in: place }) =>
  changeStep(document, workflowId, stepId, (step) => {
    const payload = mapOf(step.requestBody?.payload)
    const parameters = listOf(step.parameters).filter((each) => each.name !== name || each.in !== place)
    if (place === 'body' ? !Object.hasOwn(payload, name) : parameters.length === listOf(step.parameters).length) {
      throw new RefusedEdit(`"${stepId}" sends no ${place} parameter "${name}"`)
    }
    if (place === 'body') delete step.requestBody.payload[name]
    else if (parameters.length) step.parameters = parameters
    else delete step.parameters
  })

export const addWorkflowOutput = (document, workflowId, { name, stepId, output }) =>
  changeWorkflow(document, workflowId, (workflow) => {
    named('the output name', name)
    workflow.outputs = { ...workflow.outputs, [name]: valueFrom(workflow, { stepId, output }, workflow.steps.length) }
  })

export const addSuccessCriterion = (document, workflowId, { stepId, condition }) =>
  changeStep(document, workflowId, stepId, (step) => {
    if (!condition) throw new RefusedEdit('a success criterion needs a condition, such as $statusCode == 200')
    step.successCriteria = [...listOf(step.successCriteria), { condition }]
  })

const actionOf = (workflow, { on, type, target, retryAfter, retryLimit }) => {
  if (type === 'end') return { name: `end-on-${on}`, type }
  if (type === 'goto') {
    indexOfStep(workflow, target)
    return { name: `goto-${target}`, type, stepId: target }
  }
  if (type === 'retry' && on === 'failure') {
    if (!Number.isInteger(retryLimit) || retryLimit < 1) throw new RefusedEdit('a retry needs at least 1 attempt')
    return { name: 'retry', type, retryLimit, retryAfter: retryAfter ?? 0 }
  }
  throw new RefusedEdit(type === 'retry' ? 'a step only retries on failure' : `an action is end, goto or retry, not "${type}"`)
}

export const addAction = (document, workflowId, { stepId, on, ...action }) =>
  changeStep(document, workflowId, stepId, (step, workflow) => {
    if (on !== 'success' && on !== 'failure') throw new RefusedEdit(`an action runs on success or on failure, not "${on}"`)
    const key = on === 'success' ? 'onSuccess' : 'onFailure'
    step[key] = [...listOf(step[key]), actionOf(workflow, { on, ...action })]
  })
