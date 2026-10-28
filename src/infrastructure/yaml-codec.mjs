// The text of an Arazzo document is what the developer owns: the codec reads it into a plain object,
// and writes an edited object back by changing only the nodes that differ, so the comments, the
// order of the keys and the style of what was not edited stay as they were. A JSON document is
// written as JSON.
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from './vendor/yaml/index.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const keyOf = (pair) => String(isScalar(pair.key) ? pair.key.value : pair.key)

/** What makes an item of a list the same item after an edit: its id, its name, or its place. */
const identityOf = (value) => {
  if (!isObject(value)) return JSON.stringify(value)
  return value.stepId ?? value.workflowId ?? (value.name === undefined ? undefined : `${value.in}:${value.name}`)
}

const mergeNode = (doc, node, previous, value) => {
  if (isMap(node) && isObject(value)) {
    node.items = node.items.filter((pair) => Object.hasOwn(value, keyOf(pair)))
    for (const [key, child] of Object.entries(value)) {
      const pair = node.items.find((each) => keyOf(each) === key)
      if (pair) pair.value = mergeNode(doc, pair.value, previous[key], child)
      else node.items.push(doc.createPair(key, child))
    }
    return node
  }
  if (isSeq(node) && Array.isArray(value)) {
    // the comment above the first item is the list's: it follows that item when the list changes
    const [first] = node.items
    if (first) [first.commentBefore, node.commentBefore] = [node.commentBefore ?? first.commentBefore, undefined]
    const used = new Set()
    node.items = value.map((child, index) => {
      const id = identityOf(child)
      const at = previous.findIndex((each, i) => !used.has(i) && (id === undefined ? i === index : identityOf(each) === id))
      if (at < 0) return doc.createNode(child)
      used.add(at)
      return mergeNode(doc, node.items[at], previous[at], child)
    })
    return node
  }
  if (isScalar(node) && !(value instanceof Object)) {
    node.value = value
    return node
  }
  return doc.createNode(value)
}

const reasonOf = (error) => error.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')

const segmentsOf = (pointer) => pointer.replace(/^#\/?/, '').split('/').filter(Boolean)
  .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))

export const yamlCodec = () => ({
  /** The document a text holds, or why it holds none and on which line. */
  parse(text) {
    const doc = parseDocument(text, { lineCounter: new LineCounter() })
    const [error] = doc.errors
    if (error) return { error: { message: reasonOf(error), line: error.linePos[0].line } }
    const document = doc.toJS()
    if (!isObject(document)) return { error: { message: 'the YAML does not hold an object', line: 1 } }
    return { document }
  },

  /** The text of `document`, written over `text` (null for a new document) so that what did not change keeps its form. */
  merge(path, text, document) {
    if (path.endsWith('.json')) return `${JSON.stringify(document, null, 2)}\n`
    const doc = parseDocument(text ?? '')
    doc.contents = mergeNode(doc, doc.contents, doc.toJS(), document)
    return doc.toString({ lineWidth: 0 })
  },

  /** The line of the node a JSON pointer names, or of its nearest ancestor the text holds. */
  lineOf(text, pointer) {
    const lineCounter = new LineCounter()
    let node = parseDocument(text, { lineCounter }).contents
    let line = 1
    for (const segment of segmentsOf(pointer)) {
      const pair = isMap(node) ? node.items.find((each) => keyOf(each) === segment) : null
      const item = isSeq(node) ? node.items[Number(segment)] : null
      if (pair) {
        line = lineCounter.linePos(pair.key.range[0]).line
        node = pair.value
      } else if (item) {
        line = lineCounter.linePos(item.range[0]).line
        node = item
      } else break
    }
    return line
  },
})
