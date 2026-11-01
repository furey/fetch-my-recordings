import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ALL_APPLICATION_PACKAGES_READ = '*S-1-15-2-1:(OI)(CI)(RX)'

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
