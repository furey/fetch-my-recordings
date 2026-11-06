import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronBinary from 'electron'
import { _electron as electron } from 'playwright-core'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagedExecutable = process.env.FETCHTV_E2E_EXECUTABLE
const aclRepro = Boolean(process.env.FMR_E2E_ACL_REPRO)
const expectAclCrash = Boolean(process.env.FMR_E2E_ACL_EXPECT_CRASH)
const ACCESS_CHECK_EXIT_CODE = 0x80000003
const VISIBLE_WITHIN_MS = 30000
const EXIT_WITHIN_MS = 30000
const TEST_TIMEOUT_MS = 180000
const STOP_WITHIN_MS = 5000

let tmpRoot = null

const startupTest = (name, ...rest) => {
  const [options, fn] = rest.length === 2 ? rest : [{}, rest[0]]
  return test(name, { timeout: TEST_TIMEOUT_MS, ...options }, fn)
}

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fmr-startup-'))
})

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
})

startupTest('startup fault renderer-crash: shows the window and a Reload dialog, then reloads, and leaves the graphics fallback at 0', async () => {
  const userData = await freshDir('renderer-crash')
  const app = await launchWatched({ userData, fault: 'renderer-crash' })
  try {
    await waitForLog({ userData, text: 'The window contents stopped' })
    await waitForLog({ userData, text: 'Dialog shown: The Fetch My Recordings window stopped working.' })
    await waitForLog({ userData, text: 'Reloading the window.' })
    await waitForVisibleWindow(app)
  } finally {
    await closeApp(app)
  }
  assert.equal(await keptRung(userData), 0)
  await assertNextLaunchShowsWindow(userData)
  assert.doesNotMatch(await readLog(userData), /Using graphics fallback/)
})

startupTest('startup fault renderer-crash: choosing Quit exits with the reason logged and does not count as a failed start', async () => {
  const userData = await freshDir('renderer-crash-quit')
  const { code } = await runUntilExit({ userData, fault: 'renderer-crash', extraEnv: { FMR_TEST_DIALOG_ANSWER: '1' } })
  assert.equal(code, 0, await exitDetails({ code, userData }))
  const log = await readLog(userData)
  assert.match(log, /The window contents stopped/)
  assert.match(log, /Dialog answer: Quit\./)
  assert.match(log, /Quit before the window showed\. This start does not count as failed\./)
  assert.equal(await keptRung(userData), 0)
  assert.equal(await pendingExists(userData), false)
  await assertNextLaunchShowsWindow(userData)
  assert.doesNotMatch(await readLog(userData), /closed before the window showed|Using graphics fallback/)
})

startupTest('startup fault no-ready: shows the window after 10 s and raises the graphics fallback once', async () => {
  const userData = await freshDir('no-ready')
  const app = await launchWatched({ userData, fault: 'no-ready' })
  try {
    await waitForVisibleWindow(app)
    await waitForLog({ userData, text: 'Showed it anyway.' })
    await waitForLog({ userData, text: 'The next start uses graphics fallback 1' })
  } finally {
    await closeApp(app)
  }
  assert.equal(await keptRung(userData), 1)
  assert.equal(await pendingExists(userData), false)
  await assertNextLaunchShowsWindow(userData)
  assert.match(await readLog(userData), /Using graphics fallback 1 \(hardware acceleration off\), kept from an earlier start\./)
  assert.match(await readLog(userData), /Window shown with graphics fallback 1\./)
  assert.equal(await keptRung(userData), 1)
})

