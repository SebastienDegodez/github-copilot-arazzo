// The panel of the Arazzo canvas: renders the studio view pushed over SSE, and turns drags, drops and
// forms into the canvas actions posted to the loopback server.
const token = window.CANVAS_TOKEN
const $ = (id) => document.getElementById(id)
const DRAG_TYPE = 'application/x-arazzo'
const SVG = 'http://www.w3.org/2000/svg'

let view = null
let selected = null
let dragging = null

const h = (tag, attributes = {}, ...children) => {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value)
    else if (key === 'dataset') Object.assign(element.dataset, value)
    else if (key === 'style') Object.assign(element.style, value)
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
  toastTimer = setTimeout(() => (box.hidden = true), 5000)
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

/** A small form in a dialog; resolves with its values, or null when cancelled. */
const form = (title, fields) => new Promise((resolve) => {
  const dialog = $('dialog')
  $('dialog-title').textContent = title
  $('dialog-fields').replaceChildren(...fields.map((field) => h('label', {}, field.label,
    field.options
      ? h('select', { name: field.name, 'data-testid': `field-${field.name}` }, field.options.map((option) => h('option', { value: option, selected: option === field.value }, option)))
      : h('input', { name: field.name, value: field.value ?? '', required: field.required !== false, type: field.type ?? 'text', 'data-testid': `field-${field.name}`, placeholder: field.placeholder }))))
  dialog.returnValue = ''
  dialog.onclose = () => {
    if (dialog.returnValue !== 'ok') return resolve(null)
    resolve(Object.fromEntries(fields.map((field) => [field.name, dialog.querySelector(`[name="${field.name}"]`).value.trim()])))
  }
  dialog.showModal()
  dialog.querySelector('input, select')?.focus()
})

const stepOf = (stepId) => view?.workflow?.steps.find((step) => step.stepId === stepId)

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
    { name: 'in', label: 'In', options: ['query', 'path', 'header', 'cookie', 'body'], value: 'query' },
  ])
  if (values) await link(payload, { stepId, name: values.name, in: values.in })
}

/* ---------- rendering ---------- */

const renderBar = () => {
  $('path').textContent = view.path
  const count = view.problems.length
  $('status').textContent = count ? `${count} problem${count > 1 ? 's' : ''}` : 'valid'
  $('status').classList.toggle('has-problems', count > 0)
  $('workflows').replaceChildren(...view.workflows.map((workflow) =>
    h('option', { value: workflow.workflowId, selected: workflow.workflowId === view.workflowId }, `${workflow.workflowId} (${workflow.steps})`)))
}

const renderPalette = () => {
  $('inputs').replaceChildren(...(view.workflow?.inputs ?? []).map((name) =>
    draggable(h('span', { class: 'chip', title: `$inputs.${name}`, 'data-testid': `input-${name}` }, name), { kind: 'input', name })))
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

const stepNode = (node) => {
  const step = stepOf(node.stepId) ?? { slots: [], outputs: {}, operationId: '' }
  const element = h('div', {
    class: `node step${node.problems?.length ? ' has-problems' : ''}${selected === node.stepId ? ' selected' : ''}`,
    tabindex: 0, role: 'button', 'data-testid': `step-${node.stepId}`, 'data-step-id': node.stepId,
    style: { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` },
    onclick: () => select(node.stepId), onkeydown: (event) => event.key === 'Enter' && select(node.stepId),
  },
  h('div', { class: 'title' }, h('span', { class: 'number' }, String(node.index + 1)), h('span', {}, node.stepId),
    node.problems?.length ? h('span', { class: 'badge', title: node.problems.join('\n') }, `⚠ ${node.problems.length}`) : null),
  h('div', { class: 'endpoint mono' }, node.operation ? `${node.operation.method} ${node.operation.path}` : step.operationId),
  h('div', { class: 'row' }, h('span', { class: 'label' }, 'in'), step.slots.map((slot) => dropTarget(
    h('span', { class: `chip slot${slot.value ? ' bound' : ''}${slot.required ? ' required' : ''}`, title: slot.value ?? 'drop a value here', 'data-testid': `slot-${node.stepId}-${slot.in}-${slot.name}` }, `${slot.in} ${slot.name}`),
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
    h('dl', {},
      h('dt', {}, 'calls'), h('dd', {}, h('code', {}, step.operationId ?? '—')),
      h('dt', {}, 'sends'), h('dd', {}, step.slots.length ? step.slots.map((slot) => h('div', {}, h('code', {}, `${slot.in} ${slot.name}`), ' ← ', h('code', {}, slot.value ?? '—'))) : '—'),
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
}

const renderProblems = () => {
  const problems = view.problems
  $('problems').replaceChildren(...(problems.length
    ? problems.map((problem) => h('li', { onclick: () => problem.stepId && select(problem.stepId) }, problem.stepId ? `${problem.stepId}: ${problem.message}` : problem.message))
    : [h('li', { class: 'none' }, 'No problem: the document is valid Arazzo.')]))
}

const render = () => {
  if (!view) return
  renderBar()
  renderPalette()
  renderDiagram()
  renderDetails()
  renderProblems()
}

function select(stepId) {
  selected = stepId
  render()
}

/* ---------- wiring ---------- */

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
  const values = await form('Describe an API', [{ name: 'name', label: 'Name' }, { name: 'url', label: 'OpenAPI file (relative to the document) or URL' }])
  if (values) await api('add_source', values)
})
$('ask').addEventListener('submit', async (event) => {
  event.preventDefault()
  const question = $('question').value
  if (await api('ask', selected ? { question, stepId: selected } : { question })) $('question').value = ''
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
