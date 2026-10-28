// The canvas declaration and the composition root, with the SDK's createCanvas, CanvasError and
// joinSession replaced by recorders, on a real workspace folder.
import assert from 'node:assert/strict'
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { register } from '../../src/composition.mjs'
import { CANVAS_ID, DEFAULT_PATH } from '../../src/presentation/canvas.mjs'

const FIXTURE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))

class CanvasError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const boot = async ({ fixture = true, home } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'arazzo-canvas-'))
  if (fixture) await cp(FIXTURE, root, { recursive: true })
  const sent = []
  const logs = []
  let joined
  const { canvas, studio } = await register({
    root,
    home: home ?? await mkdtemp(join(tmpdir(), 'copilot-home-')),
    createCanvas: (options) => options,
    CanvasError,
    joinSession: async (config) => {
      joined = config
      return { send: async (message) => sent.push(message) }
    },
    log: (text) => logs.push(text),
  })
  const action = (name) => canvas.actions.find((each) => each.name === name).handler
  const open = canvas.open
  // a failed test closes the panels it opened, so their server does not keep the run alive
  canvas.open = async (ctx) => {
    opened.push(() => canvas.onClose(ctx))
    return open(ctx)
  }
  return { root, canvas, studio, sent, logs, joined, action }
}

const opened = []
afterEach(async () => {
  for (const close of opened.splice(0)) await close()
})

