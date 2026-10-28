// The use cases of the Arazzo canvas. Each edit reads the open document, applies a domain edit,
// saves the document and tells the listeners; the view is what the canvas and the agent see.
//
// Ports:
//   documents.read(path) -> document | null (no file yet); documents.write(path, document)
//   sources.load(documentPath, sourceDescription) -> OpenAPI document (throws when unreadable)
//   assistant.ask(prompt) -> hands a question to Copilot
import { findOperation, operationIdFor, operationsOf } from '../arazzo-domain/catalog.mjs'
import * as edits from '../arazzo-domain/document.mjs'
import { layoutWorkflow } from '../arazzo-domain/layout.mjs'
import { listOf } from '../arazzo-domain/lists.mjs'
import { RefusedEdit } from '../arazzo-domain/refused-edit.mjs'
import { problemsOf } from '../arazzo-domain/validation.mjs'

const titleFrom = (path) => path.split('/').at(-1).split('.')[0]

export const createStudio = ({ documents, sources, assistant }) => {
  let state = null
  const listeners = new Set()

  const opened = () => {
    if (!state) throw new RefusedEdit('no Arazzo document is open on the canvas')
    return state
  }

  const loadCatalog = async (path, document) => {
    const catalog = { loaded: [], operations: [], problems: [] }
    for (const source of listOf(document.sourceDescriptions).filter((each) => (each.type ?? 'openapi') === 'openapi')) {
      try {
        catalog.operations.push(...operationsOf(source.name, await sources.load(path, source)))
        catalog.loaded.push(source.name)
      } catch (error) {
        catalog.problems.push({ message: `the API description "${source.name}" cannot be read from ${source.url}: ${error.message}` })
      }
    }
    return catalog
  }

  const show = async (path, document, workflowId, { reloadSources = true } = {}) => {
    const catalog = reloadSources || !state ? await loadCatalog(path, document) : state.catalog
    const ids = edits.workflowsOf(document).map((workflow) => workflow.workflowId)
    state = { path, document, catalog, workflowId: ids.includes(workflowId) ? workflowId : ids[0] ?? null }
    for (const listener of listeners) listener()
  }

  const save = async (document, { workflowId = state.workflowId, reloadSources = false } = {}) => {
    await documents.write(state.path, document)
    await show(state.path, document, workflowId, { reloadSources })
  }

  /** Applies an edit to the selected workflow, or to the workflow named. */
  const editWorkflow = async (input, edit) => {
    const { document } = opened()
    const workflowId = input.workflowId ?? state.workflowId
    await save(edit(document, workflowId), { workflowId })
  }

  const describeStep = (problems) => (step) => {
    const operation = findOperation(state.catalog.operations, step.operationId)
    return {
      operation: operation ? { method: operation.method, path: operation.path, summary: operation.summary } : null,
      problems: problems.filter((problem) => problem.stepId === step.stepId).map((problem) => problem.message),
    }
  }

  /** The values a step can get: the parameters of its operation and those it already sends. */
  const slotsOf = (step) => {
    const operation = findOperation(state.catalog.operations, step.operationId)
    const slots = listOf(operation?.parameters).map((parameter) => ({ ...parameter, value: null }))
    for (const parameter of listOf(step.parameters)) {
      const slot = slots.find((each) => each.name === parameter.name && each.in === parameter.in)
      if (slot) slot.value = parameter.value
      else slots.push({ name: parameter.name, in: parameter.in, required: false, value: parameter.value })
    }
    for (const [name, value] of Object.entries(step.requestBody?.payload ?? {})) slots.push({ name, in: 'body', required: false, value })
    return slots
  }

  const view = () => {
    const { path, document, catalog, workflowId } = opened()
    const problems = [...catalog.problems, ...problemsOf(document, catalog)]
    const workflow = workflowId === null ? null : edits.findWorkflow(document, workflowId)
    return {
      path,
      document,
      workflows: edits.workflowsOf(document).map((each) => ({ workflowId: each.workflowId, summary: each.summary ?? '', steps: listOf(each.steps).length })),
      workflowId,
      workflow: workflow && {
        inputs: edits.declaredInputs(workflow),
        outputs: workflow.outputs ?? {},
        steps: listOf(workflow.steps).map((step) => ({
          stepId: step.stepId,
          operationId: step.operationId ?? step.operationPath ?? step.workflowId ?? null,
          outputs: step.outputs ?? {},
          slots: slotsOf(step),
          successCriteria: listOf(step.successCriteria).map((criterion) => criterion.condition),
        })),
      },
      diagram: workflow && layoutWorkflow(workflow, describeStep(problems.filter((problem) => problem.workflowId === workflowId))),
      problems,
      operations: catalog.operations,
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
      let document = await documents.read(path)
      if (!document) {
        document = edits.newDocument({ title: titleFrom(path), workflowId: workflowId ?? titleFrom(path) })
        for (const source of described) document = edits.addSource(document, source)
        await documents.write(path, document)
      }
      await show(path, document, workflowId)
      return view()
    },

    /** Reads the open document again, after another tool changed its file. */
    async reload() {
      const { path, workflowId } = opened()
      const document = await documents.read(path)
      if (document) await show(path, document, workflowId)
    },

    selectWorkflow: async ({ workflowId }) => {
      const { path, document } = opened()
      edits.findWorkflow(document, workflowId)
      await show(path, document, workflowId, { reloadSources: false })
    },

    addSource: async (input) => save(edits.addSource(opened().document, input), { reloadSources: true }),

    addWorkflow: async (input) => save(edits.addWorkflow(opened().document, input), { workflowId: input.workflowId }),

    /** Adds a step calling an operation of the palette (`operation`: "source.operationId") or any operationId. */
    async addStep(input) {
      const { document, catalog } = opened()
      let { operationId } = input
      if (input.operation) {
        const operation = catalog.operations.find((each) => `${each.source}.${each.operationId}` === input.operation)
        if (!operation) throw new RefusedEdit(`no described API offers the operation "${input.operation}"`)
        operationId = operationIdFor(operation, catalog.loaded.length)
      }
      let stepId
      await editWorkflow(input, (doc, workflowId) => {
        const added = edits.addStep(doc, workflowId, { operationId, stepId: input.stepId, before: input.before })
        stepId = added.stepId
        return added.document
      })
      return { stepId }
    },

    moveStep: async (input) => editWorkflow(input, (doc, id) => edits.moveStep(doc, id, input)),
    removeStep: async (input) => editWorkflow(input, (doc, id) => edits.removeStep(doc, id, input)),
    addInput: async (input) => editWorkflow(input, (doc, id) => edits.addInput(doc, id, input)),
    setStepOutput: async (input) => editWorkflow(input, (doc, id) => edits.setStepOutput(doc, id, input)),
    linkData: async (input) => editWorkflow(input, (doc, id) => edits.linkData(doc, id, input)),
    addWorkflowOutput: async (input) => editWorkflow(input, (doc, id) => edits.addWorkflowOutput(doc, id, input)),
    addSuccessCriterion: async (input) => editWorkflow(input, (doc, id) => edits.addSuccessCriterion(doc, id, input)),
    addAction: async (input) => editWorkflow(input, (doc, id) => edits.addAction(doc, id, input)),

    /** Hands a question to Copilot with what it needs to answer: the document, the step and their problems. */
    async ask({ question, stepId }) {
      if (!question?.trim()) throw new RefusedEdit('ask a question first')
      const { path, document, workflowId, problems } = view()
      const workflow = edits.workflowsOf(document).find((each) => each.workflowId === workflowId)
      const step = listOf(workflow?.steps).find((each) => stepId !== undefined && each.stepId === stepId)
      if (stepId !== undefined && !step) throw new RefusedEdit(`the workflow "${workflowId}" has no step "${stepId}"`)
      const about = step ? problems.filter((problem) => problem.stepId === stepId)
        : problems.filter((problem) => problem.workflowId === workflowId || !Object.hasOwn(problem, 'workflowId'))
      const subject = step ?? workflow ?? document
      const prompt = [
        `About ${workflow ? `the Arazzo workflow "${workflowId}" in` : 'the Arazzo document'} ${path}${step ? `, step "${stepId}"` : ''}:`,
        question.trim(),
        '',
        `The ${step ? 'step' : workflow ? 'workflow' : 'document'}:\n${JSON.stringify(subject, null, 2)}`,
        '',
        about.length ? `Its problems:\n${about.map((problem) => `- ${problem.message}`).join('\n')}` : 'It has no problem.',
        '',
        'Change the workflow through the actions of the "arazzo" canvas (get_workflow, add_step, link_data, …) so the developer sees it.',
      ].join('\n')
      await assistant.ask(prompt)
      return { asked: true }
    },
  }
}
