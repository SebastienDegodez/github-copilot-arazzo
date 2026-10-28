// features/yaml-view.feature, through the studio use cases.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { InMemoryPreferences, PATH, stepIdsOf, studioWith } from '../support/studio-world.mjs'

const opened = async (steps = ['findPets']) => {
  const preferences = new InMemoryPreferences()
  preferences.settings.autosave = false
  return studioWith({ steps, preferences })
}
const renamed = (studio) => studio.view().yaml.text.replace('stepId: findPets', 'stepId: searchPets')

describe('See and edit the YAML the canvas produces', () => {
  test('Show the YAML of the document', async () => {
    const { studio, documents } = await opened()
    assert.deepEqual(studio.view().yaml, { text: documents.files.get(PATH), error: null })
    assert.deepEqual(studio.getYaml(), { text: documents.files.get(PATH), error: null })
  })

  test('An edit on the diagram shows in the YAML', async () => {
    const { studio } = await opened()
    await studio.addStep({ operation: 'petstore.getPet' })
    assert.ok(studio.view().yaml.text.endsWith('      - stepId: getPet\n        operationId: getPet\n'), studio.view().yaml.text)
  })

  test('A valid YAML edit shows on the diagram', async () => {
    const { studio, documents } = await opened()
    const before = documents.files.get(PATH)

    assert.deepEqual(await studio.setYaml({ text: renamed(studio) }), { error: null })

    assert.deepEqual(studio.view().diagram.nodes.map((node) => node.stepId).filter(Boolean), ['searchPets'])
    assert.equal(studio.view().save.dirty, true)
    assert.equal(documents.files.get(PATH), before)
  })

  test('A YAML edit that does not parse is not applied', async () => {
    const { studio } = await opened()
    const broken = studio.view().yaml.text.replace('info:\n', 'info: [\n')

    assert.deepEqual(await studio.setYaml({ text: broken }), { error: { message: 'Implicit keys need to be on a single line', line: 3 } })

    assert.deepEqual(studio.view().yaml, { text: broken, error: { message: 'Implicit keys need to be on a single line', line: 3 } })
    assert.deepEqual(stepIdsOf(studio), ['findPets'])
    await assert.rejects(studio.save(), { name: 'RefusedEdit', message: 'the YAML does not parse (line 3): correct it before saving' })
    await assert.rejects(studio.addStep({ operation: 'petstore.getPet' }), { message: 'the YAML does not parse (line 3): correct it or undo first' })
  })

  test('With autosave, a YAML edit is saved once it parses', async () => {
    const { studio, documents } = await studioWith({ steps: ['findPets'] })
    const text = studio.view().yaml.text
    await studio.setYaml({ text: 'arazzo: [' })
    assert.equal(documents.files.get(PATH), text)
    await studio.setYaml({ text: text.replace('findPets', 'searchPets') })
    assert.equal(documents.files.get(PATH), text.replace('findPets', 'searchPets'))
  })

  test('A YAML that parses but holds no object is not applied', async () => {
    const { studio } = await opened()
    await studio.setYaml({ text: '- a list\n' })
    assert.deepEqual(studio.view().yaml.error, { message: 'the YAML does not hold an object', line: 1 })
    await assert.rejects(studio.setYaml({}), { name: 'RefusedEdit', message: 'set the YAML with the text of the document' })
  })

  test('Undo a YAML edit', async () => {
    const { studio } = await opened()
    const text = studio.view().yaml.text
    await studio.setYaml({ text: renamed(studio) })

    await studio.undo()

    assert.deepEqual(stepIdsOf(studio), ['findPets'])
    assert.deepEqual(studio.view().yaml, { text, error: null })
  })

  test('Go from a problem to its line', async () => {
    const { studio } = await opened(['findPets', 'deletePet'])
    const [problem] = studio.view().problems
    assert.equal(problem.pointer, '#/workflows/0/steps/1/operationId')
    assert.equal(studio.view().yaml.text.split('\n')[problem.line - 1], '        operationId: deletePet')
  })

  test('A problem keeps the line of the last document that parsed', async () => {
    const { studio } = await opened(['findPets', 'deletePet'])
    await studio.setYaml({ text: `# a comment\n${studio.view().yaml.text}` })
    await studio.setYaml({ text: 'arazzo: [' })
    assert.equal(studio.view().problems[0].line, 22)
  })
})
