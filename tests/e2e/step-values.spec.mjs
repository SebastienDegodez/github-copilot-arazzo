// features/step-values.feature in a real browser: the values a step sends, given in the inspector.
import { expect, test } from '@playwright/test'
import { serveWorkspace } from './serve-workspace.mjs'

let workspace
test.beforeEach(async ({ page }) => {
  workspace = await serveWorkspace()
  await page.goto(workspace.url)
  await expect(page.getByTestId('step-placeOrder')).toBeVisible()
})
test.afterEach(() => workspace.close())

test('the inspector lists the parameters a step can send', async ({ page }) => {
  await page.getByTestId('step-findPets').click()
  await expect(page.getByTestId('value-row-query-status')).toContainText('query status')
  await expect(page.getByTestId('value-query-status')).toHaveValue('')
})

test('give a fixed value to a parameter of the operation', async ({ page }) => {
  await page.getByTestId('step-findPets').click()
  await page.getByTestId('value-query-status').fill('available')
  await page.getByTestId('value-query-status').press('Enter')

  await expect(page.getByTestId('slot-findPets-query-status')).toHaveClass(/bound/)
  await expect.poll(() => workspace.document()).toContain('parameters:\n          - name: status\n            in: query\n            value: available')
})

test('give an expression to a parameter and see the data edge', async ({ page }) => {
  await page.getByTestId('step-findPets').click()
  await page.getByTestId('value-query-status').fill('$inputs.status')
  await page.getByTestId('value-query-status').blur()

  await expect(page.getByTestId('label-data')).toHaveText('$inputs.status→ query status')
})

test('add a parameter the operation does not describe', async ({ page }) => {
  await page.getByTestId('step-findPets').click()
  await page.getByTestId('add-parameter').click()
  await page.getByTestId('field-name').fill('X-Request-Id')
  await page.getByTestId('field-in').selectOption('header')
  await page.getByTestId('field-value').fill('$inputs.requestId')
  await page.getByTestId('dialog-ok').click()

  await expect(page.getByTestId('value-header-X-Request-Id')).toHaveValue('$inputs.requestId')
  await expect(page.getByTestId('slot-findPets-header-X-Request-Id')).toHaveClass(/bound/)
})

test('click an empty slot to fill it', async ({ page }) => {
  await page.getByTestId('slot-getPet-path-petId').click()

  await expect(page.getByTestId('step-getPet')).toHaveClass(/selected/)
  await expect(page.getByTestId('value-path-petId')).toBeFocused()
})

test('clear a parameter', async ({ page }) => {
  await workspace.studio.setStepValue({ stepId: 'findPets', name: 'status', in: 'query', value: 'available' })
  await page.getByTestId('step-findPets').click()
  await expect(page.getByTestId('slot-findPets-query-status')).toHaveClass(/bound/)

  await page.getByTestId('clear-query-status').click()

  await expect(page.getByTestId('slot-findPets-query-status')).not.toHaveClass(/bound/)
  await expect(page.getByTestId('value-query-status')).toHaveValue('')
  await expect.poll(() => workspace.document()).not.toContain('value: available')
})

test('refuse a parameter without a name', async ({ page }) => {
  await page.getByTestId('step-findPets').click()
  await page.getByTestId('add-parameter').click()
  await page.getByTestId('field-name').evaluate((input) => input.removeAttribute('required'))
  await page.getByTestId('field-value').fill('x')
  await page.getByTestId('dialog-ok').click()
  await expect(page.getByTestId('toast')).toHaveText('a parameter needs a name')
})
