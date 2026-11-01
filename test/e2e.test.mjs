import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { MB, bigLibrary, demoShows, recordingBytes, startFakeBox } from './fake-box.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const screenshotDir = process.env.FETCHTV_SCREENSHOTS_DIR
const packagedExecutable = process.env.FETCHTV_E2E_EXECUTABLE
const skipSsdp = Boolean(process.env.FETCHTV_E2E_SKIP_SSDP)
const UNREACHABLE_ADDRESS = '192.0.2.1'

let tmpRoot = null
let notSavedLog = []

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fetchtv-e2e-'))
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true })
})

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

test('first run: no box found, type the address, choose episodes, save in the default layout', async () => {
  const box = await startFakeBox()
  const userData = await freshDir('user-data')
  const saveFolder = path.join(await freshDir('saves'), 'Fetch recordings')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: UNREACHABLE_ADDRESS }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Looking for your Fetch box' }).waitFor()
    await capture({ app, page, name: '1-searching' })
    await page.getByRole('heading', { name: 'No Fetch box found' }).waitFor({ timeout: 20000 })
    await capture({ app, page, name: '1-not-found' })

    await page.getByLabel('Or type its IP address').fill('300.1.2.3')
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.getByText('That is not an IP address.').waitFor()

    await page.getByLabel('Or type its IP address').fill(box.address)
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await capture({ app, page, name: '2-recordings' })

    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await page.getByRole('heading', { name: 'Fetch box found' }).waitFor({ timeout: 20000 })
    await capture({ app, page, name: '1-choose-box' })
    await page.getByRole('button', { name: /Test Fetch Box/ }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()

    const masterCook = page.locator('li.show-row[data-show="Master Cook"]')
    await masterCook.locator('.row-main').first().click()
    await masterCook.getByLabel('S1 E4 - Elimination').uncheck()
    assert.equal(await masterCook.locator('.row-main input[type="checkbox"]').first().evaluate(input => input.indeterminate), true)
    const coastal = page.locator('li.show-row[data-show="Bigger Brother"]')
    await coastal.locator('.row-main').first().click()
    assert.equal(await coastal.getByLabel('S2 E6 - Eviction Night').isDisabled(), true)
    await capture({ app, page, name: '2-recordings-episodes' })
    await page.getByText('9 recordings selected').waitFor()

    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('heading', { name: 'Choose a folder' }).waitFor()
    await stubFolderPicker({ app, folder: saveFolder })
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await page.locator(`#folder-path[data-path="${cssString(saveFolder)}"]`).waitFor()
    await page.locator('#folder-info', { hasText: 'Needs' }).waitFor()
    await capture({ app, page, name: '3-folder' })

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    await capture({ app, page, name: '4-finished' })
    assert.deepEqual(await totals(page), { 'Saved': '9', 'Already saved': '0', 'Not saved': '0' })

    const expected = [
      'Backyard Builders/S3 E1 - The Shed.ts',
      'Master Cook/S1 E1 - Auditions.ts',
      'Master Cook/S1 E3 - Team Challenge.ts',
      'The Footy Panel/The Footy Panel.ts',
      'Mission Improbable/Mission Improbable.ts'
    ]
    const files = await listFiles(saveFolder)
    for (const file of expected) assert.ok(files.includes(file), `${file} missing from ${files.join(', ')}`)
    assert.equal(files.some(file => file.includes('Elimination')), false)
    assert.equal(files.some(file => file.includes('Eviction Night')), false)
    assert.equal(files.some(file => /\.(part|lock)$/.test(file)), false)
    await assertSameBytes({ box, folder: saveFolder, file: 'Master Cook/S1 E1 - Auditions.ts', title: 'S1 E1 - Auditions' })
    assert.ok(files.includes('fetchtv.json'))
  } finally {
    await app.close()
    await box.stop()
  }
})

