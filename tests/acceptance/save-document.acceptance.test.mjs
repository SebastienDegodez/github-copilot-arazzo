// features/save-document.feature, through the studio use cases.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { InMemoryPreferences, NOW, PATH, savedWorkflow, stepIdsOf, studioOn, studioWith } from '../support/studio-world.mjs'

/** The adopt document open with the step findPets, autosave on or off. */
const opened = async ({ autosave }) => {
  const preferences = new InMemoryPreferences()
  preferences.settings.autosave = autosave
  const world = await studioWith({ steps: ['findPets'], preferences })
  return { ...world, original: world.documents.files.get(PATH) }
}
const addGetPet = (studio) => studio.addStep({ operation: 'petstore.getPet' })

describe('Save the Arazzo document the way the developer chooses', () => {
  test('With autosave off, an edit waits for the developer to save', async () => {
    const { studio, documents, original } = await opened({ autosave: false })

    await addGetPet(studio)

    assert.deepEqual(studio.view().save, { autosave: false, dirty: true, savedAt: null, error: null, conflict: false, canUndo: true, canRedo: false })
    assert.equal(documents.files.get(PATH), original)
    assert.equal(documents.writes, 0)
  })

  test('Save the modified document', async () => {
    const { studio, documents } = await opened({ autosave: false })
    await addGetPet(studio)

    assert.deepEqual(await studio.save(), { savedAt: NOW })

    assert.deepEqual(savedWorkflow(documents).steps.map((step) => step.stepId), ['findPets', 'getPet'])
    assert.deepEqual([studio.view().save.dirty, studio.view().save.savedAt], [false, NOW])
  })

  test('With autosave on, every edit is saved at once', async () => {
    const { studio, documents } = await opened({ autosave: true })

    await addGetPet(studio)

    assert.deepEqual(savedWorkflow(documents).steps.map((step) => step.stepId), ['findPets', 'getPet'])
    assert.deepEqual(studio.view().save, { autosave: true, dirty: false, savedAt: NOW, error: null, conflict: false, canUndo: true, canRedo: false })
  })

  test('Autosave is on until the developer turns it off', async () => {
    const { studio } = await studioWith()
    assert.equal(studio.view().save.autosave, true)
  })

  test('Turning autosave on saves what was waiting', async () => {
    const { studio, documents, preferences } = await opened({ autosave: false })
    await addGetPet(studio)

    await studio.setAutosave({ on: true })

    assert.deepEqual(savedWorkflow(documents).steps.map((step) => step.stepId), ['findPets', 'getPet'])
    assert.deepEqual(preferences.settings, { autosave: true })
    assert.deepEqual([studio.view().save.autosave, studio.view().save.dirty], [true, false])
  })

  test('Turning autosave on with nothing waiting writes nothing', async () => {
    const { studio, documents } = await opened({ autosave: false })
    await studio.setAutosave({ on: true })
    assert.equal(documents.writes, 0)
    await assert.rejects(studio.setAutosave({ on: 'yes' }), { name: 'RefusedEdit', message: 'autosave is on (true) or off (false)' })
  })

  test('The autosave choice is remembered', async () => {
    const { studio, documents, preferences } = await studioWith()
    await studio.setAutosave({ on: false })

    const again = studioOn({ documents, preferences })
    await again.studio.open({ path: PATH })

    assert.equal(again.studio.view().save.autosave, false)
  })

  test('Undo and redo an edit', async () => {
    const { studio, documents } = await opened({ autosave: true })
    await addGetPet(studio)
    await studio.removeStep({ stepId: 'findPets' })

    await studio.undo()
    assert.deepEqual(stepIdsOf(studio), ['findPets', 'getPet'])
    assert.deepEqual(savedWorkflow(documents).steps.map((step) => step.stepId), ['findPets', 'getPet'])
    assert.deepEqual([studio.view().save.canUndo, studio.view().save.canRedo], [true, true])

    await studio.redo()
    assert.deepEqual(stepIdsOf(studio), ['getPet'])
    assert.deepEqual([studio.view().save.canUndo, studio.view().save.canRedo], [true, false])
  })

  test('An edit after an undo drops what could be redone', async () => {
    const { studio } = await opened({ autosave: false })
    await addGetPet(studio)
    await studio.undo()
    assert.deepEqual([studio.view().save.canUndo, studio.view().save.dirty], [false, false])

    await studio.addStep({ operation: 'petstore.placeOrder' })

    assert.equal(studio.view().save.canRedo, false)
    await assert.rejects(studio.redo(), { name: 'RefusedEdit', message: 'there is no edit to redo' })
    await studio.undo()
    await assert.rejects(studio.undo(), { message: 'there is no edit to undo' })
  })

  test('Selecting a workflow changes nothing in the document', async () => {
    const { studio } = await opened({ autosave: false })
    await studio.addWorkflow({ workflowId: 'other' })
    await studio.save()

    await studio.selectWorkflow({ workflowId: 'adopt-pet' })

    assert.deepEqual([studio.view().save.dirty, studio.view().save.canUndo], [false, true])
  })

  test('Saving keeps the comments and the order of the document', async () => {
    const { studio, documents } = studioOn()
    const text = [
      '# Adopt a pet',
      'arazzo: 1.0.1',
      'info:',
      '  version: 1.0.0',
      '  title: Adopt',
      'sourceDescriptions:',
      '  - { name: petstore, url: petstore.yaml, type: openapi }',
      'workflows:',
      '  - workflowId: adopt-pet',
      '    steps:',
      '      # finds the pets available',
      '      - operationId: findPets # by status',
      '        stepId: findPets',
      '',
    ].join('\n')
    documents.files.set(PATH, text)
    await studio.open({ path: PATH })
    await studio.setAutosave({ on: false })

    await addGetPet(studio)
    await studio.save()

    assert.equal(documents.files.get(PATH), `${text}      - stepId: getPet\n        operationId: getPet\n`)
  })

  test('The file changed by another tool while there are unsaved edits', async () => {
    const { studio, documents, original } = await opened({ autosave: false })
    await addGetPet(studio)
    const theirs = original.replace('stepId: findPets', 'stepId: searchPets')
    documents.files.set(PATH, theirs)

    await studio.reload()

    assert.equal(studio.view().save.conflict, true)
    assert.deepEqual(stepIdsOf(studio), ['findPets', 'getPet'])
    await studio.resolveConflict({ keep: 'mine' })
    assert.deepEqual([studio.view().save.conflict, studio.view().save.dirty], [false, true])
    await studio.save()
    assert.deepEqual(savedWorkflow(documents).steps.map((step) => step.stepId), ['findPets', 'getPet'])
  })

  test('Reload the file changed by another tool, dropping the unsaved edits', async () => {
    const { studio, documents, original } = await opened({ autosave: false })
    await addGetPet(studio)
    documents.files.set(PATH, original.replace('stepId: findPets', 'stepId: searchPets'))
    await studio.reload()

    await studio.resolveConflict({ keep: 'file' })

    assert.deepEqual(stepIdsOf(studio), ['searchPets'])
    assert.deepEqual(studio.view().save, { autosave: false, dirty: false, savedAt: null, error: null, conflict: false, canUndo: false, canRedo: false })
    await assert.rejects(studio.resolveConflict({ keep: 'file' }), { name: 'RefusedEdit', message: 'the file did not change on disk' })
  })

  test('Keep the saved document when the changed file is gone', async () => {
    const { studio, documents, original } = await opened({ autosave: false })
    await addGetPet(studio)
    documents.files.set(PATH, original.replace('stepId: findPets', 'stepId: searchPets'))
    await studio.reload()
    documents.files.delete(PATH)
    await assert.rejects(studio.resolveConflict({ keep: 'theirs' }), { message: 'keep "mine" or "file", not "theirs"' })

    await studio.resolveConflict({ keep: 'file' })

    assert.deepEqual(stepIdsOf(studio), ['findPets'])
  })

  test('A save that fails keeps the edits', async () => {
    const { studio, documents } = await opened({ autosave: false })
    await addGetPet(studio)
    documents.failure = 'permission denied'

    await assert.rejects(studio.save(), { name: 'RefusedEdit', message: `${PATH} could not be saved: permission denied` })

    assert.deepEqual(studio.view().save, { autosave: false, dirty: true, savedAt: null, error: 'permission denied', conflict: false, canUndo: true, canRedo: false })
    documents.failure = null
    await studio.save()
    assert.deepEqual([studio.view().save.error, studio.view().save.dirty], [null, false])
  })

  test('An edit autosave cannot write stays in the draft and tells why', async () => {
    const { studio, documents } = await opened({ autosave: true })
    documents.failure = 'the disk is full'

    await addGetPet(studio)

    assert.deepEqual(stepIdsOf(studio), ['findPets', 'getPet'])
    assert.deepEqual([studio.view().save.dirty, studio.view().save.error], [true, 'the disk is full'])
    await assert.rejects(studio.setAutosave({ on: true }), { message: `${PATH} could not be saved: the disk is full` })
  })

  test('A new document is saved at once, whatever autosave says', async () => {
    const preferences = new InMemoryPreferences()
    preferences.settings.autosave = false
    const { studio, documents } = studioOn({ preferences })
    await studio.open({ path: PATH })
    assert.deepEqual([documents.writes, studio.view().save.dirty], [1, false])
    assert.deepEqual(documents.saved(), { arazzo: '1.0.1', info: { title: 'adopt', version: '1.0.0' }, sourceDescriptions: [], workflows: [{ workflowId: 'adopt', steps: [] }] })
  })
})
