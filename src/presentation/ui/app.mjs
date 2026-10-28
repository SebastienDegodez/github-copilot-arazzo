// The panel of the Arazzo canvas: renders the studio view pushed over SSE, and turns drags, drops,
// forms and the YAML typed into the canvas actions posted to the loopback server.
const token = window.CANVAS_TOKEN
const $ = (id) => document.getElementById(id)
const DRAG_TYPE = 'application/x-arazzo'
const SVG = 'http://www.w3.org/2000/svg'
const PLACES = ['query', 'path', 'header', 'cookie', 'body']
const TYPING_DELAY = 400

let view = null
let selected = null
let dragging = null
let focusSlot = null
let currentLine = null
let typing = null

const h = (tag, attributes = {}, ...children) => {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value)
    else if (key === 'dataset') Object.assign(element.dataset, value)
    else if (key === 'style') Object.assign(element.style, value)
    else if (key === 'value') element.value = value
    else element.setAttribute(key, value === true ? '' : value)
  }
  element.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false))
  return element
}

const svg = (tag, attributes = {}) => {
  const element = document.createElementNS(SVG, tag)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
  return element
}

let toastTimer
const toast = (message) => {
  const box = $('toast')
  box.textContent = message
  box.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (box.hidden = true), 6000)
}

const api = async (name, input = {}) => {
  const response = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Canvas-Token': token },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) {
    toast(body.error)
    return null
  }
  return body.result ?? {}
}

/** A small form in a dialog; resolves with its values, or null when cancelled. `extra` goes under the fields. */
const form = (title, fields, extra = null) => new Promise((resolve) => {
  const dialog = $('dialog')
  $('dialog-title').textContent = title
  $('dialog-fields').replaceChildren(...fields.map((field) => h('label', {}, field.label,
    field.options
      ? h('select', { name: field.name, 'data-testid': `field-${field.name}` }, field.options.map((option) => h('option', { value: option, selected: option === field.value }, option)))
      : h('input', { name: field.name, value: field.value ?? '', required: field.required !== false, type: field.type ?? 'text', 'data-testid': `field-${field.name}`, placeholder: field.placeholder }))),
  extra ?? [])
  dialog.returnValue = ''
  dialog.onclose = () => {
    if (dialog.returnValue !== 'ok') return resolve(null)
    resolve(Object.fromEntries(fields.map((field) => [field.name, dialog.querySelector(`[name="${field.name}"]`).value.trim()])))
  }
  dialog.showModal()
  dialog.querySelector('input, select')?.focus()
})

