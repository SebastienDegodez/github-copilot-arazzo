// The video: a pure function of the time `t`, in seconds. The canvas shown is the real one: its
// states come from the studio of the plugin (scenario.mjs) and it is styled by the plugin's own
// stylesheet, scoped under `.az`. Play it at video/index.html, export it with `npm run video:export`.
import { EDITS, PATH, playScenario } from './scenario.mjs'
import { CHAPTERS, DURATION, LANDS, TYPING } from './timeline.mjs'

const { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } = React
const { flushSync } = ReactDOM

/* ---------- time ---------- */

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const progress = (t, start, end) => clamp((t - start) / (end - start))
const outExpo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x))
const inOutCubic = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const mix = (a, b, x) => a + (b - a) * x
/** Fades in over `fade` seconds after `start` and out before `end`. */
const window_ = (t, start, end, fade = 0.4) => Math.min(outExpo(progress(t, start, start + fade)), 1 - progress(t, end - fade * 0.75, end))

const ORDER = EDITS.map((edit) => edit.id)

const stateAt = (t) => {
  let index = -1
  ORDER.forEach((id, i) => { if (t >= LANDS[id]) index = i })
  return { id: ORDER[index] ?? null, previous: ORDER[index - 1] ?? null, since: index >= 0 ? t - LANDS[ORDER[index]] : 0 }
}

const PROMPT = TYPING.prompt.text
const QUESTION = TYPING.question.text
const typed = (text, t, start, end) => text.slice(0, Math.round(text.length * progress(t, start, end)))

/* ---------- camera ---------- */

const SHOTS = {
  full: { x: 1000, y: 460, s: 0.8 },
  drag: { x: 1290, y: 505, s: 1.25 },
  result: { x: 1520, y: 540, s: 1.0 },
}
const CAMERA = [
  [0, 'full'], [11.4, 'full'], [12.6, 'drag'], [28.8, 'drag'], [30.0, 'full'], [40.4, 'full'], [41.8, 'result'],
]
const cameraAt = (t) => {
  for (let i = CAMERA.length - 1; i >= 0; i--) {
    const [start, shot] = CAMERA[i]
    if (t >= start) {
      const next = CAMERA[i + 1]
      if (!next || SHOTS[next[1]] === SHOTS[shot]) return SHOTS[shot]
      const x = inOutCubic(progress(t, start, next[0]))
      const a = SHOTS[shot]
      const b = SHOTS[next[1]]
      return { x: mix(a.x, b.x, x), y: mix(a.y, b.y, x), s: mix(a.s, b.s, x) }
    }
  }
  return SHOTS.full
}

/* ---------- the real stylesheet, scoped ---------- */

const scope = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((block) => {
  const at = block.indexOf('{')
  if (at < 0) return block
  const selectors = block.slice(0, at).split(',').map((selector) => {
    const s = selector.trim()
    if (s === ':root') return '.az'
    if (s === 'body') return '.az.az-body'
    return `.az ${s}`
  })
  return `${selectors.join(', ')} ${block.slice(at)}`
}).join('}')

/* ---------- pointer script ---------- */

const testid = (id) => `[data-testid="${id}"]`
/** Where the pointer goes: [time, target, { press, drag }]. A target is a selector inside the app, or a point. */
const POINTER = [
  [4.6, { x: 1180, y: 900 }],
  [5.3, { sel: '.composer-box', fx: 0.3, fy: 0.4 }, { press: true }],
  [8.0, { sel: '.composer-box', fx: 0.3, fy: 0.4 }],
  [8.35, { sel: '.composer-foot .send' }, { press: true }],
  [12.6, { sel: '.composer-foot .send' }],
  [13.3, { sel: testid('operation-findPets'), fx: 0.35 }, { press: true }],
  [14.5, { sel: testid('board'), fx: 0.5, fy: 0.24 }, { drag: 'findPets' }],
  [15.6, { sel: testid('operation-getPet'), fx: 0.35 }, { press: true }],
  [16.9, { sel: testid('board'), fx: 0.5, fy: 0.42 }, { drag: 'getPet' }],
  [17.9, { sel: testid('operation-placeOrder'), fx: 0.35 }, { press: true }],
  [19.1, { sel: testid('board'), fx: 0.5, fy: 0.62 }, { drag: 'placeOrder' }],
  [20.3, { sel: testid('input-status') }, { press: true }],
  [21.7, { sel: testid('slot-findPets-query-status') }, { drag: 'status' }],
  [22.9, { sel: testid('slot-getPet-path-petId') }],
  [23.6, { sel: testid('step-getPet'), fx: 0.75, fy: 0.22 }, { press: true }],
  [24.6, { sel: testid('question'), fx: 0.3, fy: 0.4 }, { press: true }],
  [28.1, { sel: testid('question'), fx: 0.3, fy: 0.4 }],
  [28.5, { sel: testid('ask') }, { press: true }],
  [29.6, { sel: testid('ask') }],
  [30.6, { x: 1700, y: 1000 }],
]
const DRAGS = {
  findPets: { kind: 'operation', id: 'findPets', drop: 'board' },
  getPet: { kind: 'operation', id: 'getPet', drop: 'board' },
  placeOrder: { kind: 'operation', id: 'placeOrder', drop: 'board' },
  status: { kind: 'input', id: 'status', drop: 'slot-findPets-query-status' },
}

