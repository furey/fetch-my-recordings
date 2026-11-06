import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { parseArgs, promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(appRoot, 'docs', 'img', 'app-icon-animated.gif') },
    hold: { type: 'string', default: '2' },
    fps: { type: 'string', default: '50' }
  }
})

const CYCLE_MS = 6000
const SETTLED_MS = 1340
const LEAVE_START_MS = 4200
const DISPLAY_SIZE = 128
const SCALE = 2
const TILE = '#141c24'

const main = async () => {
  const fps = Number(values.fps)
  const holdMs = Number(values.hold) * 1000
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fetch-my-recordings-logo-'))
  const frameTimes = appTimeline({ fps, holdMs })
  const frames = mergeRepeatedFrames({ shots: await renderFrames(frameTimes), frameMs: 1000 / fps })
  await encodeGif({ frames, dir: work, out: path.resolve(values.out) })
  await fs.rm(work, { recursive: true })
  console.log(`${frameTimes.length} steps at ${fps} fps as ${frames.length} GIF frames, hold ${holdMs} ms: ${values.out}`)
}

const appTimeline = ({ fps, holdMs }) => {
  const frameMs = 1000 / fps
  const holdFrames = Math.round(holdMs / frameMs)
  const motionFrames = Math.round((CYCLE_MS - LEAVE_START_MS + SETTLED_MS) / frameMs)
  const hold = Array.from({ length: holdFrames }, () => SETTLED_MS)
  const motion = Array.from({ length: motionFrames }, (_, index) => (LEAVE_START_MS + index * frameMs) % CYCLE_MS)
  return [...hold, ...motion]
}

const renderFrames = async (frameTimes) => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: DISPLAY_SIZE, height: DISPLAY_SIZE },
      deviceScaleFactor: SCALE
    })
    await page.setContent(await logoPage())
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.pause()))
    const shots = []
    for (const time of frameTimes) {
      await page.evaluate(steadyStateTime => {
        document.getAnimations().forEach(animation => { animation.currentTime = steadyStateTime })
      }, time + CYCLE_MS)
      shots.push(await page.screenshot({ omitBackground: true }))
    }
    return shots
  } finally {
    await browser.close()
  }
}

const logoPage = async () => {
  const styles = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'styles.css'), 'utf8')
  const mark = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'mark.svg'), 'utf8')
  return `<!doctype html><html><head><style>
    html, body { margin: 0; background: transparent; }
    svg { display: block; }
    ${markAnimationCss(styles)}
  </style></head><body>
  <svg xmlns="http://www.w3.org/2000/svg" width="${DISPLAY_SIZE}" height="${DISPLAY_SIZE}" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" rx="200" fill="${TILE}"/>
    <svg class="mark is-animated" x="112" y="112" width="800" height="800" viewBox="0 0 64 64">
      ${animatedMarkInner(mark)}
    </svg>
  </svg></body></html>`
}

const markAnimationCss = (styles) => {
  const start = styles.indexOf('.mark.is-animated {')
  const end = styles.indexOf('@media (prefers-reduced-motion: reduce)', start)
  if (start < 0 || end < 0) throw new Error('Mark animation CSS not found in styles.css')
  return styles.slice(start, end)
}

const animatedMarkInner = (mark) => {
  const chipNames = { '#3ba4ff': 'blue', '#f28c28': 'orange', '#f5c542': 'yellow' }
  const chips = [...mark.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"\/>/g)]
    .map(([rect, fill]) => rect.replace('<rect ', `<rect class="mark-chip is-${chipNames[fill]}" `))
  const tray = mark.match(/<path [^>]*\/>/)[0]
  if (chips.length !== 3 || !tray) throw new Error('Unexpected mark.svg shape')
  return `<g class="mark-chips">${chips.join('')}</g>${tray}`
}

const mergeRepeatedFrames = ({ shots, frameMs }) => shots.reduce((frames, shot) => {
  const previous = frames.at(-1)
  if (previous?.shot.equals(shot)) {
    previous.durationMs += frameMs
    return frames
  }
  return [...frames, { shot, durationMs: frameMs }]
}, [])

const encodeGif = async ({ frames, dir, out }) => {
  await fs.mkdir(path.dirname(out), { recursive: true })
  for (const [index, { shot }] of frames.entries()) await fs.writeFile(framePath(dir, index), shot)
  const input = ['-framerate', '50', '-i', path.join(dir, 'frame-%04d.png')]
  const palette = path.join(dir, 'palette.png')
  await run('ffmpeg', ['-y', '-v', 'error', ...input,
    '-vf', 'palettegen=reserve_transparent=1:stats_mode=full', palette])
  const encoded = path.join(dir, 'encoded.gif')
  await run('ffmpeg', ['-y', '-v', 'error', ...input, '-i', palette,
    '-lavfi', 'paletteuse=dither=none:alpha_threshold=128', '-loop', '0', encoded])
  const gif = await fs.readFile(encoded)
  const delays = frames.map(({ durationMs }) => Math.round(durationMs / 10))
  await fs.writeFile(out, withFrameDelays({ gif, delays }))
}

const withFrameDelays = ({ gif, delays }) => {
  const patched = Buffer.from(gif)
  const offsets = frameDelayOffsets(patched)
  if (offsets.length !== delays.length) throw new Error(`GIF has ${offsets.length} frames, expected ${delays.length}`)
  offsets.forEach((offset, index) => patched.writeUInt16LE(delays[index], offset))
  return patched
}

const frameDelayOffsets = (gif) => {
  const offsets = []
  let position = 13 + colourTableSize(gif[10])
  while (gif[position] !== 0x3b) {
    if (gif[position] === 0x21) {
      if (gif[position + 1] === 0xf9) offsets.push(position + 4)
      position = afterSubBlocks(gif, position + 2)
    } else if (gif[position] === 0x2c) {
      position = afterSubBlocks(gif, position + 10 + colourTableSize(gif[position + 9]) + 1)
    } else {
      throw new Error(`Unexpected GIF block 0x${gif[position].toString(16)} at ${position}`)
    }
  }
  return offsets
}

const colourTableSize = (packedFields) => (packedFields & 0x80 ? 3 * 2 ** ((packedFields & 0x07) + 1) : 0)

const afterSubBlocks = (gif, start) => {
  let position = start
  while (gif[position] !== 0) position += gif[position] + 1
  return position + 1
}

const framePath = (dir, index) => path.join(dir, `frame-${String(index).padStart(4, '0')}.png`)

const run = promisify(execFile)

await main()
