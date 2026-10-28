// The scenario of the demo video, played on the real studio: if the canvas changes, the video's
// story must still be a valid Arazzo workflow, or the video would show a lie.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EDITS, playScenario } from '../../video/scenario.mjs'

test('the video scenario ends on a valid workflow returning the order id', async () => {
  const { states, prompt } = await playScenario()
  const last = states[EDITS.at(-1).id].view

  assert.deepEqual(last.problems.filter((problem) => problem.severity === 'error'), [])
  assert.deepEqual(last.workflow.steps.map((step) => step.stepId), ['findPets', 'getPet', 'placeOrder'])
  assert.deepEqual(last.workflow.outputs, { orderId: '$steps.placeOrder.outputs.orderId' })
  assert.deepEqual(last.diagram.edges.filter((edge) => edge.label).map((edge) => edge.label.lines[0]),
    ['$inputs.status', 'outputs.petId', 'retry ×3 · 2 s'])
  assert.match(states[EDITS.at(-1).id].yaml, /value: \$steps\.findPets\.outputs\.petId/)
  assert.match(prompt, /step "getPet"/)
})