const pointerAt = (t) => {
  let i = POINTER.findIndex(([at]) => at > t)
  if (i === -1) i = POINTER.length
  const [fromAt, from] = POINTER[Math.max(0, i - 1)]
  const next = POINTER[i]
  const press = POINTER.filter(([at, , options]) => options?.press && t >= at - 0.06 && t < at + 0.5).at(-1)
  if (!next) return { from, to: from, x: 1, press, drag: null, at: fromAt }
  const [toAt, to, options] = next
  const travel = Math.min(0.75, toAt - fromAt)
  const x = inOutCubic(progress(t, toAt - travel, toAt))
  return { from, to, x, press, drag: options?.drag ? { ...DRAGS[options.drag], x } : null, at: toAt }
}

/* ---------- YAML ---------- */

const lcsAdded = (before, after) => {
  const a = before.split('\n')
  const b = after.split('\n')
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const added = new Set()
  let i = 0
  let j = 0
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) { i++; j++ } else if (i < a.length && table[i + 1][j] >= table[i][j + 1]) i++
    else added.add(j++)
  }
  return added
}

const YamlLine = ({ text }) => {
  const match = /^(\s*(?:- )?)([\w$.-]+)(:)(.*)$/.exec(text)
  if (!match) return <span>{text}</span>
  const [, lead, key, colon, rest] = match
  const value = rest.trim()
  const kind = value.startsWith('$') ? 'x' : /^\d/.test(value) ? 'n' : 'v'
  return <span>{lead}<span className="k">{key}</span>{colon}{rest && <span className={kind}>{rest}</span>}</span>
}

/* ---------- canvas (the plugin panel) ---------- */

const nodeKey = (node) => (node.kind === 'step' ? `step:${node.stepId}` : node.kind)
const edgeKey = (edge) => `${edge.kind}|${edge.from}|${edge.to}|${edge.label?.lines.join('/') ?? ''}`
const NODE_WIDTH = 280

