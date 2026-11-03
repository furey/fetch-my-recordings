import fs from 'node:fs/promises'
import path from 'node:path'
import { readJsonFile } from './json-file.js'

export const createSettings = (folder, { log } = {}) => {
  const filePath = path.join(folder, 'settings.json')
  let cache = null

  const read = async () => {
    if (cache) return cache
    cache = await readJsonFile({ filePath, fallback: () => ({}), log })
    return cache
  }

  const update = async (changes) => {
    cache = { ...(await read()), ...changes }
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(cache, null, 2))
    return cache
  }

  return { read, update }
}
