// The loopback server every panel of the canvas loads. Mutating calls need a per-process token
// only the served page carries, so another local page cannot edit the workspace through this port.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UI = join(dirname(fileURLToPath(import.meta.url)), 'ui')
const STATIC = {
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
}
const MAX_BODY = 1024 * 1024

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** The JSON body of a request; a body over MAX_BODY is read to its end and dropped. */
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    chunks.push(chunk)
    if (size > MAX_BODY) chunks.length = 0
  })
  req.on('end', () => {
    if (size > MAX_BODY) return reject(Object.assign(new Error('request body too large'), { status: 413 }))
    const text = Buffer.concat(chunks).toString('utf8')
    try {
      resolve(text ? JSON.parse(text) : {})
    } catch {
      reject(Object.assign(new Error('the request body is not JSON'), { status: 400 }))
    }
  })
})

/** `isRefusal(error)` tells an error the developer can correct (400) from a crash (500). */
export const startServer = async ({ studio, actions, isRefusal, onError = () => {} }) => {
  const token = randomBytes(24).toString('hex')
  const byName = new Map(actions.map((action) => [action.name, action]))
  const clients = new Set()
  const snapshot = () => {
    try {
      return { view: studio.view() }
    } catch (error) {
      return { error: error.message }
    }
  }
  const broadcast = () => {
    const payload = `data: ${JSON.stringify(snapshot())}\n\n`
    for (const res of clients) res.write(payload)
  }
  const unsubscribe = studio.onChange(broadcast)

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = (await readFile(join(UI, 'index.html'), 'utf8')).replace('__CANVAS_TOKEN__', token)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(html)
        return
      }
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname]
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
        res.end(await readFile(join(UI, file)))
        return
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        if (url.searchParams.get('token') !== token) return send(res, 403, { error: 'forbidden' })
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers['x-canvas-token'] !== token) return send(res, 403, { error: 'forbidden' })
        const action = byName.get(url.pathname.slice('/api/'.length))
        if (!action) return send(res, 404, { error: 'no such action' })
        const result = await action.run(await readBody(req))
        return send(res, 200, { result: result ?? null })
      }
      send(res, 404, { error: 'not found' })
    } catch (error) {
      if (error.status) return send(res, error.status, { error: error.message })
      if (isRefusal(error)) return send(res, 400, { error: error.message })
      onError(error)
      send(res, 500, { error: 'the canvas hit an error; try again' })
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { address, port } = server.address()
  return {
    url: `http://${address}:${port}/`,
    close: () => new Promise((resolve) => {
      unsubscribe()
      for (const res of clients) res.end()
      server.close(() => resolve())
    }),
  }
}
