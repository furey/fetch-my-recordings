import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { bigLibrary, startFakeBox } from '../test/fake-box.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { shots: { type: 'string' } } })
const SIZES = { default: null, minimum: [640, 560] }
const problems = []

const main = async () => {
  if (values.shots) await fs.mkdir(values.shots, { recursive: true })
  await checkFinishedRun()
  await checkStoppedRun()
  if (problems.length === 0) return console.log('All scrolling checks passed.')
  problems.forEach(problem => console.log(problem))
  process.exitCode = 1
}

const checkFinishedRun = async () => {
  const session = await openSession({})
  const { app, page } = session
  try {
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
    await atEachSize({ app, page, name: 'welcome', check: (size, shot) => checkMainScroll({ page, name: 'welcome', shot }) })
    await checkDialog({ app, page, name: 'about', open: () => page.getByRole('button', { name: 'About this app' }).click() })
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 30000 })
    for (const show of ['Master Cook', 'Grand Resigns', 'Football', 'Space Wars']) {
      await page.locator(`li.show-row[data-show="${show}"] .row-main`).first().click()
    }
    await atEachSize({ app, page, name: 'recordings', check: (size, shot) => checkMainScroll({ page, name: 'recordings', shot }) })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.locator('#folder-info', { hasText: 'Needs' }).waitFor()
    await checkDialog({ app, page, name: 'folder-path', open: () => page.getByRole('button', { name: 'Full path of the folder' }).click() })
    await checkDialog({ app, page, name: 'plex', open: () => page.getByRole('button', { name: 'About names for Plex, Jellyfin or Kodi' }).click() })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('heading', { name: 'Some not saved' }).waitFor({ timeout: 180000 })
    await checkDialog({ app, page, name: 'saved', open: () => page.locator('.stat[data-list="saved"]').click(), reopen: true })
    await checkDialog({
      app,
      page,
      name: 'not-saved',
      open: () => page.locator('.stat[data-list="not-saved"]').click(),
      prepare: async () => {
        const rows = page.locator('#info-dialog .problem-row .row-main')
        for (let index = 0; index < 4; index++) await rows.nth(index).click()
      },
      footerButton: 'Save again',
      tabToLast: '.problem-row .row-main'
    })
    for (const tab of ['On this computer', 'On your TV', 'Record free-to-air']) {
      await checkDialog({
        app,
        page,
        name: `watch-${tab}`,
        open: async () => {
          await page.getByRole('button', { name: 'How to watch your recordings' }).click()
          await page.locator('#info-dialog').getByRole('button', { name: tab }).click()
        }
      })
    }
  } finally {
    await session.close()
  }
}

const checkStoppedRun = async () => {
  const session = await openSession({ bytesPerSecond: 256 * 1024 })
  const { app, page } = session
  try {
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor()
    await page.locator('.status', { hasText: ' of ' }).first().waitFor()
    await atEachSize({ app, page, name: 'saving', check: (size, shot) => checkMainScroll({ page, name: 'saving', shot }) })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('heading', { name: 'Stopped' }).waitFor({ timeout: 60000 })
    await checkDialog({ app, page, name: 'stopped', open: () => page.locator('.stat[data-list="stopped"]').click(), footerButton: 'Save again' })
  } finally {
    await session.close()
  }
}

const openSession = async ({ bytesPerSecond = 0 }) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fetch-my-recordings-scroll-'))
  const box = await startFakeBox({ shows: bigLibrary(), name: 'Lounge room box', bytesPerSecond })
  const userData = path.join(work, 'user-data')
  await fs.mkdir(userData, { recursive: true })
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: path.join(work, 'Movies', 'Fetch recordings') }))
  const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, FETCHTV_USER_DATA: userData, FETCHTV_DISCOVERY: 'off', FETCHTV_RETRY_DELAYS_MS: '20,20' } })
  const page = await app.firstWindow()
  return {
    app,
    page,
    close: async () => {
      await app.close()
      await box.stop()
      await fs.rm(work, { recursive: true, force: true })
    }
  }
}

const atEachSize = async ({ app, page, name, check }) => {
  for (const [size, dimensions] of Object.entries(SIZES)) {
    const original = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    if (dimensions) await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), dimensions)
    await page.waitForTimeout(250)
    await check(size, async () => {
      if (values.shots) await page.screenshot({ path: path.join(values.shots, `${name}-${size}.png`) })
    })
    if (dimensions) await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), original)
  }
}

const report = (condition, message) => {
  if (!condition) problems.push(message)
}

const checkMainScroll = async ({ page, name, shot }) => {
  const label = `${name}`
  const main = page.locator('main')
  await main.evaluate(element => { element.scrollTop = 0 })
  const sizes = await main.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))
  if (sizes.scrollHeight <= sizes.clientHeight + 1) return shot()
  const box = await main.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(250)
  report(await main.evaluate(element => element.scrollTop) > 0, `${label}: the mouse wheel does not scroll the screen`)
  await main.evaluate(element => { element.scrollTop = 0 })
  await main.focus()
  await page.keyboard.press('PageDown')
  await page.waitForTimeout(250)
  report(await main.evaluate(element => element.scrollTop) > 0, `${label}: PageDown does not scroll the screen`)
  await page.keyboard.press('End')
  await page.waitForTimeout(400)
  const end = await main.evaluate(element => {
    const last = [...element.querySelectorAll('*')].filter(node => node.getBoundingClientRect().height > 0).at(-1)
    const view = element.getBoundingClientRect()
    return { atBottom: Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2, lastBottom: last.getBoundingClientRect().bottom, viewBottom: view.bottom }
  })
  report(end.atBottom, `${label}: End does not reach the bottom of the screen`)
  report(end.lastBottom <= end.viewBottom, `${label}: the last item is cut off at the bottom`)
  await shot()
  await main.evaluate(element => { element.scrollTop = 0 })
}