test('next run: remembers the box and folder, saves in the Plex layout, then skips what is saved', async () => {
  const box = await startFakeBox({ port: 0 })
  const userData = await freshDir('user-data-plex')
  const saveFolder = path.join(await freshDir('plex'), 'Movies', 'Fetch recordings')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await page.getByRole('button', { name: 'Select none' }).click()
    assert.equal(await page.getByRole('button', { name: 'Next' }).isDisabled(), true)
    await page.getByText('Nothing selected').waitFor()
    await page.getByRole('button', { name: 'Select all' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.locator(`#folder-path[data-path="${cssString(saveFolder)}"]`).waitFor()
    await page.getByRole('switch', { name: 'Names for Plex, Jellyfin or Kodi' }).click()
    const infoButton = page.getByRole('button', { name: 'About names for Plex, Jellyfin or Kodi' })
    await infoButton.click()
    await page.locator('#example-on', { hasText: 'Backyard Builders/Season 03/Backyard Builders - S03E01.ts' }).waitFor()
    await capture({ app, page, name: '3-folder-info' })
    await page.keyboard.press('Escape')
    await page.locator('#info-dialog').waitFor({ state: 'hidden' })
    assert.equal(await infoButton.evaluate(button => document.activeElement === button), true)
    await capture({ app, page, name: '3-folder-plex' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })

    const files = await listFiles(saveFolder)
    for (const file of [
      'Master Cook/Season 01/Master Cook - S01E04.ts',
      'Backyard Builders/Season 03/Backyard Builders - S03E02.ts',
      'Bigger Brother/Season 02/Bigger Brother - S02E05.ts',
      'Mission Improbable/Mission Improbable.ts'
    ]) assert.ok(files.includes(file), `${file} missing from ${files.join(', ')}`)

    await page.getByRole('button', { name: 'Save again' }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    assert.deepEqual(await totals(page), { 'Saved': '0', 'Already saved': '10', 'Not saved': '0' })
    await page.locator('.stat[data-list="already"]').click()
    await page.locator('#info-dialog').getByRole('heading', { name: 'Already saved' }).waitFor()
    assert.equal(await page.locator('#result-list-already .row').count(), 10)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Choose other recordings' }).click()
    await page.locator('#saved-summary', { hasText: '0 new · 10 already saved' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Next' }).isDisabled(), true)
    await page.getByRole('button', { name: 'Select all' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.locator('#already-here', { hasText: '10 already here' }).waitFor()
  } finally {
    await app.close()
    await box.stop()
  }
})

test('stop part way, then save again carries on from the partial file', async () => {
  const box = await startFakeBox({
    shows: [{ title: 'Master Cook', items: [{ title: 'S1 E1 - Auditions', size: 24 * MB, duration: '0:58:12' }, { title: 'S1 E2 - Mystery Box', size: 24 * MB, duration: '0:57:40' }] }],
    quirks: { rangeNotSatisfiable: false },
    bytesPerSecond: 4 * MB
  })
  const userData = await freshDir('user-data-stop')
  const saveFolder = await freshDir('stop')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor()
    await page.locator('.status', { hasText: / MB of / }).first().waitFor()
    await page.waitForTimeout(1500)
    await capture({ app, page, name: '4-saving' })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('heading', { name: 'Stopped', exact: true }).waitFor({ timeout: 30000 })
    await capture({ app, page, name: '4-stopped' })

    const files = await listFiles(saveFolder)
    assert.ok(files.some(file => file.endsWith('.ts.part')), `no partial file in ${files.join(', ')}`)
    assert.equal(files.some(file => file.endsWith('.lock')), false)

    const before = box.requests.length
    await page.getByRole('button', { name: 'Save again' }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    const resumed = box.requests.slice(before).filter(request => request.range && request.range !== 'bytes=0-')
    assert.ok(resumed.length > 0, 'the second save did not resume with a Range request')
    await assertSameBytes({ box, folder: saveFolder, file: 'Master Cook/S1 E1 - Auditions.ts', title: 'S1 E1 - Auditions' })
    await assertSameBytes({ box, folder: saveFolder, file: 'Master Cook/S1 E2 - Mystery Box.ts', title: 'S1 E2 - Mystery Box' })
  } finally {
    await app.close()
    await box.stop()
  }
})

test('a recording the box keeps cutting off is listed as not saved, with a plain reason', async () => {
  const shows = demoShows({ size: MB })
  shows[0].items[1].quirks = { alwaysDropAt: Math.round(MB / 2) }
  const box = await startFakeBox({ shows: [shows[0]] })
  const userData = await freshDir('user-data-fail')
  const saveFolder = await freshDir('fail')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('heading', { name: 'Some not saved' }).waitFor({ timeout: 60000 })
    assert.deepEqual(await totals(page), { 'Saved': '3', 'Already saved': '0', 'Not saved': '1' })
    assert.equal(await page.locator('#problem-list').count(), 0)
    assert.equal(await page.locator('.stat[data-list="already"]').evaluate(tile => tile.tagName), 'DIV')
    await page.locator('.stat[data-list="saved"]').click()
    const dialog = page.locator('#info-dialog')
    await dialog.getByRole('heading', { name: 'Saved recordings' }).waitFor()
    await dialog.getByText('Master Cook · S1 E1 - Auditions').waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.dataset.list === 'saved')
    await page.locator('.stat[data-list="not-saved"]').focus()
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.list), 'not-saved')
    await page.keyboard.press('Enter')
    await dialog.getByRole('heading', { name: 'Not saved' }).waitFor()
    await dialog.getByText('Master Cook · S1 E2 - Mystery Box').waitFor()
    await dialog.locator('.problem-row .row-main').first().click()
    await dialog.getByText('The copy stopped part way, even after trying again.').waitFor()
    await dialog.getByRole('button', { name: 'Save again' }).click()
    await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Some not saved' }).waitFor({ timeout: 60000 })
    await capture({ app, page, name: '4-finished-not-saved' })
  } finally {
    await app.close()
    await box.stop()
  }
})

test('a box with no recordings explains why the list is empty', async () => {
  const box = await startFakeBox({ shows: [] })
  const userData = await freshDir('user-data-empty')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'No recordings on this box' }).waitFor()
    await capture({ app, page, name: '2-empty' })
    await page.getByRole('button', { name: 'More about: No recordings on this box' }).click()
    await page.locator('#cancelled-account', { hasText: 'A Fetch box whose account is cancelled shows its setup screen on the TV and lists no recordings.' }).waitFor()
    await page.mouse.click(5, 5)
    await page.locator('#info-dialog').waitFor({ state: 'hidden' })
  } finally {
    await app.close()
    await box.stop()
  }
})

