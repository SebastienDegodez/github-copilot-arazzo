// The panel server on a real loopback port, in front of the real studio and its actions.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createStudio } from '../../src/arazzo-application/studio.mjs'
import { createActions } from '../../src/presentation/actions.mjs'
import { isRefusal } from '../../src/presentation/canvas.mjs'
import { startServer } from '../../src/presentation/server.mjs'
import { InMemoryDocuments, InMemorySources, PATH, RecordingAssistant, studioWith } from '../support/studio-world.mjs'

const tokenOf = async (url) => (await (await fetch(url)).text()).match(/CANVAS_TOKEN = "([0-9a-f]{48})"/)[1]

const sse = async (url) => {
  const controller = new AbortController()
  const response = await fetch(url, { signal: controller.signal })
  const reader = response.body.getReader()
  let buffer = ''
  return {
    response,
    async next() {
      while (!buffer.includes('\n\n')) buffer += new TextDecoder().decode((await reader.read()).value)
      const [event, ...rest] = buffer.split('\n\n')
      buffer = rest.join('\n\n')
      return JSON.parse(event.replace(/^data: /, ''))
    },
    close: () => controller.abort(),
  }
}

describe('The panel server', () => {
  let world
  let server
  let token
  const errors = []
  const post = (name, body, headers = { 'X-Canvas-Token': token }) =>
    fetch(new URL(`/api/${name}`, server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

  before(async () => {
    world = await studioWith({ steps: ['findPets', 'getPet'] })
    const actions = [...createActions(world.studio), { name: 'crash', run: () => { throw new Error('boom') } }]
    server = await startServer({ studio: world.studio, actions, isRefusal, onError: (error) => errors.push(error.message) })
    token = await tokenOf(server.url)
  })
  after(() => server.close())

  test('listens on loopback only and serves the panel', async () => {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    const page = await fetch(new URL('/index.html', server.url))
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
    assert.ok(!(await page.text()).includes('__CANVAS_TOKEN__'))
    for (const [file, type] of [['/app.mjs', 'text/javascript; charset=utf-8'], ['/styles.css', 'text/css; charset=utf-8']]) {
      const response = await fetch(new URL(file, server.url))
      assert.deepEqual([response.status, response.headers.get('content-type'), response.headers.get('cache-control')], [200, type, 'no-store'])
    }
    const events = await fetch(new URL(`/events?token=${token}`, server.url))
    assert.deepEqual([events.headers.get('content-type'), events.headers.get('cache-control')], ['text/event-stream', 'no-store'])
    await events.body.cancel()
    assert.equal(page.headers.get('cache-control'), 'no-store')
    for (const [method, path] of [['GET', '/secret'], ['DELETE', '/app.mjs'], ['POST', '/'], ['POST', '/events'], ['GET', '/api/get_workflow'], ['POST', '/secret']]) {
      const response = await fetch(new URL(path, server.url), { method, headers: { 'X-Canvas-Token': token } })
      assert.deepEqual([response.status, response.headers.get('content-type'), await response.json()], [404, 'application/json; charset=utf-8', { error: 'not found' }], `${method} ${path}`)
    }
  })

  test('edits only for the page that carries the token', async () => {
    for (const response of [
      await post('remove_step', { stepId: 'findPets' }, {}),
      await post('remove_step', { stepId: 'findPets' }, { 'X-Canvas-Token': '0'.repeat(48) }),
      await fetch(new URL('/events?token=nope', server.url)),
      await fetch(new URL('/events', server.url)),
    ]) assert.deepEqual([response.status, await response.json()], [403, { error: 'forbidden' }])
    assert.deepEqual(world.studio.view().workflow.steps.map((step) => step.stepId), ['findPets', 'getPet'])
  })

  test('runs the actions the panel posts', async () => {
    const response = await post('add_step', { operation: 'petstore.placeOrder' })
    assert.deepEqual([response.status, response.headers.get('content-type')], [200, 'application/json; charset=utf-8'])
    assert.deepEqual(await response.json(), { result: { stepId: 'placeOrder' } })
    assert.deepEqual(await (await post('move_step', { stepId: 'placeOrder', to: 0 })).json(), { result: null })
    assert.deepEqual(world.studio.view().workflow.steps.map((step) => step.stepId), ['placeOrder', 'findPets', 'getPet'])
  })

  test('asks Copilot from the panel', async () => {
    assert.deepEqual(await (await post('ask', { question: 'why?', stepId: 'getPet' })).json(), { result: { asked: true } })
    assert.match(world.assistant.prompts.at(-1), /^About the Arazzo workflow "adopt-pet" in workflows\/adopt\.arazzo\.yaml, step "getPet":\nwhy\?/)
  })

  test('tells a refused edit from a crash, and hides what crashed', async () => {
    const refused = await post('remove_step', { stepId: 'nope' })
    assert.deepEqual([refused.status, await refused.json()], [400, { error: 'the workflow "adopt-pet" has no step "nope"' }])
    const crash = await post('crash', {})
    assert.deepEqual([crash.status, await crash.json()], [500, { error: 'the canvas hit an error; try again' }])
    assert.deepEqual(errors, ['boom'])
    assert.deepEqual(await (await post('missing', {})).json(), { error: 'no such action' })
    assert.equal((await post('missing', {})).status, 404)
  })

  test('refuses a body that is not JSON or too large', async () => {
    const notJson = await post('add_input', '{name')
    assert.deepEqual([notJson.status, await notJson.json()], [400, { error: 'the request body is not JSON' }])
    const empty = await post('add_input', '')
    assert.deepEqual([empty.status, await empty.json()], [400, { error: 'the input name "" must only use letters, digits, "_" and "-"' }])
    const body = (size) => `{"name":"${' '.repeat(size - 11)}"}`
    assert.equal(body(1024 * 1024).length, 1024 * 1024)
    const large = await post('add_input', body(1024 * 1024 + 1))
    assert.deepEqual([large.status, await large.json()], [413, { error: 'request body too large' }])
    const largest = await post('add_input', body(1024 * 1024))
    assert.equal(largest.status, 400)
  })

  test('pushes the view on every change', async () => {
    const events = await sse(new URL(`/events?token=${token}`, server.url))
    assert.equal(events.response.headers.get('content-type'), 'text/event-stream')
    const first = await events.next()
    assert.equal(first.view.path, PATH)
    await world.studio.addInput({ name: 'status' })
    const next = await events.next()
    assert.deepEqual(next.view.workflow.inputs, ['status'])
    events.close()
  })
})

describe('The panel server before any document is open', () => {
  test('pushes why there is nothing to show, and closes its streams on close', async () => {
    const studio = createStudio({ documents: new InMemoryDocuments(), sources: new InMemorySources(), assistant: new RecordingAssistant() })
    const server = await startServer({ studio, actions: [], isRefusal })
    const events = await sse(new URL(`/events?token=${await tokenOf(server.url)}`, server.url))
    assert.deepEqual(await events.next(), { error: 'no Arazzo document is open on the canvas' })
    await server.close()
    await assert.rejects(fetch(server.url))
  })
})
