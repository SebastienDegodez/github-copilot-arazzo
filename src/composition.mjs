// Composition root: the studio on the workspace files, its canvas, and the Copilot session that
// answers the questions asked from the panel.
import { createStudio } from './arazzo-application/studio.mjs'
import { fileDocuments, fileSources, findArazzoDocuments } from './infrastructure/workspace.mjs'
import { arazzoCanvas } from './presentation/canvas.mjs'

export const register = async ({ joinSession, createCanvas, CanvasError, root, log }) => {
  let session = null
  const documents = fileDocuments({ root })
  const studio = createStudio({
    documents,
    sources: fileSources({ root }),
    assistant: {
      // a question comes from the panel, which only opens once the session is joined
      ask: (prompt) => session.send({ prompt }),
    },
  })
  const canvas = arazzoCanvas({ createCanvas, CanvasError, studio, documents, findDocuments: () => findArazzoDocuments(root), log })
  session = await joinSession({ canvases: [canvas] })
  return { session, studio, canvas }
}
