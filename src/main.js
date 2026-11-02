import { app, BrowserWindow, Menu, crashReporter, dialog, ipcMain, nativeTheme, powerMonitor, powerSaveBlocker, session, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { syncCleanupLockFiles } from 'fetchtv'
import { connectToAddress, describeBox, findBoxes, parseBoxAddress } from './boxes.js'
import { describeFolder } from './folders.js'
import { describeListing, listingProblemFor, listRecordings, pickEpisodes } from './recordings.js'
import { startSave } from './saving.js'
import { createSettings } from './settings.js'
import { createHistory, savedStates } from './history.js'
import { createStartupLog, describeError } from './startup-log.js'
import { createLaunchGuard } from './launch-guard.js'
import { createInstallAccessRecord, grantSandboxReadAccess, previousStartFailedAccessCheck } from './install-access.js'

const APP_REPOSITORY_URL = 'https://github.com/furey/fetch-my-recordings'
const FETCHTV_REPOSITORY_URL = 'https://github.com/furey/fetchtv'
const EXTERNAL_LINKS = {
  vlc: 'https://www.videolan.org/vlc/',
  freetvarr: 'https://furey.github.io/freetvarr/',
  mp4: 'https://furey.github.io/freetvarr/guide/leaving-fetch#converting-recordings-to-mp4',
  usb: 'https://github.com/furey/fetch-my-recordings#watch-on-your-tv-from-a-usb-drive'
}
const DISCUSSIONS_URL = 'https://github.com/furey/fetch-my-recordings/discussions'
const SHOW_FALLBACK_MS = 10000
const CHROMIUM_LOG_MAX_BYTES = 2 * 1024 * 1024
const FAULTS_WITHOUT_READY = new Set(['no-ready', 'gpu-crash', 'renderer-crash'])
const WATCHDOG_MS = 30000
const ERR_ABORTED = -3
const distDir = path.dirname(fileURLToPath(import.meta.url))
const rendererPage = path.join(distDir, 'renderer', 'index.html')
const rendererUrl = pathToFileURL(rendererPage).href

const state = {
  window: null,
  boxes: new Map(),
  shows: [],
  summaries: [],
  activeSave: null,
  savedFolder: null,
  closingAfterStop: false,
  log: null,
  launchGuard: null,
  gpuRung: 0,
  windowShown: false,
  startSettled: false,
  dialogQueue: Promise.resolve(),
  queuedDialogs: new Set(),
  quitting: false,
  failing: false
}

const GPU_FALLBACKS = [
  { name: 'normal graphics', apply: () => null },
  {
    name: 'hardware acceleration off',
    apply: () => {
      app.disableHardwareAcceleration()
    }
  },
  {
    name: 'hardware acceleration off, GPU sandbox off',
    apply: () => {
      app.disableHardwareAcceleration()
      app.commandLine.appendSwitch('disable-gpu-sandbox')
    }
  }
]

const main = () => {
  if (process.env.FETCHTV_USER_DATA) app.setPath('userData', process.env.FETCHTV_USER_DATA)
  state.log = createStartupLog(path.join(app.getPath('userData'), 'logs'))
  catchFatalErrors()
  if (!app.requestSingleInstanceLock()) {
    state.log.write('Another copy is already running. Asked it to show its window, then quit.')
    return app.quit()
  }
  crashReporter.start({ uploadToServer: false })
  state.log.write(`Starting version ${APP_VERSION} on ${process.platform} ${process.arch} (${os.release()}), Electron ${process.versions.electron}.`)
  const previousStart = beginLaunch()
  startWatchdog()
  repairInstallFolderAccess(previousStart)
  keepChromiumLog()
  applyGpuFallback()
  app.enableSandbox()
  app.setAboutPanelOptions({
    applicationName: 'Fetch My Recordings',
    applicationVersion: APP_VERSION,
    copyright: 'Free and open source under the GPL-3.0-or-later licence.',
    credits: 'Built on the fetchtv command-line tool (github.com/furey/fetchtv). Fetch My Recordings is an independent, free tool made by a Fetch customer. It is not made, endorsed, or supported by Fetch TV. Fetch is a trademark of its owner. The GitHub mark is from GitHub Octicons, MIT licence, copyright GitHub Inc. The Figtree and Geist Mono fonts are under the SIL Open Font Licence 1.1.'
  })
  app.on('second-instance', focusWindow)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', handleBeforeQuit)
  app.on('will-quit', () => {
    state.log.write('Quitting.')
    syncCleanupLockFiles()
  })
  app.on('web-contents-created', (_event, contents) => lockDownContents(contents))
  app.on('child-process-gone', (_event, details) => handleChildProcessGone(details))
  app.whenReady().then(startSafely)
}

const startSafely = () => {
  try {
    state.log.write('Electron is ready. Opening the window.')
    powerMonitor.on('shutdown', () => forgetStartBeforeShow('The computer is shutting down'))
    start()
  } catch (error) {
    failFatally({ error, origin: 'start' })
  }
}

const start = () => {
  if (activeFault() === 'main-throw') throw new Error('Test fault: main-throw')
  nativeTheme.themeSource = 'dark'
  const settings = createSettings(app.getPath('userData'))
  blockRemoteRequests()
  Menu.setApplicationMenu(buildMenu())
  registerIpc({ settings, history: createHistory(app.getPath('userData')) })
  if (activeFault() === 'no-window') return state.log.write('Test fault: no-window.')
  state.window = createWindow()
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 640,
    minHeight: 560,
    title: 'Fetch My Recordings',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1117',
    webPreferences: {
      preload: path.join(distDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  const fault = activeFault()
  if (!FAULTS_WITHOUT_READY.has(fault)) window.once('ready-to-show', () => showWhenReady(window))
  window.on('close', (event) => confirmCloseDuringSave({ event, window }))
  window.on('session-end', () => forgetStartBeforeShow('Windows is ending the session'))
  window.on('unresponsive', () => handleUnresponsive(window))
  window.on('responsive', () => state.log.write('The window is responding again.'))
  window.webContents.on('render-process-gone', (_event, details) => handleRendererGone({ window, details }))
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) =>
    handleLoadFailure({ window, errorCode, errorDescription, url, isMainFrame }))
  injectFault({ window, fault })
  setTimeout(() => showIfStillHidden(window), SHOW_FALLBACK_MS)
  loadRenderer(window)
  return window
}

const loadRenderer = (window) => window.loadFile(rendererPage).catch(() => null)

const showWhenReady = (window) => {
  if (window.isDestroyed()) return
  window.show()
  const firstShow = !state.windowShown
  state.windowShown = true
  state.startSettled = true
  state.launchGuard.succeed(state.gpuRung)
  state.log.write(`Window shown${state.gpuRung ? ` with graphics fallback ${state.gpuRung}` : ''}.`)
  if (!firstShow) state.log.write(`The window became ready after the fallback, so graphics fallback ${state.gpuRung} works.`)
}

const showIfStillHidden = (window) => {
  if (window.isDestroyed() || window.isVisible()) return
  revealWindow(window)
  settleStart()
  state.log.write(`The window was not ready after ${SHOW_FALLBACK_MS / 1000} s. Showed it anyway.`)
  if (window.webContents.isCrashed()) return handleRendererGone({ window, details: { reason: 'found stopped', exitCode: 'unknown' } })
  planNextRung('The window did not draw in time')
}

const revealWindow = (window) => {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  state.windowShown = true
}

const startWatchdog = () => {
  const waitMs = watchdogMs()
  const timer = setTimeout(() => {
    if (state.windowShown || state.quitting || state.failing) return
    state.failing = true
    state.log.write(`No window after ${waitMs / 1000} s. Closing so the next start can try again.`)
    showErrorBox({
      title: 'Fetch My Recordings did not open',
      content: `The window did not open within ${waitMs / 1000} seconds. Open the app again. It starts with safer graphics settings.\n\nIf it still does not open, start a thread at ${DISCUSSIONS_URL} and attach the log file:\n${state.log.filePath}`
    })
    exitApp(1)
  }, waitMs)
  timer.unref?.()
}

const watchdogMs = () => (isTestRun() && Number(process.env.FMR_TEST_WATCHDOG_MS)) || WATCHDOG_MS

const catchFatalErrors = () => {
  process.on('uncaughtException', (error) => handleUncaught({ error, origin: 'uncaught exception' }))
  process.on('unhandledRejection', (reason) => handleUncaught({ error: reason, origin: 'unhandled rejection' }))
}

const handleUncaught = ({ error, origin }) => {
  if (!state.windowShown) return failFatally({ error, origin: `${origin} during start` })
  state.log.write(`Kept running after an ${origin}: ${describeError(error)}`)
}

const failFatally = ({ error, origin }) => {
  if (state.failing) return
  state.failing = true
  state.log.write(`Fatal error (${origin}): ${describeError(error)}`)
  settleStart()
  showErrorBox({
    title: 'Fetch My Recordings has to close',
    content: `Something went wrong: ${error?.message ?? error}\n\nIf it happens again, start a thread at ${DISCUSSIONS_URL} and attach the log file:\n${state.log.filePath}`
  })
  exitApp(1)
}

const exitApp = (code) => {
  try {
    syncCleanupLockFiles()
  } catch (error) {
    state.log.write(`Could not clean up lock files: ${describeError(error)}`)
  }
  app.exit(code)
}

const showErrorBox = ({ title, content }) => {
  state.log.write(`Error box: ${title}`)
  if (isTestRun()) return
  try {
    dialog.showErrorBox(title, content)
  } catch (error) {
    state.log.write(`Could not show the error box: ${describeError(error)}`)
  }
}

const beginLaunch = () => {
  state.launchGuard = createLaunchGuard({
    folder: app.getPath('userData'),
    maxRung: GPU_FALLBACKS.length - 1,
    electronVersion: process.versions.electron
  })
  const { rung, failedStarts, atLastRung, previousPid } = state.launchGuard.begin(process.pid)
  state.gpuRung = rung
  if (failedStarts > 0) state.log.write(`The last ${failedStarts} start(s) closed before the window showed.`)
  if (failedStarts >= 2 || (failedStarts > 0 && atLastRung)) warnRepeatedFailedStarts(failedStarts)
  return { failedStarts, previousPid }
}

const applyGpuFallback = () => {
  const rung = state.gpuRung
  if (rung === 0) return
  state.log.write(`Using graphics fallback ${rung} (${GPU_FALLBACKS[rung].name}), kept from an earlier start.`)
  GPU_FALLBACKS[rung].apply()
}

const repairInstallFolderAccess = ({ failedStarts, previousPid }) => {
  if (process.platform !== 'win32' || !app.isPackaged) return
  state.log.write('Checking install folder access…')
  if (failedStarts === 0) return
  const chromiumLogFile = path.join(state.log.folder, 'chromium.log')
  if (!previousStartFailedAccessCheck({ chromiumLogFile, pid: previousPid })) return
  state.log.write('The last start closed because sandboxed processes could not read the install folder.')
  const record = createInstallAccessRecord({ folder: app.getPath('userData'), electronVersion: process.versions.electron })
  if (record.alreadyRepaired()) return state.log.write(`Already tried to repair the install folder access once for Electron ${process.versions.electron}. Reinstall the app to repair it again.`)
  if (isTestRun() && process.env.FMR_TEST_SKIP_INSTALL_ACCESS === '1') return state.log.write('Test switch: skipped the install folder access grant.')
  record.markRepaired()
  const result = grantSandboxReadAccess(path.dirname(process.execPath))
  state.log.write(result.ok
    ? 'Gave sandboxed processes read access to the install folder (ALL APPLICATION PACKAGES).'
    : `Could not give sandboxed processes read access to the install folder: ${result.error}`)
}

const keepChromiumLog = () => {
  if (process.platform !== 'win32') return
  const logFile = path.join(state.log.folder, 'chromium.log')
  rotateIfLarge({ filePath: logFile, maxBytes: CHROMIUM_LOG_MAX_BYTES })
  app.commandLine.appendSwitch('enable-logging', 'file')
  app.commandLine.appendSwitch('log-file', logFile)
}

const rotateIfLarge = ({ filePath, maxBytes }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (fs.statSync(filePath).size > maxBytes) fs.renameSync(filePath, filePath.replace(/\.log$/, '.old.log'))
  } catch {
    return false
  }
  return true
}