const stepOf = (stepId) => view?.workflow?.steps.find((step) => step.stepId === stepId)
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`

/* ---------- views: diagram, split, YAML ---------- */

const setView = (mode) => {
  document.body.classList.remove('view-diagram', 'view-split', 'view-yaml')
  document.body.classList.add(`view-${mode}`)
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === mode))
}
const viewMode = () => ['diagram', 'split', 'yaml'].find((mode) => document.body.classList.contains(`view-${mode}`))

/* ---------- drag and drop ---------- */

const draggable = (element, payload) => {
  element.draggable = true
  element.addEventListener('dragstart', (event) => {
    dragging = payload
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'copyMove'
    event.stopPropagation()
  })
  element.addEventListener('dragend', () => {
    dragging = null
    document.querySelectorAll('.drop-ok').forEach((each) => each.classList.remove('drop-ok'))
  })
  return element
}

/** Makes an element take the drops `accepts` says yes to, and hands them to `drop`. */
const dropTarget = (element, accepts, drop) => {
  element.addEventListener('dragover', (event) => {
    if (!dragging || !accepts(dragging)) return
    event.preventDefault()
    event.stopPropagation()
    element.classList.add('drop-ok')
  })
  element.addEventListener('dragleave', () => element.classList.remove('drop-ok'))
  element.addEventListener('drop', (event) => {
    element.classList.remove('drop-ok')
    const payload = dragging ?? JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || 'null')
    if (!payload || !accepts(payload)) return
    event.preventDefault()
    event.stopPropagation()
    dragging = null
    drop(payload)
  })
  return element
}

const isValue = (payload) => payload.kind === 'input' || payload.kind === 'output'
const fromOf = (payload) => (payload.kind === 'input' ? { input: payload.name } : { stepId: payload.stepId, output: payload.output })

const link = (payload, to) => api('link_data', { from: fromOf(payload), to })

const linkToNewParameter = async (payload, stepId) => {
  const values = await form(`Pass ${payload.kind === 'input' ? `$inputs.${payload.name}` : `outputs.${payload.output}`} to ${stepId}`, [
    { name: 'name', label: 'Parameter or body property', value: payload.output ?? payload.name },
    { name: 'in', label: 'In', options: PLACES, value: 'query' },
  ])
  if (values) await link(payload, { stepId, name: values.name, in: values.in })
}

/* ---------- rendering ---------- */

const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const renderBar = () => {
  $('path').textContent = view.path
  $('path').title = view.path
  $('status').textContent = view.status
  $('status').className = `status${view.problems.some((problem) => problem.severity === 'error') ? ' has-errors' : view.problems.length ? ' has-warnings' : ''}`
  $('workflows').replaceChildren(...view.workflows.map((workflow) =>
    h('option', { value: workflow.workflowId, selected: workflow.workflowId === view.workflowId }, `${workflow.workflowId} (${workflow.steps})`)))
  const { save, yaml } = view
  const status = $('save-status')
  if (yaml.error) [status.textContent, status.className] = [`YAML does not parse (line ${yaml.error.line})`, 'save-status danger']
  else if (save.error) [status.textContent, status.className] = [`Not saved: ${save.error}`, 'save-status danger']
  else if (save.dirty) [status.textContent, status.className] = ['Modified', 'save-status modified']
  else [status.textContent, status.className] = [save.savedAt ? `Saved at ${timeOf(save.savedAt)}` : 'Saved', 'save-status saved']
  status.dataset.state = yaml.error ? 'invalid' : save.dirty ? 'modified' : 'saved'
  $('autosave').checked = save.autosave
  $('save').disabled = !save.dirty || Boolean(yaml.error)
  $('undo').disabled = !save.canUndo
  $('redo').disabled = !save.canRedo
  $('conflict').hidden = !save.conflict
}

const renderPalette = () => {
  $('inputs').replaceChildren(...(view.workflow?.inputs ?? []).map((name) =>
    draggable(h('span', { class: 'chip', title: `$inputs.${name}`, 'data-testid': `input-${name}` }, name), { kind: 'input', name })))
  $('sources').replaceChildren(...(view.sources.length ? view.sources.map((source) => h('li', { class: `source-item${source.state === 'read' ? '' : ' unreadable'}`, 'data-testid': `source-${source.name}` },
    h('div', { class: 'source-head' },
      h('strong', {}, source.name),
      h('button', { type: 'button', class: 'link remove', title: `Stop describing ${source.name}`, 'aria-label': `Remove ${source.name}`, 'data-testid': `remove-source-${source.name}`,
        onclick: () => api('remove_source', { name: source.name }) }, '×')),
    h('div', { class: 'source-badges' },
      h('span', { class: 'badge' }, source.type ?? '?'),
      h('span', { class: `badge state ${source.state === 'read' ? 'ok' : 'bad'}`, 'data-testid': `source-state-${source.name}` }, source.state)),
    h('code', { class: 'url' }, source.url),
    h('span', { class: 'hint' }, source.state === 'read' ? plural(source.operations, 'operation') : source.message)))
    : [h('li', { class: 'hint' }, 'No API described yet.')]))
  const bySource = Map.groupBy(view.operations, (operation) => operation.source)
  $('operations').replaceChildren(...[...bySource].flatMap(([source, operations]) => [
    h('div', { class: 'source' }, source),
    ...operations.map((operation) => draggable(h('div', { class: 'operation', title: operation.summary, 'data-testid': `operation-${operation.operationId}` },
      h('span', { class: 'id' }, operation.operationId),
      h('span', { class: 'method mono' }, operation.method), h('code', {}, operation.path)),
    { kind: 'operation', operation: `${source}.${operation.operationId}` })),
  ]))
}

const renderEdges = (diagram) => {
  const layer = svg('svg', { width: diagram.width, height: diagram.height, viewBox: `0 0 ${diagram.width} ${diagram.height}`, 'aria-hidden': 'true' })
  const defs = svg('defs')
  for (const kind of ['sequence', 'data', 'goto', 'retry', 'end']) {
    const marker = svg('marker', { id: `arrow-${kind}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: `edge-${kind}`, style: 'fill: currentColor; stroke: none' }))
    marker.style.color = getComputedStyle(document.documentElement).getPropertyValue('--muted')
    defs.append(marker)
  }
  layer.append(defs)
  for (const edge of diagram.edges) {
    layer.append(svg('path', { d: edge.path, class: `edge edge-${edge.kind}`, 'marker-end': `url(#arrow-${edge.kind})`, 'data-from': edge.from, 'data-to': edge.to, 'data-kind': edge.kind }))
  }
  const labels = diagram.edges.filter((edge) => edge.label).map((edge) => h('div', {
    class: `edge-label ${edge.label.align}`, 'data-testid': `label-${edge.kind}`, style: { left: `${edge.label.x + (edge.label.align === 'end' ? -4 : 4)}px`, top: `${edge.label.y}px` },
  }, edge.label.lines.map((line) => h('div', {}, line))))
  return [layer, ...labels]
}