startupTest('startup fault gpu-crash: before the window shows, exits with the reason logged and the next start uses the next fallback', async () => {
  const userData = await freshDir('gpu-crash')
  const { code } = await runUntilExit({ userData, fault: 'gpu-crash' })
  assert.equal(code, 0, await exitDetails({ code, userData }))
  const log = await readLog(userData)
  assert.match(log, /The GPU process stopped/)
  assert.match(log, /The next start uses graphics fallback 1/)
  assert.match(log, /Restarting the app\./)
  assert.equal(await keptRung(userData), 1)
  await assertNextLaunchShowsWindow(userData)
  await assertNextLaunchShowsWindow(userData)
  assert.match(await readLog(userData), /Window shown with graphics fallback 1\.[^]*Window shown with graphics fallback 1\./)
})

startupTest('startup fault main-throw: exits with code 1, the error in main.log, and the graphics fallback left at 0', async () => {
  const userData = await freshDir('main-throw')
  const { code } = await runUntilExit({ userData, fault: 'main-throw' })
  assert.equal(code, 1, await exitDetails({ code, userData }))
  const log = await readLog(userData)
  assert.match(log, /Fatal error \(start\): Error: Test fault: main-throw/)
  assert.match(log, /Error box: Fetch My Recordings has to close/)
  assert.equal(await keptRung(userData), 0)
  assert.equal(await pendingExists(userData), false)
  await assertNextLaunchShowsWindow(userData)
  assert.doesNotMatch(await readLog(userData), /Using graphics fallback/)
})

startupTest('startup fault no-window: the watchdog shows an error box and exits, and the next start says so', async () => {
  const userData = await freshDir('watchdog')
  const { code } = await runUntilExit({ userData, fault: 'no-window', extraEnv: { FMR_TEST_WATCHDOG_MS: '3000' } })
  assert.equal(code, 1, await exitDetails({ code, userData }))
  const log = await readLog(userData)
  assert.match(log, /No window after 3 s\./)
  assert.match(log, /Error box: Fetch My Recordings did not open/)
  assert.equal(await keptRung(userData), 0)
  await assertNextLaunchShowsWindow(userData)
  assert.match(await readLog(userData), /The last 1 start\(s\) closed before the window showed\./)
})

startupTest('repeated failed starts show an error box before the window, and still open the window', async () => {
  const userData = await freshDir('repeated-failures')
  await fs.writeFile(path.join(userData, 'launch-pending.json'), JSON.stringify({ rung: 0, failedStarts: 1, electron: await electronVersion() }))
  await assertNextLaunchShowsWindow(userData)
  const log = await readLog(userData)
  assert.match(log, /The last 2 start\(s\) closed before the window showed\./)
  assert.match(log, /Error box: Fetch My Recordings could not open its window/)
  assert.equal(await keptRung(userData), 0)
})

startupTest('a kept graphics fallback from another Electron version is ignored', async () => {
  const userData = await freshDir('electron-update')
  await fs.writeFile(path.join(userData, 'gpu-fallback.json'), JSON.stringify({ rung: 2, electron: '1.0.0' }))
  await assertNextLaunchShowsWindow(userData)
  assert.doesNotMatch(await readLog(userData), /Using graphics fallback/)
  assert.equal(await keptRung(userData), 0)
})

startupTest('second start: a hidden window comes back, and the second copy quits', async () => {
  const userData = await freshDir('second-instance')
  const app = await launchWatched({ userData })
  try {
    await waitForVisibleWindow(app)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    const { code } = await runUntilExit({ userData })
    assert.equal(code, 0, await exitDetails({ code, userData }))
    await waitForLog({ userData, text: 'Another start asked for the window.' })
    await waitForVisibleWindow(app)
  } finally {
    await closeApp(app)
  }
})

startupTest('the Help menu opens the log folder', async () => {
  const userData = await freshDir('help-menu')
  const app = await launchWatched({ userData })
  try {
    await waitForVisibleWindow(app)
    const opened = await app.evaluate(async ({ Menu, shell }) => {
      const calls = []
      shell.openPath = async (target) => { calls.push(target); return '' }
      const help = Menu.getApplicationMenu().items.find(item => item.role === 'help')
      help.submenu.items.find(item => item.label === 'Open log folder').click()
      return calls
    })
    assert.deepEqual(opened, [path.join(userData, 'logs')])
  } finally {
    await closeApp(app)
  }
})

