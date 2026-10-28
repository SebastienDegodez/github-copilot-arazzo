// The workflow as a top-down flow chart, after the Microcks Arazzo workflow diagram: the inputs, each
// step in order, then the outputs, in one column linked by sequence edges. A value given to a step is
// a data edge curving on a side of the column — workflow inputs on the left, step outputs on the
// right — labelled with what it carries and where it goes. A retry loops on the right of its step,
// a goto curves on the right to the step it goes to, an end leaves the step in a short exit.
// Adapted from workflow-diagram.layout.ts of Microcks (Copyright The Microcks Authors, Apache-2.0).
import { referencesIn } from './expressions.mjs'
import { listOf } from './lists.mjs'

export const MARGIN = 24
export const NODE_WIDTH = 280
export const IO_HEIGHT = 64
export const STEP_HEIGHT = 120
export const GAP = 56
export const LANE = 32
export const LABEL_ROOM = 160
export const ACTION_ROOM = 120
const EXIT_ABOVE_BOTTOM = 12
const ENTRY_BELOW_TOP = 18
const ENTRY_STEP = 10
const LOOP = 26

/** The values each step gets, as flows from the inputs node or from an earlier step. */
const flowsOf = (steps) => {
  const indexOf = new Map(steps.map((step, index) => [step.stepId, index]))
  return steps.flatMap((step, index) => [
    ...listOf(step.parameters).map((parameter) => [`${parameter.in} ${parameter.name}`, parameter.value]),
    ...Object.entries(step.requestBody?.payload ?? {}).map(([name, value]) => [`body ${name}`, value]),
  ].flatMap(([place, value]) => {
    const { inputs, outputs } = referencesIn(value)
    return [
      ...inputs.map((name) => ({ side: 'left', from: 'inputs', to: index, lines: [`$inputs.${name}`, `→ ${place}`] })),
      ...outputs.filter(({ stepId }) => indexOf.get(stepId) < index)
        .map(({ stepId, output }) => ({ side: 'right', from: indexOf.get(stepId), to: index, lines: [`outputs.${output}`, `→ ${place}`] })),
    ]
  }))
}

const actionsOf = (step) => [
  ...listOf(step.onSuccess).map((action) => ({ ...action, on: 'success' })),
  ...listOf(step.onFailure).map((action) => ({ ...action, on: 'failure' })),
]

const gotosOf = (steps) => {
  const indexOf = new Map(steps.map((step, index) => [step.stepId, index]))
  return steps.flatMap((step, from) => actionsOf(step)
    .filter((action) => action.type === 'goto' && indexOf.has(action.stepId))
    .map((action) => ({ from, to: indexOf.get(action.stepId), on: action.on })))
}

const hasActions = (steps) => steps.some((step) => actionsOf(step).some((action) => action.type === 'end' || action.type === 'retry'))

const curve = (x, startY, laneX, endY) => `M ${x} ${startY} C ${laneX} ${startY} ${laneX} ${endY} ${x} ${endY}`

/**
 * @param {object} workflow an Arazzo workflow
 * @param {(step: object) => object} describe what a step node carries besides its step id and
 *   position, such as its operation and its problems
 */
