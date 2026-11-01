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
const VISIBLE_WITHIN_MS = 12000

let tmpRoot = null

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fmr-startup-'))
})

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

test('startup fault renderer-crash: shows the window and a Reload dialog, then reloads', async () => {
  const userData = await freshDir('renderer-crash')
  const app = await launchWatched({ userData, fault: 'renderer-crash' })
  try {
    await waitForLog({ userData, text: 'The window contents stopped' })
    await waitForLog({ userData, text: 'Dialog shown: The Fetch My Recordings window stopped working.' })
    await waitForLog({ userData, text: 'Reloading the window.' })
    await waitForVisibleWindow(app)
    await waitForLog({ userData, text: 'Window shown.' })
    const log = await readLog(userData)
    assert.ok(log.indexOf('The window contents stopped') < log.indexOf('Window shown'), log)
  } finally {
    await app.close()
  }
  await assertNextLaunchShowsWindow(userData)
})

test('startup fault renderer-crash: choosing Quit in the dialog exits with the reason logged', async () => {
  const userData = await freshDir('renderer-crash-quit')
  const { code } = await runUntilExit({ userData, fault: 'renderer-crash', dialogAnswer: '1' })
  assert.equal(code, 0)
  const log = await readLog(userData)
  assert.match(log, /The window contents stopped/)
  assert.match(log, /Dialog answer: Quit\./)
  await assertNextLaunchShowsWindow(userData)
})

test('startup fault no-ready: shows the window after 10 s, and the next start uses the GPU fallback', async () => {
  const userData = await freshDir('no-ready')
  const app = await launchWatched({ userData, fault: 'no-ready' })
  try {
    await waitForVisibleWindow(app)
    await waitForLog({ userData, text: 'Showed it anyway.' })
  } finally {
    await app.close()
  }
  await assertNextLaunchShowsWindow(userData)
  assert.match(await readLog(userData), /Using GPU fallback rung 1 .*after a failed start/)
})

test('startup fault gpu-crash: exits with the reason logged, and the next start keeps the GPU fallback', async () => {
  const userData = await freshDir('gpu-crash')
  const { code } = await runUntilExit({ userData, fault: 'gpu-crash' })
  assert.equal(code, 0)
  const log = await readLog(userData)
  assert.match(log, /The GPU process stopped/)
  assert.match(log, /Restarting with GPU fallback rung 1/)
  await assertNextLaunchShowsWindow(userData)
  assert.match(await readLog(userData), /Using GPU fallback rung 1 .*kept from an earlier start/)
  await assertNextLaunchShowsWindow(userData)
  assert.match(await readLog(userData), /Window shown with GPU fallback rung 1\.[^]*Window shown with GPU fallback rung 1\./)
})

test('startup fault main-throw: exits with code 1 and the error in main.log', async () => {
  const userData = await freshDir('main-throw')
  const { code } = await runUntilExit({ userData, fault: 'main-throw' })
  assert.equal(code, 1)
  const log = await readLog(userData)
  assert.match(log, /Fatal error \(start\): Error: Test fault: main-throw/)
  assert.match(log, /Error box: Fetch My Recordings has to close/)
  await assertNextLaunchShowsWindow(userData)
})

test('second start: a hidden or minimised window comes back, and the second copy quits', async () => {
  const userData = await freshDir('second-instance')
  const app = await launchWatched({ userData })
  try {
    await waitForVisibleWindow(app)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    const { code } = await runUntilExit({ userData })
    assert.equal(code, 0)
    await waitForLog({ userData, text: 'Another start asked for the window.' })
    await waitForVisibleWindow(app)
  } finally {
    await app.close()
  }
})

test('the Help menu opens the log folder', async () => {
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
    await app.close()
  }
})

test('windows ACL repro (electron#51761): an orphaned capability SID on the app folder still ends in a window', { skip: !aclRepro && 'FMR_E2E_ACL_REPRO is not set' }, async () => {
  const userData = await freshDir('acl-repro')
  const outcomes = []
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const outcome = await launchUntilWindowOrExit(userData)
    outcomes.push(outcome)
    if (outcome === 'window') break
  }
  const log = await readLog(userData)
  assert.equal(outcomes.at(-1), 'window', `Outcomes: ${outcomes.join(', ')}\n${log}`)
  console.log(`ACL repro outcomes: ${outcomes.join(', ')}`)
})

const assertNextLaunchShowsWindow = async (userData) => {
  const app = await launchWatched({ userData })
  try {
    await waitForVisibleWindow(app)
  } finally {
    await app.close()
  }
}

const launchUntilWindowOrExit = async (userData) => {
  const child = spawnApp({ userData })
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

const spawnApp = ({ userData, fault = '', dialogAnswer = '0' }) => {
  const env = { ...testEnv({ userData, fault }), FMR_TEST_DIALOG_ANSWER: dialogAnswer }
  return packagedExecutable
    ? spawn(packagedExecutable, [], { env, stdio: 'ignore' })
    : spawn(electronBinary, [appRoot], { cwd: appRoot, env, stdio: 'ignore' })
}

const runUntilExit = async ({ userData, fault = '', dialogAnswer }) => {
  const child = spawnApp({ userData, fault, dialogAnswer })
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), VISIBLE_WITHIN_MS))
  const result = await Promise.race([exit, timeout])
  if (result) return result
  await stopChild(child)
  throw new Error(`The app did not exit within ${VISIBLE_WITHIN_MS} ms.\n${await readLog(userData)}`)
}

const stopChild = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill()
  await exited
}

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

const readLog = (userData) => fs.readFile(path.join(userData, 'logs', 'main.log'), 'utf8').catch(() => '')

const logLength = async (userData) => (await readLog(userData)).length

const freshDir = async (name) => fs.mkdtemp(path.join(tmpRoot, `${name}-`))

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
