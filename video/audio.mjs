// The soundtrack of the video, made from code so it carries no third-party rights: an original
// music bed and the sound effects are synthesized here, the narration is spoken by a macOS voice
// (`say`), and ffmpeg mixes them, ducking the music under the voice. Everything is timed by
// timeline.mjs, like the picture.
//
//   node video/audio.mjs [--voice "Ava"] [--no-voice] [--out docs/media]
//     writes <out>/arazzo-canvas.m4a, the soundtrack alone (the player plays it in sync), and the
//     subtitles of the narration, timed on the voice: arazzo-canvas.en.srt and arazzo-canvas.fr.srt
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'ffmpeg-static'
import { CHAPTERS, DURATION, NARRATION, SOUNDS, TYPING } from './timeline.mjs'

const RATE = 48_000
const TAU = Math.PI * 2
const exec = promisify(execFile)

/* ---------- a stereo buffer and a few instruments ---------- */

const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}

const track = (seconds = DURATION) => {
  const left = new Float32Array(Math.ceil(seconds * RATE))
  const right = new Float32Array(left.length)
  /** Adds `voice(time since start)` from `at` for `length` seconds, panned from -1 (left) to 1. */
  const add = (at, length, voice, pan = 0) => {
    const start = Math.round(at * RATE)
    const gainL = Math.cos((pan + 1) * Math.PI / 4)
    const gainR = Math.sin((pan + 1) * Math.PI / 4)
    for (let i = Math.max(0, -start); i < length * RATE && start + i < left.length; i++) {
      const sample = voice(i / RATE)
      left[start + i] += sample * gainL
      right[start + i] += sample * gainR
    }
  }
  return { left, right, add }
}

const lowpass = (cutoff) => {
  let y = 0
  return (x, hz = cutoff) => (y += (1 - Math.exp(-TAU * hz / RATE)) * (x - y))
}

const noise = (seed) => {
  const next = random(seed)
  return () => next() * 2 - 1
}

const note = (name) => {
  const [, letter, accidental, octave] = /^([A-G])(#|b)?(\d)$/.exec(name)
  const semitone = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0)
  return 440 * 2 ** ((semitone + (Number(octave) - 4) * 12) / 12)
}

/* ---------- music: an original bed at 96 BPM, A minor ---------- */

const BEAT = 60 / 96
const BAR = BEAT * 4
const PROGRESSION = [
  { root: 'A2', pad: ['A3', 'C4', 'E4', 'B4'] },
  { root: 'F2', pad: ['F3', 'A3', 'C4', 'E4'] },
  { root: 'C3', pad: ['G3', 'C4', 'E4', 'D5'] },
  { root: 'G2', pad: ['G3', 'B3', 'D4', 'A4'] },
]
const at = (name) => CHAPTERS.find((chapter) => chapter.name === name).at
const GROOVE = { from: at('Drag') + 1, to: at('Install') }
const BUSY = [[at('Copilot'), at('Result')], [at('Result') + 1.4, at('Install')]]
const busy = (t) => BUSY.some(([from, to]) => t >= from && t < to)

const music = () => {
  const out = track()
  const bars = Math.ceil(DURATION / BAR)

  for (let bar = 0; bar < bars; bar++) {
    const start = bar * BAR
    const ending = start >= at('Install')
    const chord = ending ? { pad: ['C4', 'E4', 'G4', 'B4', 'E5'] } : PROGRESSION[bar % PROGRESSION.length]
    const length = ending ? DURATION - start : BAR + 0.9
    chord.pad.forEach((name, k) => {
      const f = note(name)
      for (const [detune, pan] of [[0.9985, -0.6], [1.0015, 0.6]]) {
        const filter = lowpass(1200)
        out.add(start, length, (t) => {
          const swell = Math.min(1, t / 0.5) * (ending ? Math.max(0, 1 - Math.max(0, t - 3) / (length - 3)) : Math.min(1, Math.max(0, (length - t) / 0.9)))
          const wave = Math.sin(TAU * f * detune * t) + 0.3 * Math.sin(TAU * 2 * f * detune * t) + 0.12 * Math.sin(TAU * 3 * f * detune * t)
          return filter(wave) * swell * (k === 3 ? 0.022 : 0.04)
        }, pan)
      }
    })
    if (ending || start + BAR <= GROOVE.from - BAR || start >= GROOVE.to) continue
    const f = note(PROGRESSION[bar % PROGRESSION.length].root)
    for (const beat of [0, 1.5, 2.5, 3.5]) {
      const when = start + beat * BEAT
      if (when < GROOVE.from || when >= GROOVE.to) continue
      out.add(when, 0.6, (t) => (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t)) * Math.exp(-t * 6) * Math.min(1, t * 200) * 0.2)
    }
    for (let beat = 0; beat < 4; beat++) {
      const when = start + beat * BEAT
      if (when < GROOVE.from || when >= GROOVE.to) continue
      out.add(when, 0.4, (t) => Math.sin(TAU * (48 * t + (75 / 30) * (1 - Math.exp(-t * 30)))) * Math.exp(-t * 9) * 0.42)
      const hiss = noise(bar * 8 + beat)
      let last = 0
      if (busy(when + BEAT / 2)) {
        out.add(when + BEAT / 2, 0.08, (t) => {
          const x = hiss()
          const high = x - last
          last = x
          return high * Math.exp(-t * 70) * 0.05
        }, 0.3)
      }
      if (busy(when)) {
        for (const [step, k] of [[0, 0], [0.5, 2], [1, 1], [1.5, 3]].slice(beat % 2 ? 2 : 0)) {
          const pluck = note(PROGRESSION[bar % PROGRESSION.length].pad[k]) * 2
          out.add(when + step * BEAT / 2, 0.5, (t) => Math.sin(TAU * pluck * t) * Math.exp(-t * 9) * Math.min(1, t * 400) * 0.035, -0.3)
        }
      }
    }
  }

  const fadeIn = 1.5
  const fadeOut = 3
  for (let i = 0; i < out.left.length; i++) {
    const t = i / RATE
    const gain = Math.min(1, t / fadeIn, (DURATION - t) / fadeOut)
    out.left[i] *= gain
    out.right[i] *= gain
  }
  return out
}

