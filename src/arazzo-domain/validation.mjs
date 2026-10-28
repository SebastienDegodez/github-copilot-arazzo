// The rules of the spectral:arazzo ruleset, so that a linter or a tool such as Microcks accepts the
// document the canvas writes, with the checks only the canvas can make — the operations the API
// descriptions offer, the steps that run before a value is read — under the rule they belong to.
// A document with problems stays editable: each problem tells its rule, its severity, the JSON
// pointer of what it is about, and the workflow and the step there.
import { findOperation } from './catalog.mjs'
import { declaredInputs } from './document.mjs'
import { isRuntimeExpression, referencesIn } from './expressions.mjs'
import { isObject, listOf, mapOf, objectsOf } from './lists.mjs'
import { schemaProblems } from './schema.mjs'

const NAME = /^[A-Za-z0-9_-]+$/
const OUTPUT_NAME = /^[a-zA-Z0-9._-]+$/
const MEDIA_TYPE = /^(application|audio|font|example|image|message|model|multipart|text|video)\/[a-zA-Z0-9!#$&^_.+-]{1,127}$/
// These patterns match any text, from its start, capturing nothing when the text is not of their form.
const OPERATION_PATH = /(?:\{\$sourceDescriptions\.([a-zA-Z0-9_-]+)\.url\}#.)?/
const QUALIFIED = /(?:\$sourceDescriptions\.([A-Za-z0-9_-]+)\.)?/
const WORKFLOW_REFERENCE = /(?:\$workflows\.([A-Za-z0-9_-]+)(?:\.steps\.([A-Za-z0-9_-]+))?)?/
const COMPONENT_REFERENCE = /(?:\$components\.(parameters|successActions|failureActions)\.([A-Za-z0-9_-]+)$)?/
const CRITERION_TYPES = ['simple', 'regex', 'jsonpath', 'xpath']

const at = (path, message) => ({ path, message })
const quoted = (value) => `"${value}"`
/** The places of the values seen before at an earlier place. */
const repeated = (values) => values.flatMap((value, index) => (value !== undefined && values.indexOf(value) < index ? [index] : []))

const eachWorkflow = (context, check) => context.workflows.flatMap((workflow, index) => check(workflow, ['workflows', index]))

/** What a workflow and its actions may read: its inputs and any of its steps. */
const workflowScope = (workflow) => {
  const steps = objectsOf(workflow.steps)
  return { workflow, steps, before: steps }
}

/** Checks each step with what it may read: the inputs of its workflow and the steps that run before it. */
const eachStep = (context, check) => eachWorkflow(context, (workflow, path) => {
  const steps = objectsOf(workflow.steps)
  return steps.flatMap((step, index) => check(step, [...path, 'steps', index], { workflow, steps, before: steps.slice(0, index), stepId: step.stepId }))
})

/** The inputs and the step outputs a value reads that its workflow does not give at that point. */
const referenceProblems = (value, scope) => {
  const { inputs, steps } = referencesIn(value)
  const declared = declaredInputs(scope.workflow)
  return [
    ...inputs.filter((name) => !declared.includes(name)).map((name) => `the input "${name}" is not declared`),
    ...steps.flatMap(({ stepId, output }) => {
      const source = scope.before.find((step) => step.stepId === stepId)
      if (!source) return [scope.steps.some((step) => step.stepId === stepId) ? `"${stepId}" does not run before "${scope.stepId}"` : `the workflow has no step "${stepId}"`]
      return output === undefined || Object.hasOwn(mapOf(source.outputs), output) ? [] : [`"${stepId}" has no output "${output}"`]
    }),
  ]
}

/** The workflow, step or component a whole runtime expression names, when the document has none. */
const targetProblems = (value, context) => {
  const [, workflowId, stepId] = WORKFLOW_REFERENCE.exec(value)
  const workflow = context.workflows.find((each) => each.workflowId === workflowId)
  const [, kind, name] = COMPONENT_REFERENCE.exec(value)
  if (workflowId && !workflow) return [`the document has no workflow "${workflowId}"`]
  if (stepId && !objectsOf(workflow.steps).some((step) => step.stepId === stepId)) return [`the workflow "${workflowId}" has no step "${stepId}"`]
  return kind && !Object.hasOwn(mapOf(context.components[kind]), name) ? [`the components hold no ${kind}.${name}`] : []
}

/** What is wrong with a value given to a step: an expression of no known source, or what it reads. */
const valueProblems = (value, scope, context) => {
  if (typeof value !== 'string' || !value.startsWith('$')) return referenceProblems(value, scope)
  if (!isRuntimeExpression(value)) return [`"${value}" is not a runtime expression`]
  return [...targetProblems(value, context), ...referenceProblems(value, scope)]
}

/** What is wrong with an output, which must be a runtime expression. */
const outputProblems = (outputs, path, scope, context) => Object.entries(mapOf(outputs)).flatMap(([name, value]) => [
  ...(OUTPUT_NAME.test(name) ? [] : [`the output "${name}" may only use letters, digits, ".", "_" and "-"`]),
  ...(isRuntimeExpression(value) ? valueProblems(value, scope, context) : [`"${value}" is not a runtime expression`]),
].map((message) => at([...path, 'outputs', name], message)))

/** A workflow a step calls, a goto goes to or a workflow depends on: of the document, or of an Arazzo API description. */
const workflowProblems = (workflowId, context) => {
  if (!String(workflowId).startsWith('$')) {
    return context.workflows.some((workflow) => workflow.workflowId === workflowId) ? [] : [`the document has no workflow "${workflowId}"`]
  }
  const [, name] = QUALIFIED.exec(workflowId)
  const source = context.sources.find((each) => each.name === name)
  if (!source) return [`"${workflowId}" names no API description of the document`]
  return source.type === 'arazzo' ? [] : [`the API description "${name}" is not an Arazzo document: it has no workflow to call`]
}

/** Why the condition of a criterion of type regex is not a regular expression. */
const regexProblems = (condition) => {
  try {
    new RegExp(condition)
  } catch {
    return [`"${condition}" is not a regular expression`]
  }
  return []
}

const criterionProblems = (criterion, path, scope) => {
  const { condition, context, type } = criterion
  return [
    ...(typeof condition === 'string' && condition.trim() ? [] : [at([...path, 'condition'], 'a criterion needs a condition')]),
    ...(type != null && context == null ? [at([...path, 'context'], 'a criterion with a type needs a context')] : []),
    ...(typeof type === 'string' && !CRITERION_TYPES.includes(type) ? [at([...path, 'type'], `the type of a criterion is one of ${CRITERION_TYPES.join(', ')}, not "${type}"`)] : []),
    ...(isObject(type) && !(type.type && type.version) ? [at([...path, 'type'], 'the type of a criterion names its type and its version')] : []),
    ...(type === 'regex' ? regexProblems(condition).map((message) => at([...path, 'condition'], message)) : []),
    ...(context == null || isRuntimeExpression(context) ? [] : [at([...path, 'context'], `"${context}" is not a runtime expression`)]),
    ...referenceProblems(condition, scope).map((message) => at([...path, 'condition'], message)),
  ]
}

const COMPONENT_OF = { onSuccess: 'successActions', successActions: 'successActions', onFailure: 'failureActions', failureActions: 'failureActions' }

const actionProblems = (holder, key, path, scope, context) => {
  const actions = objectsOf(holder[key])
  const names = actions.map((action) => action.name)
  return [
    ...repeated(names).map((index) => at([...path, key, index, 'name'], `two actions are named "${names[index]}"`)),
    ...actions.flatMap((action, index) => [
      ...(action.reference === undefined || COMPONENT_REFERENCE.exec(action.reference)[1] === COMPONENT_OF[key]
        ? targetProblems(action.reference, context) : [`"${action.reference}" is not a reference to the ${COMPONENT_OF[key]} of the components`]),
      ...(action.type === 'goto' && (action.stepId === undefined) === (action.workflowId === undefined) ? ['a goto goes either to a stepId or to a workflowId'] : []),
      ...(action.stepId === undefined || scope.steps.some((step) => step.stepId === action.stepId) ? [] : [`goes to the step "${action.stepId}" the workflow does not have`]),
      ...(action.workflowId === undefined ? [] : workflowProblems(action.workflowId, context)),
      ...(action.type === 'retry' && action.retryAfter === undefined ? ['a retry needs retryAfter, the seconds it waits'] : []),
    ].map((message) => at([...path, key, index], message))),
    ...actions.flatMap((action, index) => objectsOf(action.criteria)
      .flatMap((criterion, place) => criterionProblems(criterion, [...path, key, index, 'criteria', place], scope))),
  ]
}

const parameterProblems = (holder, path, scope, context) => {
  const parameters = objectsOf(holder.parameters)
  const keys = parameters.map((parameter) => parameter.reference ?? `${parameter.in} parameter "${parameter.name}"`)
  return [
    ...repeated(keys).map((index) => at([...path, 'parameters', index], `the ${keys[index]} is sent twice`)),
    ...parameters.flatMap((parameter, index) => [
      ...(parameter.reference === undefined || COMPONENT_REFERENCE.exec(parameter.reference)[1] === 'parameters'
        ? targetProblems(parameter.reference, context).map((message) => at([...path, 'parameters', index], message))
        : [at([...path, 'parameters', index], `"${parameter.reference}" is not a reference to the parameters of the components`)]),
      ...valueProblems(parameter.value, scope, context).map((message) => at([...path, 'parameters', index, 'value'], message)),
    ]),
  ]
}

/** Where the parameters of a step go: with "in" to an operation, without to a workflow. */
const placeProblems = (step) => {
  const placed = objectsOf(step.parameters).filter((parameter) => parameter.reference === undefined).map((parameter) => parameter.in !== undefined)
  return [
    ...(placed.includes(true) && placed.includes(false) ? ['the parameters all say where they go with "in", or none does'] : []),
    ...(step.workflowId !== undefined && placed.includes(true) ? ['a step calling a workflow sends its parameters without "in"'] : []),
    ...(step.workflowId === undefined && placed.includes(false) ? ['a step calling an operation says where each parameter goes with "in"'] : []),
  ]
}

const operationProblems = (operationId, context) => {
  const [, name] = QUALIFIED.exec(operationId)
  if (name) {
    const source = context.sources.find((each) => each.name === name)
    if (!source) return [`"${operationId}" names no API description of the document`]
    return source.state === 'read' && !findOperation(context.operations, operationId) ? [`"${operationId}" is not an operation of "${name}"`] : []
  }
  if (String(operationId).startsWith('$')) return [`"${operationId}" names an operation as $sourceDescriptions.<name>.<operationId>`]
  const apis = context.sources.filter((source) => source.type !== 'arazzo')
  if (apis.some((source) => source.state !== 'read') || findOperation(context.operations, operationId)) return []
  return [`"${operationId}" is not an operation of ${apis.map((source) => quoted(source.name)).join(', ')}`]
}

const CALLS = {
  operationId: operationProblems,
  operationPath: (operationPath, context) => {
    const [, name] = OPERATION_PATH.exec(operationPath)
    if (!name) return [`"${operationPath}" names an operation as {$sourceDescriptions.<name>.url}#<JSON pointer>`]
    return context.sources.some((source) => source.name === name) ? [] : [`"${operationPath}" names no API description of the document`]
  },
  workflowId: workflowProblems,
}

const callProblems = (step, path, context) => {
  const calls = Object.keys(CALLS).filter((key) => step[key] !== undefined)
  if (calls.length !== 1) return [at(path, 'a step calls exactly one of operationId, operationPath or workflowId')]
  return CALLS[calls[0]](step[calls[0]], context).map((message) => at([...path, calls[0]], message))
}

const scriptTags = (value, path) => (value instanceof Object ? Object.entries(value).flatMap(([key, child]) => [
  ...((key === 'title' || key === 'description') && String(child).includes('<script') ? [at([...path, key], `the ${key} holds a <script> tag`)] : []),
  ...scriptTags(child, [...path, key]),
]) : [])

const missing = (value, path, message) => (value ? [] : [at(path, message)])

const ERROR = 'error'
const WARNING = 'warning'

const RULES = [
  ['arazzo-document-schema', ERROR, ({ document }) => schemaProblems(document)],
  ['arazzo-workflowId-unique', ERROR, ({ workflows }) => {
    const ids = workflows.map((workflow) => workflow.workflowId)
    return repeated(ids).map((index) => at(['workflows', index, 'workflowId'], `two workflows are named "${ids[index]}"`))
  }],
  ['arazzo-workflow-output-validation', ERROR, (context) => eachWorkflow(context, (workflow, path) => outputProblems(workflow.outputs, path, workflowScope(workflow), context))],
  ['arazzo-workflow-stepId-unique', ERROR, (context) => eachWorkflow(context, (workflow, path) => {
    const ids = objectsOf(workflow.steps).map((step) => step.stepId)
    return repeated(ids).map((index) => at([...path, 'steps', index, 'stepId'], `two steps are named "${ids[index]}"`))
  })],
  ['arazzo-step-output-validation', ERROR, (context) => eachStep(context, (step, path, scope) => outputProblems(step.outputs, path, scope, context))],
  ['arazzo-step-parameters-validation', ERROR, (context) => [
    ...eachWorkflow(context, (workflow, path) => parameterProblems(workflow, path, workflowScope(workflow), context)),
    ...eachStep(context, (step, path, scope) => [
      ...placeProblems(step).map((message) => at([...path, 'parameters'], message)),
      ...parameterProblems(step, path, scope, context),
    ]),
  ]],
  ['arazzo-step-success-actions-validation', ERROR, (context) => [
    ...eachWorkflow(context, (workflow, path) => actionProblems(workflow, 'successActions', path, workflowScope(workflow), context)),
    ...eachStep(context, (step, path, scope) => actionProblems(step, 'onSuccess', path, scope, context)),
  ]],
  ['arazzo-step-failure-actions-validation', ERROR, (context) => [
    ...eachWorkflow(context, (workflow, path) => actionProblems(workflow, 'failureActions', path, workflowScope(workflow), context)),
    ...eachStep(context, (step, path, scope) => actionProblems(step, 'onFailure', path, scope, context)),
  ]],
  ['arazzo-workflow-depends-on-validation', ERROR, (context) => eachWorkflow(context, (workflow, path) => {
    const dependencies = listOf(workflow.dependsOn)
    return [
      ...repeated(dependencies).map((index) => at([...path, 'dependsOn', index], `the workflow depends twice on "${dependencies[index]}"`)),
      ...dependencies.flatMap((dependency, index) => workflowProblems(dependency, context).map((message) => at([...path, 'dependsOn', index], message))),
    ]
  })],
  ['arazzo-step-success-criteria-validation', ERROR, (context) => eachStep(context, (step, path, scope) =>
    objectsOf(step.successCriteria).flatMap((criterion, index) => criterionProblems(criterion, [...path, 'successCriteria', index], scope)))],
  ['arazzo-step-request-body-validation', ERROR, (context) => eachStep(context, (step, path, scope) => {
    const body = mapOf(step.requestBody)
    const bodyPath = [...path, 'requestBody']
    return [
      ...(body.contentType === undefined || MEDIA_TYPE.test(body.contentType) ? [] : [at([...bodyPath, 'contentType'], `"${body.contentType}" is not a media type such as application/json`)]),
      ...valueProblems(body.payload, scope, context).map((message) => at([...bodyPath, 'payload'], message)),
      ...objectsOf(body.replacements).flatMap((replacement, index) =>
        valueProblems(replacement.value, scope, context).map((message) => at([...bodyPath, 'replacements', index, 'value'], message))),
    ]
  })],
  ['arazzo-step-validation', ERROR, (context) => {
    if (!context.sources.length) return [at(['sourceDescriptions'], 'the document describes no API: add the OpenAPI description its steps call')]
    return [
      ...context.sources.flatMap((source, index) => (source.message ? [at(['sourceDescriptions', index, 'url'], `the API description "${source.name}" cannot be read: ${source.message}`)] : [])),
      ...eachStep(context, (step, path) => callProblems(step, path, context)),
    ]
  }],
  ['arazzo-no-script-tags-in-markdown', ERROR, ({ document }) => scriptTags(document, [])],
  ['arazzo-info-description', WARNING, ({ document }) => missing(mapOf(document.info).description, ['info', 'description'], 'the document has no info.description')],
  ['arazzo-info-summary', WARNING, ({ document }) => missing(mapOf(document.info).summary, ['info', 'summary'], 'the document has no info.summary')],
  ['arazzo-source-descriptions-type', WARNING, ({ document }) => objectsOf(document.sourceDescriptions).flatMap((source, index) =>
    missing(source.type, ['sourceDescriptions', index, 'type'], `the API description "${source.name}" does not say its type, openapi or arazzo`))],
  ['arazzo-workflow-workflowId', WARNING, (context) => eachWorkflow(context, (workflow, path) =>
    (NAME.test(workflow.workflowId) ? [] : [at([...path, 'workflowId'], `the workflow id "${workflow.workflowId}" should only use letters, digits, "_" and "-"`)]))],
  ['arazzo-workflow-description', WARNING, (context) => eachWorkflow(context, (workflow, path) => missing(workflow.description, [...path, 'description'], 'the workflow has no description'))],
  ['arazzo-workflow-summary', WARNING, (context) => eachWorkflow(context, (workflow, path) => missing(workflow.summary, [...path, 'summary'], 'the workflow has no summary'))],
  ['arazzo-step-description', WARNING, (context) => eachStep(context, (step, path) => missing(step.description, [...path, 'description'], 'the step has no description'))],
  ['arazzo-step-stepId', WARNING, (context) => eachStep(context, (step, path) =>
    (NAME.test(step.stepId) ? [] : [at([...path, 'stepId'], `the step id "${step.stepId}" should only use letters, digits, "_" and "-"`)]))],
  ['arazzo-step-operationPath', WARNING, (context) => eachStep(context, (step, path) =>
    (step.operationPath === undefined ? [] : [at([...path, 'operationPath'], 'the step calls an operationPath: an operationId names the operation better')]))],
]

/** The workflow and the step a path leads into. */
const placeOf = (path, workflows) => {
  if (path[0] !== 'workflows' || !(path[1] in workflows)) return {}
  const workflow = workflows[path[1]]
  const steps = objectsOf(workflow.steps)
  if (path[2] !== 'steps' || !(path[3] in steps)) return { workflowId: workflow.workflowId }
  return { workflowId: workflow.workflowId, stepId: steps[path[3]].stepId }
}

/**
 * @param {object} document the Arazzo document
 * @param {{ sources: { name: string, type?: string, state: string, message?: string }[], operations: object[] }} catalog
 *   the API descriptions of the document as the canvas read them, and the operations they offer
 * @returns {{ rule: string, severity: 'error'|'warning', pointer: string, workflowId?: string, stepId?: string, message: string }[]}
 */
export const problemsOf = (document, catalog) => {
  const context = { document, workflows: objectsOf(document.workflows), components: mapOf(document.components), ...catalog }
  return RULES.flatMap(([rule, severity, check]) => check(context).map(({ path, message }) => ({
    rule, severity, pointer: `#${path.map((segment) => `/${segment}`).join('')}`, ...placeOf(path, context.workflows), message,
  })))
}

/** "1 error · 3 warnings", or "valid". */
export const summaryOf = (problems) => {
  const count = (severity) => {
    const n = problems.filter((problem) => problem.severity === severity).length
    return n ? [`${n} ${severity}${n > 1 ? 's' : ''}`] : []
  }
  return [...count(ERROR), ...count(WARNING)].join(' · ') || 'valid'
}