const badges = (problems) => ['error', 'warning'].map((severity) => {
  const of = problems.filter((problem) => problem.severity === severity)
  return of.length ? h('span', { class: `badge ${severity}`, title: of.map((problem) => problem.message).join('\n'), 'data-testid': `badge-${severity}` }, `${severity === 'error' ? '✕' : '⚠'} ${of.length}`) : null
})

/** Selects a step and asks the value of one of its slots. */
const askValue = (stepId, slot) => {
  focusSlot = `${slot.in}-${slot.name}`
  select(stepId)
}

const stepNode = (node) => {
  const step = stepOf(node.stepId) ?? { slots: [], outputs: {}, operationId: '' }
  const severity = node.problems.some((problem) => problem.severity === 'error') ? ' has-errors' : node.problems.length ? ' has-warnings' : ''
  const element = h('div', {
    class: `node step${severity}${selected === node.stepId ? ' selected' : ''}`,
    tabindex: 0, role: 'button', 'data-testid': `step-${node.stepId}`, 'data-step-id': node.stepId,
    style: { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` },
    onclick: () => select(node.stepId), onkeydown: (event) => event.key === 'Enter' && select(node.stepId),
  },
  h('div', { class: 'title' }, h('span', { class: 'number' }, String(node.index + 1)), h('span', { class: 'name' }, node.stepId), h('span', { class: 'badges' }, badges(node.problems))),
  h('div', { class: 'endpoint mono' }, node.operation ? `${node.operation.method} ${node.operation.path}` : step.operationId),
  h('div', { class: 'row' }, h('span', { class: 'label' }, 'in'), step.slots.map((slot) => dropTarget(
    h('span', {
      class: `chip slot${slot.value === null ? '' : ' bound'}${slot.required ? ' required' : ''}`, title: slot.value ?? 'click to give a value, or drop one here',
      'data-testid': `slot-${node.stepId}-${slot.in}-${slot.name}`,
      onclick: (event) => {
        event.stopPropagation()
        askValue(node.stepId, slot)
      },
    }, `${slot.in} ${slot.name}`),
    isValue, (payload) => link(payload, { stepId: node.stepId, name: slot.name, in: slot.in })))),
  h('div', { class: 'row' }, h('span', { class: 'label' }, 'out'), Object.keys(step.outputs).map((output) =>
    draggable(h('span', { class: 'chip', title: step.outputs[output], 'data-testid': `output-${node.stepId}-${output}` }, output), { kind: 'output', stepId: node.stepId, output }))))
  draggable(element, { kind: 'step', stepId: node.stepId })
  return dropTarget(element, (payload) => payload.kind === 'operation' || (payload.kind === 'step' && payload.stepId !== node.stepId) || isValue(payload), (payload) => {
    if (payload.kind === 'operation') return api('add_step', { operation: payload.operation, before: node.stepId })
    if (payload.kind === 'step') return api('move_step', { stepId: payload.stepId, to: node.index })
    return linkToNewParameter(payload, node.stepId)
  })
}

const ioNode = (node) => {
  const workflow = view.workflow
  const content = node.kind === 'inputs'
    ? workflow.inputs.map((name) => h('code', { class: 'chip' }, name))
    : Object.entries(workflow.outputs).map(([name, expression]) => h('code', { class: 'chip', title: expression }, name))
  const element = h('div', {
    class: 'node io', 'data-testid': `node-${node.kind}`,
    style: { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` },
  }, h('div', { class: 'title' }, node.kind === 'inputs' ? 'Inputs' : 'Outputs'), h('div', { class: 'row' }, content.length ? content : h('span', { class: 'label' }, node.kind === 'inputs' ? 'No input' : 'No output')))
  if (node.kind === 'outputs') {
    dropTarget(element, (payload) => payload.kind === 'output', async (payload) => {
      const values = await form(`Expose outputs.${payload.output} of ${payload.stepId} as a workflow output`, [{ name: 'name', label: 'Workflow output', value: payload.output }])
      if (values) await api('add_workflow_output', { name: values.name, stepId: payload.stepId, output: payload.output })
    })
  }
  return element
}

