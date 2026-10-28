// What keeps an Arazzo document from being valid. A document with problems stays editable: each
// problem names the workflow and the step it is about, so the canvas shows it where it is.
import { findOperation } from './catalog.mjs'
import { declaredInputs, workflowsOf } from './document.mjs'
import { referencesIn } from './expressions.mjs'
import { listOf } from './lists.mjs'

const VERSION = /^1\.\d+\.\d+$/

const duplicates = (values) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]

const documentProblems = (document) => [
  ...(VERSION.test(document.arazzo) ? [] : [`the document must declare an Arazzo version 1.x.y, not "${document.arazzo ?? ''}"`]),
  ...(document.info?.title ? [] : ['the document needs a title in info.title']),
  ...(document.info?.version ? [] : ['the document needs a version in info.version']),
  ...(listOf(document.sourceDescriptions).length ? [] : ['the document describes no API: add the OpenAPI description its steps call']),
  ...(workflowsOf(document).length ? [] : ['the document has no workflow']),
  ...duplicates(workflowsOf(document).map((workflow) => workflow.workflowId)).map((id) => `two workflows are named "${id}"`),
].map((message) => ({ message }))

const callsOf = (step) => ['operationId', 'operationPath', 'workflowId'].filter((key) => step[key] !== undefined)

const operationProblems = (step, catalog) => {
  const calls = callsOf(step)
  if (calls.length !== 1) return ['must call exactly one of operationId, operationPath or workflowId']
  if (calls[0] !== 'operationId' || !catalog.loaded.length || findOperation(catalog.operations, step.operationId)) return []
  return [`"${step.operationId}" is not an operation of ${catalog.loaded.map((name) => `"${name}"`).join(', ')}`]
}

const referenceProblems = (value, workflow, before) => {
  const { inputs, outputs } = referencesIn(value)
  const declared = declaredInputs(workflow)
  return [
    ...inputs.filter((name) => !declared.includes(name)).map((name) => `the input "${name}" is not declared`),
    ...outputs.map(({ stepId, output }) => {
      const source = before.find((step) => step.stepId === stepId)
      if (!source) return `no step "${stepId}" runs before`
      return Object.hasOwn(source.outputs ?? {}, output) ? null : `"${stepId}" has no output "${output}"`
    }).filter(Boolean),
  ]
}

const actionProblems = (step, stepIds) =>
  [...listOf(step.onSuccess), ...listOf(step.onFailure)]
    .filter((action) => action.stepId !== undefined && !stepIds.includes(action.stepId))
    .map((action) => `goes to a step "${action.stepId}" the workflow does not have`)

const stepProblems = (workflow, catalog) => {
  const steps = listOf(workflow.steps)
  const stepIds = steps.map((step) => step.stepId)
  const repeated = duplicates(stepIds)
  return steps.flatMap((step, index) => [
    ...(step.stepId ? [] : ['needs a stepId']),
    ...(repeated.includes(step.stepId) ? [`two steps are named "${step.stepId}"`] : []),
    ...operationProblems(step, catalog),
    ...referenceProblems([step.parameters, step.requestBody, step.successCriteria], workflow, steps.slice(0, index)),
    ...actionProblems(step, stepIds),
  ].map((message) => ({ workflowId: workflow.workflowId, stepId: step.stepId, message })))
}

const workflowProblems = (workflow, catalog) => [
  ...[
    ...(workflow.workflowId ? [] : ['a workflow needs a workflowId']),
    ...(listOf(workflow.steps).length ? [] : ['the workflow has no step yet: drop an operation on it']),
    ...referenceProblems(workflow.outputs, workflow, listOf(workflow.steps)),
  ].map((message) => ({ workflowId: workflow.workflowId, message })),
  ...stepProblems(workflow, catalog),
]

/**
 * @param {object} document the Arazzo document
 * @param {{ loaded: string[], operations: object[] }} catalog the API descriptions read, and their operations
 */
export const problemsOf = (document, catalog) => [
  ...documentProblems(document),
  ...workflowsOf(document).flatMap((workflow) => workflowProblems(workflow, catalog)),
]