test('saved recordings: still there is unticked, moved or deleted is ticked with the reason, new is ticked', async () => {
  const box = await startFakeBox({ shows: [demoShows()[0]] })
  const userData = await freshDir('user-data-history')
  const saveFolder = await freshDir('history')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const first = await launchApp({ userData })
  try {
    const page = await openApp(first)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await page.locator('#saved-summary', { hasText: '4 new' }).waitFor()
    await page.getByRole('button', { name: 'Select none' }).click()
    const masterCook = page.locator('li.show-row[data-show="Master Cook"]')
    await masterCook.locator('.row-main').first().click()
    await masterCook.getByLabel('S1 E1 - Auditions').check()
    await masterCook.getByLabel('S1 E2 - Mystery Box').check()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
  } finally {
    await first.close()
  }
  await fs.rm(path.join(saveFolder, 'Master Cook', 'S1 E2 - Mystery Box.ts'))
  const second = await launchApp({ userData })
  try {
    const page = await openApp(second)
    await page.locator('#saved-summary', { hasText: '2 new · 1 already saved · 1 moved or deleted' }).waitFor()
    const masterCook = page.locator('li.show-row[data-show="Master Cook"]')
    await masterCook.locator('.row-main').first().click()
    const row = (title) => masterCook.locator('.episode-row', { hasText: title })
    assert.equal(await row('S1 E1').locator('.row-main').getAttribute('data-saved'), 'saved')
    assert.equal(await masterCook.getByLabel('S1 E1 - Auditions').isChecked(), false)
    await row('S1 E1').getByText('Saved', { exact: true }).waitFor()
    assert.equal(await row('S1 E2').locator('.row-main').getAttribute('data-saved'), 'missing')
    assert.equal(await masterCook.getByLabel('S1 E2 - Mystery Box').isChecked(), true)
    await row('S1 E2').getByRole('button', { name: 'Moved or deleted' }).click()
    await page.locator('#missing-detail', { hasText: 'to Master Cook/S1 E2 - Mystery Box.ts. It is no longer there.' }).waitFor()
    assert.equal(await masterCook.getByLabel('S1 E2 - Mystery Box').isChecked(), true)
    await page.keyboard.press('Escape')
    await page.locator('#info-dialog').waitFor({ state: 'hidden' })
    assert.equal(await row('S1 E3').locator('.row-main').getAttribute('data-saved'), 'new')
    assert.equal(await masterCook.getByLabel('S1 E3 - Team Challenge').isChecked(), true)
    await capture({ app: second, page, name: '2-recordings-history' })
  } finally {
    await second.close()
    await box.stop()
  }
})