export const layoutWorkflow = (workflow, describe) => {
  const steps = listOf(workflow.steps)
  const flows = flowsOf(steps)
  const gotos = gotosOf(steps)
  const left = flows.filter((flow) => flow.side === 'left')
  const right = [...flows.filter((flow) => flow.side === 'right'), ...gotos]
  const actionRoom = hasActions(steps) ? ACTION_ROOM : 0
  const leftRoom = left.length ? left.length * LANE + LABEL_ROOM : 0
  const rightRoom = actionRoom + (right.length ? right.length * LANE + LABEL_ROOM : 0)
  const x = MARGIN + leftRoom
  const nodeRight = x + NODE_WIDTH

  const stepY = (index) => MARGIN + IO_HEIGHT + GAP + index * (STEP_HEIGHT + GAP)
  const nodes = [
    { id: 'inputs', kind: 'inputs', x, y: MARGIN, width: NODE_WIDTH, height: IO_HEIGHT },
    ...steps.map((step, index) => ({
      id: `step:${index}`, kind: 'step', stepId: step.stepId, index, x, y: stepY(index), width: NODE_WIDTH, height: STEP_HEIGHT, ...describe(step),
    })),
    { id: 'outputs', kind: 'outputs', x, y: stepY(steps.length), width: NODE_WIDTH, height: IO_HEIGHT },
  ]
  const nodeOf = (from) => (from === 'inputs' ? nodes[0] : nodes[from + 1])

  const sequence = nodes.slice(1).map((node, i) => ({
    kind: 'sequence', from: nodes[i].id, to: node.id,
    path: `M ${x + NODE_WIDTH / 2} ${nodes[i].y + nodes[i].height} L ${x + NODE_WIDTH / 2} ${node.y}`,
  }))

  const entries = new Map()
  const sideEdge = (kind, flow, lane, lines) => {
    const source = nodeOf(flow.from)
    const target = nodeOf(flow.to)
    const isLeft = flow.side === 'left'
    const edgeX = isLeft ? x : nodeRight
    const laneX = isLeft ? x - (lane + 1) * LANE : nodeRight + actionRoom + (lane + 1) * LANE
    const entryKey = `${isLeft}:${target.id}`
    const entry = entries.get(entryKey) ?? 0
    entries.set(entryKey, entry + 1)
    const startY = source.y + source.height - EXIT_ABOVE_BOTTOM
    const endY = target.y + ENTRY_BELOW_TOP + entry * ENTRY_STEP
    return {
      kind, from: source.id, to: target.id, side: flow.side, path: curve(edgeX, startY, laneX, endY),
      label: { lines, x: laneX, y: (startY + endY) / 2, align: isLeft ? 'end' : 'start' },
    }
  }
  const data = [
    ...left.map((flow, lane) => sideEdge('data', flow, lane, flow.lines)),
    ...right.map((flow, lane) => (flow.lines
      ? sideEdge('data', flow, lane, flow.lines)
      : sideEdge('goto', { ...flow, side: 'right' }, lane, [`goto on ${flow.on}`]))),
  ]

  const actions = steps.flatMap((step, index) => {
    const node = nodes[index + 1]
    const bottom = node.y + node.height
    const ends = actionsOf(step).filter((action) => action.type === 'end')
      .map(({ on }, k) => ({
        kind: 'end', from: node.id, to: `end:${index}:${k}`, path: `M ${nodeRight} ${bottom - 20 - k * 20} L ${nodeRight + 24} ${bottom - 20 - k * 20}`,
        label: { lines: [`end on ${on}`], x: nodeRight + 30, y: bottom - 20 - k * 20, align: 'start' },
      }))
    const retry = listOf(step.onFailure).find((action) => action.type === 'retry')
    if (!retry) return ends
    // below the values coming in at the top of the step, above its ends
    const startY = bottom - 20 - ends.length * 20
    const control = nodeRight + 32
    return [...ends, {
      kind: 'retry', from: node.id, to: node.id,
      path: `M ${nodeRight} ${startY} C ${control} ${startY} ${control} ${startY - LOOP} ${nodeRight} ${startY - LOOP}`,
      label: { lines: [`retry ×${retry.retryLimit}${retry.retryAfter ? ` · ${retry.retryAfter} s` : ''}`], x: control + 4, y: startY - LOOP / 2, align: 'start' },
    }]
  })

  return {
    width: x + NODE_WIDTH + rightRoom + MARGIN,
    height: nodes.at(-1).y + IO_HEIGHT + MARGIN,
    nodes,
    edges: [...sequence, ...data, ...actions],
  }
}
