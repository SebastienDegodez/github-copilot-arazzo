// The Arazzo canvas declaration, built from the SDK's createCanvas and CanvasError handed in, so it
// is tested without the SDK. One panel server serves every open instance; the agent gets the actions
// marked `agent`.
import { createActions } from './actions.mjs'
import { startServer } from './server.mjs'

export const CANVAS_ID = 'arazzo'
export const DEFAULT_PATH = 'arazzo/workflow.arazzo.yaml'
const REFUSALS = new Set(['RefusedEdit'])
const CRASHED = 'the Arazzo canvas hit an error; run the action again or reopen the canvas'

export const isRefusal = (error) => REFUSALS.has(error.name)

/**
 * @param {object} dependencies
 * @param {(options: object) => object} dependencies.createCanvas the SDK's createCanvas
 * @param {new (code: string, message: string) => Error} dependencies.CanvasError the SDK's CanvasError
 * @param {object} dependencies.studio the use cases (src/arazzo-application/studio.mjs)
 * @param {{ watch: (path: string, listener: () => void) => () => void }} dependencies.documents the document files
 * @param {() => Promise<string[]>} dependencies.findDocuments the Arazzo documents of the workspace
 * @param {(text: string) => void} [dependencies.log]
 */
export const arazzoCanvas = ({ createCanvas, CanvasError, studio, documents, findDocuments, log = () => {} }) => {
  const actions = createActions(studio)
  const instances = new Set()
  let server = null
  let starting = null
  let opened = null
  let unwatch = () => {}

  const toCanvasError = (error) => {
    if (isRefusal(error)) return new CanvasError('arazzo_refused', error.message)
    log(`arazzo canvas: ${error.stack ?? error.message}`)
    return new CanvasError('arazzo_error', CRASHED)
  }

  const ensureServer = () => {
    starting ??= startServer({ studio, actions, isRefusal, onError: (error) => log(`arazzo canvas: ${error.stack ?? error.message}`) })
      .then((started) => (server = started))
    return starting
  }

  const openDocument = async ({ path, workflowId, sources }) => {
    const wanted = path ?? opened ?? (await findDocuments())[0] ?? DEFAULT_PATH
    if (wanted !== opened) {
      await studio.open({ path: wanted, workflowId, sources })
      unwatch()
      unwatch = documents.watch(wanted, () => studio.reload().catch((error) => log(`arazzo canvas: ${error.stack ?? error.message}`)))
      opened = wanted
    } else if (workflowId) {
      await studio.selectWorkflow({ workflowId })
    }
  }

  return createCanvas({
    id: CANVAS_ID,
    displayName: 'Arazzo',
    description: 'Author an Arazzo workflow visually: drop the operations of your OpenAPI descriptions as steps, wire data between them, see its problems against the spectral:arazzo rules and its YAML, save it and ask Copilot.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Arazzo document to open, relative to the workspace (created when missing; default: the first *.arazzo.yaml found).' },
        workflowId: { type: 'string', description: 'Workflow to show, or to create in a new document.' },
        sources: {
          type: 'array',
          description: 'OpenAPI descriptions a new document describes.',
          items: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' } }, required: ['name', 'url'], additionalProperties: false },
        },
      },
      additionalProperties: false,
    },
    actions: actions.filter((action) => action.agent).map((action) => ({
      name: action.name,
      description: action.description,
      inputSchema: action.inputSchema,
      handler: async (ctx) => {
        try {
          return (await action.run(ctx.input ?? {})) ?? { ok: true }
        } catch (error) {
          throw toCanvasError(error)
        }
      },
    })),
    open: async (ctx) => {
      try {
        await openDocument(ctx.input ?? {})
        const { url } = await ensureServer()
        instances.add(ctx.instanceId)
        return { url, title: `Arazzo · ${opened}`, status: studio.view().status }
      } catch (error) {
        throw toCanvasError(error)
      }
    },
    onClose: async (ctx) => {
      instances.delete(ctx.instanceId)
      if (instances.size || !server) return
      // the next open reads the document again: another tool may change it while no panel shows it
      unwatch()
      opened = null
      const closing = server
      server = null
      starting = null
      await closing.close()
    },
  })
}
