import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { spawn, execFileSync } from 'node:child_process'

const { values } = parseArgs({
  options: {
    mp4: { type: 'string' },
    out: { type: 'string' }
  }
})

const FPS = 60
const NEAR_RADIUS = 6
const SEARCH_RADIUS = 56
const OPAQUE_ALPHA = 200
const MATCHED_ERROR = 20
const JUMP_RATIO = 1.8
const JUMP_FLOOR = 4
const MOVING_STEP = 1
const CHANGED_LEVEL = 10
const CHANGED_PIXELS = 12
const CURSOR_MARGIN = 6
const RUN_GAP_FRAMES = 3
const RUN_MIN_FRAMES = 15

const main = async () => {
  const out = path.resolve(values.out)
  const mp4 = path.resolve(values.mp4)
  const timeline = JSON.parse(await fs.readFile(path.join(out, 'timeline.json'), 'utf8'))
  const video = probe(mp4)
  const scale = video.width / timeline.viewportWidth
  const templates = await Promise.all(['arrow', 'hand'].map(name => loadTemplate({ out, name, hotspot: timeline.cursorHotspots[name] })))
  const start = timeline.frames[0].time
  const length = (timeline.recordingEnd - start) / 1000
  const measured = []
  const changed = []
  let previous = null
  await eachFrame({ mp4, video, onFrame: (pixels, index) => {
    const expected = expectedAt({ timeline, start, index, scale })
    const found = expected && locateCursor({ pixels, video, templates, expected })
    measured.push({ index, expected, found })
    if (previous) changed.push(backgroundChanged({ pixels, previous, video, boxes: cursorBoxes(measured.slice(-2), templates) }))
    previous = pixels
  } })
  const timing = frameCountReport({ count: measured.length, length })
  const cursor = cursorReport(measured)
  const background = backgroundReport(changed)
  const capture = captureReport(timeline.frames)
  printReport({ mp4, timing, cursor, background, capture })
  if (cursor.holds.length > 0 || cursor.jumps.length > 0) process.exit(1)
}

const frameCountReport = ({ count, length }) => ({ count, expected: Math.round(length * FPS) })

const cursorReport = (measured) => {
  const steps = measured.slice(1).map((frame, offset) => {
    const before = measured[offset]
    if (!frame.found || !before.found) return null
    return {
      index: frame.index,
      step: Math.hypot(frame.found.x - before.found.x, frame.found.y - before.found.y),
      expectedStep: Math.max(Math.abs(frame.expected.x - before.expected.x), Math.abs(frame.expected.y - before.expected.y))
    }
  })
  const moving = steps.filter(step => step && step.expectedStep >= MOVING_STEP)
  const holds = moving.filter(step => step.step === 0)
  const jumps = steps.filter((step, offset) => {
    const before = steps[offset - 1]
    const after = steps[offset + 1]
    if (!step || !before || !after) return false
    const neighbourMean = (before.step + after.step) / 2
    return step.step >= JUMP_FLOOR && step.step > neighbourMean * JUMP_RATIO
  })
  const lost = measured.filter(frame => frame.expected && !frame.found).length
  return { movingFrames: moving.length, holds, jumps, lost }
}

const backgroundReport = (changed) => {
  const runs = []
  let run = null
  changed.forEach((isChanged, index) => {
    if (!isChanged) return
    if (run && index - run.last <= RUN_GAP_FRAMES + 1) {
      run.last = index
      run.changes += 1
      return
    }
    run = { first: index, last: index, changes: 1 }
    runs.push(run)
  })
  const animated = runs.filter(entry => entry.last - entry.first + 1 >= RUN_MIN_FRAMES)
  const framesIn = animated.reduce((sum, entry) => sum + entry.last - entry.first + 1, 0)
  const changesIn = animated.reduce((sum, entry) => sum + entry.changes, 0)
  const rates = animated.map(entry => ({ at: (entry.first + 1) / FPS, seconds: (entry.last - entry.first + 1) / FPS, fps: (entry.changes * FPS) / (entry.last - entry.first + 1) }))
  return { runs: rates, fps: framesIn ? (changesIn * FPS) / framesIn : 0 }
}

const captureReport = (frames) => {
  const gaps = frames.slice(1).map((frame, index) => frame.time - frames[index].time)
  const busy = gaps.filter(gap => gap < 50)
  const meanBusy = busy.reduce((sum, gap) => sum + gap, 0) / Math.max(1, busy.length)
  return { frames: frames.length, busyFps: 1000 / meanBusy }
}

