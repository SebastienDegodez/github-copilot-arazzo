// features/step-values.feature, through the studio use cases.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { describedStep, savedWorkflow, studioWith } from '../support/studio-world.mjs'

const stepView = (studio, stepId) => studio.view().workflow.steps.find((step) => step.stepId === stepId)
const savedStep = (documents, stepId) => savedWorkflow(documents).steps.find((step) => step.stepId === stepId)

describe('Give a step the values it sends', () => {
  test('The inspector lists the parameters a step can send', async () => {
    const { studio } = await studioWith({ steps: ['findPets'] })
    assert.deepEqual(stepView(studio, 'findPets').slots, [{ name: 'status', in: 'query', required: false, value: null }])
  })

  test('Give a fixed value to a parameter of the operation', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets'] })

    await studio.setStepValue({ stepId: 'findPets', name: 'status', in: 'query', value: 'available' })

    assert.deepEqual(savedStep(documents, 'findPets').parameters, [{ name: 'status', in: 'query', value: 'available' }])
    assert.deepEqual(stepView(studio, 'findPets').slots, [{ name: 'status', in: 'query', required: false, value: 'available' }])
    assert.deepEqual(studio.view().problems, [])
  })

  test('Give an expression to a parameter', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets'], inputs: ['status'] })

    await studio.setStepValue({ stepId: 'findPets', name: 'status', in: 'query', value: '$inputs.status' })

    assert.deepEqual(savedStep(documents, 'findPets').parameters, [{ name: 'status', in: 'query', value: '$inputs.status' }])
    const edge = studio.view().diagram.edges.find((each) => each.kind === 'data')
    assert.deepEqual([edge.from, edge.to, edge.label.lines], ['inputs', 'step:0', ['$inputs.status', '→ query status']])
  })

  test('Add a parameter the operation does not describe', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets'] })

    await studio.setStepValue({ stepId: 'findPets', name: 'X-Request-Id', in: 'header', value: '$inputs.requestId' })

    assert.deepEqual(savedStep(documents, 'findPets').parameters, [{ name: 'X-Request-Id', in: 'header', value: '$inputs.requestId' }])
    assert.deepEqual(studio.view().problems.map((problem) => problem.message), ['the input "requestId" is not declared'])
  })

  test('Add a property to the body of a request', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets', 'placeOrder'] })

    await studio.setStepValue({ stepId: 'placeOrder', name: 'quantity', in: 'body', value: '1' })
    await studio.setStepValue({ stepId: 'placeOrder', name: 'petId', in: 'body', value: '42' })

    assert.deepEqual(savedStep(documents, 'placeOrder').requestBody, { contentType: 'application/json', payload: { quantity: '1', petId: '42' } })
    assert.deepEqual(stepView(studio, 'placeOrder').slots.map((slot) => [slot.in, slot.name, slot.value]), [['body', 'quantity', '1'], ['body', 'petId', '42']])
  })

  test('Clear a parameter', async () => {
    const { studio, documents } = await studioWith({ steps: [{ ...describedStep('findPets'), parameters: [{ name: 'status', in: 'query', value: 'available' }] }] })

    await studio.clearStepValue({ stepId: 'findPets', name: 'status', in: 'query' })

    assert.deepEqual(savedStep(documents, 'findPets'), describedStep('findPets'))
    assert.deepEqual(stepView(studio, 'findPets').slots, [{ name: 'status', in: 'query', required: false, value: null }])
  })

  test('Clear one parameter among others, or a property of the body', async () => {
    const { studio, documents } = await studioWith({ steps: [{
      ...describedStep('placeOrder'),
      parameters: [{ name: 'a', in: 'query', value: '1' }, { name: 'a', in: 'header', value: '2' }, { name: 'b', in: 'query', value: '3' }],
      requestBody: { contentType: 'application/json', payload: { quantity: '1', petId: '2' } },
    }] })

    await studio.clearStepValue({ stepId: 'placeOrder', name: 'a', in: 'query' })
    await studio.clearStepValue({ stepId: 'placeOrder', name: 'quantity', in: 'body' })

    assert.deepEqual(savedStep(documents, 'placeOrder').parameters, [{ name: 'a', in: 'header', value: '2' }, { name: 'b', in: 'query', value: '3' }])
    assert.deepEqual(savedStep(documents, 'placeOrder').requestBody, { contentType: 'application/json', payload: { petId: '2' } })
    await assert.rejects(studio.clearStepValue({ stepId: 'placeOrder', name: 'quantity', in: 'body' }), { name: 'RefusedEdit', message: '"placeOrder" sends no body parameter "quantity"' })
    await assert.rejects(studio.clearStepValue({ stepId: 'placeOrder', name: 'a', in: 'query' }), { message: '"placeOrder" sends no query parameter "a"' })
  })

  test('Refuse a parameter without a name or in an unknown place', async () => {
    const { studio } = await studioWith({ steps: ['findPets'] })
    const refused = (input, message) => assert.rejects(studio.setStepValue({ stepId: 'findPets', ...input }), { name: 'RefusedEdit', message })
    await refused({ in: 'query', value: 'x' }, 'a parameter needs a name')
    await refused({ name: '', in: 'query', value: 'x' }, 'a parameter needs a name')
    await refused({ name: 'status', in: 'form', value: 'x' }, 'a value goes in one of path, query, header, cookie, body, not "form"')
    await refused({ name: 'status', in: 'query' }, 'the query parameter "status" needs a value')
    await studio.setStepValue({ stepId: 'findPets', name: 'status', in: 'query', value: '' })
  })
})