const renderDiagram = () => {
  const diagram = view.diagram
  $('empty').hidden = Boolean(diagram)
  const canvas = $('diagram')
  if (!diagram) return canvas.replaceChildren()
  canvas.style.width = `${diagram.width}px`
  canvas.style.height = `${diagram.height}px`
  canvas.replaceChildren(...renderEdges(diagram), ...diagram.nodes.map((node) => (node.kind === 'step' ? stepNode(node) : ioNode(node))))
}

/** A value of a step, edited in place: Enter or leaving the field gives it, an empty field stops sending it. */
const valueRow = (step, slot) => {
  const key = `${slot.in}-${slot.name}`
  const apply = async (input) => {
    const value = input.value.trim()
    if (value === (slot.value ?? '')) return
    if (value) await api('set_step_value', { stepId: step.stepId, name: slot.name, in: slot.in, value })
    else await api('clear_step_value', { stepId: step.stepId, name: slot.name, in: slot.in })
  }
  return h('li', { class: 'value-row', 'data-testid': `value-row-${key}` },
    h('label', { for: `value-${key}`, class: 'value-label' }, h('code', {}, `${slot.in} ${slot.name}`), slot.required ? h('span', { class: 'required', title: 'required' }, '*') : null),
    h('div', { class: 'value-field' },
      h('textarea', {
        id: `value-${key}`, rows: 1, value: slot.value ?? '', placeholder: 'a value, or $inputs.…', 'data-testid': `value-${key}`, spellcheck: 'false',
        onkeydown: (event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          apply(event.target)
        },
        onchange: (event) => apply(event.target),
      }),
      slot.value === null ? null : h('button', { type: 'button', class: 'link clear', title: `Stop sending ${slot.in} ${slot.name}`, 'aria-label': `Clear ${slot.in} ${slot.name}`, 'data-testid': `clear-${key}`,
        onclick: () => api('clear_step_value', { stepId: step.stepId, name: slot.name, in: slot.in }) }, '×')))
}

