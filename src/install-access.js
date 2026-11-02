import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ALL_APPLICATION_PACKAGES_READ = '*S-1-15-2-1:(OI)(CI)(RX)'
const ACCESS_CHECK_FAILURE = 'Sandboxed processes cannot read'

export const previousStartFailedAccessCheck = ({ chromiumLogFile, pid }) => {
  if (!pid) return false
  const linePrefix = `[${pid}:`
  return readText(chromiumLogFile)
    .split('\n')
    .some(line => line.startsWith(linePrefix) && line.includes(ACCESS_CHECK_FAILURE))
}

export const createInstallAccessRecord = ({ folder, electronVersion }) => {
  const recordPath = path.join(folder, 'install-access.json')
  const alreadyRepaired = () => readJson(recordPath)?.electron === electronVersion
  const markRepaired = () => writeJson(recordPath, { electron: electronVersion, repairedAt: new Date().toISOString() })
  return { alreadyRepaired, markRepaired }
}

export const grantSandboxReadAccess = (folder) => {
  try {
    execFileSync(icaclsPath(), [folder, '/grant', ALL_APPLICATION_PACKAGES_READ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 10000,
      windowsHide: true
    })
  } catch (error) {
    return { ok: false, error: String(error.stderr ?? '').trim() || error.message }
  }
  return { ok: true }
}

const icaclsPath = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe')

const readText = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

const readJson = (filePath) => {
  try {
    return JSON.parse(readText(filePath))
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