const warnRepeatedFailedStarts = (failedStarts) => {
  state.log.write('Showing an error box: the window has not opened for several starts.')
  showErrorBox({
    title: 'Fetch My Recordings could not open its window',
    content: `The app closed before its window opened the last ${failedStarts} times. It tries to open again now.\n\nIf no window opens, start a thread at ${DISCUSSIONS_URL} and attach the files in the log folder:\n${state.log.folder}`
  })
}

const planNextRung = (reason) => {
  const nextRung = state.gpuRung + 1
  if (nextRung >= GPU_FALLBACKS.length) {
    state.log.write(`${reason}. Graphics fallback is already at the last step.`)
    return false
  }
  state.launchGuard.keepRung(nextRung)
  state.log.write(`${reason}. The next start uses graphics fallback ${nextRung} (${GPU_FALLBACKS[nextRung].name}).`)
  return true
}

const forgetStartBeforeShow = (reason) => {
  if (state.startSettled || !state.launchGuard) return
  settleStart()
  state.log.write(`${reason} before the window showed. This start does not count as failed.`)
}

const settleStart = () => {
  state.startSettled = true
  state.launchGuard?.clearPending()
}

const handleBeforeQuit = () => {
  state.quitting = true
  if (!state.failing) forgetStartBeforeShow('Quit')
}

