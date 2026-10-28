// The Arazzo document as a file of the workspace, the API descriptions it names, read next to it or
// fetched over HTTP, and the choices of the developer kept from one session to the next. What is
// told of a file names it as the document writes it: never a path of the machine, nor an error code.
import { createHash } from 'node:crypto'
import { unwatchFile, watchFile } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parse } from './vendor/yaml/index.js'

const digest = (text) => createHash('sha256').update(text).digest('hex')
const WRITE_FAILURES = { EACCES: 'permission denied', EPERM: 'permission denied' }

export const fileDocuments = ({ root, pollInterval = 300 }) => {
  const at = (path) => resolve(root, path)
  const written = new Map()
  return {
    async read(path) {
      try {
        return await readFile(at(path), 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },

    /** Writes the text whole or not at all; says why in words when the file system refuses it. */
    async write(path, text) {
      const file = at(path)
      const temporary = `${file}.${process.pid}.tmp`
      try {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(temporary, text)
        await rename(temporary, file)
      } catch (error) {
        throw new Error(WRITE_FAILURES[error.code] ?? 'the file system refused it')
      }
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

const MAX_SIZE = 5 * 1024 * 1024

/** What a text holds: the description it parses into, or why it holds none. */
const described = (text) => {
  if (Buffer.byteLength(text) > MAX_SIZE) return { state: 'too large' }
  try {
    return { state: 'read', description: parse(text) }
  } catch {
    return { state: 'invalid' }
  }
}

const SKIPPED = new Set(['node_modules', 'dist', 'build', 'target'])

/** The files of a workspace `filter` keeps, as paths relative to it, nearest first, then by name. */
const findFiles = async (root, filter, depth) => {
  const found = []
  const visit = async (dir, level) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && await filter(join(dir, entry.name), entry.name)) found.push({ level, path: relative(root, join(dir, entry.name)) })
      if (entry.isDirectory() && level < depth && !SKIPPED.has(entry.name) && !entry.name.startsWith('.')) await visit(join(dir, entry.name), level + 1)
    }
  }
  await visit(root, 0)
  return found.sort((a, b) => a.level - b.level || a.path.localeCompare(b.path)).map(({ path }) => path)
}

const DESCRIPTION_FILE = /\.(ya?ml|json)$/
const DESCRIPTION_KEY = /^[\s{]*["']?(openapi|swagger|arazzo)["']?\s*:/m

const isDescription = async (file, name) => {
  if (!DESCRIPTION_FILE.test(name)) return false
  const info = await stat(file)
  return info.size <= MAX_SIZE && DESCRIPTION_KEY.test(await readFile(file, 'utf8'))
}

export const fileSources = ({ root, fetch = globalThis.fetch, timeout = 10_000 }) => ({
  async load(documentPath, source) {
    const url = String(source.url)
    if (url.startsWith('https://') || url.startsWith('http://')) {
      let response
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
      } catch (error) {
        return { state: 'unreachable', detail: error.name === 'TimeoutError' ? `no answer within ${timeout / 1000} s` : 'no answer' }
      }
      if (!response.ok) return { state: 'unreachable', detail: `HTTP ${response.status}` }
      return described(await response.text())
    }
    const file = resolve(dirname(resolve(root, documentPath)), url)
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) return { state: 'not found' }
    if (info.size > MAX_SIZE) return { state: 'too large' }
    return described(await readFile(file, 'utf8'))
  },

  /** The OpenAPI and Arazzo descriptions of the workspace, as urls relative to the document. */
  async candidates(documentPath) {
    const document = resolve(root, documentPath)
    const files = await findFiles(root, (file, name) => file !== document && isDescription(file, name), 4)
    return files.map((path) => relative(dirname(document), resolve(root, path)).split(sep).join('/'))
  },
})

const ARAZZO_FILE = /\.arazzo\.(ya?ml|json)$/

/** The Arazzo documents of a workspace, as paths relative to it, nearest first, then by name. */
export const findArazzoDocuments = (root, depth = 3) => findFiles(root, (_file, name) => ARAZZO_FILE.test(name), depth)

/** The choices of the developer, kept under `$COPILOT_HOME/extensions/arazzo-canvas/artifacts/settings.json`. */
export const filePreferences = ({ home }) => {
  const file = join(home, 'extensions', 'arazzo-canvas', 'artifacts', 'settings.json')
  const read = async () => {
    try {
      const settings = JSON.parse(await readFile(file, 'utf8'))
      return settings instanceof Object ? settings : {}
    } catch {
      return {}
    }
  }
  return {
    read,
    async write(settings) {
      const current = await read()
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, `${JSON.stringify({ ...current, ...settings }, null, 2)}\n`)
    },
  }
}
