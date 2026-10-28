// The Arazzo document as a file of the workspace, in YAML or JSON after its extension, and the
// OpenAPI descriptions it names, read next to it or fetched over HTTP.
import { createHash } from 'node:crypto'
import { unwatchFile, watchFile } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { parse, stringify } from './vendor/yaml/index.js'

export class UnreadableDocument extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnreadableDocument'
  }
}

const parseText = (text, what) => {
  let value
  try {
    value = parse(text)
  } catch (error) {
    throw new UnreadableDocument(`${what} is neither YAML nor JSON: ${error.message.split('\n')[0]}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnreadableDocument(`${what} does not hold an object`)
  return value
}

const textOf = (path, document) =>
  (extname(path) === '.json' ? `${JSON.stringify(document, null, 2)}\n` : stringify(document, { lineWidth: 0 }))

const digest = (text) => createHash('sha256').update(text).digest('hex')

export const fileDocuments = ({ root, pollInterval = 300 }) => {
  const at = (path) => resolve(root, path)
  const written = new Map()
  return {
    async read(path) {
      let text
      try {
        text = await readFile(at(path), 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
      return parseText(text, path)
    },

    async write(path, document) {
      const file = at(path)
      const text = textOf(file, document)
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await writeFile(temporary, text)
      await rename(temporary, file)
      written.set(file, digest(text))
    },

    /** Calls back when another tool changes the file; the canvas's own writes are not changes. */
    watch(path, listener) {
      const file = at(path)
      const changed = async () => {
        const content = await readFile(file).catch(() => null)
        if (content === null || digest(content) === written.get(file)) return
        written.set(file, digest(content))
        listener()
      }
      watchFile(file, { interval: pollInterval }, changed)
      return () => unwatchFile(file, changed)
    },
  }
}

export const fileSources = ({ root, fetch = globalThis.fetch, timeout = 10_000 }) => ({
  async load(documentPath, source) {
    const url = source.url ?? ''
    if (url.startsWith('https://') || url.startsWith('http://')) {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return parseText(await response.text(), url)
    }
    const file = resolve(dirname(resolve(root, documentPath)), url)
    return parseText(await readFile(file, 'utf8'), url)
  },
})

const SKIPPED = new Set(['node_modules', 'dist', 'build', 'target'])
const ARAZZO_FILE = /\.arazzo\.(ya?ml|json)$/

/** The Arazzo documents of a workspace, as paths relative to it, nearest first, then by name. */
export const findArazzoDocuments = async (root, depth = 3) => {
  const found = []
  const visit = async (dir, level) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && ARAZZO_FILE.test(entry.name)) found.push({ level, path: relative(root, join(dir, entry.name)) })
      if (entry.isDirectory() && level < depth && !SKIPPED.has(entry.name) && !entry.name.startsWith('.')) await visit(join(dir, entry.name), level + 1)
    }
  }
  await visit(root, 0)
  return found.sort((a, b) => a.level - b.level || a.path.localeCompare(b.path)).map(({ path }) => path)
}

