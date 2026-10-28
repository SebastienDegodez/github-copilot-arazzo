// Serves the canvas panel on a copy of the fixture workspace, with the real studio and adapters, for
// the browser tests. The assistant records the questions instead of reaching Copilot; the choices of
// the developer are kept in a Copilot home of the test.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudio } from '../../src/arazzo-application/studio.mjs'
import { filePreferences, fileDocuments, fileSources } from '../../src/infrastructure/workspace.mjs'
import { yamlCodec } from '../../src/infrastructure/yaml-codec.mjs'
import { createActions } from '../../src/presentation/actions.mjs'
import { isRefusal } from '../../src/presentation/canvas.mjs'
import { startServer } from '../../src/presentation/server.mjs'

const FIXTURE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))

/**
 * @param {object} [options]
 * @param {boolean} [options.autosave] the choice an earlier session made
 * @param {(root: string) => Promise<void>} [options.prepare] changes the workspace before the canvas opens it
 */
export const serveWorkspace = async ({ path = 'adopt.arazzo.yaml', autosave = true, prepare = async () => {} } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'arazzo-e2e-'))
  const home = await mkdtemp(join(tmpdir(), 'arazzo-e2e-home-'))
  await cp(FIXTURE, root, { recursive: true })
  await prepare(root)
  const questions = []
  const documents = fileDocuments({ root, pollInterval: 50 })
  const preferences = filePreferences({ home })
  await preferences.write({ autosave })
  const studio = createStudio({
    documents, codec: yamlCodec(), sources: fileSources({ root }), preferences, clock: { now: () => new Date() },
    assistant: { ask: async (prompt) => questions.push(prompt) },
  })
  await studio.open({ path })
  const unwatch = documents.watch(path, () => studio.reload())
  const server = await startServer({ studio, actions: createActions(studio), isRefusal })
  return {
    url: server.url,
    root,
    questions,
    studio,
    document: () => readFile(join(root, path), 'utf8'),
    write: (file, text) => writeFile(join(root, file), text),
    remove: (file) => rm(join(root, file)),
    close: async () => {
      unwatch()
      await server.close()
    },
  }
}