const printReport = ({ mp4, timing, cursor, background, capture }) => {
  const at = (index) => `${index} (${(index / FPS).toFixed(2)} s)`
  console.log(mp4)
  console.log(`Frames ${timing.count}, duration x ${FPS} = ${timing.expected}${timing.count === timing.expected ? '' : ` (off by ${timing.count - timing.expected})`}`)
  console.log(`Capture ${capture.frames} frames, ${capture.busyFps.toFixed(1)} fps while the page paints`)
  console.log(`Cursor moving in ${cursor.movingFrames} frames: ${cursor.holds.length} holds, ${cursor.jumps.length} jumps, ${cursor.lost} frames not found`)
  cursor.holds.slice(0, 10).forEach(step => console.log(`  hold at frame ${at(step.index)}, expected step ${step.expectedStep.toFixed(1)} px`))
  cursor.jumps.slice(0, 10).forEach(step => console.log(`  jump at frame ${at(step.index)}, step ${step.step.toFixed(1)} px`))
  console.log(`Background ${background.fps.toFixed(1)} distinct fps during ${background.runs.length} UI animations`)
  background.runs.forEach(run => console.log(`  ${run.at.toFixed(2)} s for ${run.seconds.toFixed(2)} s: ${run.fps.toFixed(1)} fps`))
}

const probe = (mp4) => {
  const [width, height] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).trim().split(',').map(Number)
  return { width, height }
}

const loadTemplate = async ({ out, name, hotspot }) => {
  const file = path.join(out, `cursor-${name}.png`)
  const { width, height } = probe(file)
  const rgba = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 * 1024 * 1024 })
  const points = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (rgba[offset + 3] < OPAQUE_ALPHA) continue
      const gray = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]
      points.push({ x: x - hotspot.x, y: y - hotspot.y, gray })
    }
  }
  return { name, width, height, hotspot, points }
}

const eachFrame = ({ mp4, video, onFrame }) => new Promise((resolve, reject) => {
  const size = video.width * video.height
  const decoder = spawn('ffmpeg', ['-v', 'error', '-i', mp4, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  let pending = Buffer.alloc(0)
  let index = 0
  decoder.stdout.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= size) {
      onFrame(Uint8Array.from(pending.subarray(0, size)), index++)
      pending = pending.subarray(size)
    }
  })
  decoder.on('error', reject)
  decoder.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
})

const expectedAt = ({ timeline, start, index, scale }) => {
  const position = positionAt({ log: timeline.pointerLog, time: start + (index * 1000) / FPS })
  if (!position) return null
  return { x: position.x * scale, y: position.y * scale }
}

const positionAt = ({ log, time }) => {
  if (log.length === 0 || time < log[0].time) return null
  const index = log.findIndex(entry => entry.time > time)
  if (index === -1) return log.at(-1)
  const before = log[index - 1]
  const after = log[index]
  const share = (time - before.time) / Math.max(1, after.time - before.time)
  return { x: before.x + (after.x - before.x) * share, y: before.y + (after.y - before.y) * share }
}

const locateCursor = ({ pixels, video, templates, expected }) => {
  const centre = { x: Math.round(expected.x), y: Math.round(expected.y) }
  return bestMatch({ pixels, video, templates, centre, radius: NEAR_RADIUS }) ?? bestMatch({ pixels, video, templates, centre, radius: SEARCH_RADIUS })
}

const bestMatch = ({ pixels, video, templates, centre, radius }) => {
  let best = null
  for (const template of templates) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = centre.x + dx
        const y = centre.y + dy
        const error = matchError({ pixels, video, template, x, y, limit: best?.error ?? Infinity })
        if (error < (best?.error ?? Infinity)) best = { x, y, error, shape: template.name }
      }
    }
  }
  if (!best) return null
  const meanError = best.error / templates.find(template => template.name === best.shape).points.length
  return meanError < MATCHED_ERROR ? best : null
}

const matchError = ({ pixels, video, template, x, y, limit }) => {
  let error = 0
  for (const point of template.points) {
    const px = x + point.x
    const py = y + point.y
    if (px < 0 || py < 0 || px >= video.width || py >= video.height) return Infinity
    error += Math.abs(pixels[Math.round(py) * video.width + Math.round(px)] - point.gray)
    if (error >= limit) return Infinity
  }
  return error
}

const cursorBoxes = (frames, templates) => frames.filter(frame => frame.found).map(({ found }) => {
  const template = templates.find(entry => entry.name === found.shape)
  return {
    left: Math.floor(found.x - template.hotspot.x - CURSOR_MARGIN),
    top: Math.floor(found.y - template.hotspot.y - CURSOR_MARGIN),
    right: Math.ceil(found.x - template.hotspot.x + template.width + CURSOR_MARGIN),
    bottom: Math.ceil(found.y - template.hotspot.y + template.height + CURSOR_MARGIN)
  }
})

const backgroundChanged = ({ pixels, previous, video, boxes }) => {
  const isUnderCursor = (x, y) => boxes.some(box => x >= box.left && x < box.right && y >= box.top && y < box.bottom)
  let count = 0
  for (let y = 0; y < video.height; y += 2) {
    for (let x = 0; x < video.width; x += 2) {
      const offset = y * video.width + x
      if (Math.abs(pixels[offset] - previous[offset]) < CHANGED_LEVEL) continue
      if (isUnderCursor(x, y)) continue
      count += 1
      if (count >= CHANGED_PIXELS) return true
    }
  }
  return false
}

await main()