const renderDetails = () => {
  const step = stepOf(selected)
  const details = $('details')
  details.className = 'details'
  if (!step) {
    selected = null
    const workflow = view.workflows.find((each) => each.workflowId === view.workflowId)
    return details.replaceChildren(h('h2', {}, 'Workflow'), workflow
      ? h('dl', {}, h('dt', {}, 'id'), h('dd', {}, workflow.workflowId), h('dt', {}, 'summary'), h('dd', {}, workflow.summary || '—'), h('dt', {}, 'steps'), h('dd', {}, String(workflow.steps)))
      : h('p', { class: 'hint' }, 'The document has no workflow yet.'))
  }
  details.replaceChildren(
    h('h2', {}, `Step ${step.stepId}`),
    h('dl', {}, h('dt', {}, 'calls'), h('dd', {}, h('code', {}, step.operationId ?? '—'))),
    h('h3', {}, 'Sends', h('button', { type: 'button', class: 'link', 'data-testid': 'add-parameter', onclick: async () => {
      const values = await form(`Value sent by ${step.stepId}`, [
        { name: 'name', label: 'Parameter or body property' },
        { name: 'in', label: 'In', options: PLACES, value: 'query' },
        { name: 'value', label: 'Value: fixed, or an expression such as $inputs.status' },
      ])
      if (values) await api('set_step_value', { stepId: step.stepId, ...values })
    } }, '+ Parameter')),
    step.slots.length ? h('ul', { class: 'values', 'data-testid': 'values' }, step.slots.map((slot) => valueRow(step, slot))) : h('p', { class: 'hint' }, 'Its operation takes no parameter.'),
    h('dl', {},
      h('dt', {}, 'outputs'), h('dd', {}, Object.keys(step.outputs).length ? Object.entries(step.outputs).map(([name, expression]) => h('div', {}, h('code', {}, name), ' ← ', h('code', {}, expression))) : '—'),
      h('dt', {}, 'success'), h('dd', {}, step.successCriteria.length ? step.successCriteria.map((condition) => h('div', {}, h('code', {}, condition))) : '—')),
    h('div', { class: 'buttons' },
      h('button', { type: 'button', 'data-testid': 'add-output', onclick: async () => {
        const values = await form(`Output of ${step.stepId}`, [{ name: 'name', label: 'Name' }, { name: 'expression', label: 'Value', value: '$response.body#/', placeholder: '$response.body#/id' }])
        if (values) await api('set_step_output', { stepId: step.stepId, ...values })
      } }, '+ Output'),
      h('button', { type: 'button', 'data-testid': 'add-criterion', onclick: async () => {
        const values = await form(`Success of ${step.stepId}`, [{ name: 'condition', label: 'Condition', value: '$statusCode == 200' }])
        if (values) await api('add_success_criterion', { stepId: step.stepId, ...values })
      } }, '+ Success'),
      h('button', { type: 'button', 'data-testid': 'add-action', onclick: async () => {
        const values = await form(`Action of ${step.stepId}`, [
          { name: 'on', label: 'On', options: ['failure', 'success'] },
          { name: 'type', label: 'Then', options: ['retry', 'end', 'goto'] },
          { name: 'target', label: 'Go to step (goto)', options: view.workflow.steps.map((each) => each.stepId) },
          { name: 'retryLimit', label: 'Attempts (retry)', type: 'number', value: '3' },
          { name: 'retryAfter', label: 'Seconds between attempts (retry)', type: 'number', value: '1', required: false },
        ])
        if (!values) return
        const input = { stepId: step.stepId, on: values.on, type: values.type }
        if (values.type === 'goto') input.target = values.target
        if (values.type === 'retry') Object.assign(input, { retryLimit: Number(values.retryLimit), ...(values.retryAfter ? { retryAfter: Number(values.retryAfter) } : {}) })
        await api('add_action', input)
      } }, '+ Action'),
      h('button', { type: 'button', class: 'danger', 'data-testid': 'remove-step', onclick: async () => {
        if (await api('remove_step', { stepId: step.stepId })) selected = null
      } }, 'Remove')))
  if (focusSlot) {
    const field = $(`value-${focusSlot}`)
    focusSlot = null
    field?.focus()
  }
}