test('saved recordings: a fetchtv.json in the folder marks files saved by the command-line tool', async () => {
  const box = await startFakeBox({ shows: [demoShows()[0]] })
  const userData = await freshDir('user-data-cli')
  const saveFolder = await freshDir('cli')
  const item = [...box.catalogue.items.values()].find(entry => entry.title === 'S1 E3 - Team Challenge')
  await fs.mkdir(path.join(saveFolder, 'Master Cook'), { recursive: true })
  await fs.writeFile(path.join(saveFolder, 'Master Cook', 'S1 E3 - Team Challenge.ts'), recordingBytes(item))
  await fs.writeFile(path.join(saveFolder, 'fetchtv.json'), JSON.stringify({ [item.id]: { title: item.title, size: item.actualSize, path: 'Master Cook/S1 E3 - Team Challenge.ts' } }))
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.locator('#saved-summary', { hasText: '3 new · 1 already saved' }).waitFor()
    assert.equal(await page.locator(`.episode-row[data-episode="${item.id}"] .row-main`).getAttribute('data-saved'), 'saved')
  } finally {
    await app.close()
    await box.stop()
  }
})

test('welcome mark: the animation rests on the exact mark.svg shapes, loops, and stops for reduced motion', async () => {
  const userData = await freshDir('user-data-mark')
  const app = await launchApp({ userData })
  try {
    const page = await app.firstWindow()
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
    const markFile = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'mark.svg'), 'utf8')
    const fileShapes = {
      chips: [...markFile.matchAll(/<rect ([^>]*)\/>/g)].map(([, attributes]) => attributesOf(attributes)),
      tray: attributesOf(markFile.match(/<path ([^>]*)\/>/)[1])
    }
    const pageShapes = await page.evaluate(() => {
      const read = (element) => Object.fromEntries([...element.attributes].filter(attribute => attribute.name !== 'class').map(attribute => [attribute.name, attribute.value]))
      const mark = document.getElementById('welcome-mark')
      return { chips: [...mark.querySelectorAll('rect')].map(read), tray: read(mark.querySelector('path')) }
    })
    assert.deepEqual(pageShapes, fileShapes)
    const running = await page.evaluate(() => document.getAnimations().filter(animation => animation.animationName === 'mark-chip-drop').map(animation => animation.effect.getTiming().iterations))
    assert.deepEqual(running, [Infinity, Infinity, Infinity])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.animationName.startsWith('mark-chip')).length), 0)
  } finally {
    await app.close()
  }
})

const attributesOf = (text) => Object.fromEntries([...text.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]))

test('after a save: the card opens How to watch your recordings with three tabs and allow-listed links only', async () => {
  const box = await startFakeBox({ shows: [demoShows({ size: MB })[0]] })
  const userData = await freshDir('user-data-watch')
  const saveFolder = await freshDir('watch')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    await app.evaluate(({ shell }) => {
      globalThis.openedLinks = []
      shell.openExternal = async (url) => { globalThis.openedLinks.push(url) }
    })
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    await page.locator('#what-now-card').getByRole('heading', { name: 'I have my files, but now what?' }).waitFor()
    await page.getByRole('button', { name: 'How to watch your recordings' }).click()
    const dialog = page.locator('#info-dialog')
    await dialog.getByRole('heading', { name: 'How to watch your recordings' }).waitFor()
    await dialog.getByRole('button', { name: 'Download VLC' }).click()
    await dialog.getByRole('button', { name: 'Record free-to-air' }).click()
    await dialog.getByRole('heading', { name: 'Record free-to-air TV without Fetch' }).waitFor()
    await dialog.getByRole('button', { name: 'Learn about Freetvarr' }).click()
    assert.deepEqual(await page.evaluate(() => window.fetchtv.openLink({ name: 'https://example.com/' })), { error: 'unknown-link' })
    await page.waitForTimeout(200)
    assert.deepEqual(await app.evaluate(() => globalThis.openedLinks), ['https://www.videolan.org/vlc/', 'https://furey.github.io/freetvarr/'])
    await dialog.getByRole('button', { name: 'On your TV' }).click()
    await dialog.getByRole('button', { name: 'Save again with Plex names' }).click()
    await page.getByRole('heading', { name: 'Choose a folder' }).waitFor()
    assert.equal(await page.getByRole('switch', { name: 'Names for Plex, Jellyfin or Kodi' }).getAttribute('aria-checked'), 'true')
  } finally {
    await app.close()
    await box.stop()
  }
})

