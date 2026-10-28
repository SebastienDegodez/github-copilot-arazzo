// features/panel-layout.feature (@visual): every part of the canvas stays readable at the width of the
// panel, measured in a real browser.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { serveWorkspace } from './serve-workspace.mjs'

const LONG = '$steps.findAvailablePetsByStatus.outputs.firstAvailablePetIdentifier'
let workspace
test.afterEach(() => workspace.close())

const noSideScroll = (locator) => locator.evaluate((element) => element.scrollWidth <= element.clientWidth)

test('@visual long values wrap in the inspector', async ({ page }) => {
  workspace = await serveWorkspace({ prepare: async (root) => {
    const file = join(root, 'adopt.arazzo.yaml')
    const text = (await readFile(file, 'utf8')).replace('        operationId: getPet\n', `        operationId: getPet\n        parameters:\n          - name: petId\n            in: path\n            value: ${LONG}\n`)
    await writeFile(file, text)
  } })
  await page.goto(workspace.url)
  await page.getByTestId('step-getPet').click()

  const field = page.getByTestId('value-path-petId')
  await expect(field).toHaveValue(LONG)
  expect(await noSideScroll(page.getByTestId('inspector'))).toBe(true)
  expect(await field.evaluate((area) => area.scrollWidth <= area.clientWidth && area.scrollHeight <= area.clientHeight + 1)).toBe(true)
  const inspector = await page.getByTestId('inspector').boundingBox()
  const value = await field.boundingBox()
  expect(value.x + value.width).toBeLessThanOrEqual(inspector.x + inspector.width)
})

test('@visual long messages wrap in the problems list', async ({ page }) => {
  workspace = await serveWorkspace()
  await page.goto(workspace.url)
  await workspace.studio.addStep({ operationId: 'findAvailablePetsByStatusAndCategoryAndTagsOfTheirOwnersAndTheirStores', stepId: 'search' })

  const problem = page.getByTestId('problem').filter({ hasText: 'is not an operation' })
  await expect(problem).toBeVisible()
  expect(await noSideScroll(page.getByTestId('problems'))).toBe(true)
  expect(await noSideScroll(page.getByTestId('inspector'))).toBe(true)
  const list = await page.getByTestId('problems').boundingBox()
  const message = await problem.boundingBox()
  expect(message.x + message.width).toBeLessThanOrEqual(list.x + list.width)
  expect(message.height).toBeGreaterThan(30)
})

test('@visual the save status and the views stay in the header at 900 pixels', async ({ page }) => {
  workspace = await serveWorkspace()
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto(workspace.url)
  await expect(page.getByTestId('step-findPets')).toBeVisible()

  const header = await page.getByTestId('header').boundingBox()
  for (const id of ['save-status', 'autosave', 'save', 'undo', 'redo', 'view-diagram', 'view-split', 'view-yaml', 'status']) {
    const part = page.getByTestId(id)
    await expect(part).toBeVisible()
    const at = await part.boundingBox()
    expect(at.x, id).toBeGreaterThanOrEqual(header.x)
    expect(at.x + at.width, id).toBeLessThanOrEqual(header.x + header.width)
    expect(at.y, id).toBeGreaterThanOrEqual(header.y)
    expect(at.y + at.height, id).toBeLessThanOrEqual(header.y + header.height)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
