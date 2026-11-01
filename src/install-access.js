import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ALL_APPLICATION_PACKAGES_READ = '*S-1-15-2-1:(OI)(CI)(RX)'

export const grantSandboxReadAccess = ({ folder, markerPath, version, force }) => {
  if (!force && alreadyGranted({ markerPath, folder, version })) return { skipped: true }
  try {
    execFileSync(icaclsPath(), [folder, '/grant', ALL_APPLICATION_PACKAGES_READ], {
      stdio: 'ignore',
      timeout: 10000,
      windowsHide: true
    })
  } catch (error) {
    return { ok: false, error: error.message }
  }
  rememberGrant({ markerPath, folder, version })
  return { ok: true }
}

const rememberGrant = ({ markerPath, folder, version }) => {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, JSON.stringify({ folder, version }))
  } catch {
    return false
  }
  return true
}

const alreadyGranted = ({ markerPath, folder, version }) => {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    return marker.folder === folder && marker.version === version
  } catch {
    return false
  }
}

const icaclsPath = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe')