const handleChildProcessGone = (details) => {
  if (details.type !== 'GPU') return
  state.log.write(`The GPU process stopped: ${details.reason}, exit code ${details.exitCode}.`)
  if (details.reason === 'clean-exit' || state.quitting || state.failing) return
  if (state.windowShown) return state.log.write('The window is already open. Left the GPU process to restart by itself.')
  if (!planNextRung('The GPU process stopped before the window showed')) return
  settleStart()
  state.log.write('Restarting the app.')
  if (!isTestRun()) app.relaunch()
  exitApp(0)
}

const handleRendererGone = ({ window, details }) => {
  if (state.quitting || details.reason === 'clean-exit') return
  state.log.write(`The window contents stopped: ${details.reason}, exit code ${details.exitCode}.`)
  offerReload({
    window,
    message: 'The Fetch My Recordings window stopped working.',
    detail: 'Reload it to carry on.'
  })
}

const handleLoadFailure = ({ window, errorCode, errorDescription, url, isMainFrame }) => {
  if (!isMainFrame || errorCode === ERR_ABORTED || state.quitting) return
  state.log.write(`The window did not load: ${errorDescription} (${errorCode}) for ${url}.`)
  offerReload({
    window,
    message: 'The Fetch My Recordings window did not load.',
    detail: `${errorDescription} (${errorCode}).`
  })
}

