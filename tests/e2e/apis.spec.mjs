// features/api-descriptions.feature in a real browser: the APIs of the palette, adding one picked
// among the files of the workspace, and an API the canvas cannot read.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { serveWorkspace } from './serve-workspace.mjs'

let workspace
const open = async (page, options) => {
  workspace = await serveWorkspace(options)
  await page.goto(workspace.url)
  await expect(page.getByTestId('step-placeOrder')).toBeVisible()
}
test.afterEach(() => workspace.close())

const withStore = { prepare: async (root) => {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(root, 'apis/store.yaml'), (await readFile(join(root, 'apis/petstore.yaml'), 'utf8')).replaceAll('Pet', 'Item').replaceAll('pet', 'item').replaceAll('Order', 'Stock').replaceAll('order', 'stock'))
} }

test('see the APIs of the document', async ({ page }) => {
  await open(page)
  const petstore = page.getByTestId('source-petstore')
  await expect(petstore).toContainText('petstore')
  await expect(petstore).toContainText('openapi')
  await expect(petstore).toContainText('apis/petstore.yaml')
  await expect(petstore).toContainText('3 operations')
  await expect(page.getByTestId('source-state-petstore')).toHaveText('read')
})

test('add an API picked among the descriptions of the workspace', async ({ page }) => {
  await open(page, withStore)
  await page.getByTestId('add-source').click()
  await expect(page.getByTestId('candidates').getByRole('button')).toHaveText(['apis/store.yaml'])

  await page.getByTestId('candidate-apis/store.yaml').click()
  await expect(page.getByTestId('field-name')).toHaveValue('store')
  await page.getByTestId('dialog-ok').click()

  await expect(page.getByTestId('source-store')).toContainText('3 operations')
  await expect(page.getByTestId('operation-findItems')).toBeVisible()
  expect(await workspace.document()).toContain('  - name: store\n    url: apis/store.yaml\n    type: openapi')
})

test('refuse an API whose file does not exist', async ({ page }) => {
  await open(page)
  await page.getByTestId('add-source').click()
  await page.getByTestId('field-name').fill('test')
  await page.getByTestId('field-url').fill('T')
  await page.getByTestId('dialog-ok').click()

  await expect(page.getByTestId('toast')).toHaveText('the API "test" cannot be added: no file "T" exists next to the document')
  await expect(page.getByTestId('source-test')).toHaveCount(0)
})

test('@visual an API that can no longer be read says so, by the url the document writes', async ({ page }) => {
  await open(page, { prepare: (root) => import('node:fs/promises').then(({ rm }) => rm(join(root, 'apis/petstore.yaml'))) })
  await expect(page.getByTestId('source-state-petstore')).toHaveText('not found')
  await expect(page.getByTestId('source-petstore')).toContainText('no file "apis/petstore.yaml" exists next to the document')
  await expect(page.getByTestId('problem')).toHaveCount(1)
  await expect(page.getByTestId('problem')).toContainText('the API description "petstore" cannot be read: no file "apis/petstore.yaml" exists next to the document')
  await expect(page.locator('body')).not.toContainText(workspace.root)
  await expect(page.getByTestId('step-findPets')).not.toHaveClass(/has-errors/)
  await expect(page.getByTestId('status')).toHaveText('1 error')
})

test('remove an API no step calls, and refuse one the steps call', async ({ page }) => {
  await open(page, withStore)
  await workspace.studio.addSource({ name: 'store', url: 'apis/store.yaml' })
  await page.getByTestId('remove-source-store').click()
  await expect(page.getByTestId('source-store')).toHaveCount(0)

  await page.getByTestId('remove-source-petstore').click()
  await expect(page.getByTestId('toast')).toHaveText('the API "petstore" cannot be removed: the steps "findPets", "getPet" and "placeOrder" call it')
  await expect(page.getByTestId('source-petstore')).toBeVisible()
})
