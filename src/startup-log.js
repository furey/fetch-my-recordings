import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_BYTES = 512 * 1024

export const createStartupLog = (folder) => {
  const filePath = path.join(folder, 'main.log')
  const previousPath = path.join(folder, 'main.old.log')

  const write = (message) => {
    try {
      fs.mkdirSync(folder, { recursive: true })
      if (sizeOf(filePath) > MAX_LOG_BYTES) fs.renameSync(filePath, previousPath)
      fs.appendFileSync(filePath, `${new Date().toISOString()} [${process.pid}] ${message}\n`)
    } catch {
      return false
    }
    return true
  }

  return { folder, filePath, write }
}

export const describeError = (error) => error instanceof Error
  ? error.stack ?? `${error.name}: ${error.message}`
  : String(error)

const sizeOf = (filePath) => {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}