const offerReload = async ({ window, message, detail }) => {
  if (window.isDestroyed()) return
  revealWindow(window)
  const answer = await askUser({ message, detail, buttons: ['Reload', 'Quit'] })
  if (answer === 'Quit') return quitNow()
  if (answer !== 'Reload' || window.isDestroyed()) return
  state.log.write('Reloading the window.')
  loadRenderer(window)
}

const handleUnresponsive = async (window) => {
  state.log.write('The window is not responding.')
  revealWindow(window)
  const answer = await askUser({
    message: 'The Fetch My Recordings window is not responding.',
    detail: 'Wait for it, or quit and open it again.',
    buttons: ['Wait', 'Quit']
  })
  if (answer === 'Quit') quitNow()
}

const askUser = ({ message, detail, buttons }) => {
  if (state.queuedDialogs.has(message)) {
    state.log.write(`Dialog already waiting: ${message}`)
    return Promise.resolve(null)
  }
  state.queuedDialogs.add(message)
  const answer = state.dialogQueue.then(() => showDialog({ message, detail, buttons }))
  state.dialogQueue = answer.catch(() => null)
  return answer.finally(() => state.queuedDialogs.delete(message))
}

const showDialog = async ({ message, detail, buttons }) => {
  if (state.quitting) return null
  state.log.write(`Dialog shown: ${message} [${buttons.join(' / ')}]`)
  const response = isTestRun()
    ? Number(process.env.FMR_TEST_DIALOG_ANSWER ?? 0)
    : (await dialog.showMessageBox({
        type: 'warning',
        title: 'Fetch My Recordings',
        message,
        detail: `${detail}\n\nThe details are in the log folder:\n${state.log.folder}`,
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true
      })).response
  state.log.write(`Dialog answer: ${buttons[response]}.`)
  return buttons[response]
}

const quitNow = () => {
  state.activeSave?.cancel()
  BrowserWindow.getAllWindows().forEach(window => window.destroy())
  app.quit()
}

