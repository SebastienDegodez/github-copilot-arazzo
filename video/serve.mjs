// Serves the repository over loopback so the video can import the plugin's own modules and
// stylesheet. `npm run video` prints the URL to open; the exporter starts it the same way.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.jsx': 'text/babel; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
}

export const serveVideo = ({ port = 0 } = {}) => new Promise((resolve, reject) => {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    const file = join(ROOT, path.endsWith('/') ? join(path, 'index.html') : path)
    if (!file.startsWith(ROOT) || file.split(sep).includes('.git')) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body)
    } catch {
      response.writeHead(404).end('not found')
    }
  })
  server.on('error', reject)
  server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/video/`,
    close: () => new Promise((done) => server.close(done)),
  }))
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serveVideo({ port: Number(process.env.PORT ?? 4317) })
  console.log(`Arazzo canvas video: ${url}  (space: play/pause, ← →: chapters, ?t=12 to start at 12 s)`)
}