/** Shows the line of a problem in the YAML, opening the YAML beside the diagram when it is hidden. */
const goToLine = (line) => {
  if (viewMode() === 'diagram') setView('split')
  currentLine = line
  const box = $('yaml-text')
  const lines = box.value.split('\n')
  const start = lines.slice(0, line - 1).reduce((sum, each) => sum + each.length + 1, 0)
  box.focus({ preventScroll: true })
  box.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
  const height = parseFloat(getComputedStyle(box).lineHeight)
  box.scrollTop = Math.max(0, (line - 3) * height)
  renderGutter()
}

const renderProblems = () => {
  const problems = [...view.problems].sort((a, b) => (a.severity === b.severity ? a.line - b.line : a.severity === 'error' ? -1 : 1))
  $('problems').replaceChildren(...(problems.length
    ? problems.map((problem) => h('li', {
      class: `problem ${problem.severity}`, tabindex: 0, 'data-testid': 'problem', 'data-line': problem.line, title: `${problem.rule} · ${problem.pointer}`,
      onclick: () => {
        goToLine(problem.line)
        if (problem.stepId && stepOf(problem.stepId)) select(problem.stepId)
      },
      onkeydown: (event) => event.key === 'Enter' && event.currentTarget.click(),
    },
    h('span', { class: 'severity' }, problem.severity === 'error' ? '✕' : '⚠'),
    h('span', { class: 'message' }, problem.stepId ? h('strong', {}, `${problem.stepId}: `) : null, problem.message),
    h('span', { class: 'where' }, `line ${problem.line} · ${problem.rule}`)))
    : [h('li', { class: 'none' }, 'No problem: the document follows the spectral:arazzo rules.')]))
  $('others').replaceChildren(...view.otherWorkflows.map((other) => h('li', {},
    h('button', { type: 'button', class: 'link', 'data-testid': `other-workflow-${other.workflowId}`, onclick: () => api('select_workflow', { workflowId: other.workflowId }) },
      `workflow ${other.workflowId}: ${plural(other.problems, 'problem')}`))))
}

const renderGutter = () => {
  const count = $('yaml-text').value.split('\n').length
  const errorLine = view?.yaml.error?.line
  $('gutter').replaceChildren(...Array.from({ length: count }, (_, i) => h('div', {
    class: `${i + 1 === errorLine ? 'error' : ''}${i + 1 === currentLine ? ' current' : ''}`.trim() || null, 'data-line': i + 1,
  }, String(i + 1))))
  $('gutter').scrollTop = $('yaml-text').scrollTop
}

const renderYaml = () => {
  const box = $('yaml-text')
  if (typing === null && box.value !== view.yaml.text) {
    const [start, end] = [box.selectionStart, box.selectionEnd]
    box.value = view.yaml.text
    if (document.activeElement === box) box.setSelectionRange(start, end)
  }
  const error = $('yaml-error')
  error.hidden = !view.yaml.error
  error.textContent = view.yaml.error ? `Line ${view.yaml.error.line}: ${view.yaml.error.message}` : ''
  renderGutter()
}

const render = () => {
  if (!view) return
  renderBar()
  renderPalette()
  renderDiagram()
  renderDetails()
  renderProblems()
  renderYaml()
}

