import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { MB, demoShows, startFakeBox } from '../test/fake-box.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { shots: { type: 'string' } } })
const SIZES = { default: null, minimum: [640, 560] }

const main = async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fetch-my-recordings-runts-'))
  const shows = demoShows({ size: MB })
  shows[0].items[1].quirks = { alwaysDropAt: Math.round(MB / 2) }
  const box = await startFakeBox({ shows, name: 'Lounge room box' })
  const folder = path.join(work, 'Movies', 'Fetch recordings')
  const userData = path.join(work, 'user-data')
  await fs.mkdir(userData, { recursive: true })
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: '192.0.2.1', lastFolder: folder }))
  if (values.shots) await fs.mkdir(values.shots, { recursive: true })
  const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, FETCHTV_USER_DATA: userData, FETCHTV_DISCOVERY: 'off', FETCHTV_RETRY_DELAYS_MS: '50,50' } })
  const found = []
  try {
    const page = await app.firstWindow()
    const check = (name) => checkState({ app, page, name, found })
    const dialog = page.locator('#info-dialog')
    const closeDialog = async () => {
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
    }
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
    await check('welcome')
    await page.getByRole('button', { name: 'About this app' }).click()
    await check('about-dialog')
    await closeDialog()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('heading', { name: 'No Fetch box found' }).waitFor({ timeout: 30000 })
    await check('not-found')
    await page.getByRole('button', { name: 'More about: No Fetch box found' }).click()
    await check('not-found-dialog')
    await closeDialog()
    await page.getByRole('button', { name: 'Where to find the IP address' }).click()
    await check('ip-address-dialog')
    await closeDialog()
    await page.getByLabel('Or type its IP address').fill(box.address)
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await page.locator('li.show-row[data-show="Master Cook"] .row-main').first().click()
    await page.locator('li.show-row[data-show="Bigger Brother"] .row-main').first().click()
    await check('recordings')
    await page.getByRole('button', { name: 'Next' }).click()
    await page.locator('#folder-info', { hasText: 'Needs' }).waitFor()
    await check('folder')
    await page.getByRole('button', { name: 'Full path of the folder' }).click()
    await check('folder-path-dialog')
    await closeDialog()
    await page.getByRole('button', { name: 'About names for Plex, Jellyfin or Kodi' }).click()
    await check('plex-dialog')
    await closeDialog()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor()
    await check('saving')
    await page.getByRole('heading', { name: 'Some not saved' }).waitFor({ timeout: 60000 })
    await page.locator('#problem-list .row-main').first().click()
    await check('some-not-saved')
    await page.getByRole('button', { name: 'More about: Some not saved' }).click()
    await check('finished-dialog')
    await closeDialog()
    await page.getByRole('button', { name: 'How to watch your recordings' }).click()
    for (const tab of ['On this computer', 'On your TV', 'Record free-to-air']) {
      await dialog.getByRole('button', { name: tab }).click()
      await check(`watch-${tab.toLowerCase().replaceAll(' ', '-')}`)
    }
    await closeDialog()
  } finally {
    await app.close()
    await box.stop()
    await fs.rm(work, { recursive: true, force: true })
  }
  if (found.length === 0) return console.log('No runts found.')
  found.forEach(runt => console.log(`${runt.state} (${runt.size}): "${runt.text}" ends with a lone "${runt.word}"`))
  process.exitCode = 1
}

const checkState = async ({ app, page, name, found }) => {
  for (const [size, dimensions] of Object.entries(SIZES)) {
    const original = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    if (dimensions) await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), dimensions)
    await page.waitForTimeout(250)
    const runts = await page.evaluate(findRunts)
    runts.forEach(runt => found.push({ ...runt, state: name, size }))
    if (values.shots) await page.screenshot({ path: path.join(values.shots, `${name}-${size}.png`) })
    if (dimensions) await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), original)
  }
}

const findRunts = () => {
  const isShown = (element) => {
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }
  const openDialog = document.querySelector('dialog[open]')
  const scope = openDialog ?? document.body
  const elements = [...scope.querySelectorAll('*')].filter(element => !element.closest('dialog:not([open])') && isShown(element))
  const runts = []
  for (const element of elements) {
    const words = []
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue
      for (const match of node.textContent.matchAll(/\S+/g)) {
        const range = document.createRange()
        range.setStart(node, match.index)
        range.setEnd(node, match.index + match[0].length)
        const rects = [...range.getClientRects()]
        if (rects.length === 0) continue
        words.push({ word: match[0], top: Math.round(rects.at(-1).top) })
      }
    }
    if (words.length < 2) continue
    const lines = [...new Set(words.map(word => word.top))]
    if (lines.length < 2) continue
    const lastLine = words.filter(word => word.top === lines.at(-1))
    if (lastLine.length === 1) runts.push({ text: element.textContent.trim().slice(0, 80), word: lastLine[0].word })
  }
  return runts
}

await main()
