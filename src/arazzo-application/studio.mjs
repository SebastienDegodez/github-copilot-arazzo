// The use cases of the Arazzo canvas. The text of the document is what is saved: an edit on the
// diagram is written over it by the codec, keeping its comments and the order of its keys, and an
// edit of the YAML itself shows on the diagram as soon as it parses. Every edit goes to a draft that
// is saved at once with autosave, or when the developer saves; it can be undone and redone.
//
// Ports:
//   documents.read(path) -> text | null (no file yet); documents.write(path, text) (throws why it cannot)
//   codec.parse(text) -> { document } | { error: { message, line } }; codec.merge(path, text, document) -> text;
//     codec.lineOf(text, pointer) -> line
//   sources.load(documentPath, sourceDescription) -> { state, description?, detail? };
//     sources.candidates(documentPath) -> urls of the API descriptions of the workspace, relative to the document
//   preferences.read() -> { autosave? }; preferences.write({ autosave })
//   assistant.ask(prompt) -> hands a question to Copilot
//   clock.now() -> Date
import { findOperation, operationIdFor, readSource } from '../arazzo-domain/catalog.mjs'
import * as edits from '../arazzo-domain/document.mjs'
import { record, redo, startHistory, undo } from '../arazzo-domain/history.mjs'
import { layoutWorkflow } from '../arazzo-domain/layout.mjs'
import { listOf, mapOf, objectsOf } from '../arazzo-domain/lists.mjs'
import { RefusedEdit } from '../arazzo-domain/refused-edit.mjs'
import { problemsOf, summaryOf } from '../arazzo-domain/validation.mjs'

const titleFrom = (path) => path.split('/').at(-1).split('.')[0]