/* ---------- sound effects ---------- */

const effects = () => {
  const out = track()
  const tick = (when, { pitch = 3200, gain = 0.3, seed = 1, pan = 0.15 } = {}) => {
    const hiss = noise(seed)
    const filter = lowpass(5000)
    out.add(when, 0.03, (t) => (filter(hiss()) * Math.exp(-t * 700) + 0.5 * Math.sin(TAU * pitch * t) * Math.exp(-t * 900)) * gain, pan)
  }
  SOUNDS.click.forEach((when, i) => {
    tick(when, { gain: 0.32, seed: i + 1 })
    tick(when + 0.075, { pitch: 2600, gain: 0.16, seed: i + 50 })
  })

  const jitter = random(7)
  for (const { from, to, text } of Object.values(TYPING)) {
    ;[...text].forEach((char, i) => {
      const when = from + (i / text.length) * (to - from) + (jitter() - 0.5) * 0.018
      tick(when, char === ' '
        ? { pitch: 900, gain: 0.11, seed: i + 300 }
        : { pitch: 1800 + jitter() * 900, gain: 0.06 + jitter() * 0.05, seed: i + 100, pan: -0.1 + jitter() * 0.2 })
    })
  }

  SOUNDS.drop.forEach((when, i) => {
    const hiss = noise(i + 900)
    const filter = lowpass(700)
    out.add(when, 0.3, (t) => Math.sin(TAU * (65 * t + (100 / 22) * (1 - Math.exp(-t * 22)))) * Math.exp(-t * 18) * 0.5 + filter(hiss()) * Math.exp(-t * 40) * 0.25)
    out.add(when + 0.01, 0.12, (t) => Math.sin(TAU * note('E6') * t) * Math.exp(-t * 35) * 0.05, 0.2)
  })

  SOUNDS.send.forEach((when) => {
    out.add(when, 0.16, (t) => Math.sin(TAU * (500 * t + 1900 * t * t)) * Math.sin(Math.PI * t / 0.16) * 0.1)
  })

  const blip = ['E6', 'B6', 'A6', 'E7']
  SOUNDS.done.forEach((when, i) => {
    const [a, b] = i % 2 ? [blip[2], blip[3]] : [blip[0], blip[1]]
    for (const [delay, name] of [[0, a], [0.07, b]]) {
      const f = note(name)
      out.add(when + delay, 0.4, (t) => (Math.sin(TAU * f * t) + 0.15 * Math.sin(TAU * 2 * f * t)) * Math.exp(-t * 12) * Math.min(1, t * 300) * 0.06, 0.25)
    }
  })

  SOUNDS.whoosh.forEach((when, i) => {
    const hiss = noise(i + 2000)
    const low = lowpass(400)
    const high = lowpass(200)
    const length = 0.75
    out.add(when - 0.25, length, (t) => {
      const x = t / length
      const cutoff = 300 + 3200 * Math.sin(Math.PI * x) ** 2
      const band = low(hiss(), cutoff) - high(hiss(), cutoff / 4)
      return band * Math.sin(Math.PI * x) ** 2 * 0.22
    }, -0.5 + (i % 2))
  })

  SOUNDS.chime.forEach((when) => {
    for (const [name, gain, delay] of [['A5', 0.09, 0], ['E6', 0.06, 0.09], ['C#6', 0.045, 0.16]]) {
      const f = note(name)
      out.add(when + delay, 4, (t) => [[1, 1, 1.2], [2.0, 0.4, 2], [2.76, 0.25, 3], [5.4, 0.1, 5]]
        .reduce((sum, [ratio, level, decay]) => sum + level * Math.sin(TAU * f * ratio * t) * Math.exp(-t * decay), 0) * gain * Math.min(1, t * 500))
    }
  })
  return out
}