const isTestRun = () => process.env.FMR_TEST === '1' && (!app.isPackaged || Boolean(process.env.CI))

const activeFault = () => isTestRun() ? process.env.FMR_FAULT ?? '' : ''

const injectFault = ({ window, fault }) => {
  if (fault === 'renderer-crash') window.webContents.once('dom-ready', () => crashRendererForTest(window))
  if (fault === 'gpu-crash') window.webContents.once('dom-ready', () => window.webContents.loadURL('chrome://gpucrash').catch(() => null))
}

const crashRendererForTest = (window) => {
  const pid = window.webContents.getOSProcessId()
  state.log.write(`Test fault: killing the window contents (process ${pid}).`)
  process.kill(pid, 'SIGKILL')
}

const registerIpc = ({ settings, history }) => {
  handle('app:info', async () => ({
    version: APP_VERSION,
    settings: await settings.read(),
    defaultFolder: defaultSaveFolder()
  }))

  handle('boxes:find', async ({ wholeNetwork }) => {
    const { lastAddress } = await settings.read()
    const locations = await findBoxes({
      rememberedAddress: lastAddress,
      searchNetwork: process.env.FETCHTV_DISCOVERY !== 'off',
      wholeNetwork: Boolean(wholeNetwork)
    })
    return { boxes: locations.map(rememberBox) }
  })

  handle('boxes:connect', async ({ address }) => {
    if (!parseBoxAddress(address)) return { error: 'invalid-address' }
    const location = await connectToAddress(address)
    if (!location) return { error: 'no-answer' }
    return { box: rememberBox(location) }
  })

  handle('recordings:list', async ({ boxId }) => {
    const location = state.boxes.get(boxId)
    if (!location) return { error: 'unknown-box' }
    const onProgress = (progress) => send('recordings:progress', progress)
    try {
      const address = new URL(location.url).hostname
      const { shows, summaries, outcome } = await listRecordings({ location, onProgress })
      state.log.write(describeListing({ address, ...outcome }))
      const problem = listingProblemFor(outcome.outcome)
      if (problem) return { problem }
      const box = describeBox(location)
      const { lastFolder } = await settings.read()
      const saved = await savedStates({
        episodes: summaries.flatMap(show => show.episodes),
        history: await history.read(),
        boxKey: box.key,
        folder: lastFolder || defaultSaveFolder()
      })
      state.shows = shows
      state.summaries = summaries.map(show => ({ ...show, episodes: show.episodes.map(episode => ({ ...episode, saved: saved[episode.id] })) }))
      state.boxKey = box.key
      await settings.update({ lastAddress: box.address })
      return { shows: state.summaries }
    } catch (error) {
      state.log.write(`Could not list recordings from box ${location.url}: ${describeError(error)}`)
      return { error: 'list-failed' }
    }
  })

  handle('folder:choose', async ({ current }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(state.window, {
      title: 'Choose a folder for your recordings',
      buttonLabel: 'Use this folder',
      defaultPath: typeof current === 'string' ? current : defaultSaveFolder(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths?.[0]) return {}
    return { folder: filePaths[0] }
  })

  handle('folder:describe', async ({ folder, episodeIds }) => {
    if (!isUsableFolder(folder)) return { error: 'invalid-folder' }
    return describeFolder({ folder, items: selectedItems(episodeIds) })
  })

  handle('save:start', async ({ folder, forPlex, copyAgain, episodeIds }) => {
    if (state.activeSave) return { error: 'already-saving' }
    if (!isUsableFolder(folder)) return { error: 'invalid-folder' }
    const recordings = pickEpisodes({ shows: state.shows, episodeIds: toIdList(episodeIds) })
    await settings.update({ lastFolder: folder, forPlex: Boolean(forPlex) })
    return runSave({ recordings, folder, forPlex: Boolean(forPlex), copyAgain: Boolean(copyAgain), history })
  })

  handle('save:cancel', async () => {
    state.activeSave?.cancel()
    return {}
  })

  handle('folder:open', async () => {
    if (!state.savedFolder) return {}
    await shell.openPath(state.savedFolder)
    return {}
  })

  handle('settings:sound', async ({ on }) => {
    await settings.update({ sound: Boolean(on) })
    return {}
  })

  handle('link:project', async () => {
    await shell.openExternal(APP_REPOSITORY_URL)
    return {}
  })

  handle('link:fetchtv', async () => {
    await shell.openExternal(FETCHTV_REPOSITORY_URL)
    return {}
  })

  handle('link:open', async ({ name }) => {
    const url = Object.hasOwn(EXTERNAL_LINKS, name) ? EXTERNAL_LINKS[name] : null
    if (!url) return { error: 'unknown-link' }
    await shell.openExternal(url)
    return {}
  })
}

const runSave = async ({ recordings, folder, forPlex, copyAgain, history }) => {
  const blockerId = powerSaveBlocker.start('prevent-app-suspension')
  const save = startSave({
    recordings,
    folder,
    forPlex,
    copyAgain,
    retryDelays: retryDelaysFromEnv(),
    onProgress: ({ id, bytes, total }) => send('save:progress', { id: String(id), bytes, total }),
    onResult: (result) => send('save:result', result)
  })
  state.activeSave = save
  state.savedFolder = folder
  try {
    const { summary, results } = await save.done
    await history.recordFolder({ folder, boxKey: state.boxKey, results }).catch(() => null)
    return { summary }
  } catch (error) {
    return { error: error.code === 'ENOSPC' ? 'no-space' : 'save-failed' }
  } finally {
    state.activeSave = null
    powerSaveBlocker.stop(blockerId)
  }
}

const confirmCloseDuringSave = async ({ event, window }) => {
  if (!state.activeSave || state.closingAfterStop) return
  event.preventDefault()
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    buttons: ['Keep saving', 'Stop and close'],
    defaultId: 0,
    cancelId: 0,
    message: 'Recordings are still saving.',
    detail: 'If you stop now, a recording that is part way keeps what it has. Save the same recordings to the same folder next time to carry on from there.'
  })
  if (response !== 1 || !state.activeSave) return
  const save = state.activeSave
  save.cancel()
  await save.done.catch(() => null)
  state.closingAfterStop = true
  window.close()
}