startupTest('the log writes the home folder as ~', async () => {
  const userData = await freshDir('home-in-log')
  const { code } = await runUntilExit({ userData, fault: 'main-throw' })
  assert.equal(code, 1, await exitDetails({ code, userData }))
  const log = await readLog(userData)
  assert.match(log, /Test fault: main-throw/)
  assert.equal(log.includes(os.homedir()), false, log)
  if (appRoot.startsWith(os.homedir())) assert.match(log, /~[\\/]/)
})

startupTest('windows ACL repro (electron#51761): an orphaned package SID on the app folder still ends in a window', { timeout: 180000, skip: !aclRepro && 'FMR_E2E_ACL_REPRO is not set' }, async () => {
  if (expectAclCrash) await assertAclCrashWithoutGrant()
  const userData = await freshDir('acl-repro')
  const outcomes = await launchUntilWindow({ userData, attempts: 3 })
  const log = await readLog(userData)
  console.log(`ACL repro with the repair: ${outcomes.map((outcome, index) => `attempt ${index + 1} ${outcome}`).join(', ')}.`)
  console.log(log)
  assert.equal(outcomes.at(-1), 'window', `${outcomes.join(', ')}\n${log}`)
  assert.match(log, /Checking install folder access…/)
  if (!expectAclCrash) return
  assert.equal(outcomes[0], `exit ${ACCESS_CHECK_EXIT_CODE}`, log)
  assert.match(log, /The last start closed because sandboxed processes could not read the install folder\.[^]*Gave sandboxed processes read access to the install folder/)
})

const assertAclCrashWithoutGrant = async () => {
  const userData = await freshDir('acl-repro-no-grant')
  const extraEnv = { FMR_TEST_SKIP_INSTALL_ACCESS: '1' }
  const outcomes = [await launchUntilWindowOrExit({ userData, extraEnv }), await launchUntilWindowOrExit({ userData, extraEnv })]
  const chromiumLog = await fs.readFile(path.join(userData, 'logs', 'chromium.log'), 'utf8').catch(() => '(no chromium.log)')
  const fatalLine = chromiumLog.split('\n').find(line => line.includes('install_dir_access')) ?? '(no install_dir_access line)'
  const log = await readLog(userData)
  console.log(`ACL repro without the grant: ${outcomes.join(', ')}. ${fatalLine}`)
  assert.deepEqual(outcomes, [`exit ${ACCESS_CHECK_EXIT_CODE}`, `exit ${ACCESS_CHECK_EXIT_CODE}`], `${log}\n${chromiumLog}`)
  assert.match(fatalLine, /Sandboxed processes cannot read/)
  assert.match(log, /Test switch: skipped the install folder access grant\./)
}

const launchUntilWindow = async ({ userData, attempts }) => {
  const outcomes = []
  while (outcomes.length < attempts && outcomes.at(-1) !== 'window') outcomes.push(await launchUntilWindowOrExit({ userData }))
  return outcomes
}

const closeApp = async (app) => {
  const child = app.process()
  const closed = await Promise.race([app.close().then(() => true, () => false), delay(STOP_WITHIN_MS).then(() => false)])
  if (!closed) await stopChild(child)
}

const assertNextLaunchShowsWindow = async (userData) => {
  const app = await launchWatched({ userData })
  try {
    await waitForVisibleWindow(app)
  } finally {
    await closeApp(app)
  }
}

const launchUntilWindowOrExit = async ({ userData, extraEnv }) => {
  const child = spawnApp({ userData, extraEnv })
  const exited = new Promise(resolve => child.once('exit', code => resolve(`exit ${code}`)))
  const shown = waitForLog({ userData, text: 'Window shown', from: await logLength(userData) }).then(() => 'window', () => 'timeout')
  const outcome = await Promise.race([exited, shown])
  await stopChild(child)
  return outcome
}

