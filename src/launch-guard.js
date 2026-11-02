import fs from 'node:fs'
import path from 'node:path'

export const createLaunchGuard = ({ folder, maxRung, electronVersion }) => {
  const pendingPath = path.join(folder, 'launch-pending.json')
  const fallbackPath = path.join(folder, 'gpu-fallback.json')

  const keptRung = () => {
    const kept = readJson(fallbackPath)
    return kept?.electron === electronVersion ? kept.rung ?? 0 : 0
  }

  const begin = (pid) => {
    const pending = readJson(pendingPath)
    const survived = pending?.electron === electronVersion
    const failedStarts = survived ? (pending.failedStarts ?? 0) + 1 : 0
    const rung = Math.min(maxRung, keptRung())
    writeJson(pendingPath, { rung, failedStarts, electron: electronVersion, pid, startedAt: new Date().toISOString() })
    return { rung, failedStarts, atLastRung: rung === maxRung, previousPid: survived ? pending.pid ?? null : null }
  }

  const keepRung = (rung) => writeJson(fallbackPath, { rung: Math.min(maxRung, rung), electron: electronVersion })

  const clearPending = () => fs.rmSync(pendingPath, { force: true })

  const succeed = (rung) => {
    clearPending()
    if (rung !== keptRung()) keepRung(rung)
  }

  return { begin, keepRung, clearPending, succeed }
}

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
