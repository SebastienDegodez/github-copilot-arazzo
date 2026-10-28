// features/*.feature in a real browser: the drags, drops and forms of the panel, and where the
// diagram draws what they change (@visual: measured with boundingBox, never through the DOM order).
import { expect, test } from '@playwright/test'
import { serveWorkspace } from './serve-workspace.mjs'

let workspace

test.beforeEach(async ({ page }) => {
  workspace = await serveWorkspace()
  await page.goto(workspace.url)
  await expect(page.getByTestId('step-placeOrder')).toBeVisible()
})
test.afterEach(() => workspace.close())

const box = async (locator) => {
  const measured = await locator.boundingBox()
  if (!measured) throw new Error('not rendered')
  return measured
}
const stepIds = (page) => page.locator('[data-step-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.stepId))

test('@visual the steps stand one below the other between the inputs and the outputs', async ({ page }) => {
  const boxes = []
  for (const id of ['node-inputs', 'step-findPets', 'step-getPet', 'step-placeOrder', 'node-outputs']) boxes.push(await box(page.getByTestId(id)))
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y + boxes[i - 1].height)
    expect(Math.abs(boxes[i].x - boxes[0].x)).toBeLessThan(1)
  }
  await expect(page.getByTestId('status')).toHaveText('valid')
  await expect(page.getByTestId('path')).toHaveText('adopt.arazzo.yaml')
})

test('@visual drop an operation between two steps to add a step there', async ({ page }) => {
  await page.getByTestId('operation-findPets').dragTo(page.getByTestId('step-placeOrder'))

  await expect(page.getByTestId('step-findPets-2')).toBeVisible()
  expect(await stepIds(page)).toEqual(['findPets', 'getPet', 'findPets-2', 'placeOrder'])
  const added = await box(page.getByTestId('step-findPets-2'))
  expect(added.y).toBeGreaterThan((await box(page.getByTestId('step-getPet'))).y)
  expect(added.y).toBeLessThan((await box(page.getByTestId('step-placeOrder'))).y)
  expect(await workspace.document()).toContain('- stepId: findPets-2\n        operationId: findPets\n      - stepId: placeOrder')
})

test('@visual drop an operation on the board to add a step last', async ({ page }) => {
  await page.getByTestId('operation-getPet').dragTo(page.getByTestId('board'), { targetPosition: { x: 10, y: 10 } })

  await expect(page.getByTestId('step-getPet-2')).toBeVisible()
  expect((await box(page.getByTestId('step-getPet-2'))).y).toBeGreaterThan((await box(page.getByTestId('step-placeOrder'))).y)
})

test('@visual drag a step onto another to move it there', async ({ page }) => {
  await page.getByTestId('step-placeOrder').dragTo(page.getByTestId('step-findPets'))

  await expect.poll(() => stepIds(page)).toEqual(['placeOrder', 'findPets', 'getPet'])
  expect((await box(page.getByTestId('step-placeOrder'))).y).toBeLessThan((await box(page.getByTestId('step-findPets'))).y)
})

test('@visual drag the output of a step onto a parameter of a later step to pass it', async ({ page }) => {
  await page.getByTestId('output-findPets-petId').dragTo(page.getByTestId('slot-getPet-path-petId'))

  await expect(page.getByTestId('slot-getPet-path-petId')).toHaveClass(/bound/)
  const label = page.getByTestId('label-data')
  await expect(label).toHaveText('outputs.petId→ path petId')
  const findPets = await box(page.getByTestId('step-findPets'))
  const labelBox = await box(label)
  expect(labelBox.x).toBeGreaterThan(findPets.x + findPets.width)
  expect(await workspace.document()).toContain('value: $steps.findPets.outputs.petId')
})

test('drag an input onto a step, then name the parameter it fills', async ({ page }) => {
  await page.getByTestId('input-status').dragTo(page.getByTestId('step-findPets'))
  await page.getByTestId('field-name').fill('status')
  await page.getByTestId('field-in').selectOption('query')
  await page.getByTestId('dialog-ok').click()

  await expect(page.getByTestId('slot-findPets-query-status')).toHaveClass(/bound/)
  await expect(page.getByTestId('label-data')).toHaveText('$inputs.status→ query status')
})

test('refuse to pass a value backwards, and say why', async ({ page }) => {
  await page.getByTestId('step-placeOrder').click()
  await page.getByTestId('add-output').click()
  await page.getByTestId('field-name').fill('orderId')
  await page.getByTestId('field-expression').fill('$response.body#/id')
  await page.getByTestId('dialog-ok').click()
  await expect(page.getByTestId('output-placeOrder-orderId')).toBeVisible()

  await page.getByTestId('output-placeOrder-orderId').dragTo(page.getByTestId('slot-getPet-path-petId'))

  await expect(page.getByTestId('toast')).toHaveText('"placeOrder" runs after "getPet": a step only gets values from the steps before it')
  await expect(page.getByTestId('slot-getPet-path-petId')).not.toHaveClass(/bound/)
})

test('@visual retry a step on failure and see the loop on its right', async ({ page }) => {
  await page.getByTestId('step-placeOrder').click()
  await page.getByTestId('add-action').click()
  await page.getByTestId('field-on').selectOption('failure')
  await page.getByTestId('field-type').selectOption('retry')
  await page.getByTestId('field-retryLimit').fill('3')
  await page.getByTestId('field-retryAfter').fill('2')
  await page.getByTestId('dialog-ok').click()

  const label = page.getByTestId('label-retry')
  await expect(label).toHaveText('retry ×3 · 2 s')
  const step = await box(page.getByTestId('step-placeOrder'))
  const loop = await box(label)
  expect(loop.x).toBeGreaterThan(step.x + step.width)
  expect(loop.y).toBeGreaterThan(step.y)
  expect(loop.y + loop.height).toBeLessThan(step.y + step.height)
})

test('see a problem on its step and in the list, then remove the step', async ({ page }) => {
  await workspace.studio.addStep({ operationId: 'deletePet' })
  await expect(page.getByTestId('status')).toHaveText('1 problem')
  await expect(page.getByTestId('problems')).toHaveText('deletePet: "deletePet" is not an operation of "petstore"')
  await expect(page.getByTestId('step-deletePet')).toHaveClass(/has-problems/)

  await page.getByTestId('problems').getByText('deletePet:').click()
  await page.getByTestId('remove-step').click()

  await expect(page.getByTestId('step-deletePet')).toHaveCount(0)
  await expect(page.getByTestId('status')).toHaveText('valid')
})

test('ask Copilot about the selected step', async ({ page }) => {
  await page.getByTestId('step-getPet').click()
  await page.getByTestId('question').fill('how do I pass the pet id?')
  await page.getByTestId('ask').click()

  await expect(page.getByTestId('question')).toHaveValue('')
  expect(workspace.questions).toHaveLength(1)
  expect(workspace.questions[0]).toMatch(/^About the Arazzo workflow "adopt-pet" in adopt\.arazzo\.yaml, step "getPet":\nhow do I pass the pet id\?/)
})