export const createStudio = ({ documents, codec, sources, preferences, assistant, clock }) => {
  let state = null
  const listeners = new Set()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const opened = () => {
    if (!state) throw new RefusedEdit('no Arazzo document is open on the canvas')
    return state
  }

  /** The open document, when the diagram can edit it: not while its YAML does not parse. */
  const editable = () => {
    const { error, valid } = opened()
    if (error) throw new RefusedEdit(`the YAML does not parse (line ${error.line}): correct it or undo first`)
    return valid.document
  }

  const loadCatalog = async (document) => {
    const catalog = { sources: [], operations: [] }
    for (const source of objectsOf(document.sourceDescriptions)) {
      const read = readSource(source, await sources.load(state.path, source))
      catalog.sources.push(read.source)
      catalog.operations.push(...read.operations)
    }
    return catalog
  }

  /** Takes a text as the draft; the diagram keeps the last document that parsed. */
  const take = (text) => {
    const parsed = codec.parse(text)
    state.text = text
    state.error = parsed.error ?? null
    if (parsed.document) state.valid = { text, document: parsed.document }
  }

  /** Checks the document again, reading its API descriptions when they changed, and tells the listeners. */
  const refresh = async ({ reloadSources = false } = {}) => {
    const { text, document } = state.valid
    const described = JSON.stringify(document.sourceDescriptions)
    if (reloadSources || described !== state.described) {
      state.catalog = await loadCatalog(document)
      state.described = described
    }
    const ids = edits.workflowsOf(document).map((workflow) => workflow.workflowId)
    state.workflowId = ids.includes(state.workflowId) ? state.workflowId : ids[0] ?? null
    state.problems = problemsOf(document, state.catalog).map((problem) => ({ ...problem, line: codec.lineOf(text, problem.pointer) }))
    notify()
  }

  const persist = async () => {
    if (state.error) throw new RefusedEdit(`the YAML does not parse (line ${state.error.line}): correct it before saving`)
    try {
      await documents.write(state.path, state.text)
    } catch (error) {
      state.saveError = error.message
      notify()
      throw new RefusedEdit(`${state.path} could not be saved: ${error.message}`)
    }
    Object.assign(state, { savedText: state.text, savedAt: clock.now().toISOString(), saveError: null })
  }

  /** Saves at once with autosave; a save that fails keeps the draft and tells why. */
  const autosave = async () => {
    if (state.autosave && !state.error) await persist().catch(() => {})
  }

  const commit = async (text, workflowId = state.workflowId) => {
    state.history = record(state.history, text)
    take(text)
    state.workflowId = workflowId
    await autosave()
    await refresh()
  }

  /** Writes an edited document over the draft. */
  const change = (document, workflowId) => commit(codec.merge(state.path, state.text, document), workflowId)

  /** Applies an edit to the workflow shown, or to the workflow named. */
  const editWorkflow = (input, edit) => {
    const document = editable()
    const workflowId = input.workflowId ?? state.workflowId
    return change(edit(document, workflowId), workflowId)
  }

  const restore = async (history) => {
    state.history = history
    take(history.present)
    await autosave()
    await refresh()
  }

  const load = async (text) => {
    state.history = startHistory(text)
    state.savedText = text
    state.conflict = false
    take(text)
    await refresh({ reloadSources: true })
  }

  /** The values a step can send: the parameters of its operation and those it already sends. */
  const slotsOf = (step) => {
    const operation = findOperation(state.catalog.operations, step.operationId)
    const slots = listOf(operation?.parameters).map((parameter) => ({ ...parameter, value: null }))
    for (const parameter of objectsOf(step.parameters)) {
      const slot = slots.find((each) => each.name === parameter.name && each.in === parameter.in)
      if (slot) slot.value = parameter.value
      else slots.push({ name: parameter.name, in: parameter.in, required: false, value: parameter.value })
    }
    for (const [name, value] of Object.entries(mapOf(mapOf(step.requestBody).payload))) slots.push({ name, in: 'body', required: false, value })
    return slots
  }

  const view = () => {
    const { path, catalog, workflowId, problems, valid: { document } } = opened()
    const workflows = edits.workflowsOf(document)
    const index = workflows.findIndex((each) => each.workflowId === workflowId)
    const ofDocument = (problem) => !Object.hasOwn(problem, 'workflowId')
    const of = (id) => problems.filter((problem) => !ofDocument(problem) && problem.workflowId === id)
    const shown = problems.filter((problem) => ofDocument(problem) || problem.workflowId === workflowId)
    const workflow = workflows[index] ?? null
    const describeStep = (step, at) => {
      const operation = findOperation(catalog.operations, step.operationId)
      const pointer = `#/workflows/${index}/steps/${at}`
      return {
        operation: operation ? { method: operation.method, path: operation.path, summary: operation.summary } : null,
        problems: shown.filter((problem) => `${problem.pointer}/`.startsWith(`${pointer}/`)).map(({ severity, message }) => ({ severity, message })),
      }
    }
    return {
      path,
      document,
      workflows: workflows.map((each) => ({ workflowId: each.workflowId, summary: each.summary ?? '', steps: listOf(each.steps).length })),
      workflowId,
      workflow: workflow && {
        inputs: edits.declaredInputs(workflow),
        outputs: mapOf(workflow.outputs),
        steps: objectsOf(workflow.steps).map((step) => ({
          stepId: step.stepId,
          operationId: step.operationId ?? step.operationPath ?? step.workflowId ?? null,
          outputs: mapOf(step.outputs),
          slots: slotsOf(step),
          successCriteria: objectsOf(step.successCriteria).map((criterion) => criterion.condition),
        })),
      },
      diagram: workflow ? layoutWorkflow(workflow, describeStep) : null,
      problems: shown,
      status: summaryOf(shown),
      otherWorkflows: [...new Set(workflows.map((each) => each.workflowId))].filter((id) => id !== workflowId)
        .map((id) => ({ workflowId: id, problems: of(id).length })).filter((each) => each.problems),
      sources: catalog.sources,
      operations: catalog.operations,
      save: {
        autosave: state.autosave, dirty: state.text !== state.savedText, savedAt: state.savedAt, error: state.saveError,
        conflict: state.conflict, canUndo: state.history.past.length > 0, canRedo: state.history.future.length > 0,
      },
      yaml: { text: state.text, error: state.error },
    }
  }

  return {
    view,

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Opens the document at a path; a path without a document gets a new one with one empty workflow. */
    async open({ path, workflowId, sources: described = [] }) {
      if (!path) throw new RefusedEdit('the canvas needs the path of the Arazzo document to open')
      let text = await documents.read(path)
      if (text === null) {
        let document = edits.newDocument({ title: titleFrom(path), workflowId: workflowId ?? titleFrom(path) })
        for (const source of described) document = edits.addSource(document, source)
        text = codec.merge(path, text, document)
        await documents.write(path, text)
      }
      const { error } = codec.parse(text)
      if (error) throw new RefusedEdit(`${path} is not an Arazzo document: ${error.message} (line ${error.line})`)
      const { autosave: on } = await preferences.read()
      state = { path, workflowId: workflowId ?? null, autosave: on !== false, savedAt: null, saveError: null }
      await load(text)
      return view()
    },

    /**
     * Reads the open document again, after another tool changed its file: at once when every edit is
     * saved, else the developer chooses between their edits and the file.
     */
    async reload() {
      const { path } = opened()
      const text = await documents.read(path)
      if (text === null) return
      if (state.text === state.savedText) return load(text)
      state.conflict = true
      notify()
    },

    /** After the file changed on disk under unsaved edits: keep the edits ("mine"), or take the file ("file"). */
    async resolveConflict({ keep }) {
      if (!opened().conflict) throw new RefusedEdit('the file did not change on disk')
      if (keep === 'mine') {
        state.conflict = false
        return notify()
      }
      if (keep !== 'file') throw new RefusedEdit(`keep "mine" or "file", not "${keep}"`)
      const text = await documents.read(state.path)
      return load(text ?? state.savedText)
    },

    selectWorkflow: async ({ workflowId }) => {
      edits.findWorkflow(opened().valid.document, workflowId)
      state.workflowId = workflowId
      notify()
    },

    async save() {
      opened()
      await persist()
      notify()
      return { savedAt: state.savedAt }
    },

    async setAutosave({ on }) {
      if (typeof on !== 'boolean') throw new RefusedEdit('autosave is on (true) or off (false)')
      opened().autosave = on
      await preferences.write({ autosave: on })
      if (on && state.text !== state.savedText) await persist()
      notify()
    },

    undo: async () => restore(undo(opened().history)),
    redo: async () => restore(redo(opened().history)),

    getYaml: () => ({ text: opened().text, error: state.error }),

    /** Takes a text typed in the YAML view as the draft; the diagram shows it once it parses. */
    async setYaml({ text }) {
      opened()
      if (typeof text !== 'string') throw new RefusedEdit('set the YAML with the text of the document')
      await commit(text)
      return { error: state.error }
    },

    /** Describes an API, once its url gives an OpenAPI or Arazzo description the canvas can read. */
    async addSource(input) {
      const document = editable()
      edits.addSource(document, input)
      const { source } = readSource(input, await sources.load(state.path, input))
      if (source.message) throw new RefusedEdit(`the API "${input.name}" cannot be added: ${source.message}`)
      await change(edits.addSource(document, { ...input, type: source.type }))
    },

    removeSource: async ({ name }) => change(edits.removeSource(editable(), { name }, state.catalog.operations)),

    /** The OpenAPI and Arazzo descriptions of the workspace the document does not describe yet. */
    async listSourceCandidates() {
      const urls = objectsOf(opened().valid.document.sourceDescriptions).map((source) => source.url)
      return { candidates: (await sources.candidates(state.path)).filter((url) => !urls.includes(url)) }
    },

    addWorkflow: async (input) => change(edits.addWorkflow(editable(), input), input.workflowId),

    /** Adds a step calling an operation of the palette (`operation`: "source.operationId") or any operationId. */
    async addStep(input) {
      const document = editable()
      let { operationId } = input
      if (input.operation) {
        const operation = state.catalog.operations.find((each) => `${each.source}.${each.operationId}` === input.operation)
        if (!operation) throw new RefusedEdit(`no described API offers the operation "${input.operation}"`)
        operationId = operationIdFor(operation, state.catalog.sources.length)
      }
      const workflowId = input.workflowId ?? state.workflowId
      const added = edits.addStep(document, workflowId, { operationId, stepId: input.stepId, before: input.before })
      await change(added.document, workflowId)
      return { stepId: added.stepId }
    },

    moveStep: async (input) => editWorkflow(input, (doc, id) => edits.moveStep(doc, id, input)),
    removeStep: async (input) => editWorkflow(input, (doc, id) => edits.removeStep(doc, id, input)),
    addInput: async (input) => editWorkflow(input, (doc, id) => edits.addInput(doc, id, input)),
    setStepOutput: async (input) => editWorkflow(input, (doc, id) => edits.setStepOutput(doc, id, input)),
    linkData: async (input) => editWorkflow(input, (doc, id) => edits.linkData(doc, id, input)),
    setStepValue: async (input) => editWorkflow(input, (doc, id) => edits.setStepValue(doc, id, input)),
    clearStepValue: async (input) => editWorkflow(input, (doc, id) => edits.clearStepValue(doc, id, input)),
    addWorkflowOutput: async (input) => editWorkflow(input, (doc, id) => edits.addWorkflowOutput(doc, id, input)),
    addSuccessCriterion: async (input) => editWorkflow(input, (doc, id) => edits.addSuccessCriterion(doc, id, input)),
    addAction: async (input) => editWorkflow(input, (doc, id) => edits.addAction(doc, id, input)),

    /** Hands a question to Copilot with what it needs to answer: the document, the step and their problems. */
    async ask({ question, stepId }) {
      if (!question?.trim()) throw new RefusedEdit('ask a question first')
      const { path, document, workflowId, problems } = view()
      const workflow = edits.workflowsOf(document).find((each) => each.workflowId === workflowId)
      const step = objectsOf(workflow?.steps).find((each) => stepId !== undefined && each.stepId === stepId)
      if (stepId !== undefined && !step) throw new RefusedEdit(`the workflow "${workflowId}" has no step "${stepId}"`)
      const about = step ? problems.filter((problem) => problem.stepId === stepId) : problems
      const subject = step ?? workflow ?? document
      const prompt = [
        `About ${workflow ? `the Arazzo workflow "${workflowId}" in` : 'the Arazzo document'} ${path}${step ? `, step "${stepId}"` : ''}:`,
        question.trim(),
        '',
        `The ${step ? 'step' : workflow ? 'workflow' : 'document'}:\n${JSON.stringify(subject, null, 2)}`,
        '',
        about.length ? `Its problems:\n${about.map((problem) => `- line ${problem.line}, ${problem.severity} ${problem.rule}: ${problem.message}`).join('\n')}` : 'It has no problem.',
        '',
        'Change the workflow through the actions of the "arazzo" canvas (get_workflow, add_step, link_data, …) so the developer sees it.',
      ].join('\n')
      await assistant.ask(prompt)
      return { asked: true }
    },
  }
}
