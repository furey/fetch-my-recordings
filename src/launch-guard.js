import fs from 'node:fs'
import path from 'node:path'

export const MAX_GPU_RUNG = 2

export const createLaunchGuard = (folder) => {
  const pendingPath = path.join(folder, 'launch-pending.json')
  const fallbackPath = path.join(folder, 'gpu-fallback.json')

  const begin = () => {
    const failedStarts = readJson(pendingPath)?.attempts ?? 0
    const keptRung = readJson(fallbackPath)?.rung ?? 0
    const rung = Math.min(MAX_GPU_RUNG, Math.max(keptRung, failedStarts))
    writeJson(pendingPath, { attempts: failedStarts + 1, rung })
    return { failedStarts, keptRung, rung }
  }

  const keepRung = (rung) => {
    const keptRung = readJson(fallbackPath)?.rung ?? 0
    writeJson(fallbackPath, { rung: Math.min(MAX_GPU_RUNG, Math.max(keptRung, rung)) })
  }

  const succeed = (rung) => {
    fs.rmSync(pendingPath, { force: true })
    if (rung > 0) keepRung(rung)
  }

  return { begin, keepRung, succeed }
}

export const describeRung = (rung) => [
  'normal graphics',
  'hardware acceleration off, GPU sandbox off',
  'hardware acceleration off, GPU sandbox off, GPU in the main process'
][rung]

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

const writeJson = (filePath, value) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(value))
  } catch {
    return false
  }
  return true
}
