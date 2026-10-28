// The YAML codec: the text of a document is what the developer owns; an edit changes only what it changes.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { yamlCodec } from '../../src/infrastructure/yaml-codec.mjs'

const codec = yamlCodec()
const lines = (...each) => `${each.join('\n')}\n`
const edited = (text, edit) => {
  const { document } = codec.parse(text)
  edit(document)
  return codec.merge('adopt.arazzo.yaml', text, document)
}

const TEXT = lines(
  '# Adopt a pet',
  'arazzo: 1.0.1',
  'info:',
  '  version: 1.0.0 # the version of the document',
  '  title: Adopt',
  'workflows:',
  '  - workflowId: adopt-pet',
  '    steps:',
  '      # finds the pets',
  '      - operationId: findPets',
  '        stepId: findPets',
  '        parameters:',
  '          - { name: status, in: query, value: available }',
  '          - name: status',
  '            in: header',
  '            value: x',
  '      - stepId: getPet # reads one',
  '        operationId: getPet',
  '        successCriteria:',
  '          - condition: $statusCode == 200',
  '          - condition: $statusCode == 201',
  '    outputs:',
  '      200: $steps.getPet.outputs.code',
)

describe('The YAML codec', () => {
  test('reads a document, or tells why the text holds none and on which line', () => {
    assert.deepEqual(codec.parse('arazzo: 1.0.1\n'), { document: { arazzo: '1.0.1' } })
    assert.deepEqual(codec.parse('arazzo: 1.0.1\ninfo: [\n  title: x\n'), { error: { message: 'Flow sequence in block collection must be sufficiently indented and end with a ]', line: 4 } })
    assert.deepEqual(codec.parse('a: 1\na: 2\n'), { error: { message: 'Map keys must be unique', line: 2 } })
    for (const text of ['- a\n', '', 'just text\n', '42\n']) assert.deepEqual(codec.parse(text), { error: { message: 'the YAML does not hold an object', line: 1 } }, text)
  })

  test('writes an unchanged document as it was', () => {
    assert.equal(edited(TEXT, () => {}), TEXT)
  })

  test('keeps the comments, the order of the keys and the style of what an edit does not touch', () => {
    const text = edited(TEXT, (document) => {
      document.info.description = 'Adopt a pet'
      document.workflows[0].steps.push({ stepId: 'placeOrder', operationId: 'placeOrder' })
      document.workflows[0].steps[0].parameters[0].value = 'sold'
    })
    assert.equal(text, TEXT
      .replace('  title: Adopt\n', '  title: Adopt\n  description: Adopt a pet\n')
      .replace('value: available }', 'value: sold }')
      .replace('    outputs:\n', '      - stepId: placeOrder\n        operationId: placeOrder\n    outputs:\n'))
  })

  test('moves the items of a list with their comments, known by their id, their name and place, or their place', () => {
    const text = edited(TEXT, (document) => {
      const [findPets, getPet] = document.workflows[0].steps
      findPets.parameters.reverse()
      getPet.successCriteria = [{ condition: '$statusCode == 202' }, getPet.successCriteria[1]]
      document.workflows[0].steps = [getPet, findPets]
    })
    assert.equal(text, lines(
      '# Adopt a pet',
      'arazzo: 1.0.1',
      'info:',
      '  version: 1.0.0 # the version of the document',
      '  title: Adopt',
      'workflows:',
      '  - workflowId: adopt-pet',
      '    steps:',
      '      - stepId: getPet # reads one',
      '        operationId: getPet',
      '        successCriteria:',
      '          - condition: $statusCode == 202',
      '          - condition: $statusCode == 201',
      '      # finds the pets',
      '      - operationId: findPets',
      '        stepId: findPets',
      '        parameters:',
      '          - name: status',
      '            in: header',
      '            value: x',
      '          - { name: status, in: query, value: available }',
      '    outputs:',
      '      200: $steps.getPet.outputs.code',
    ))
  })

  test('removes what the edit removes, with its comment, and writes anew what changes kind', () => {
    const text = edited(TEXT, (document) => {
      delete document.info.version
      document.workflows[0].steps.shift()
      document.workflows[0].steps[0].successCriteria = { condition: 'x' }
      document.workflows[0].outputs['200'] = { kind: 'object' }
      document.arazzo = '1.0.0'
    })
    assert.equal(text, lines(
      '# Adopt a pet',
      'arazzo: 1.0.0',
      'info:',
      '  title: Adopt',
      'workflows:',
      '  - workflowId: adopt-pet',
      '    steps:',
      '      - stepId: getPet # reads one',
      '        operationId: getPet',
      '        successCriteria:',
      '          condition: x',
      '    outputs:',
      '      200:',
      '        kind: object',
    ))
  })

  test('writes a new document, and a JSON document as JSON', () => {
    assert.equal(codec.merge('a.arazzo.yaml', null, { arazzo: '1.0.1', workflows: [{ workflowId: 'w', steps: [] }] }), 'arazzo: 1.0.1\nworkflows:\n  - workflowId: w\n    steps: []\n')
    assert.equal(codec.merge('a.arazzo.json', '{"arazzo": "1.0.0"}', { arazzo: '1.0.1', info: { title: 't' } }), '{\n  "arazzo": "1.0.1",\n  "info": {\n    "title": "t"\n  }\n}\n')
    assert.equal(codec.merge('a.arazzo.yaml', null, { summary: `${'a long summary '.repeat(10)}end` }), `summary: ${'a long summary '.repeat(10)}end\n`)
  })

  test('finds the line of what a JSON pointer names, or of its nearest ancestor', () => {
    const lineOf = (pointer) => codec.lineOf(TEXT, pointer)
    assert.equal(lineOf('#'), 1)
    assert.equal(lineOf('#/arazzo'), 2)
    assert.equal(lineOf('#/info/version'), 4)
    assert.equal(lineOf('#/info/description'), 3)
    assert.equal(lineOf('#/workflows/0/steps/0'), 10)
    assert.equal(lineOf('#/workflows/0/steps/0/parameters/1/value'), 16)
    assert.equal(lineOf('#/workflows/0/steps/1/successCriteria/1/condition'), 21)
    assert.equal(lineOf('#/workflows/0/steps/2/stepId'), 8)
    assert.equal(lineOf('#/workflows/0/outputs/200'), 23)
    assert.equal(lineOf('#/workflows/0/workflowId/x'), 7)
    assert.equal(codec.lineOf('a/b:\n  c~d: 1\n', '#/a~1b/c~0d'), 2)
    assert.equal(codec.lineOf('', '#/a'), 1)
  })
})