function select(stepId) {
  selected = stepId
  render()
  document.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/* ---------- wiring ---------- */

const flushYaml = async () => {
  if (typing === null) return
  clearTimeout(typing)
  typing = null
  await api('set_yaml', { text: $('yaml-text').value })
}

const save = async () => {
  await flushYaml()
  await api('save')
}

dropTarget($('board'), (payload) => payload.kind === 'operation' || payload.kind === 'step', (payload) =>
  (payload.kind === 'operation'
    ? api('add_step', { operation: payload.operation })
    : api('move_step', { stepId: payload.stepId, to: view.workflow.steps.length - 1 })))

$('workflows').addEventListener('change', (event) => api('select_workflow', { workflowId: event.target.value }))
$('add-workflow').addEventListener('click', async () => {
  const values = await form('New workflow', [{ name: 'workflowId', label: 'Workflow id' }, { name: 'summary', label: 'Summary', required: false }])
  if (values) await api('add_workflow', values.summary ? values : { workflowId: values.workflowId })
})
$('add-input').addEventListener('click', async () => {
  const values = await form('New input', [{ name: 'name', label: 'Name' }, { name: 'type', label: 'Type', options: ['string', 'integer', 'number', 'boolean', 'object', 'array'] }])
  if (values) await api('add_input', values)
})
$('add-source').addEventListener('click', async () => {
  const { candidates } = (await api('list_source_candidates')) ?? { candidates: [] }
  const pick = (url) => {
    $('dialog').querySelector('[name="url"]').value = url
    const name = $('dialog').querySelector('[name="name"]')
    if (!name.value) name.value = url.split('/').at(-1).split('.')[0].replace(/[^A-Za-z0-9_-]/g, '-')
  }
  const proposals = h('div', { class: 'candidates', 'data-testid': 'candidates' },
    h('p', { class: 'hint' }, candidates.length ? 'Descriptions of the workspace, relative to the document:' : 'No other OpenAPI or Arazzo file in the workspace.'),
    candidates.map((url) => h('button', { type: 'button', class: 'candidate', 'data-testid': `candidate-${url}`, onclick: () => pick(url) }, url)))
  const values = await form('Describe an API', [
    { name: 'name', label: 'Name' },
    { name: 'url', label: 'OpenAPI or Arazzo file (relative to the document) or URL', placeholder: 'apis/petstore.yaml' },
  ], proposals)
  if (values) await api('add_source', values)
})
$('ask').addEventListener('submit', async (event) => {
  event.preventDefault()
  const question = $('question').value
  if (await api('ask', selected ? { question, stepId: selected } : { question })) $('question').value = ''
})

$('autosave').addEventListener('change', async (event) => {
  await flushYaml()
  await api('set_autosave', { on: event.target.checked })
})
$('save').addEventListener('click', save)
$('undo').addEventListener('click', () => api('undo'))
$('redo').addEventListener('click', () => api('redo'))
$('keep-mine').addEventListener('click', () => api('resolve_conflict', { keep: 'mine' }))
$('reload-file').addEventListener('click', () => api('resolve_conflict', { keep: 'file' }))
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view))
setView('diagram')

$('yaml-text').addEventListener('input', () => {
  clearTimeout(typing)
  typing = setTimeout(flushYaml, TYPING_DELAY)
  renderGutter()
})
$('yaml-text').addEventListener('scroll', () => ($('gutter').scrollTop = $('yaml-text').scrollTop))
$('copy-yaml').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('yaml-text').value)
    toast('The YAML is in the clipboard.')
  } catch {
    $('yaml-text').select()
    toast('Select all and copy: the clipboard is not available here.')
  }
})

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 's') {
    event.preventDefault()
    save()
  }
  const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
  if (key === 'z' && !editing) {
    event.preventDefault()
    api(event.shiftKey ? 'redo' : 'undo')
  }
})

const events = new EventSource(`/events?token=${token}`)
events.onmessage = (message) => {
  const data = JSON.parse(message.data)
  if (data.error) {
    $('empty').hidden = false
    $('empty').textContent = data.error
    return
  }
  view = data.view
  render()
}
