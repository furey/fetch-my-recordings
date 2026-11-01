import { app, BrowserWindow, Menu, crashReporter, dialog, ipcMain, nativeTheme, powerSaveBlocker, session, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { syncCleanupLockFiles } from 'fetchtv'
import { connectToAddress, describeBox, findBoxes, parseBoxAddress } from './boxes.js'
import { describeFolder } from './folders.js'
import { listRecordings, pickEpisodes } from './recordings.js'
import { startSave } from './saving.js'
import { createSettings } from './settings.js'
import { createHistory, savedStates } from './history.js'
import { createStartupLog, describeError } from './startup-log.js'
import { MAX_GPU_RUNG, createLaunchGuard, describeRung } from './launch-guard.js'

const APP_REPOSITORY_URL = 'https://github.com/furey/fetch-my-recordings'
const FETCHTV_REPOSITORY_URL = 'https://github.com/furey/fetchtv'
const EXTERNAL_LINKS = {
  vlc: 'https://www.videolan.org/vlc/',
  freetvarr: 'https://furey.github.io/freetvarr/'
}
const SHOW_FALLBACK_MS = 10000
const ERR_ABORTED = -3
const distDir =path.dirname(fileURLToPath(import.meta.url))
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
  dialogOpen: false,
  quitting: false,
  failing: false
}

const main = () => {
  if (process.env.FETCHTV_USER_DATA) app.setPath('userData', process.env.FETCHTV_USER_DATA)
  state.log = createStartupLog(path.join(app.getPath('userData'), 'logs'))
  catchFatalErrors()
  crashReporter.start({ uploadToServer: false })
  if (!app.requestSingleInstanceLock()) {
    state.log.write('Another copy is already running. Asked it to show its window, then quit.')
    return app.quit()
  }
  state.log.write(`Starting version ${APP_VERSION} on ${process.platform} ${process.arch} (${os.release()}), Electron ${process.versions.electron}.`)
  prepareGpuFallback()
  app.enableSandbox()
  app.setAboutPanelOptions({
    applicationName: 'Fetch My Recordings',
    applicationVersion: APP_VERSION,
    copyright: 'Free and open source under the GPL-3.0-or-later licence.',
    credits: 'Built on the fetchtv command-line tool (github.com/furey/fetchtv). Fetch My Recordings is an independent, free tool made by a Fetch customer. It is not made, endorsed, or supported by Fetch TV. Fetch is a trademark of its owner. The GitHub mark is from GitHub Octicons, MIT licence, copyright GitHub Inc. The Figtree and Geist Mono fonts are under the SIL Open Font Licence 1.1.'
  })
  app.on('second-instance', focusWindow)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => { state.quitting = true })
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
  if (fault !== 'no-ready') window.once('ready-to-show', () => showWhenReady(window))
  window.on('close', (event) => confirmCloseDuringSave({ event, window }))
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
  state.windowShown = true
  state.launchGuard.succeed(state.gpuRung)
  state.log.write(`Window shown${state.gpuRung ? ` with GPU fallback rung ${state.gpuRung}` : ''}.`)
}

const showIfStillHidden = (window) => {
  if (window.isDestroyed() || window.isVisible()) return
  revealWindow(window)
  state.log.write(`The window was not ready after ${SHOW_FALLBACK_MS / 1000} s. Showed it anyway.`)
}

const revealWindow = (window) => {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  state.windowShown = true
}

const catchFatalErrors = () => {
  process.on('uncaughtException', (error) => failFatally({ error, origin: 'uncaught exception' }))
  process.on('unhandledRejection', (reason) => handleUnhandledRejection(reason))
}

const handleUnhandledRejection = (reason) => {
  if (!state.windowShown) return failFatally({ error: reason, origin: 'unhandled rejection during start' })
  state.log.write(`Unhandled rejection (kept running): ${describeError(reason)}`)
}

const failFatally = ({ error, origin }) => {
  if (state.failing) return
  state.failing = true
  state.log.write(`Fatal error (${origin}): ${describeError(error)}`)
  showErrorBox({
    title: 'Fetch My Recordings has to close',
    content: `Something went wrong: ${error?.message ?? error}\n\nThe details are in this log file:\n${state.log.filePath}`
  })
  app.exit(1)
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

const prepareGpuFallback = () => {
  state.launchGuard = createLaunchGuard(app.getPath('userData'))
  const { failedStarts, keptRung, rung } = state.launchGuard.begin()
  state.gpuRung = rung
  if (failedStarts > 0) state.log.write(`The last ${failedStarts} start(s) did not show a window.`)
  if (rung === 0) return
  const source = keptRung === rung ? 'kept from an earlier start' : 'after a failed start'
  state.log.write(`Using GPU fallback rung ${rung} (${describeRung(rung)}), ${source}.`)
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  if (rung >= 2) app.commandLine.appendSwitch('in-process-gpu')
}

const handleChildProcessGone = (details) => {
  if (details.type !== 'GPU') return
  state.log.write(`The GPU process stopped: ${details.reason}, exit code ${details.exitCode}.`)
  if (details.reason === 'clean-exit' || state.quitting) return
  if (state.gpuRung >= MAX_GPU_RUNG) return state.log.write('GPU fallback is already at the last rung. Not restarting.')
  const nextRung = state.gpuRung + 1
  state.launchGuard.keepRung(nextRung)
  if (state.activeSave) return state.log.write(`Kept GPU fallback rung ${nextRung} for the next start. Not restarting during a save.`)
  state.log.write(`Restarting with GPU fallback rung ${nextRung} (${describeRung(nextRung)}).`)
  if (!isTestRun()) app.relaunch()
  app.exit(0)
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

const askUser = async ({ message, detail, buttons }) => {
  if (state.dialogOpen) {
    state.log.write(`Dialog skipped, one is already open: ${message}`)
    return null
  }
  state.dialogOpen = true
  state.log.write(`Dialog shown: ${message} [${buttons.join(' / ')}]`)
  try {
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
  } finally {
    state.dialogOpen = false
  }
}

const quitNow = () => {
  BrowserWindow.getAllWindows().forEach(window => window.destroy())
  app.quit()
}

const isTestRun = () => process.env.FMR_TEST === '1'

const activeFault = () => isTestRun() ? process.env.FMR_FAULT ?? '' : ''

const injectFault = ({ window, fault }) => {
  if (fault === 'renderer-crash') window.webContents.once('did-navigate', () => window.webContents.forcefullyCrashRenderer())
  if (fault === 'gpu-crash') window.webContents.once('dom-ready', () => window.webContents.loadURL('chrome://gpucrash').catch(() => null))
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
      const { shows, summaries } = await listRecordings({ location, onProgress })
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
    } catch {
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

  handle('save:start', async ({ folder, forPlex, episodeIds }) => {
    if (state.activeSave) return { error: 'already-saving' }
    if (!isUsableFolder(folder)) return { error: 'invalid-folder' }
    const recordings = pickEpisodes({ shows: state.shows, episodeIds: toIdList(episodeIds) })
    await settings.update({ lastFolder: folder, forPlex: Boolean(forPlex) })
    return runSave({ recordings, folder, forPlex: Boolean(forPlex), history })
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

const runSave = async ({ recordings, folder, forPlex, history }) => {
  const blockerId = powerSaveBlocker.start('prevent-app-suspension')
  const save = startSave({
    recordings,
    folder,
    forPlex,
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
  if (!app.isReady() || state.failing) return
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
