import fs from 'node:fs/promises'
import { saveRecordings } from 'fetchtv'

export const startSave = ({ recordings, folder, forPlex, retryDelays, onProgress, onResult }) => {
  const controller = new AbortController()
  const done = runSave({ recordings, folder, forPlex, retryDelays, onProgress, onResult, signal: controller.signal })
  return { cancel: () => controller.abort(), done }
}

export const describeResult = (result) => ({
  id: String(result.item.id),
  status: result.status,
  reason: plainReason(result)
})

export const summariseResults = (described) => {
  const count = (statuses) => described.filter(result => statuses.includes(result.status)).length
  return {
    total: described.length,
    saved: count(['saved']),
    alreadySaved: count(['already_saved']),
    notSaved: count(NOT_SAVED_STATUSES),
    stopped: count(['cancelled'])
  }
}

const NOT_SAVED_STATUSES = ['failed', 'locked', 'still_recording']

export const plainReason = (result) => {
  const text = `${result.error ?? ''} ${result.warning ?? ''}`
  if (result.status === 'saved') return ''
  if (result.status === 'already_saved') return 'Already saved in this folder.'
  if (result.status === 'still_recording') return 'Still recording on the box. Save it after the recording ends.'
  if (result.status === 'locked') return 'Another save is using this recording right now.'
  if (result.status === 'cancelled') return result.warning?.includes('before') ? 'Not started.' : 'Stopped part way. Save again to carry on from where it stopped.'
  return failureReason(text)
}

const failureReason = (text) => {
  if (/ENOSPC/.test(text)) return 'The folder ran out of space.'
  if (/EACCES|EPERM|EROFS/.test(text)) return 'Could not write to this folder. Choose another folder.'
  if (/ENAMETOOLONG/.test(text)) return 'The file name is too long for this folder. Choose a folder with a shorter path, such as one at the top of a drive.'
  if (/EINVAL: [^,]*, (open|mkdir|rename|copyfile|unlink|stat|lstat|scandir|utime|chmod)\b|ENOTDIR|EISDIR/.test(text)) return 'This folder does not accept the file name. Choose another folder.'
  if (/rejected the resume/.test(text)) return 'The box would not carry on from where the copy stopped. Save again to start this recording again.'
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/.test(text)) return 'The box stopped answering. Check that it is turned on and connected, then save again.'
  if (/status code 4\d\d|status code 5\d\d/.test(text)) return 'The box would not send this recording.'
  if (/interrupted|mismatch|incomplete|Timeout|timeout|reset|Premature|empty file/.test(text)) return 'The copy stopped part way, even after trying again. Save again to carry on from where it stopped.'
  return 'The copy did not finish. Save again to try once more.'
}

const runSave = async ({ recordings, folder, forPlex, retryDelays, onProgress, onResult, signal }) => {
  await fs.mkdir(folder, { recursive: true })
  const described = []
  await saveRecordings({
    recordings,
    savePath: folder,
    forPlex,
    retryDelays,
    onProgress,
    onResult: (result) => {
      const entry = describeResult(result)
      if (NOT_SAVED_STATUSES.includes(entry.status)) logNotSaved(result)
      described.push(entry)
      onResult(entry)
    },
    signal
  })
  return { summary: summariseResults(described), results: described }
}

const logNotSaved = (result) => {
  const attempts = result.attempts ?? 1
  const detail = result.error ?? result.warning ?? 'no reason given'
  console.error(`Not saved: ${result.item.title} (${result.status} after ${attempts} attempts): ${detail}`)
}