const checkDialog = async ({ app, page, name, open, prepare, footerButton, tabToLast, reopen = false }) => {
  await atEachSize({
    app,
    page,
    name: `dialog-${name}`,
    check: async (size, shot) => {
      const label = `${name} dialog (${size})`
      await open()
      const dialog = page.locator('#info-dialog')
      await dialog.waitFor()
      const mainTop = await page.locator('main').evaluate(element => element.scrollTop)
      const startTop = await page.locator('#info-body').evaluate(element => element.scrollTop)
      if (prepare) await prepare()
      const body = page.locator('#info-body')
      const geometry = () => page.evaluate(() => {
        const rect = (element) => element.getBoundingClientRect()
        const dialog = document.getElementById('info-dialog')
        const body = document.getElementById('info-body')
        return {
          dialog: rect(dialog),
          title: rect(document.getElementById('info-title')),
          close: rect(document.getElementById('info-close')),
          body: rect(body),
          viewport: { height: window.innerHeight, width: window.innerWidth },
          dialogScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
          bodyScrolls: body.scrollHeight > body.clientHeight + 1,
          bodyTop: body.scrollTop,
          tabbable: body.getAttribute('tabindex') === '0'
        }
      })
      const before = await geometry()
      report(before.dialog.top >= 0 && before.dialog.bottom <= before.viewport.height, `${label}: the dialog is taller than the window`)
      report(!before.dialogScrolls, `${label}: the dialog itself scrolls (double scrollbars)`)
      report(startTop === 0, `${label}: the list does not start at the top`)
      if (before.bodyScrolls) {
        report(before.tabbable, `${label}: the scrolling list cannot be reached with Tab`)
        const box = await body.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.wheel(0, 300)
        await page.waitForTimeout(250)
        report(await body.evaluate(element => element.scrollTop) > 0, `${label}: the mouse wheel does not scroll the list`)
        await body.evaluate(element => { element.scrollTop = 0 })
        await body.focus()
        await page.keyboard.press('PageDown')
        await page.waitForTimeout(250)
        report(await body.evaluate(element => element.scrollTop) > 0, `${label}: PageDown does not scroll the list`)
        await page.keyboard.press('End')
        await page.waitForTimeout(400)
        await page.mouse.wheel(0, 2000)
        await page.waitForTimeout(250)
        const end = await page.evaluate(() => {
          const body = document.getElementById('info-body')
          const last = [...body.querySelectorAll('*')].filter(node => node.getBoundingClientRect().height > 0).at(-1)
          return {
            atBottom: Math.abs(body.scrollHeight - body.clientHeight - body.scrollTop) < 2,
            lastBottom: last.getBoundingClientRect().bottom,
            bodyBottom: body.getBoundingClientRect().bottom
          }
        })
        report(end.atBottom, `${label}: End does not reach the end of the list`)
        report(end.lastBottom <= end.bodyBottom - 8, `${label}: the last row is cut off or has no space under it`)
      }
      const after = await geometry()
      report(after.title.top >= after.dialog.top && after.title.bottom <= after.body.top + 1, `${label}: the title scrolls away`)
      report(after.close.top >= 0 && after.close.bottom <= after.viewport.height, `${label}: Close is out of view`)
      if (footerButton) {
        const button = await page.locator('#info-foot').getByRole('button', { name: footerButton }).boundingBox()
        report(button && button.y >= 0 && button.y + button.height <= after.viewport.height, `${label}: ${footerButton} is out of view`)
      }
      if (tabToLast) {
        const count = await page.locator(`#info-body ${tabToLast}`).count()
        await page.locator('#info-close').focus()
        for (let index = 0; index < count + 1; index++) await page.keyboard.press('Tab')
        const focusVisible = await page.evaluate((selector) => {
          const focused = document.activeElement
          if (!focused.matches(selector)) return { inView: false, insideDialog: Boolean(focused.closest('#info-dialog')), wrongTarget: focused.outerHTML.slice(0, 80) }
          const body = document.getElementById('info-body').getBoundingClientRect()
          const box = focused.getBoundingClientRect()
          const inView = box.top >= body.top - 1 && box.bottom <= body.bottom + 1
          return { inView, insideDialog: Boolean(focused.closest('#info-dialog')) }
        }, `#info-body ${tabToLast}`)
        report(focusVisible.insideDialog, `${label}: Tab leaves the dialog`)
        report(focusVisible.inView, `${label}: the focused row is not scrolled into view${focusVisible.wrongTarget ? ` (focus was on ${focusVisible.wrongTarget})` : ''}`)
      }
      report(await page.locator('main').evaluate(element => element.scrollTop) === mainTop, `${label}: the page behind scrolled`)
      if (values.shots) {
        await body.evaluate(element => { element.scrollTop = element.scrollHeight / 2 - element.clientHeight / 2 })
        await page.mouse.move(0, 0)
        await shot()
      }
      if (reopen) {
        await body.evaluate(element => { element.scrollTop = element.scrollHeight })
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        await open()
        await dialog.waitFor()
        report(await body.evaluate(element => element.scrollTop) === 0, `${label}: the list does not go back to the top when reopened`)
      }
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
    }
  })
}

await main()