const handle = (channel, handler) => {
  ipcMain.handle(channel, async (event, args = {}) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return handler(typeof args === 'object' && args !== null ? args : {})
  })
}

const isTrustedSender = (event) => comparableUrl(event.senderFrame?.url ?? '') === comparableUrl(rendererUrl)

const comparableUrl = (url) => {
  const withoutHash = decodeURI(url.split('#')[0])
  return process.platform === 'win32' ? withoutHash.toLowerCase() : withoutHash
}

const send = (channel, payload) => {
  if (state.window && !state.window.isDestroyed()) state.window.webContents.send(channel, payload)
}

const rememberBox = (location) => {
  state.boxes.set(location.url, location)
  return describeBox(location)
}

const selectedItems = (episodeIds) => {
  const wanted = new Set(toIdList(episodeIds))
  return state.summaries.flatMap(show => show.episodes).filter(episode => wanted.has(episode.id))
}

const toIdList = (ids) => (Array.isArray(ids) ? ids : []).map(String)

const isUsableFolder = (folder) => typeof folder === 'string' && path.isAbsolute(folder)

const defaultSaveFolder = () => {
  const videos = safePath('videos') ?? safePath('home')
  return path.join(videos, 'Fetch recordings')
}

const safePath = (name) => {
  try {
    return app.getPath(name)
  } catch {
    return null
  }
}

const retryDelaysFromEnv = () => {
  const text = process.env.FETCHTV_RETRY_DELAYS_MS
  if (!text) return undefined
  return text.split(',').map(Number).filter(Number.isFinite)
}

const focusWindow = () => {
  state.log.write('Another start asked for the window.')
  if (!app.isReady() || state.failing || state.quitting) return
  if (!state.window || state.window.isDestroyed()) {
    state.window = createWindow()
    return
  }
  revealWindow(state.window)
  state.window.focus()
}

const lockDownContents = (contents) => {
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

const blockRemoteRequests = () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true })
  )
}

const buildMenu = () => Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : [{ role: 'fileMenu' }]),
  { role: 'editMenu' },
  { role: 'windowMenu' },
  {
    role: 'help',
    submenu: [{ label: 'Open log folder', click: () => shell.openPath(state.log.folder) }]
  }
])

main()