test('long result lists scroll inside the dialog, keep the title and Save again in view, and leave the page still', async () => {
  const box = await startFakeBox({ shows: bigLibrary() })
  const userData = await freshDir('user-data-long')
  const saveFolder = await freshDir('long')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'Some not saved', timeout: 170000 })
    const mainTop = await page.locator('main').evaluate(element => element.scrollTop)
    const body = page.locator('#info-body')
    const inView = (selector) => page.evaluate((target) => {
      const element = document.querySelector(target)
      const box = element.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= window.innerHeight
    }, selector)
    const lastRowVisible = () => page.evaluate(() => {
      const body = document.getElementById('info-body')
      const last = body.querySelector('.row:last-child').getBoundingClientRect()
      return last.bottom <= body.getBoundingClientRect().bottom
    })
    for (const list of ['saved', 'not-saved']) {
      await page.locator(`.stat[data-list="${list}"]`).click()
      assert.equal(await body.evaluate(element => element.scrollTop), 0)
      assert.ok(await body.evaluate(element => element.scrollHeight > element.clientHeight), `${list} list does not scroll`)
      const bodyBox = await body.boundingBox()
      await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2)
      await page.mouse.wheel(0, 100000)
      await page.waitForFunction(() => {
        const element = document.getElementById('info-body')
        return Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2
      })
      assert.equal(await lastRowVisible(), true)
      assert.equal(await inView('#info-title'), true)
      assert.equal(await inView('#info-close'), true)
      if (list === 'not-saved') assert.equal(await inView('#dialog-save-again'), true)
      assert.equal(await page.evaluate(() => document.getElementById('info-dialog').scrollTop), 0)
      await page.keyboard.press('Escape')
      await page.locator('#info-dialog').waitFor({ state: 'hidden' })
      assert.equal(await page.locator('main').evaluate(element => element.scrollTop), mainTop)
    }
    await page.locator('.stat[data-list="saved"]').click()
    assert.equal(await body.evaluate(element => element.scrollTop), 0)
  } finally {
    await app.close()
    await box.stop()
  }
})

test('the window is locked down: isolated, sandboxed, no Node in the page, strict CSP', async () => {
  const box = await startFakeBox()
  const userData = await freshDir('user-data-security')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    const consoleErrors = []
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const { contextIsolation, nodeIntegration, sandbox, webSecurity } = contents.getLastWebPreferences()
      return { contextIsolation, nodeIntegration, sandbox, webSecurity }
    })
    assert.deepEqual(preferences, { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true })
    const pageGlobals = await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      api: Object.keys(window.fetchtv).sort()
    }))
    assert.equal(pageGlobals.require, 'undefined')
    assert.equal(pageGlobals.process, 'undefined')
    assert.ok(pageGlobals.api.every(name => typeof name === 'string') && pageGlobals.api.length === 16)
    const inlineScriptRan = await page.evaluate(() => new Promise(resolve => {
      window.inlineRan = false
      const script = document.createElement('script')
      script.textContent = 'window.inlineRan = true'
      document.body.append(script)
      setTimeout(() => resolve(window.inlineRan), 100)
    }))
    assert.equal(inlineScriptRan, false)
    const remoteLoaded = await page.evaluate(() => fetch('https://example.com/').then(() => true, () => false))
    assert.equal(remoteLoaded, false)
    assert.equal(consoleErrors.filter(text => !/Content Security Policy|example\.com|ERR_BLOCKED/.test(text)).length, 0, consoleErrors.join('\n'))
  } finally {
    await app.close()
    await box.stop()
  }
})

