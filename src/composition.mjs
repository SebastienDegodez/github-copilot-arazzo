// Composition root: the studio on the workspace files, its canvas, and the Copilot session that
// answers the questions asked from the panel.
import { createStudio } from './arazzo-application/studio.mjs'
import { filePreferences, fileDocuments, fileSources, findArazzoDocuments } from './infrastructure/workspace.mjs'
import { yamlCodec } from './infrastructure/yaml-codec.mjs'
import { arazzoCanvas } from './presentation/canvas.mjs'

/**
 * @param {object} dependencies
 * @param {string} dependencies.root the workspace
 * @param {string} dependencies.home the Copilot home, $COPILOT_HOME or ~/.copilot, where the choices of the developer are kept
 */
export const register = async ({ joinSession, createCanvas, CanvasError, root, home, log }) => {
  let session = null
  const documents = fileDocuments({ root })
  const studio = createStudio({
    documents,
    codec: yamlCodec(),
    sources: fileSources({ root }),
    preferences: filePreferences({ home }),
    clock: { now: () => new Date() },
    assistant: {
      // a question comes from the panel, which only opens once the session is joined
      ask: (prompt) => session.send({ prompt }),
    },
  })
  const canvas = arazzoCanvas({ createCanvas, CanvasError, studio, documents, findDocuments: () => findArazzoDocuments(root), log })
  session = await joinSession({ canvases: [canvas] })
  return { session, studio, canvas }
}
