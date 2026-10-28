// Serves the canvas panel on a copy of the fixture workspace, with the real studio and adapters, for
// the browser tests. The assistant records the questions instead of reaching Copilot.
import { cp, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudio } from '../../src/arazzo-application/studio.mjs'
import { fileDocuments, fileSources } from '../../src/infrastructure/workspace.mjs'
import { createActions } from '../../src/presentation/actions.mjs'
import { isRefusal } from '../../src/presentation/canvas.mjs'
import { startServer } from '../../src/presentation/server.mjs'

const FIXTURE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))

export const serveWorkspace = async ({ path = 'adopt.arazzo.yaml' } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'arazzo-e2e-'))
  await cp(FIXTURE, root, { recursive: true })
  const questions = []
  const studio = createStudio({ documents: fileDocuments({ root }), sources: fileSources({ root }), assistant: { ask: async (prompt) => questions.push(prompt) } })
  await studio.open({ path })
  const server = await startServer({ studio, actions: createActions(studio), isRefusal })
  return {
    url: server.url,
    questions,
    studio,
    document: () => readFile(join(root, path), 'utf8'),
    close: () => server.close(),
  }
}
