import fs from 'node:fs/promises'
import path from 'node:path'

export const readJsonFile = async ({ filePath, fallback, log = () => {} }) => {
  const text = await fs.readFile(filePath, 'utf8').catch(() => null)
  if (text === null) return fallback()
  const parsed = parseJson(text.replace(/^\uFEFF/, ''))
  if (isPlainObject(parsed)) return parsed
  const keptPath = await keepBadFile(filePath)
  log(`Could not read ${path.basename(filePath)}; started from defaults${keptPath ? ` and kept the old file as ${path.basename(keptPath)}` : ''}.`)
  return fallback()
}

const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const keepBadFile = async (filePath) => {
  const keptPath = filePath.replace(/\.json$/, '.bad.json')
  return fs.rename(filePath, keptPath).then(() => keptPath, () => null)
}
