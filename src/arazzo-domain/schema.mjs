// The rule arazzo-document-schema of spectral:arazzo, written by hand after the JSON schema of Arazzo
// 1.0.x: the fields each object requires and allows (besides its x- extensions), and their kinds.
// The other rules check what the fields hold.
import { isObject } from './lists.mjs'

const kind = (is, name) => ({ is, kind: name })
const STRING = kind((value) => typeof value === 'string', 'a string')
const NUMBER = kind((value) => typeof value === 'number', 'a number')
const INTEGER = kind(Number.isInteger, 'an integer')
const ANY = kind(() => true)
const OBJECT = kind(isObject, 'an object')
const SCHEMA = kind((value) => typeof value === 'boolean' || isObject(value), 'a JSON schema')
const oneOf = (...values) => kind((value) => values.includes(value), `one of ${values.map((each) => `"${each}"`).join(', ')}`)
const matching = (pattern, name) => kind((value) => typeof value === 'string' && pattern.test(value), name)
const required = (field) => ({ ...field, required: true })
/** A list, which holds at least one item when it says what the object lacks without one. */
const list = (item, lacking) => ({ ...kind(Array.isArray, 'a list'), item, lacking })
const map = (value) => ({ ...OBJECT, value })
const object = (subject, fields, { prefix = '', extensions = true } = {}) => ({ ...OBJECT, subject, prefix, fields, extensions })
const either = (reference, other) => ({ choose: (value) => (isObject(value) && Object.hasOwn(value, 'reference') ? reference : other) })

const REUSABLE = object('the reference', { reference: required(STRING), value: ANY }, { extensions: false })
const CRITERION = object('the criterion', { context: STRING, condition: required(STRING), type: ANY })
const ACTION = { name: required(STRING), workflowId: STRING, stepId: STRING, criteria: list(CRITERION) }
const SUCCESS_ACTION = object('the action', { ...ACTION, type: required(oneOf('end', 'goto')) })
const FAILURE_ACTION = object('the action', { ...ACTION, type: required(oneOf('end', 'goto', 'retry')), retryAfter: NUMBER, retryLimit: INTEGER })
const PARAMETER = object('the parameter', { name: required(STRING), in: oneOf('path', 'query', 'header', 'cookie', 'body'), value: required(ANY) })
const OUTPUTS = map(STRING)

const STEP = object('the step', {
  stepId: required(STRING), description: STRING, operationId: STRING, operationPath: STRING, workflowId: STRING,
  parameters: list(either(REUSABLE, PARAMETER)),
  requestBody: object('the request body', {
    contentType: STRING, payload: ANY,
    replacements: list(object('the replacement', { target: required(STRING), value: required(STRING) })),
  }),
  successCriteria: list(CRITERION, 'has no criterion in its successCriteria'),
  onSuccess: list(either(REUSABLE, SUCCESS_ACTION)),
  onFailure: list(either(REUSABLE, FAILURE_ACTION)),
  outputs: OUTPUTS,
})

const DOCUMENT = object('the document', {
  arazzo: required(matching(/^1\.0\.\d+(-.+)?$/, 'an Arazzo version 1.0.x')),
  info: required(object('the document', { title: required(STRING), summary: STRING, description: STRING, version: required(STRING) }, { prefix: 'info.' })),
  sourceDescriptions: required(list(object('the API description', {
    name: required(matching(/^[A-Za-z0-9_-]+$/, 'made of letters, digits, "_" and "-"')), url: required(STRING), type: oneOf('arazzo', 'openapi'),
  }))),
  workflows: required(list(object('the workflow', {
    workflowId: required(STRING), summary: STRING, description: STRING, inputs: SCHEMA, dependsOn: list(STRING),
    steps: required(list(STEP, 'has no step yet: drop an operation on it')),
    successActions: list(either(REUSABLE, SUCCESS_ACTION)),
    failureActions: list(either(REUSABLE, FAILURE_ACTION)),
    outputs: OUTPUTS,
    parameters: list(either(REUSABLE, PARAMETER)),
  }), 'has no workflow')),
  components: object('the components object', {
    inputs: map(SCHEMA), parameters: map(PARAMETER), successActions: map(SUCCESS_ACTION), failureActions: map(FAILURE_ACTION),
  }),
})

/**
 * @returns {{ path: (string|number)[], message: string }[]} where the document strays from the schema
 */
export const schemaProblems = (document) => {
  const found = []
  const check = (given, value, path, label, owner) => {
    const spec = given.choose?.(value) ?? given
    if (!spec.is(value)) return found.push({ path, message: `${label} must be ${spec.kind}` })
    if (spec.lacking && !value.length) found.push({ path, message: `${owner} ${spec.lacking}` })
    if (spec.item) value.forEach((item, index) => check(spec.item, item, [...path, index], `item ${index + 1} of ${label}`, owner))
    if (spec.value) for (const [key, each] of Object.entries(value)) check(spec.value, each, [...path, key], `"${key}" of ${label}`, owner)
    if (spec.fields) checkObject(spec, value, path)
  }
  const checkObject = ({ subject, prefix, fields, extensions }, value, path) => {
    for (const [key, field] of Object.entries(fields)) {
      if (field.required && value[key] === undefined) found.push({ path: [...path, key], message: `${subject} needs ${prefix}${key}` })
    }
    for (const [key, each] of Object.entries(value)) {
      if (Object.hasOwn(fields, key)) check(fields[key], each, [...path, key], `the ${prefix}${key} of ${subject}`, subject)
      else if (!(extensions && key.startsWith('x-'))) found.push({ path: [...path, key], message: `${subject} has an unknown field "${prefix}${key}"` })
    }
  }
  checkObject(DOCUMENT, document, [])
  return found
}