const launchWatched = async ({ userData, fault = '' }) => {
  const env = testEnv({ userData, fault })
  return packagedExecutable
    ? electron.launch({ executablePath: packagedExecutable, env })
    : electron.launch({ args: [appRoot], cwd: appRoot, env })
}

const spawnApp = ({ userData, fault = '', extraEnv = {} }) => {
  const env = { ...testEnv({ userData, fault }), ...extraEnv }
  return packagedExecutable
    ? spawn(packagedExecutable, [], { env, stdio: 'ignore' })
    : spawn(electronBinary, [appRoot], { cwd: appRoot, env, stdio: 'ignore' })
}

const runUntilExit = async ({ userData, fault = '', extraEnv }) => {
  const child = spawnApp({ userData, fault, extraEnv })
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const result = await raceTimeout({ promise: exit, ms: EXIT_WITHIN_MS, timeoutValue: null })
  if (result) return result
  await stopChild(child)
  throw new Error(`The app did not exit within ${EXIT_WITHIN_MS} ms.\n${await readLog(userData)}\n${await chromiumLogTail(userData)}`)
}

const stopChild = async (child) => {
  if (hasExited(child)) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill()
  const stopped = await Promise.race([exited.then(() => true), delay(STOP_WITHIN_MS).then(() => false)])
  if (stopped || hasExited(child)) return
  child.kill('SIGKILL')
  await exited
}

const raceTimeout = async ({ promise, ms, timeoutValue }) => {
  let timer = null
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(timeoutValue), ms) })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const hasExited = (child) => child.exitCode !== null || child.signalCode !== null

const testEnv = ({ userData, fault }) => ({
  ...process.env,
  FMR_TEST: '1',
  FMR_FAULT: fault,
  FETCHTV_USER_DATA: userData,
  FETCHTV_DISCOVERY: 'off'
})

const waitForVisibleWindow = async (app) => {
  const deadline = Date.now() + VISIBLE_WITHIN_MS
  while (Date.now() < deadline) {
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible()))
    if (visible) return
    await delay(100)
  }
  throw new Error(`No visible window within ${VISIBLE_WITHIN_MS} ms`)
}

const waitForLog = async ({ userData, text, from = 0 }) => {
  const deadline = Date.now() + VISIBLE_WITHIN_MS
  while (Date.now() < deadline) {
    if ((await readLog(userData)).slice(from).includes(text)) return
    await delay(100)
  }
  throw new Error(`"${text}" not in main.log within ${VISIBLE_WITHIN_MS} ms:\n${await readLog(userData)}`)
}

const keptRung = async (userData) => {
  const kept = await readJson(path.join(userData, 'gpu-fallback.json'))
  return kept?.electron === await electronVersion() ? kept.rung : 0
}

const pendingExists = async (userData) => Boolean(await readJson(path.join(userData, 'launch-pending.json')))

const electronVersion = async () => (await readJson(path.join(appRoot, 'node_modules', 'electron', 'package.json'))).version

const readJson = (filePath) => fs.readFile(filePath, 'utf8').then(JSON.parse, () => null)

const readLog = (userData) => fs.readFile(path.join(userData, 'logs', 'main.log'), 'utf8').catch(() => '')

const exitDetails = async ({ code, userData }) => `Exit code ${code}.\n${await readLog(userData)}\n${await chromiumLogTail(userData)}`

const chromiumLogTail = async (userData, lines = 40) => {
  const log = await fs.readFile(path.join(userData, 'logs', 'chromium.log'), 'utf8').catch(() => '(no chromium.log)')
  return `chromium.log (last ${lines} lines):\n${log.trimEnd().split('\n').slice(-lines).join('\n')}`
}

const logLength = async (userData) => (await readLog(userData)).length

const freshDir = async (name) => fs.mkdtemp(path.join(tmpRoot, `${name}-`))

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