/* ---------- files ---------- */

const writeWav = (path, { left, right }) => {
  const data = Buffer.alloc(left.length * 8)
  for (let i = 0; i < left.length; i++) {
    data.writeFloatLE(left[i], i * 8)
    data.writeFloatLE(right[i], i * 8 + 4)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(3, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 8, 28)
  header.writeUInt16LE(8, 32)
  header.writeUInt16LE(32, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return writeFile(path, Buffer.concat([header, data]))
}

const wavSeconds = async (path) => {
  const file = await readFile(path)
  let offset = 12
  let format = null
  while (offset < file.length) {
    const id = file.toString('ascii', offset, offset + 4)
    const size = file.readUInt32LE(offset + 4)
    if (id === 'fmt ') format = { channels: file.readUInt16LE(offset + 10), rate: file.readUInt32LE(offset + 12), bits: file.readUInt16LE(offset + 22) }
    if (id === 'data') return size / (format.channels * format.rate * (format.bits / 8))
    offset += 8 + size + (size % 2)
  }
  throw new Error(`no audio data in ${path}`)
}

/* ---------- narration ---------- */

/** The installed voice matching `wanted`, preferring its Premium, then Enhanced, variant. */
export const findVoice = async (wanted) => {
  const { stdout } = await exec('say', ['-v', '?'])
  const voices = stdout.split('\n').map((line) => /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})/.exec(line)).filter(Boolean)
    .map(([, name, locale]) => ({ name: name.trim(), locale }))
  const base = wanted.replace(/\s*\(.*$/, '').toLowerCase()
  const english = voices.filter((voice) => voice.locale.startsWith('en_') && voice.name.toLowerCase().startsWith(base))
  const rank = (voice) => (/premium/i.test(voice.name) ? 0 : /enhanced|amélioré/i.test(voice.name) ? 1 : 2)
  const exact = english.find((voice) => voice.name.toLowerCase() === wanted.toLowerCase())
  const best = exact ?? english.sort((a, b) => rank(a) - rank(b))[0]
  if (!best) {
    throw new Error(`no English voice "${wanted}" is installed. Download it in System Settings > Accessibility > Spoken Content > System voice > Manage Voices > English, or pass --voice with one of: ${voices.filter((voice) => voice.locale.startsWith('en_')).map((voice) => voice.name).join(', ')}`)
  }
  return best.name
}

const speak = async (dir, voice, line, index) => {
  const path = join(dir, `line-${index}.wav`)
  const room = line.end - line.at - 0.1
  let rate = 168
  for (let attempt = 0; attempt < 4; attempt++) {
    await exec('say', ['-v', voice, '-r', String(rate), '--file-format=WAVE', '--data-format=LEI16@48000', '-o', path, line.text])
    const seconds = await wavSeconds(path)
    if (seconds <= room) return { path, seconds, rate }
    rate = Math.min(240, Math.ceil(rate * (seconds / room) * 1.02))
  }
  return { path, seconds: await wavSeconds(path), rate }
}

const ffmpegRun = (args) => new Promise((done, fail) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('error', fail)
  child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited with ${code}`))))
})

/* ---------- subtitles ---------- */

const clock = (seconds) => {
  const ms = Math.round(seconds * 1000)
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

/** Splits a line into cues of whole sentences, then of clauses when a sentence is too long. */
const cuesOf = (text, max = 84) => text.match(/[^.?!]+[.?!]*\s*/g).map((part) => part.trim()).filter(Boolean)
  .flatMap((sentence) => (sentence.length <= max ? [sentence] : sentence.split(/(?<=[:,])\s+/)))

/** At most two lines of about `width` characters, balanced, broken after punctuation when it can. */
const wrap = (text, width = 42) => {
  if (text.length <= width) return text
  const words = text.split(' ')
  let best = null
  for (let i = 1; i < words.length; i++) {
    const [a, b] = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    const score = Math.max(a.length, b.length) - (/[,:;]$/.test(a) ? 10 : 0)
    if (!best || score < best.score) best = { score, text: `${a}\n${b}` }
  }
  return best.text
}

/**
 * The narration as SubRip subtitles: each line from when it is said for as long as it is spoken,
 * shared between its cues by their length.
 * @param {Array<{ at: number, end: number, seconds?: number, text: string, fr: string }>} lines
 * @param {'text' | 'fr'} language the field to subtitle
 */
export const subtitles = (lines, language = 'text') => {
  const cues = lines.flatMap((line) => {
    const parts = cuesOf(line[language])
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const spoken = Math.min(line.seconds ?? line.end - line.at, line.end - line.at)
    let start = line.at
    return parts.map((part, i) => {
      const end = i === parts.length - 1 ? line.at + spoken + 0.3 : start + spoken * (part.length / length)
      const cue = { start, end, text: wrap(part) }
      start = end
      return cue
    })
  })
  cues.forEach((cue, i) => { if (cues[i + 1]) cue.end = Math.min(cue.end, cues[i + 1].start) })
  return cues.map((cue, i) => `${i + 1}\n${clock(cue.start)} --> ${clock(cue.end)}\n${cue.text}\n`).join('\n')
}

/** Speaks the narration with `voice` into `dir`; each line gets the path and length of its audio. */
const narrate = async (dir, voice, log) => {
  const name = await findVoice(voice)
  log(`Narration: ${name}`)
  const lines = []
  for (const [index, line] of NARRATION.entries()) {
    const spoken = await speak(dir, name, line, index)
    if (spoken.seconds > line.end - line.at) log(`  warning: "${line.text.slice(0, 40)}…" lasts ${spoken.seconds.toFixed(1)} s for ${(line.end - line.at).toFixed(1)} s`)
    lines.push({ ...line, ...spoken })
  }
  return lines
}

/**
 * Builds the soundtrack: a 48 kHz stereo WAV of DURATION seconds at `path`, and the narration as
 * spoken, for the subtitles.
 * @param {{ voice?: string | null, log?: (line: string) => void }} options `voice: null` leaves the narration out
 * @returns {Promise<{ path: string, narration: object[] }>}
 */
export const buildSoundtrack = async ({ voice = 'Ava', log = console.log } = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'arazzo-audio-'))
  await writeWav(join(dir, 'music.wav'), music())
  await writeWav(join(dir, 'effects.wav'), effects())

  const lines = voice ? await narrate(dir, voice, log) : []

  const output = join(dir, 'soundtrack.wav')
  const inputs = ['-i', join(dir, 'music.wav'), '-i', join(dir, 'effects.wav'), ...lines.flatMap((line) => ['-i', line.path])]
  const voices = lines.map((line, i) => `[${i + 2}:a]aformat=sample_rates=${RATE}:channel_layouts=stereo,highpass=f=80,acompressor=threshold=0.1:ratio=3:attack=5:release=120,adelay=delays=${Math.round(line.at * 1000)}:all=1[v${i}]`)
  const graph = lines.length
    ? [
        ...voices,
        `${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,apad=whole_dur=${DURATION}[voice]`,
        '[voice]asplit[voiceKey][voiceMix]',
        '[0:a][voiceKey]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=450:makeup=1[bed]',
        '[bed][1:a][voiceMix]amix=inputs=3:normalize=0:weights=0.9 1 1.25',
      ]
    : ['[0:a][1:a]amix=inputs=2:normalize=0']
  graph[graph.length - 1] += `,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=${RATE},atrim=0:${DURATION}[out]`
  await ffmpegRun([...inputs, '-filter_complex', graph.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', output])
  return { path: output, narration: lines.length ? lines : NARRATION }
}

/** Writes the English and French subtitles of the narration next to the video. */
export const writeSubtitles = async (out, narration) => {
  const paths = [join(out, 'arazzo-canvas.en.srt'), join(out, 'arazzo-canvas.fr.srt')]
  await writeFile(paths[0], subtitles(narration, 'text'))
  await writeFile(paths[1], subtitles(narration, 'fr'))
  return paths
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { parseArgs } = await import('node:util')
  const { values } = parseArgs({ options: { voice: { type: 'string', default: 'Ava' }, 'no-voice': { type: 'boolean', default: false }, out: { type: 'string', default: 'docs/media' } } })
  const { path, narration } = await buildSoundtrack({ voice: values['no-voice'] ? null : values.voice })
  const out = resolve(fileURLToPath(new URL('..', import.meta.url)), values.out)
  const m4a = join(out, 'arazzo-canvas.m4a')
  await ffmpegRun(['-i', path, '-c:a', 'aac', '-b:a', '192k', m4a])
  console.log(`Soundtrack: ${m4a}\nSubtitles: ${(await writeSubtitles(out, narration)).join(', ')}`)
}
