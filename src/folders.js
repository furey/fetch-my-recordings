import fs from 'node:fs/promises'
import path from 'node:path'
import { planSaves } from 'fetchtv'

export const describeFolder = async ({ folder, recordings, forPlex = false, copyAgain = false }) => {
  const existing = await nearestExistingFolder(folder)
  const [freeBytes, canWrite, plans] = await Promise.all([
    freeSpaceAt(existing),
    isWritable(existing),
    planSaves({ recordings, savePath: folder, forPlex, copyAgain })
  ])
  const alreadySaved = plans.filter(plan => plan.alreadySaved)
  const toSave = plans.filter(plan => !plan.alreadySaved).map(plan => plan.item)
  return {
    folder,
    exists: existing === path.resolve(folder),
    freeBytes,
    canWrite,
    alreadySavedCount: alreadySaved.length,
    neededBytes: sumSizes(toSave),
    toSaveCount: toSave.length
  }
}

const nearestExistingFolder = async (folder) => {
  let current = path.resolve(folder)
  while (true) {
    const stats = await fs.stat(current).catch(() => null)
    if (stats?.isDirectory()) return current
    const parent = path.dirname(current)
    if (parent === current) return current
    current = parent
  }
}

const freeSpaceAt = async (folder) => {
  const stats = await fs.statfs(folder).catch(() => null)
  return stats ? Number(stats.bavail) * Number(stats.bsize) : null
}

const isWritable = (folder) => fs.access(folder, fs.constants.W_OK).then(() => true, () => false)

const sumSizes = (items) => items.reduce((total, item) => total + (item.size > 0 ? item.size : 0), 0)
