// features/yaml-view.feature in a real browser: the views, the YAML editor, its errors and the way
// from a problem to its line.
import { expect, test } from '@playwright/test'
import { serveWorkspace } from './serve-workspace.mjs'

let workspace
const open = async (page, options) => {
  workspace = await serveWorkspace(options)
  await page.goto(workspace.url)
  await expect(page.getByTestId('step-placeOrder')).toBeVisible()
}
test.afterEach(() => workspace.close())

const box = async (locator) => {
  const measured = await locator.boundingBox()
  if (!measured) throw new Error('not rendered')
  return measured
}

test('show the YAML of the document as it will be saved', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('yaml-text')).toBeHidden()
  await page.getByTestId('view-yaml').click()
  await expect(page.getByTestId('yaml-text')).toHaveValue(await workspace.document())
  await expect(page.getByTestId('board')).toBeHidden()
  await expect(page.getByTestId('view-yaml')).toHaveAttribute('aria-pressed', 'true')
})

test('@visual show the diagram and the YAML side by side', async ({ page }) => {
  await open(page)
  await page.getByTestId('view-split').click()
  const board = await box(page.getByTestId('board'))
  const yaml = await box(page.getByTestId('yaml'))
  expect(board.height).toBeGreaterThan(100)
  expect(yaml.height).toBeGreaterThan(100)
  expect(board.x + board.width).toBeLessThanOrEqual(yaml.x + 1)
  expect(Math.abs(board.y - yaml.y)).toBeLessThan(1)
  await page.setViewportSize({ width: 900, height: 900 })
  const stacked = await box(page.getByTestId('yaml'))
  expect(stacked.y).toBeGreaterThanOrEqual((await box(page.getByTestId('board'))).y + 100)
})

test('an edit on the diagram shows in the YAML', async ({ page }) => {
  await open(page)
  await page.getByTestId('view-split').click()
  await page.getByTestId('operation-getPet').dragTo(page.getByTestId('board'), { targetPosition: { x: 10, y: 10 } })
  await expect(page.getByTestId('yaml-text')).toHaveValue(/- stepId: getPet-2\n {8}operationId: getPet\n$/)
})

test('a valid YAML edit shows on the diagram', async ({ page }) => {
  await open(page, { autosave: false })
  await page.getByTestId('view-split').click()
  const editor = page.getByTestId('yaml-text')

  await editor.fill((await editor.inputValue()).replace('stepId: findPets', 'stepId: searchPets'))

  await expect(page.getByTestId('step-searchPets')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('Modified')
})

test('a YAML edit that does not parse is not applied, and cannot be saved', async ({ page }) => {
  await open(page, { autosave: false })
  await page.getByTestId('view-split').click()
  const editor = page.getByTestId('yaml-text')

  await editor.fill((await editor.inputValue()).replace('info:\n', 'info: [\n').replace('stepId: findPets', 'stepId: searchPets'))

  await expect(page.getByTestId('yaml-error')).toHaveText('Line 4: Implicit keys need to be on a single line')
  await expect(page.getByTestId('yaml-gutter').locator('.error')).toHaveText('4')
  await expect(page.getByTestId('step-findPets')).toBeVisible()
  await expect(page.getByTestId('save')).toBeDisabled()
  await expect(page.getByTestId('save-status')).toHaveText('YAML does not parse (line 4)')

  await page.getByTestId('undo').click()
  await expect(page.getByTestId('yaml-error')).toBeHidden()
  await expect(editor).toHaveValue(await workspace.document())
})

test('go from a problem to its line', async ({ page }) => {
  await open(page)
  await workspace.studio.addStep({ operationId: 'deletePet' })
  const problem = page.getByTestId('problem').filter({ hasText: 'is not an operation' })

  await problem.click()

  await expect(page.getByTestId('yaml')).toBeVisible()
  const line = Number(await problem.getAttribute('data-line'))
  await expect(page.getByTestId('yaml-gutter').locator('.current')).toHaveText(String(line))
  const selection = await page.getByTestId('yaml-text').evaluate((area) => area.value.slice(area.selectionStart, area.selectionEnd))
  expect(selection).toBe('        operationId: deletePet')
  await expect(page.getByTestId('step-deletePet')).toHaveClass(/selected/)
})

test('copy the YAML', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  await page.getByTestId('view-yaml').click()
  await page.getByTestId('copy-yaml').click()
  await expect(page.getByTestId('toast')).toHaveText('The YAML is in the clipboard.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await workspace.document())
})
