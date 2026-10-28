// What the canvas draws for a workflow: the diagram of the studio view.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { studioWith } from '../support/studio-world.mjs'

describe('Draw the workflow as a flow chart', () => {
  test('An empty workflow draws its inputs above its outputs', async () => {
    const { studio } = await studioWith()
    const { diagram } = studio.view()
    assert.deepEqual(diagram, {
      width: 328,
      height: 232,
      nodes: [
        { id: 'inputs', kind: 'inputs', x: 24, y: 24, width: 280, height: 64 },
        { id: 'outputs', kind: 'outputs', x: 24, y: 144, width: 280, height: 64 },
      ],
      edges: [{ kind: 'sequence', from: 'inputs', to: 'outputs', path: 'M 164 88 L 164 144' }],
    })
  })

  test('Steps stand in order between the inputs and the outputs, values and actions on their sides', async () => {
    const { studio } = await studioWith({
      inputs: ['status'],
      steps: [
        { stepId: 'findPets', description: 'Find the pets', operationId: 'findPets', parameters: [{ name: 'status', in: 'query', value: '$inputs.status' }], outputs: { petId: '$response.body#/0/id' },
          onSuccess: [{ name: 'done', type: 'end' }], onFailure: [{ name: 'again', type: 'goto', stepId: 'getPet' }] },
        { stepId: 'getPet', description: 'Read the pet', operationId: 'getPet', parameters: [{ name: 'petId', in: 'path', value: '$steps.findPets.outputs.petId' }],
          onFailure: [{ name: 'retry', type: 'retry', retryLimit: 2, retryAfter: 0 }] },
      ],
    })
    const { diagram } = studio.view()

    assert.equal(diagram.width, 864)
    assert.equal(diagram.height, 584)
    assert.deepEqual(diagram.nodes, [
      { id: 'inputs', kind: 'inputs', x: 216, y: 24, width: 280, height: 64 },
      { id: 'step:0', kind: 'step', stepId: 'findPets', index: 0, x: 216, y: 144, width: 280, height: 120,
        operation: { method: 'GET', path: '/pets', summary: 'Find pets' }, problems: [] },
      { id: 'step:1', kind: 'step', stepId: 'getPet', index: 1, x: 216, y: 320, width: 280, height: 120,
        operation: { method: 'GET', path: '/pets/{petId}', summary: 'Get a pet' }, problems: [] },
      { id: 'outputs', kind: 'outputs', x: 216, y: 496, width: 280, height: 64 },
    ])
    assert.deepEqual(diagram.edges, [
      { kind: 'sequence', from: 'inputs', to: 'step:0', path: 'M 356 88 L 356 144' },
      { kind: 'sequence', from: 'step:0', to: 'step:1', path: 'M 356 264 L 356 320' },
      { kind: 'sequence', from: 'step:1', to: 'outputs', path: 'M 356 440 L 356 496' },
      { kind: 'data', from: 'inputs', to: 'step:0', side: 'left', path: 'M 216 76 C 184 76 184 162 216 162',
        label: { lines: ['$inputs.status', '→ query status'], x: 184, y: 119, align: 'end' } },
      { kind: 'data', from: 'step:0', to: 'step:1', side: 'right', path: 'M 496 252 C 648 252 648 338 496 338',
        label: { lines: ['outputs.petId', '→ path petId'], x: 648, y: 295, align: 'start' } },
      { kind: 'goto', from: 'step:0', to: 'step:1', side: 'right', path: 'M 496 252 C 680 252 680 348 496 348',
        label: { lines: ['goto on failure'], x: 680, y: 300, align: 'start' } },
      { kind: 'end', from: 'step:0', to: 'end:0:0', path: 'M 496 244 L 520 244',
        label: { lines: ['end on success'], x: 526, y: 244, align: 'start' } },
      { kind: 'retry', from: 'step:1', to: 'step:1', path: 'M 496 420 C 528 420 528 394 496 394',
        label: { lines: ['retry ×2'], x: 532, y: 407, align: 'start' } },
    ])
  })

  test('Several ends of a step leave it one above the other', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'getPet', operationId: 'getPet', onSuccess: [{ name: 'a', type: 'end' }], onFailure: [{ name: 'b', type: 'end' }] }] })
    const ends = studio.view().diagram.edges.filter((edge) => edge.kind === 'end')
    assert.deepEqual(ends.map((edge) => [edge.to, edge.path, edge.label.y, edge.label.lines[0]]), [
      ['end:0:0', 'M 304 244 L 328 244', 244, 'end on success'],
      ['end:0:1', 'M 304 224 L 328 224', 224, 'end on failure'],
    ])
    assert.equal(studio.view().diagram.width, 24 + 280 + 120 + 24)
  })

  test('Two values coming into a step enter it one below the other, each on its own lane', async () => {
    const { studio } = await studioWith({
      inputs: ['a', 'b'],
      steps: [{ stepId: 'findPets', operationId: 'findPets', parameters: [{ name: 'x', in: 'query', value: '$inputs.a' }, { name: 'y', in: 'header', value: 'Bearer {$inputs.b}' }] }],
    })
    const data = studio.view().diagram.edges.filter((edge) => edge.kind === 'data')
    assert.deepEqual(data.map((edge) => edge.path), [
      'M 248 76 C 216 76 216 162 248 162',
      'M 248 76 C 184 76 184 172 248 172',
    ])
    assert.deepEqual(data[1].label, { lines: ['$inputs.b', '→ header y'], x: 184, y: 124, align: 'end' })
    assert.equal(studio.view().diagram.width, 24 + 2 * 32 + 160 + 280 + 24)
  })

  test('A goto back to the first step curves on the right, with no room for other actions', async () => {
    const { studio } = await studioWith({ steps: ['findPets', { stepId: 'getPet', operationId: 'getPet', onFailure: [{ name: 'back', type: 'goto', stepId: 'findPets' }] }] })
    const { diagram } = studio.view()
    assert.deepEqual(diagram.edges.filter((edge) => edge.kind === 'goto').map((edge) => [edge.from, edge.to, edge.path]), [['step:1', 'step:0', 'M 304 428 C 336 428 336 162 304 162']])
    assert.equal(diagram.width, 24 + 280 + 32 + 160 + 24)
  })

  test('A retry alone makes room on the right of the steps', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'placeOrder', operationId: 'placeOrder', onFailure: [{ name: 'again', type: 'retry', retryLimit: 2 }] }] })
    assert.equal(studio.view().diagram.width, 24 + 280 + 120 + 24)
  })

  test('A retry loops above the ends of its step', async () => {
    const { studio } = await studioWith({ steps: [{ stepId: 'placeOrder', operationId: 'placeOrder', onFailure: [{ name: 'again', type: 'retry', retryLimit: 2 }, { name: 'stop', type: 'end' }] }] })
    const edges = studio.view().diagram.edges.filter((edge) => edge.kind !== 'sequence')
    assert.deepEqual(edges.map((edge) => [edge.kind, edge.path]), [['end', 'M 304 244 L 328 244'], ['retry', 'M 304 224 C 336 224 336 198 304 198']])
  })

  test('A value read from a step that does not run before, or not from its outputs, draws no data edge', async () => {
    const { studio } = await studioWith({ steps: [
      { stepId: 'findPets', operationId: 'findPets', parameters: [{ name: 'a', in: 'query', value: '$steps.getPet.outputs.id' }, { name: 'b', in: 'query', value: '$steps.findPets.outputs.id' }] },
      { stepId: 'getPet', operationId: 'getPet', outputs: { id: '$response.body#/id' }, parameters: [{ name: 'c', in: 'query', value: '$steps.findPets.statusCode' }],
        onSuccess: [{ name: 'stop', type: 'end', stepId: 'findPets' }] },
    ] })
    assert.deepEqual(studio.view().diagram.edges.map((edge) => edge.kind), ['sequence', 'sequence', 'sequence', 'end'])
  })
})
