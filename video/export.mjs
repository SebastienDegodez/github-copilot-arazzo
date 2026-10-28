// Exports the video frame by frame: the page is driven to each instant with window.__video.seek(t),
// screenshotted, and the frames are encoded by ffmpeg. Writes, by default into docs/media:
//   arazzo-canvas.mp4   the full video, 1920×1080, H.264, with its soundtrack (AAC)
//   arazzo-canvas.m4a   the soundtrack alone, played in sync by the page
//   arazzo-canvas.en.srt, arazzo-canvas.fr.srt   the subtitles of the narration (for YouTube)
//   arazzo-canvas.gif   a short loop of the drag and drop, for the README
//   arazzo-canvas.png   the poster frame
// Options: --fps 30, --out docs/media, --no-gif, --voice "Ava" (a macOS voice; its Premium or Enhanced variant is preferred), --no-voice
// (music and sound effects only), --no-audio (silent), and --from/--to (seconds) to export a part
// only, as arazzo-canvas-<from>-<to>.mp4 without GIF nor poster.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import ffmpeg from 'ffmpeg-static'
import { buildSoundtrack, writeSubtitles } from './audio.mjs'
import { serveVideo } from './serve.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const POSTER_AT = 39.6
const GIF = { from: 12.4, length: 9.6, fps: 12, width: 960 }

const { values } = parseArgs({
  options: {
    fps: { type: 'string', default: '30' },
    out: { type: 'string', default: 'docs/media' },
    from: { type: 'string' },
    to: { type: 'string' },
    'no-gif': { type: 'boolean', default: false },
    voice: { type: 'string', default: 'Ava' },
    'no-voice': { type: 'boolean', default: false },
    'no-audio': { type: 'boolean', default: false },
  },
})

const run = (args, input) => new Promise((done, fail) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] })
  child.on('error', fail)
  child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited with ${code}`))))
  if (input) input(child.stdin)
})

const out = resolve(ROOT, values.out)
await mkdir(out, { recursive: true })
const soundtrack = values['no-audio'] ? null : await buildSoundtrack({ voice: values['no-voice'] ? null : values.voice })
const server = await serveVideo()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error(error))
  await page.goto(`${server.url}?export=1`)
  await page.waitForFunction(() => window.__videoReady, null, { timeout: 30_000 })
  const duration = await page.evaluate(() => window.__video.duration)
  const fps = Number(values.fps)
  const from = Number(values.from ?? 0)
  const to = Math.min(Number(values.to ?? duration), duration)
  const frames = Math.round((to - from) * fps)
  const partial = values.from !== undefined || values.to !== undefined
  const mp4 = join(out, partial ? `arazzo-canvas-${from}-${to}.mp4` : 'arazzo-canvas.mp4')
  const picture = soundtrack ? join(await mkdtemp(join(tmpdir(), 'arazzo-video-')), 'picture.mp4') : mp4

  console.log(`Exporting ${frames} frames (${from}–${to} s at ${fps} fps) to ${mp4}`)
  const started = Date.now()
  await run(['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', picture], async (stdin) => {
    for (let frame = 0; frame < frames; frame++) {
      await page.evaluate((t) => window.__video.seek(t), from + frame / fps)
      const png = await page.screenshot({ type: 'png' })
      if (!stdin.write(png)) await new Promise((drained) => stdin.once('drain', drained))
      if (frame % fps === 0) process.stdout.write(`\r  ${Math.round((frame / frames) * 100)} %  `)
    }
    stdin.end()
    process.stdout.write('\r  100 %  \n')
  })

  if (soundtrack) {
    await run(['-i', picture, '-ss', String(from), '-t', String(to - from), '-i', soundtrack.path,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4])
    if (!partial) {
      await run(['-i', soundtrack.path, '-c:a', 'aac', '-b:a', '192k', join(out, 'arazzo-canvas.m4a')])
      await writeSubtitles(out, soundtrack.narration)
    }
  }

  if (!partial) {
    await page.evaluate((t) => window.__video.seek(t), POSTER_AT)
    await writeFile(join(out, 'arazzo-canvas.png'), await page.screenshot({ type: 'png' }))
  }
  if (!partial && !values['no-gif']) {
    await run(['-ss', String(GIF.from), '-t', String(GIF.length), '-i', mp4,
      '-vf', `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      join(out, 'arazzo-canvas.gif')])
  }
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s: ${out}`)
} finally {
  await browser.close()
  await server.close()
}
