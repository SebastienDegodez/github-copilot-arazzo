// features/save-document.feature in a real browser: the save status, the autosave switch, Save,
// the keyboard, undo and redo, and the warning when the file changes under unsaved edits.
import { chmod } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { serveWorkspace } from './serve-workspace.mjs'

let workspace
const open = async (page, options) => {
  workspace = await serveWorkspace(options)
  await page.goto(workspace.url)
  await expect(page.getByTestId('step-placeOrder')).toBeVisible()
}
test.afterEach(() => workspace.close())

const addGetPet = (page) => page.getByTestId('operation-getPet').dragTo(page.getByTestId('board'), { targetPosition: { x: 10, y: 10 } })

test('with autosave off, an edit waits for the developer to save', async ({ page }) => {
  await open(page, { autosave: false })
  const before = await workspace.document()
  await expect(page.getByTestId('autosave')).not.toBeChecked()
  await expect(page.getByTestId('save')).toBeDisabled()

  await addGetPet(page)

  await expect(page.getByTestId('step-getPet-2')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('Modified')
  expect(await workspace.document()).toBe(before)

  await page.getByTestId('save').click()
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved at \d/)
  expect(await workspace.document()).toContain('- stepId: getPet-2')
  await expect(page.getByTestId('save')).toBeDisabled()
})

test('save with the keyboard', async ({ page }) => {
  await open(page, { autosave: false })
  await addGetPet(page)
  await expect(page.getByTestId('save-status')).toHaveText('Modified')

  await page.keyboard.press('ControlOrMeta+s')

  await expect(page.getByTestId('save-status')).toHaveText(/^Saved at/)
  expect(await workspace.document()).toContain('- stepId: getPet-2')
})

test('with autosave on, every edit is saved at once; turning it on saves what waits', async ({ page }) => {
  await open(page, { autosave: false })
  await addGetPet(page)
  await expect(page.getByTestId('save-status')).toHaveText('Modified')

  await page.getByTestId('autosave').click()

  await expect(page.getByTestId('save-status')).toHaveText(/^Saved at/)
  expect(await workspace.document()).toContain('- stepId: getPet-2')
  await page.getByTestId('operation-findPets').dragTo(page.getByTestId('board'), { targetPosition: { x: 10, y: 10 } })
  await expect(page.getByTestId('step-findPets-2')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved at/)
  await expect.poll(() => workspace.document()).toContain('- stepId: findPets-2')
})

test('selecting a step changes nothing in the document', async ({ page }) => {
  await open(page, { autosave: false })
  await page.getByTestId('step-findPets').click()
  await page.getByTestId('step-getPet').click()
  await expect(page.getByTestId('step-getPet')).toHaveClass(/selected/)
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await expect(page.getByTestId('undo')).toBeDisabled()
})

test('undo and redo an edit', async ({ page }) => {
  await open(page)
  await addGetPet(page)
  await expect(page.getByTestId('step-getPet-2')).toBeVisible()

  await page.getByTestId('undo').click()
  await expect(page.getByTestId('step-getPet-2')).toHaveCount(0)
  await expect(page.getByTestId('redo')).toBeEnabled()

  await page.getByTestId('redo').click()
  await expect(page.getByTestId('step-getPet-2')).toBeVisible()
  await expect(page.getByTestId('redo')).toBeDisabled()
})

test('the file changed by another tool under unsaved edits: keep my edits', async ({ page }) => {
  await open(page, { autosave: false })
  await addGetPet(page)
  await expect(page.getByTestId('save-status')).toHaveText('Modified')
  await expect(page.getByTestId('conflict')).toBeHidden()

  await workspace.write('adopt.arazzo.yaml', (await workspace.document()).replace('stepId: placeOrder', 'stepId: order'))

  await expect(page.getByTestId('conflict')).toBeVisible()
  await expect(page.getByTestId('conflict')).toContainText('The file changed on disk')
  await page.getByTestId('keep-mine').click()
  await expect(page.getByTestId('conflict')).toBeHidden()
  await expect(page.getByTestId('step-getPet-2')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('Modified')
})

test('the file changed by another tool under unsaved edits: reload the file', async ({ page }) => {
  await open(page, { autosave: false })
  await addGetPet(page)
  await workspace.write('adopt.arazzo.yaml', (await workspace.document()).replace('stepId: placeOrder', 'stepId: order'))
  await expect(page.getByTestId('conflict')).toBeVisible()

  await page.getByTestId('reload-file').click()

  await expect(page.getByTestId('step-order')).toBeVisible()
  await expect(page.getByTestId('step-getPet-2')).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
})

test('a save that fails keeps the edits and says why', async ({ page }) => {
  await open(page, { autosave: false })
  await addGetPet(page)
  await chmod(workspace.root, 0o500)
  try {
    await page.getByTestId('save').click()
    await expect(page.getByTestId('toast')).toHaveText('adopt.arazzo.yaml could not be saved: permission denied')
    await expect(page.getByTestId('save-status')).toHaveText('Not saved: permission denied')
  } finally {
    await chmod(workspace.root, 0o700)
  }
  await expect(page.getByTestId('save')).toBeEnabled()
})