describe('The Arazzo canvas', () => {
  test('is declared to the Copilot session with the actions the agent may run', async () => {
    const { canvas, joined } = await boot()
    assert.deepEqual(joined.canvases, [canvas])
    assert.equal(canvas.id, CANVAS_ID)
    assert.equal(canvas.displayName, 'Arazzo')
    assert.deepEqual(canvas.actions.map((action) => action.name), [
      'get_workflow', 'select_workflow', 'add_workflow', 'add_source', 'remove_source', 'list_source_candidates', 'add_step', 'move_step', 'remove_step',
      'add_input', 'set_step_output', 'link_data', 'set_step_value', 'clear_step_value', 'add_workflow_output', 'add_success_criterion', 'add_action',
      'save', 'undo', 'redo', 'set_autosave', 'get_yaml', 'set_yaml',
    ])
    const contract = JSON.parse(await readFile(fileURLToPath(new URL('../fixtures/canvas.contract.json', import.meta.url)), 'utf8'))
    assert.deepEqual({ id: canvas.id, displayName: canvas.displayName, description: canvas.description, inputSchema: canvas.inputSchema }, contract.canvas)
    assert.deepEqual(canvas.actions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), contract.actions)
  })

  test('opens the first Arazzo document of the workspace and serves its panel', async () => {
    const { canvas, root } = await boot()
    const opened = await canvas.open({ instanceId: 'a', input: {} })
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    assert.deepEqual([opened.title, opened.status], ['Arazzo · adopt.arazzo.yaml', 'valid'])
    assert.equal((await fetch(opened.url)).status, 200)
    const again = await canvas.open({ instanceId: 'b' })
    assert.equal(again.url, opened.url)
    await writeFile(join(root, 'other.arazzo.yaml'), 'arazzo: 1.0.1\n')
    assert.equal((await canvas.open({ instanceId: 'c', input: {} })).title, 'Arazzo · adopt.arazzo.yaml')

    await canvas.onClose({ instanceId: 'a' })
    await canvas.onClose({ instanceId: 'c' })
    assert.equal((await fetch(opened.url)).status, 200)
    await canvas.onClose({ instanceId: 'b' })
    await assert.rejects(fetch(opened.url))
    await canvas.onClose({ instanceId: 'b' })
    const reopened = await canvas.open({ instanceId: 'd' })
    assert.notEqual(reopened.url, opened.url)
    await canvas.onClose({ instanceId: 'd' })
  })

  test('creates a new document where the workspace has none', async () => {
    const { canvas, root } = await boot({ fixture: false })
    const opened = await canvas.open({ instanceId: 'a', input: {} })
    assert.deepEqual([opened.title, opened.status], [`Arazzo · ${DEFAULT_PATH}`, '2 errors · 4 warnings'])
    assert.match(await readFile(join(root, DEFAULT_PATH), 'utf8'), /workflowId: workflow\n/)
    await canvas.onClose({ instanceId: 'a' })
  })

  test('opens the document and workflow asked, describing the APIs given', async () => {
    const { canvas, root, action } = await boot()
    await cp(join(FIXTURE, 'apis'), join(root, 'flows/apis'), { recursive: true })
    const opened = await canvas.open({ instanceId: 'a', input: { path: 'flows/order.arazzo.yaml', workflowId: 'order', sources: [{ name: 'petstore', url: 'apis/petstore.yaml' }] } })
    assert.deepEqual([opened.title, opened.status], ['Arazzo · flows/order.arazzo.yaml', '1 error · 4 warnings'])
    const view = await action('get_workflow')({ input: {} })
    assert.equal(view.workflowId, 'order')
    assert.deepEqual(view.operations, [
      { operation: 'petstore.findPets', method: 'GET', path: '/pets' },
      { operation: 'petstore.getPet', method: 'GET', path: '/pets/{petId}' },
      { operation: 'petstore.placeOrder', method: 'POST', path: '/orders' },
    ])
    assert.equal(view.document, undefined)
    assert.equal(view.diagram, undefined)

    await action('add_workflow')({ input: { workflowId: 'second' } })
    await canvas.open({ instanceId: 'b', input: { path: 'flows/order.arazzo.yaml', workflowId: 'order' } })
    assert.equal((await action('get_workflow')({})).workflowId, 'order')
    await action('select_workflow')({ input: { workflowId: 'second' } })
    await canvas.open({ instanceId: 'b', input: { path: 'flows/order.arazzo.yaml' } })
    assert.equal((await action('get_workflow')({})).workflowId, 'second')
    await canvas.onClose({ instanceId: 'a' })
    await canvas.onClose({ instanceId: 'b' })
  })

  test('lets the agent edit the workflow and tells it why an edit is refused', async () => {
    const { canvas, root, action } = await boot()
    await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })

    assert.deepEqual(await action('add_step')({ input: { operation: 'petstore.getPet', before: 'placeOrder' } }), { stepId: 'getPet-2' })
    assert.deepEqual(await action('link_data')({ input: { from: { stepId: 'findPets', output: 'petId' }, to: { stepId: 'getPet-2', name: 'petId', in: 'path' } } }), { ok: true })
    assert.match(await readFile(join(root, 'adopt.arazzo.yaml'), 'utf8'), /value: \$steps\.findPets\.outputs\.petId/)

    await assert.rejects(action('remove_step')({ input: { stepId: 'nope' } }), { code: 'arazzo_refused', message: 'the workflow "adopt-pet" has no step "nope"' })
    await canvas.onClose({ instanceId: 'a' })
  })

  test('runs every edit the agent asks for on the document file', async () => {
    const { canvas, root, action } = await boot()
    await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    await cp(join(root, 'apis/petstore.yaml'), join(root, 'apis/store.yaml'))
    const run = async (name, input) => action(name)({ input })

    await run('add_source', { name: 'store', url: 'apis/store.yaml' })
    await run('set_step_output', { stepId: 'getPet', name: 'name', expression: '$response.body#/name' })
    await run('add_workflow_output', { name: 'petName', stepId: 'getPet', output: 'name' })
    await run('add_success_criterion', { stepId: 'getPet', condition: '$statusCode == 200' })
    await run('add_action', { stepId: 'placeOrder', on: 'failure', type: 'retry', retryLimit: 2 })
    await run('move_step', { stepId: 'placeOrder', to: 0 })
    await run('add_input', { name: 'quantity', type: 'integer' })
    await run('add_workflow', { workflowId: 'browse', summary: 'Browse the pets' })
    await run('select_workflow', { workflowId: 'adopt-pet' })
    await run('remove_step', { stepId: 'findPets' })

    const text = await readFile(join(root, 'adopt.arazzo.yaml'), 'utf8')
    for (const expected of ['  - name: store\n    url: apis/store.yaml\n    type: openapi', 'name: $response.body#/name', 'petName: $steps.getPet.outputs.name',
      '- condition: $statusCode == 200', 'retryLimit: 2', 'type: integer', '- workflowId: browse\n    summary: Browse the pets',
      '# Adopt a pet: find one of a status, read it, then order it.\narazzo: 1.0.1\n']) {
      assert.ok(text.includes(expected), expected)
    }
    assert.deepEqual((await run('get_workflow', {})).workflow.steps.map((step) => step.stepId), ['placeOrder', 'getPet'])
    await canvas.onClose({ instanceId: 'a' })
  })

  test('tells the panel why the document could not be saved, in words', async () => {
    const { canvas, root, logs } = await boot()
    const { url } = await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    const token = (await (await fetch(url)).text()).match(/CANVAS_TOKEN = "([0-9a-f]{48})"/)[1]
    const post = (name, body) => fetch(new URL(`/api/${name}`, url), { method: 'POST', headers: { 'X-Canvas-Token': token }, body: JSON.stringify(body) })
    await chmod(root, 0o500)
    assert.equal((await post('add_input', { name: 'quantity' })).status, 200)
    const response = await post('save', {})
    await chmod(root, 0o700)
    assert.deepEqual([response.status, await response.json()], [400, { error: 'adopt.arazzo.yaml could not be saved: permission denied' }])
    assert.deepEqual(logs, [])
    await canvas.onClose({ instanceId: 'a' })
  })

  test('lets the agent save, undo, read and write the YAML, give values and manage the APIs', async () => {
    const { canvas, root, action } = await boot()
    await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    const run = async (name, input = {}) => action(name)({ input })
    const file = () => readFile(join(root, 'adopt.arazzo.yaml'), 'utf8')
    const original = await file()

    assert.deepEqual(await run('set_autosave', { on: false }), { ok: true })
    assert.deepEqual(await run('set_step_value', { stepId: 'findPets', name: 'status', in: 'query', value: 'available' }), { ok: true })
    assert.equal(await file(), original)
    const { savedAt } = await run('save')
    assert.match(savedAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.match(await file(), /value: available/)
    await run('clear_step_value', { stepId: 'findPets', name: 'status', in: 'query' })
    await run('undo')
    assert.deepEqual((await run('get_workflow')).workflow.steps[0].slots, [{ name: 'status', in: 'query', required: false, value: 'available' }])
    await run('redo')
    const { save, yaml, document } = await run('get_workflow')
    assert.deepEqual([save.dirty, save.autosave, save.savedAt, yaml, document], [true, false, savedAt, undefined, undefined])

    const { text, error } = await run('get_yaml')
    assert.equal(error, null)
    assert.deepEqual(await run('set_yaml', { text: text.replace('stepId: placeOrder', 'stepId: order') }), { error: null })
    assert.deepEqual((await run('get_workflow')).workflow.steps.map((step) => step.stepId), ['findPets', 'getPet', 'order'])

    await writeFile(join(root, 'apis/store.yaml'), 'openapi: 3.1.0\npaths:\n  /stock:\n    get:\n      operationId: getStock\n')
    assert.deepEqual(await run('list_source_candidates'), { candidates: ['apis/store.yaml'] })
    await run('add_source', { name: 'store', url: 'apis/store.yaml' })
    await run('remove_source', { name: 'store' })
    assert.deepEqual((await run('get_workflow')).sources.map((source) => source.name), ['petstore'])
  })

  test('lets the panel keep its edits when the file changed on disk', async () => {
    const { canvas, root, studio, action } = await boot()
    const { url } = await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    const token = (await (await fetch(url)).text()).match(/CANVAS_TOKEN = "([0-9a-f]{48})"/)[1]
    await action('set_autosave')({ input: { on: false } })
    await action('add_input')({ input: { name: 'quantity' } })
    await writeFile(join(root, 'adopt.arazzo.yaml'), 'arazzo: 1.0.0\n')
    for (let i = 0; i < 40 && !studio.view().save.conflict; i++) await sleep(50)
    const response = await fetch(new URL('/api/resolve_conflict', url), { method: 'POST', headers: { 'X-Canvas-Token': token }, body: '{"keep":"mine"}' })
    assert.equal(response.status, 200)
    assert.deepEqual([studio.view().save.conflict, studio.view().workflow.inputs], [false, ['status', 'quantity']])
  })

  test('logs what crashed in the panel', async () => {
    const { canvas, root, studio, logs, action } = await boot()
    const { url } = await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    const token = (await (await fetch(url)).text()).match(/CANVAS_TOKEN = "([0-9a-f]{48})"/)[1]
    await action('set_autosave')({ input: { on: false } })
    await action('add_input')({ input: { name: 'quantity' } })
    await writeFile(join(root, 'adopt.arazzo.yaml'), 'arazzo: 1.0.0\n', { mode: 0o000 })
    for (let i = 0; i < 40 && !studio.view().save.conflict; i++) await sleep(50)
    await chmod(join(root, 'adopt.arazzo.yaml'), 0o000)
    const response = await fetch(new URL('/api/resolve_conflict', url), { method: 'POST', headers: { 'X-Canvas-Token': token }, body: '{"keep":"file"}' })
    assert.equal(response.status, 500)
    assert.match(logs[0], /^arazzo canvas: Error: EACCES/)
    await canvas.onClose({ instanceId: 'a' })
  })

  test('warns of a change of the file under unsaved edits, and keeps the choice of autosave for the next session', async () => {
    const home = await mkdtemp(join(tmpdir(), 'copilot-home-'))
    const { canvas, root, studio, action } = await boot({ home })
    await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    await action('set_autosave')({ input: { on: false } })
    await action('remove_step')({ input: { stepId: 'placeOrder' } })
    const text = await readFile(join(root, 'adopt.arazzo.yaml'), 'utf8')
    await writeFile(join(root, 'adopt.arazzo.yaml'), text.replace('stepId: getPet', 'stepId: readPet'))
    for (let i = 0; i < 40 && !studio.view().save.conflict; i++) await sleep(50)
    const { save, workflow } = await action('get_workflow')({ input: {} })
    assert.deepEqual([save.conflict, save.dirty, save.autosave], [true, true, false])
    assert.deepEqual(workflow.steps.map((step) => step.stepId), ['findPets', 'getPet'])
    await canvas.onClose({ instanceId: 'a' })

    const next = await boot({ home })
    await next.canvas.open({ instanceId: 'b', input: {} })
    assert.equal((await next.action('get_workflow')({ input: {} })).save.autosave, false)
    await next.canvas.onClose({ instanceId: 'b' })
  })

  test('names an API it cannot read as the document writes it, never by a path of the machine', async () => {
    const { canvas, root, action } = await boot()
    await rm(join(root, 'apis/petstore.yaml'))
    await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    const { problems, sources, status } = await action('get_workflow')({ input: {} })
    assert.deepEqual(problems.map((problem) => problem.message), ['the API description "petstore" cannot be read: no file "apis/petstore.yaml" exists next to the document'])
    assert.deepEqual(sources[0].state, 'not found')
    assert.equal(status, '1 error')
    assert.ok(!JSON.stringify(problems).includes(root))
    await assert.rejects(action('add_source')({ input: { name: 'store', url: 'apis/store.yaml' } }),
      { code: 'arazzo_refused', message: 'the API "store" cannot be added: no file "apis/store.yaml" exists next to the document' })
    await canvas.onClose({ instanceId: 'a' })
  })

  test('hides what crashed from the agent and logs it', async () => {
    const { canvas, root, action, logs } = await boot()
    await assert.rejects(action('get_workflow')({ input: {} }), { code: 'arazzo_refused', message: 'no Arazzo document is open on the canvas' })
    await writeFile(join(root, 'broken.arazzo.yaml'), '- a\n')
    await assert.rejects(canvas.open({ instanceId: 'a', input: { path: 'broken.arazzo.yaml' } }),
      { code: 'arazzo_refused', message: 'broken.arazzo.yaml is not an Arazzo document: the YAML does not hold an object (line 1)' })
    await writeFile(join(root, 'denied.arazzo.yaml'), 'arazzo: 1.0.1\n', { mode: 0o000 })
    await assert.rejects(canvas.open({ instanceId: 'a', input: { path: 'denied.arazzo.yaml' } }), { code: 'arazzo_error', message: 'the Arazzo canvas hit an error; run the action again or reopen the canvas' })
    assert.match(logs[0], /^arazzo canvas: Error: EACCES/)
  })

  test('follows the document when another tool changes its file', async () => {
    const { canvas, root, studio, logs } = await boot()
    await canvas.open({ instanceId: 'a', input: { path: 'adopt.arazzo.yaml' } })
    const text = await readFile(join(root, 'adopt.arazzo.yaml'), 'utf8')
    await writeFile(join(root, 'adopt.arazzo.yaml'), text.replace('stepId: placeOrder', 'stepId: order'))
    for (let i = 0; i < 40 && !studio.view().workflow.steps.some((step) => step.stepId === 'order'); i++) await sleep(50)
    assert.deepEqual(studio.view().workflow.steps.map((step) => step.stepId), ['findPets', 'getPet', 'order'])

    await writeFile(join(root, 'adopt.arazzo.yaml'), '- broken\n')
    for (let i = 0; i < 40 && !studio.view().yaml.error; i++) await sleep(50)
    assert.deepEqual(studio.view().yaml, { text: '- broken\n', error: { message: 'the YAML does not hold an object', line: 1 } })
    assert.deepEqual(studio.view().workflow.steps.map((step) => step.stepId), ['findPets', 'getPet', 'order'])

    await canvas.open({ instanceId: 'a', input: { path: 'other.arazzo.yaml' } })
    await writeFile(join(root, 'adopt.arazzo.yaml'), text)
    await sleep(700)
    assert.equal(studio.view().path, 'other.arazzo.yaml')
    assert.deepEqual(logs, [])
    await canvas.onClose({ instanceId: 'a' })
  })

  test('hands the questions of the panel to the Copilot session', async () => {
    const { canvas, sent } = await boot()
    const { url } = await canvas.open({ instanceId: 'a', input: {} })
    const token = (await (await fetch(url)).text()).match(/CANVAS_TOKEN = "([0-9a-f]{48})"/)[1]
    const response = await fetch(new URL('/api/ask', url), { method: 'POST', headers: { 'X-Canvas-Token': token }, body: JSON.stringify({ question: 'what next?' }) })
    assert.equal(response.status, 200)
    assert.equal(sent.length, 1)
    assert.match(sent[0].prompt, /^About the Arazzo workflow "adopt-pet" in adopt\.arazzo\.yaml:\nwhat next\?/)
    await canvas.onClose({ instanceId: 'a' })
  })
})

describe('The composition root', () => {
  test('refuses questions before the Copilot session is joined', async () => {
    let failure
    await register({
      root: await mkdtemp(join(tmpdir(), 'arazzo-early-')),
      home: await mkdtemp(join(tmpdir(), 'copilot-home-')),
      createCanvas: (options) => options,
      CanvasError,
      joinSession: async ({ canvases: [canvas] }) => {
        await canvas.open({ instanceId: 'early', input: {} })
        const { url } = await canvas.open({ instanceId: 'early' })
        const token = (await (await fetch(url)).text()).match(/CANVAS_TOKEN = "([0-9a-f]{48})"/)[1]
        failure = await fetch(new URL('/api/ask', url), { method: 'POST', headers: { 'X-Canvas-Token': token }, body: '{"question":"hi"}' })
        await canvas.onClose({ instanceId: 'early' })
        return {}
      },
      log: () => {},
    })
    assert.equal(failure.status, 500)
  })
})