const Diagram = ({ view, before, since, selected, dropOn, pulse }) => {
  const diagram = view.diagram
  const settle = outExpo(progress(since, 0, 0.45))
  const previous = new Map((before?.diagram?.nodes ?? []).map((node) => [nodeKey(node), node]))
  const oldEdges = new Set((before?.diagram?.edges ?? []).map(edgeKey))
  const width = mix(before?.diagram?.width ?? diagram.width, diagram.width, settle)
  const height = mix(before?.diagram?.height ?? diagram.height, diagram.height, settle)
  const nodes = diagram.nodes.map((node) => {
    const old = previous.get(nodeKey(node))
    return { ...node, isNew: !old, x: mix(old?.x ?? node.x, node.x, settle), y: mix(old?.y ?? node.y, node.y, settle) }
  })
  const stepOf = (stepId) => view.workflow.steps.find((step) => step.stepId === stepId)
  const sequence = nodes.slice(1).map((node, i) => {
    const above = nodes[i]
    const x = above.x + NODE_WIDTH / 2
    return `M ${x} ${above.y + above.height} L ${node.x + NODE_WIDTH / 2} ${node.y}`
  })
  const others = diagram.edges.filter((edge) => edge.kind !== 'sequence')
  const reveal = (edge) => (oldEdges.has(edgeKey(edge)) ? 1 : inOutCubic(progress(since, 0.3, 1.0)))

  return (
    <div id="diagram" className="diagram" style={{ width: `${width}px`, height: `${height}px` }}>
      <svg width={diagram.width} height={diagram.height} viewBox={`0 0 ${diagram.width} ${diagram.height}`} aria-hidden="true">
        <defs>
          {['sequence', 'data', 'goto', 'retry', 'end'].map((kind) => (
            <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" style={{ color: '#b8d0c1' }}>
              <path d="M 0 0 L 10 5 L 0 10 z" className={`edge-${kind}`} style={{ fill: 'currentColor', stroke: 'none' }} />
            </marker>
          ))}
          {others.map((edge, i) => (
            <mask key={i} id={`reveal-${i}`} maskUnits="userSpaceOnUse" x="-50" y="-50" width={diagram.width + 100} height={diagram.height + 100}>
              <path d={edge.path} fill="none" stroke="#fff" strokeWidth="14" pathLength="1" strokeDasharray="1 1" strokeDashoffset={1 - reveal(edge)} />
            </mask>
          ))}
        </defs>
        {sequence.map((d, i) => <path key={`s${i}`} d={d} className="edge edge-sequence" markerEnd="url(#arrow-sequence)" />)}
        {others.map((edge, i) => reveal(edge) > 0 && <path key={i} d={edge.path} className={`edge edge-${edge.kind}`} markerEnd={`url(#arrow-${edge.kind})`} mask={reveal(edge) < 1 ? `url(#reveal-${i})` : undefined} />)}
      </svg>
      {others.filter((edge) => edge.label).map((edge, i) => (
        <div key={i} className={`edge-label ${edge.label.align}`} style={{ left: `${edge.label.x + (edge.label.align === 'end' ? -4 : 4)}px`, top: `${edge.label.y}px`, opacity: reveal(edge) }}>
          {edge.label.lines.map((line) => <div key={line}>{line}</div>)}
        </div>
      ))}
      {nodes.map((node) => {
        const enter = node.isNew && before ? outExpo(progress(since, 0, 0.4)) : 1
        const style = { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px`, opacity: enter, transform: `scale(${mix(0.9, 1, enter)})` }
        if (node.kind !== 'step') {
          const content = node.kind === 'inputs' ? view.workflow.inputs.map((name) => [name, `$inputs.${name}`]) : Object.entries(view.workflow.outputs)
          return (
            <div key={nodeKey(node)} className="node io" data-testid={`node-${node.kind}`} style={style}>
              <div className="title">{node.kind === 'inputs' ? 'Inputs' : 'Outputs'}</div>
              <div className="row">{content.length ? content.map(([name, title]) => <code key={name} className="chip" title={title}>{name}</code>) : <span className="label">{node.kind === 'inputs' ? 'No input' : 'No output'}</span>}</div>
            </div>
          )
        }
        const step = stepOf(node.stepId)
        const classes = ['node', 'step', node.problems?.length && 'has-problems', selected === node.stepId && 'selected', dropOn === `step-${node.stepId}` && 'drop-ok', pulse.includes(node.stepId) && 'pulse'].filter(Boolean)
        return (
          <div key={nodeKey(node)} className={classes.join(' ')} data-testid={`step-${node.stepId}`} style={style}>
            <div className="title"><span className="number">{node.index + 1}</span><span>{node.stepId}</span>
              {node.problems?.length ? <span className="badge">⚠ {node.problems.length}</span> : null}</div>
            <div className="endpoint mono">{node.operation ? `${node.operation.method} ${node.operation.path}` : step.operationId}</div>
            <div className="row"><span className="label">in</span>{step.slots.map((slot) => {
              const id = `slot-${node.stepId}-${slot.in}-${slot.name}`
              return <span key={id} className={['chip', 'slot', slot.value && 'bound', slot.required && 'required', dropOn === id && 'drop-ok'].filter(Boolean).join(' ')} data-testid={id}>{`${slot.in} ${slot.name}`}</span>
            })}</div>
            <div className="row"><span className="label">out</span>{Object.keys(step.outputs).map((output) => <span key={output} className="chip" data-testid={`output-${node.stepId}-${output}`}>{output}</span>)}</div>
          </div>
        )
      })}
    </div>
  )
}

const Details = ({ view, selected }) => {
  const step = view.workflow.steps.find((each) => each.stepId === selected)
  if (!step) {
    const workflow = view.workflows.find((each) => each.workflowId === view.workflowId)
    return (
      <section className="details" data-testid="details">
        <h2>Workflow</h2>
        <dl><dt>id</dt><dd>{workflow.workflowId}</dd><dt>summary</dt><dd>{workflow.summary || '—'}</dd><dt>steps</dt><dd>{workflow.steps}</dd></dl>
      </section>
    )
  }
  const list = (entries) => (entries.length ? entries.map(([name, value]) => <div key={name}><code>{name}</code> ← <code>{value ?? '—'}</code></div>) : '—')
  return (
    <section className="details" data-testid="details">
      <h2>Step {step.stepId}</h2>
      <dl>
        <dt>calls</dt><dd><code>{step.operationId}</code></dd>
        <dt>sends</dt><dd>{list(step.slots.map((slot) => [`${slot.in} ${slot.name}`, slot.value]))}</dd>
        <dt>outputs</dt><dd>{list(Object.entries(step.outputs))}</dd>
        <dt>success</dt><dd>{step.successCriteria.length ? step.successCriteria.map((c) => <div key={c}><code>{c}</code></div>) : '—'}</dd>
      </dl>
      <div className="buttons"><button type="button">+ Output</button><button type="button">+ Success</button><button type="button">+ Action</button><button type="button" className="danger">Remove</button></div>
    </section>
  )
}

const Canvas = ({ t, data }) => {
  const { previous, since, ...landed } = stateAt(t)
  const id = landed.id ?? ORDER[0]
  const view = data.states[id].view
  const before = previous ? data.states[previous].view : null
  const selected = t >= 23.75 ? 'getPet' : null
  const pointer = pointerAt(t)
  const dropOn = pointer.drag && pointer.drag.x > 0.55 ? pointer.drag.drop : null
  const changed = before ? view.workflow.steps.filter((step) => {
    const old = before.workflow.steps.find((each) => each.stepId === step.stepId)
    return old && JSON.stringify(old) !== JSON.stringify(step)
  }).map((step) => step.stepId) : []
  const pulse = since < 1.1 && t > 30 ? changed : []
  const question = t < 28.6 ? typed(QUESTION, t, TYPING.question.from, TYPING.question.to) : ''
  const count = view.problems.length
  const bySource = Map.groupBy(view.operations, (operation) => operation.source)

  return (
    <div className="az az-body">
      <header className="bar">
        <strong className="brand">Arazzo</strong>
        <code id="path">{view.path}</code>
        <select aria-label="Workflow" value={view.workflowId} onChange={() => {}}>
          {view.workflows.map((workflow) => <option key={workflow.workflowId} value={workflow.workflowId}>{`${workflow.workflowId} (${workflow.steps})`}</option>)}
        </select>
        <button type="button">+ Workflow</button>
        <span className={`status${count ? ' has-problems' : ''}`} data-testid="status">{count ? `${count} problem${count > 1 ? 's' : ''}` : 'valid'}</span>
      </header>
      <main className="layout">
        <aside className="palette" aria-label="Palette">
          <section>
            <h2>Inputs <button type="button" className="link">+</button></h2>
            <div className="chips">{view.workflow.inputs.map((name) => (
              <span key={name} className="chip" data-testid={`input-${name}`} style={{ opacity: id === 'input' ? outExpo(progress(since, 0, 0.4)) : 1 }}>{name}</span>
            ))}</div>
          </section>
          <section>
            <h2>Operations <button type="button" className="link">+ API</button></h2>
            <p className="hint">Drag an operation onto the workflow, or onto a step to insert it before.</p>
            <div id="operations">{[...bySource].map(([source, operations]) => (
              <Fragment key={source}>
                <div className="source">{source}</div>
                {operations.map((operation) => (
                  <div key={operation.operationId} className="operation" data-testid={`operation-${operation.operationId}`}>
                    <span className="id">{operation.operationId}</span>
                    <span className="method mono">{operation.method}</span><code>{operation.path}</code>
                  </div>
                ))}
              </Fragment>
            ))}</div>
          </section>
        </aside>
        <section id="board" className={`board${dropOn === 'board' ? ' drop-ok' : ''}`} data-testid="board" aria-label="Workflow diagram">
          <Diagram view={view} before={before} since={since} selected={selected} dropOn={dropOn} pulse={pulse} />
        </section>
        <aside className="inspector" aria-label="Inspector">
          <Details view={view} selected={selected} />
          <section>
            <h2>Problems</h2>
            <ul className="problems" data-testid="problems">
              {count ? view.problems.map((problem) => <li key={problem.message}>{problem.stepId ? `${problem.stepId}: ${problem.message}` : problem.message}</li>)
                : <li className="none">No problem: the document is valid Arazzo.</li>}
            </ul>
          </section>
          <section>
            <h2>Ask Copilot</h2>
            <form className="ask" onSubmit={(event) => event.preventDefault()}>
              <textarea rows="3" readOnly className={t >= 24.6 && t < 28.6 ? 'focus' : ''} placeholder="Ask about the workflow or the selected step…" data-testid="question" value={question} />
              <button type="submit" data-testid="ask">Ask Copilot</button>
            </form>
          </section>
        </aside>
      </main>
    </div>
  )
}

/* ---------- the Copilot app around it ---------- */

const appear = (t, at) => outExpo(progress(t, at, at + 0.4))

const Message = ({ t, at, children }) => {
  const x = appear(t, at)
  if (x <= 0) return null
  return <div className="msg" style={{ maxHeight: `${mix(0, 420, x)}px`, opacity: x }}><div className="msg-pad">{children}</div></div>
}

const Tool = ({ t, at, done, action, arg }) => (
  <Message t={t} at={at}>
    <div className="tool"><span className={`state${t >= done ? ' done' : ''}`} style={t < done ? { transform: `rotate(${(t * 540) % 360}deg)` } : undefined} />
      <span>arazzo</span><code>{action}</code><span className="arg">{arg}</span></div>
  </Message>
)

const stream = (text, t, at, cps = 70) => text.slice(0, Math.max(0, Math.round((t - at) * cps)))

const COPILOT_CALLS = [
  { at: 30.2, done: 30.8, action: 'get_workflow', arg: 'adopt-pet' },
  ...['petIdOut', 'petIdIn', 'retry', 'orderIdOut', 'orderId'].map((id) => {
    const edit = EDITS.find((each) => each.id === id)
    return { at: LANDS[id] - 0.5, done: LANDS[id], action: edit.action, arg: edit.label }
  }),
]
const FIRST_REPLY = 'The canvas is open on adopt-pet, with the Petstore operations and a status input. Drag them onto the workflow.'
const LAST_REPLY = 'Done: getPet now gets the pet id found by findPets, placeOrder retries 3 times, 2 s apart, and the workflow returns orderId. No problem left.'

const Chat = ({ t, data, width }) => {
  const promptLines = data.prompt.split('\n')
  const composing = t < 8.4 ? typed(PROMPT, t, TYPING.prompt.from, TYPING.prompt.to) : ''
  const focused = t >= 5.3 && t < 8.4
  return (
    <div className="chat" style={{ width: `${width}px` }}>
      <div className="chat-head"><strong>Adoption workflow</strong><span className="repo">github-copilot-arazzo</span></div>
      <div className="messages"><div className="messages-inner">
        <Message t={t} at={8.4}><div className="bubble-user">{PROMPT}</div></Message>
        <Message t={t} at={8.7}><div className="who"><i />Copilot</div></Message>
        <Tool t={t} at={8.8} done={LANDS.open} action="open_canvas" arg={PATH} />
        <Tool t={t} at={10.1} done={LANDS.input} action="add_input" arg="status" />
        <Message t={t} at={10.9}><div className="assistant">{stream(FIRST_REPLY, t, 10.9)}</div></Message>
        <Message t={t} at={28.7}>
          <div className="bubble-user">
            <div className="from-canvas">From the <b>Arazzo</b> canvas · step <code>getPet</code></div>
            {promptLines[0]}<br />{promptLines[1]}
            <div className="more">+ the step, its problems and the canvas actions to use</div>
          </div>
        </Message>
        <Message t={t} at={29.0}><div className="who"><i />Copilot</div></Message>
        {t >= 29.1 && t < 30.2 && <div className="thinking" style={{ opacity: 0.55 + 0.45 * Math.sin(t * 7) }}>Thinking…</div>}
        {COPILOT_CALLS.map((call) => <Tool key={call.at} t={t} {...call} />)}
        <Message t={t} at={38.6}><div className="assistant">{stream(LAST_REPLY, t, 38.6)}</div></Message>
      </div></div>
      <div className="composer">
        <div className={`composer-box${focused ? ' focus' : ''}`}>
          <div className="composer-text">{composing || (focused ? '' : <span className="ph">Ask Copilot, or type / for commands</span>)}{focused && <span className="caret" style={{ opacity: Math.floor(t * 2.5) % 2 ? 0.2 : 1 }} />}</div>
          <div className="composer-foot"><span className="pill">Agent</span><span className="pill">github-copilot-arazzo</span>
            <span className={`send${composing ? ' ready' : ''}`}>↑</span></div>
        </div>
      </div>
    </div>
  )
}

const Sidebar = ({ width }) => (
  <div className="sidebar" style={{ width: `${width}px` }}>
    <div className="sidebar-inner">
      <div className="new">+ New session</div>
      <h3>Sessions</h3>
      <div className="item active">Adoption workflow<small>github-copilot-arazzo</small></div>
      <div className="item">Order saga contracts<small>petstore-api</small></div>
      <div className="item">Review OpenAPI changes<small>petstore-api</small></div>
    </div>
  </div>
)

const App = ({ t, data }) => {
  const open = inOutCubic(progress(t, LANDS.open - 0.1, LANDS.open + 0.8))
  const sidebar = mix(260, 0, open)
  const panel = mix(0, 1440, open)
  return (
    <div className="window">
      <div className="titlebar"><span className="lights"><i /><i /><i /></span><span className="title">GitHub Copilot</span></div>
      <div className="app-body">
        <Sidebar width={sidebar} />
        <Chat t={t} data={data} width={2000 - sidebar - panel} />
        {t >= LANDS.open - 0.1 && (
          <div className="panel" style={{ width: `${panel}px` }}>
            <div className="panel-head"><span className="tab"><i />Arazzo</span><span>adopt.arazzo.yaml</span><span className="close">×</span></div>
            <div className="panel-body" style={{ width: '1440px' }}><Canvas t={t} data={data} /></div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- overlays ---------- */

const POINTER_PATH = 'M 3 2 L 3 22 L 8.5 17 L 12 25 L 15.5 23.5 L 12 16 L 19.5 16 Z'

const Pointer = ({ t, camera }) => {
  const pointerRef = useRef(null)
  const rippleRef = useRef(null)
  const ghostRef = useRef(null)
  const state = pointerAt(t)
  const visible = window_(t, 4.6, 31.0, 0.3)
  useLayoutEffect(() => {
    const app = pointerRef.current?.parentElement
    if (!app) return
    const base = app.getBoundingClientRect()
    const resolve = (target) => {
      if (!target.sel) return target
      const element = app.querySelector(target.sel)
      if (!element) return { x: 1000, y: 560 }
      const rect = element.getBoundingClientRect()
      return {
        x: (rect.left - base.left + rect.width * (target.fx ?? 0.5)) / camera.s,
        y: (rect.top - base.top + rect.height * (target.fy ?? 0.5)) / camera.s,
      }
    }
    const a = resolve(state.from)
    const b = resolve(state.to)
    const x = mix(a.x, b.x, state.x)
    const y = mix(a.y, b.y, state.y ?? state.x)
    const pressed = state.press && t >= state.press[0] - 0.06 && t < state.press[0] + 0.12
    pointerRef.current.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(${pressed ? 0.85 : 1})`
    const ripple = state.press ? progress(t, state.press[0], state.press[0] + 0.5) : 1
    rippleRef.current.style.transform = `translate(${mix(a.x, b.x, state.x)}px, ${y}px) scale(${mix(0.3, 1.2, outExpo(ripple))})`
    rippleRef.current.style.opacity = ripple < 1 ? 0.7 * (1 - ripple) : 0
    if (ghostRef.current) ghostRef.current.style.transform = `translate(${x - 40}px, ${y - 18}px) rotate(-2deg)`
  })
  const drag = state.drag && state.drag.x > 0.04 && state.drag.x < 1 ? state.drag : null
  return (
    <Fragment>
      <div ref={rippleRef} className="ripple" />
      {drag && (
        <div ref={ghostRef} className="ghost az">
          {drag.kind === 'operation'
            ? <div className="operation"><span className="id">{drag.id}</span><span className="method mono">{drag.id === 'placeOrder' ? 'POST' : 'GET'}</span><code>{drag.id === 'findPets' ? '/pets' : drag.id === 'getPet' ? '/pets/{petId}' : '/orders'}</code></div>
            : <span className="chip">{drag.id}</span>}
        </div>
      )}
      <div ref={pointerRef} className="pointer" style={{ opacity: visible }}>
        <svg width="28" height="28" viewBox="0 0 28 28"><path d={POINTER_PATH} fill="#000" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      </div>
    </Fragment>
  )
}

const CAPTIONS = [
  [4.8, 11.2, 'The Arazzo canvas, inside the GitHub Copilot app.', 'Ask for it in the chat: Copilot opens it on your workflow file.'],
  [12.6, 19.5, 'Drag operations straight from your OpenAPI.', 'Each drop adds a step. The operations come from your API descriptions.'],
  [19.8, 23.6, 'Wire values from input to step.', 'Drop an input or an output onto a parameter.'],
  [23.9, 29.0, 'Or ask Copilot to write the rest.', 'The question goes to the chat with the step and its problems.'],
  [30.2, 40.2, 'Copilot edits the same canvas, live.', 'Through the canvas actions: you watch every change land.'],
  [42.0, 47.3, 'Valid Arazzo 1.0.1, saved as you go.', 'Every change is written to workflows/adopt.arazzo.yaml.'],
]

const Caption = ({ t, top }) => {
  const current = CAPTIONS.find(([start, end]) => t >= start && t < end)
  if (!current) return null
  const [start, end, title, line] = current
  const x = window_(t, start, end, 0.5)
  return (
    <div className={`caption${top ? ' top' : ''}`} style={{ opacity: x, transform: `translateY(${mix(16, 0, x)}px)` }}>
      <h2>{title}</h2><p>{line}</p>
    </div>
  )
}

const FILE_SHOWS = [[14.4, 23.4, 'drag'], [41.0, 47.4, 'result']]
const LINE = 23

const FileCard = ({ t, data }) => {
  const show = FILE_SHOWS.find(([start, end]) => t >= start && t < end)
  if (!show) return null
  const [start, end, mode] = show
  const x = window_(t, start, end, 0.5)
  const { id, previous, since } = stateAt(t)
  const yaml = data.states[id].yaml.trimEnd()
  const lines = yaml.split('\n')
  const added = previous ? lcsAdded(data.states[previous].yaml.trimEnd(), yaml) : new Set()
  const rows = mode === 'drag' ? 15 : 36
  const scrollFor = (stateId) => {
    if (!stateId) return 0
    const all = data.states[stateId].yaml.trimEnd().split('\n')
    return Math.max(0, all.length - rows + 1)
  }
  const scroll = mode === 'result'
    ? mix(0, Math.max(0, lines.length - rows), inOutCubic(progress(t, start + 1.2, end - 1.0)))
    : mix(scrollFor(previous), scrollFor(id), inOutCubic(progress(since, 0, 0.5)))
  const highlight = mode === 'drag' ? 1 - progress(since, 1.6, 2.6) : 0
  return (
    <div className="file" style={{ top: mode === 'drag' ? '520px' : '90px', opacity: x, transform: `translateX(${mix(40, 0, x)}px)` }}>
      <div className="file-head"><span>{PATH}</span><span className="saved"><i style={{ transform: `scale(${1 + 0.6 * (1 - progress(since, 0, 0.6))})` }} />saved</span></div>
      <div className="file-body" style={{ height: `${rows * LINE + 16}px` }}>
        <div className="file-lines" style={{ transform: `translateY(${8 - scroll * LINE}px)` }}>
          {lines.map((line, i) => (
            <div key={i} className="file-line" style={added.has(i) && highlight > 0 ? { background: `rgba(46, 160, 67, ${0.28 * highlight})` } : undefined}>
              <span className="no">{i + 1}</span><YamlLine text={line} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const Hook = ({ t, data }) => {
  const x = 1 - progress(t, 3.9, 4.6)
  if (x <= 0) return null
  const lines = data.states.orderId.yaml.trimEnd().split('\n')
  const column = (offset) => [...lines, '', ...lines].slice(offset, offset + 40)
  const first = window_(t, 0.25, 2.45, 0.45)
  const second = outExpo(progress(t, 2.45, 2.95))
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: x, filter: `blur(${mix(8, 0, x)}px)` }}>
      <div className="yaml-wall" style={{ opacity: mix(0.08, 0.2, progress(t, 0, 1.5)) * (1 - 0.6 * second), transform: `translateY(${-t * 26}px)` }}>
        {[0, 9, 18, 27].map((offset) => (
          <div key={offset}>{column(offset).map((line, i) => <div key={i}><YamlLine text={line} /></div>)}</div>
        ))}
      </div>
      <div className="hook">
        {t < 2.45
          ? <h1 style={{ opacity: first, transform: `translateY(${mix(24, 0, first)}px)` }}>Chaining API calls by hand, in YAML?</h1>
          : <h1 style={{ opacity: second, transform: `translateY(${mix(24, 0, second)}px)` }}>Drag them from <em>your API</em> instead.</h1>}
      </div>
    </div>
  )
}

const EndCard = ({ t }) => {
  const x = outExpo(progress(t, 47.4, 48.4))
  if (x <= 0) return null
  const line = (at) => ({ opacity: outExpo(progress(t, at, at + 0.6)), transform: `translateY(${mix(18, 0, outExpo(progress(t, at, at + 0.6)))}px)` })
  return (
    <div className="endcard" style={{ opacity: x, background: 'var(--stage)' }}>
      <div className="stage-glow" />
      <div style={{ position: 'relative' }}>
        <h1 style={line(47.7)}>Draw your <em>Arazzo</em> workflows.</h1>
        <p className="sub" style={line(48.3)}>The Arazzo canvas for GitHub Copilot: drag, wire, ask. Every change lands in your *.arazzo.yaml.</p>
        <div className="terminal" style={line(49.2)}>
          <div><span className="p">$ </span>copilot plugin marketplace add https://github.com/SebastienDegodez/github-copilot-arazzo</div>
          <div><span className="p">$ </span>copilot plugin install arazzo@github-copilot-arazzo</div>
        </div>
      </div>
      <div className="foot" style={line(50.2)}><span>Arazzo 1.0.1 · diagram after Microcks</span><span>github.com/SebastienDegodez/github-copilot-arazzo</span></div>
    </div>
  )
}

/* ---------- stage ---------- */

const Stage = ({ t, data }) => {
  const camera = cameraAt(t)
  const rise = outExpo(progress(t, 4.1, 5.3))
  const zoomed = camera.s > 0.95
  return (
    <div className="stage">
      <div className="stage-glow" />
      <Hook t={t} data={data} />
      {t >= 4.1 && (
        <div className="camera" style={{
          transform: `translate(${960 - camera.x * camera.s}px, ${540 - camera.y * camera.s + mix(70, 0, rise)}px) scale(${camera.s * mix(0.96, 1, rise)})`,
          opacity: rise,
        }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <App t={t} data={data} />
            <Pointer t={t} camera={camera} />
          </div>
        </div>
      )}
      <div className="scrim" style={{ opacity: zoomed ? 1 : 0 }} />
      <Caption t={t} top={camera.s < 0.95} />
      <FileCard t={t} data={data} />
      <EndCard t={t} />
    </div>
  )
}

/* ---------- player: like slides, but moving ---------- */

const params = new URLSearchParams(location.search)
const EXPORT = params.has('export')

const Player = ({ data }) => {
  const [t, setT] = useState(Number(params.get('t') ?? 0))
  const [playing, setPlaying] = useState(!EXPORT && params.get('autoplay') !== '0')
  const [scale, setScale] = useState(1)
  const [sound, setSound] = useState(false)
  const [hasSound, setHasSound] = useState(false)
  const clock = useRef({ t, at: performance.now() })
  const audio = useRef(null)

  useEffect(() => {
    if (EXPORT) return
    const track = new Audio('../docs/media/arazzo-canvas.m4a')
    track.preload = 'auto'
    track.addEventListener('canplay', () => setHasSound(true), { once: true })
    audio.current = track
    return () => track.pause()
  }, [])

  // The soundtrack follows the picture: it plays, pauses and seeks with it, and catches up on drift.
  useEffect(() => {
    const track = audio.current
    if (!track) return
    if (!sound || !playing) return void track.pause()
    track.currentTime = clock.current.t
    track.play().catch(() => setSound(false))
  }, [sound, playing])
  useEffect(() => {
    const track = audio.current
    if (track && sound && playing && Math.abs(track.currentTime - t) > 0.25) track.currentTime = t
  }, [t])

  useEffect(() => {
    const fit = () => setScale(EXPORT ? 1 : Math.min(innerWidth / 1920, innerHeight / 1080))
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    window.__video = {
      duration: DURATION,
      chapters: CHAPTERS,
      seek: (time) => new Promise((resolve) => {
        flushSync(() => setT(time))
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
    }
    window.__videoReady = true
  }, [])

  useEffect(() => {
    if (!playing) return
    clock.current = { t, at: performance.now() }
    let frame
    const tick = (now) => {
      const next = clock.current.t + (now - clock.current.at) / 1000
      setT(next >= DURATION ? 0 : next)
      if (next >= DURATION) clock.current = { t: 0, at: now }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const jump = (time) => {
    clock.current = { t: time, at: performance.now() }
    setT(time)
  }
  useEffect(() => {
    if (EXPORT) return
    const key = (event) => {
      const chapter = CHAPTERS.findLastIndex((each) => each.at <= t + 0.05)
      if (event.key === ' ') { event.preventDefault(); setPlaying((value) => !value) }
      if (event.key === 'ArrowRight') jump(CHAPTERS[Math.min(chapter + 1, CHAPTERS.length - 1)].at)
      if (event.key === 'ArrowLeft') jump(CHAPTERS[Math.max(chapter - (t - CHAPTERS[chapter].at < 1 ? 1 : 0), 0)].at)
      if (event.key === 'Home') jump(0)
      if (event.key === 'm') setSound((value) => !value)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [t])

  return (
    <Fragment>
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${scale})` }}><Stage t={t} data={data} /></div>
      {!EXPORT && (
        <div className={`player${playing ? '' : ' paused'}`}>
          <div className="track" onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            jump(DURATION * (event.clientX - rect.left) / rect.width)
          }}>
            <div className="fill" style={{ width: `${(t / DURATION) * 100}%` }} />
            {CHAPTERS.map((chapter) => <div key={chapter.at} className="tick" style={{ left: `${(chapter.at / DURATION) * 100}%` }} />)}
          </div>
          <div className="row">
            <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'} (space)</button>
            {hasSound && <button type="button" className={sound ? 'on' : ''} onClick={() => setSound((value) => !value)}>{sound ? 'Sound on' : 'Sound off'} (m)</button>}
            {CHAPTERS.map((chapter, i) => (
              <button key={chapter.at} type="button" className={t >= chapter.at && t < (CHAPTERS[i + 1]?.at ?? DURATION) ? 'on' : ''} onClick={() => jump(chapter.at)}>{chapter.name}</button>
            ))}
            <span className="time">{t.toFixed(1)} / {DURATION}s · ← → chapters</span>
          </div>
        </div>
      )}
    </Fragment>
  )
}

const boot = async () => {
  const root = ReactDOM.createRoot(document.getElementById('root'))
  root.render(<div className="loading">Playing the scenario on the canvas studio…</div>)
  const [css, data] = await Promise.all([
    fetch('../src/presentation/ui/styles.css').then((response) => response.text()),
    playScenario(),
  ])
  const style = document.createElement('style')
  style.textContent = scope(css)
  document.head.prepend(style)
  await document.fonts.ready
  root.render(<Player data={data} />)
}

boot()