test('discovery: finds a Fetch box on the network without typing an address', { skip: skipSsdp && 'FETCHTV_E2E_SKIP_SSDP is set' }, async () => {
  const box = await startFakeBox({ ssdp: true, name: 'Fake Fetch Box' })
  const userData = await freshDir('user-data-ssdp')
  const app = await launchApp({ userData, discovery: true })
  try {
    const page = await openApp(app)
    const listed = page.getByRole('heading', { name: 'Choose recordings' })
    const choose = page.getByRole('heading', { name: 'Choose your Fetch box' })
    await Promise.race([listed.waitFor({ timeout: 20000 }), choose.waitFor({ timeout: 20000 })])
    if (await choose.isVisible()) {
      await capture({ app, page, name: '1-choose-several' })
      await page.getByRole('button', { name: /Fake Fetch Box/ }).click()
      await listed.waitFor()
    }
    await page.locator('#box-card', { hasText: 'Fake Fetch Box' }).getByText(box.address).waitFor()
  } finally {
    await app.close()
    await box.stop()
  }
})

const launchApp = async ({ userData, discovery = false }) => {
  const env = {
    ...process.env,
    FETCHTV_USER_DATA: userData,
    FETCHTV_DISCOVERY: discovery ? 'on' : 'off',
    FETCHTV_RETRY_DELAYS_MS: '50,50'
  }
  const app = packagedExecutable
    ? await electron.launch({ executablePath: packagedExecutable, env })
    : await electron.launch({ args: [appRoot], cwd: appRoot, env })
  notSavedLog = []
  app.process().stderr.on('data', (chunk) => {
    notSavedLog.push(...String(chunk).split('\n').filter(line => line.startsWith('Not saved: ')))
  })
  return app
}

const openApp = async (app) => {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
  await capture({ app, page, name: '0-welcome' })
  if (screenshotDir) await captureAtSize({ app, page, name: '0-welcome-minimum', width: 640, height: 560 })
  await page.getByRole('button', { name: 'About this app' }).click()
  await page.locator('#independence', { hasText: 'It is not made, endorsed, or supported by Fetch TV.' }).waitFor()
  const githubLinks = page.getByRole('button', { name: 'Fetch My Recordings on GitHub' })
  assert.equal(await page.locator('#info-body').getByRole('button', { name: 'Fetch My Recordings on GitHub' }).getAttribute('title'), 'https://github.com/furey/fetch-my-recordings')
  assert.equal(await page.locator('#info-body').getByRole('button', { name: 'fetchtv command-line tool' }).getAttribute('title'), 'https://github.com/furey/fetchtv')
  assert.equal(await githubLinks.count(), 2)
  await capture({ app, page, name: '0-about' })
  await page.keyboard.press('Escape')
  await page.locator('#info-dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  return page
}

const captureAtSize = async ({ app, page, name, width, height }) => {
  const original = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height })
  await capture({ app, page, name })
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), original)
}

const waitForFinish = async ({ page, heading, timeout }) => {
  try {
    await page.getByRole('heading', { name: heading }).waitFor({ timeout })
  } catch (error) {
    const screen = await page.locator('main').innerText().catch(() => '(no screen text)')
    const reasons = notSavedLog.length ? `\nThe app logged:\n${notSavedLog.join('\n')}` : ''
    throw new Error(`"${heading}" did not appear within ${timeout} ms. The screen showed:\n${screen}${reasons}`, { cause: error })
  }
}

const stubFolderPicker = ({ app, folder }) => app.evaluate(({ dialog }, chosen) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })
}, folder)

const capture = async ({ app, page, name }) => {
  if (!screenshotDir) return
  await page.mouse.move(0, 0)
  await page.evaluate(() => { if (!document.querySelector('dialog[open]')) document.activeElement?.blur() })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
}

const totals = (page) => page.locator('#save-totals').evaluate(list => Object.fromEntries(
  [...list.querySelectorAll('.stat')].map(tile => [tile.querySelector('.stat-label').textContent, tile.querySelector('.stat-value').textContent])
))

const assertSameBytes = async ({ box, folder, file, title }) => {
  const item = [...box.catalogue.items.values()].find(entry => entry.title === title)
  const saved = await fs.readFile(path.join(folder, file))
  assert.equal(saved.length, item.actualSize)
  assert.ok(saved.equals(recordingBytes(item)), `${file} does not match the bytes the box sent`)
}

const listFiles = async (folder) => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile())
    .map(entry => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
}

const freshDir = async (name) => fs.mkdtemp(path.join(tmpRoot, `${name}-`))

const cssString = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
