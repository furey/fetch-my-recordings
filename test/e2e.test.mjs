import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
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
  await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => null)
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
    assert.equal(await page.locator('#steps [role="button"]').count(), 0)
    await page.waitForTimeout(1500)
    await capture({ app, page, name: '4-saving' })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('heading', { name: 'Stopped', exact: true }).waitFor({ timeout: 30000 })
    await capture({ app, page, name: '4-stopped' })
    assert.deepEqual(await stepButtonNames(page), ['Back to Find your Fetch box', 'Back to Choose recordings', 'Back to Choose a folder'])

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

const BOX_WAIT_ENV = { FETCHTV_BOX_PROBE_DELAYS_MS: '300,300,300' }
const boxWaitShows = () => [{
  title: 'Master Cook',
  items: [
    { title: 'S1 E1 - Auditions', size: 32 * MB, duration: '0:58:12' },
    { title: 'S1 E2 - Mystery Box', size: 32 * MB, duration: '0:57:40' },
    { title: 'S1 E3 - Team Challenge', size: 2 * MB, duration: '0:59:03' }
  ]
}]

const startBoxWaitSave = async ({ name, env = {} }) => {
  const box = await startFakeBox({ shows: boxWaitShows(), quirks: { rangeNotSatisfiable: false }, bytesPerSecond: 4 * MB })
  const userData = await freshDir(`user-data-${name}`)
  const saveFolder = await freshDir(name)
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData, env: { ...BOX_WAIT_ENV, ...env } })
  const page = await openApp(app)
  await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor()
  await page.locator('.status', { hasText: / MB of / }).first().waitFor()
  await page.waitForTimeout(1000)
  await recordOverallLine(page)
  return { box, app, page, saveFolder }
}

const recordOverallLine = (page) => page.evaluate(() => {
  const line = document.getElementById('overall-line')
  const log = [{ at: performance.now(), text: line.textContent }]
  window.overallLineLog = log
  new MutationObserver(() => {
    if (log.at(-1).text !== line.textContent) log.push({ at: performance.now(), text: line.textContent })
  }).observe(line, { subtree: true, childList: true, characterData: true })
})

const overallLineLog = (page) => page.evaluate(() => window.overallLineLog)

const rowStatus = (page, title) => page.locator('li.save-row', { hasText: title }).locator('.status').textContent()

test('box wait: a box that restarts mid-save is waited for, then every recording is saved', async () => {
  const { box, app, page, saveFolder } = await startBoxWaitSave({ name: 'box-restart' })
  try {
    box.powerOff()
    const line = page.locator('#overall-line')
    await line.filter({ hasText: 'Waiting for the Fetch box to answer…' }).waitFor({ timeout: 15000 })
    assert.equal(await line.getAttribute('role'), 'status')
    assert.equal(await page.locator('#overall-line.is-box-state').count(), 1)
    const percentWhileWaiting = await page.locator('#overall-percent').textContent()
    await page.locator('li.save-row .status', { hasText: 'Box not answering' }).first().waitFor()
    assert.equal(await rowStatus(page, 'S1 E3 - Team Challenge'), 'Waiting')
    await page.waitForTimeout(1000)
    assert.equal(await page.locator('#overall-percent').textContent(), percentWhileWaiting)
    await box.powerOn()
    await line.filter({ hasText: 'The box is answering again.' }).waitFor({ timeout: 15000 })
    await line.filter({ hasText: / done · / }).waitFor({ timeout: 15000 })
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })

    const log = await overallLineLog(page)
    for (const text of ['Waiting for the Fetch box to answer…', 'The box is answering again.']) {
      const index = log.findIndex(entry => entry.text === text)
      assert.ok(index >= 0 && index < log.length - 1, `"${text}" did not show and then go away in ${JSON.stringify(log.map(entry => entry.text))}`)
      assert.ok(log[index + 1].at - log[index].at >= 1950, `"${text}" showed for under 2 s`)
    }
    for (const title of ['S1 E1 - Auditions', 'S1 E2 - Mystery Box', 'S1 E3 - Team Challenge']) {
      await assertSameBytes({ box, folder: saveFolder, file: `Master Cook/${title}.ts`, title })
    }
    assert.ok(box.requests.some(request => request.range && request.range !== 'bytes=0-' && request.range !== 'bytes=0-0'), 'no recording resumed with a Range request')
  } finally {
    await app.close()
    await box.stop()
  }
})

test('box wait: a box that stays off fails the rest with a plain reason, and Save again finds it and lists again first', async () => {
  const { box, app, page, saveFolder } = await startBoxWaitSave({ name: 'box-gone', env: { FETCHTV_BOX_WAIT_MS: '900' } })
  try {
    box.powerOff()
    await waitForFinish({ page, heading: 'Some not saved', timeout: 30000 })
    await page.locator('.stat[data-list="not-saved"]').click()
    const dialog = page.locator('#info-dialog')
    await dialog.locator('.problem-row .row-main').first().click()
    await dialog.getByText('The box did not answer for 10 minutes. Check whether it is in standby. If it is, turn it on with its remote. Also check that this computer is on the same network. Then save again.').first().waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })

    await box.powerOn()
    await recordScreens(page)
    await page.getByRole('button', { name: 'Save again' }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    const screens = (await screenLog(page)).map(entry => entry.text)
    const order = ['Looking for your Fetch box', 'Reading your recordings', 'Saving'].map(heading => screens.findIndex(text => text.startsWith(heading)))
    assert.ok(order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1])), `screens were ${JSON.stringify(screens)}`)
    for (const title of ['S1 E1 - Auditions', 'S1 E2 - Mystery Box', 'S1 E3 - Team Challenge']) {
      await assertSameBytes({ box, folder: saveFolder, file: `Master Cook/${title}.ts`, title })
    }
  } finally {
    await app.close()
    await box.stop()
  }
})

const loseBoxDuringSave = async ({ name, shows, select }) => {
  const box = await startFakeBox({ shows, quirks: { rangeNotSatisfiable: false }, bytesPerSecond: 2 * MB })
  const userData = await freshDir(`user-data-${name}`)
  const saveFolder = await freshDir(name)
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData, env: { ...BOX_WAIT_ENV, FETCHTV_BOX_WAIT_MS: '900' } })
  const page = await openApp(app)
  await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
  await select(page)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.status', { hasText: / MB of / }).first().waitFor()
  box.powerOff()
  await waitForFinish({ page, heading: 'Some not saved', timeout: 30000 })
  return { box, app, page }
}

const tickOnly = async ({ page, show, indexes }) => {
  await page.getByRole('button', { name: 'Select none' }).click()
  const row = page.locator(`li.show-row[data-show="${show}"]`)
  await row.locator('.row-main').first().click()
  const episodes = row.locator('li.episode-row')
  const ids = []
  for (const index of indexes) {
    await episodes.nth(index).locator('input[type="checkbox"]').check()
    ids.push(await episodes.nth(index).getAttribute('data-episode'))
  }
  return ids
}

const sameTitleShows = (sizeOf) => [{ title: 'Seven News', items: Array.from({ length: 10 }, (_, index) => ({ title: 'Seven News', size: sizeOf(index), duration: '0:30:00' })) }]

const saveAgainKeepsTicked = async ({ name, shows }) => {
  let ticked = []
  const { box, app, page } = await loseBoxDuringSave({ name, shows, select: async (page) => { ticked = await tickOnly({ page, show: 'Seven News', indexes: [3, 7] }) } })
  try {
    await box.powerOn()
    await page.getByRole('button', { name: 'Save again' }).click()
    await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor({ timeout: 30000 })
    const saving = await page.locator('li.save-row').evaluateAll(rows => rows.map(row => row.dataset.episode))
    assert.deepEqual(saving.sort(), ticked.sort())
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('heading', { name: 'Stopped', exact: true }).waitFor({ timeout: 10000 })
  } finally {
    await app.close()
    await box.stop()
  }
}

test('box wait: Save again picks the same same-title recordings by size', () =>
  saveAgainKeepsTicked({ name: 'same-title-sizes', shows: sameTitleShows(index => 6 * MB + index * 4096) }))

test('box wait: Save again keeps the ticked same-title recordings when their sizes are equal', () =>
  saveAgainKeepsTicked({ name: 'same-title-equal', shows: sameTitleShows(() => 6 * MB) }))

const saveAgainAfterLosing = async ({ name, lose }) => {
  const shows = [
    { title: 'Master Cook', items: [{ title: 'S1 E1 - Auditions', size: 8 * MB, duration: '0:58:12' }] },
    { title: 'Jurassic Car Park', items: [{ title: 'Jurassic Car Park', size: 8 * MB, duration: '2:07:15' }] }
  ]
  const { box, app, page } = await loseBoxDuringSave({ name, shows, select: async () => {} })
  try {
    lose(box)
    await box.powerOn()
    await page.getByRole('button', { name: 'Save again' }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 30000 })
    await page.getByText('1 recording selected').waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Saving', exact: true }).count(), 0)
  } finally {
    await app.close()
    await box.stop()
  }
}

test('box wait: Save again stops on Choose recordings when a wanted recording is gone', () =>
  saveAgainAfterLosing({ name: 'gone', lose: (box) => { box.catalogue.showFolders.find(folder => folder.title === 'Jurassic Car Park').items = [] } }))

test('box wait: Save again stops on Choose recordings when the box answers error 501 for a wanted show', () =>
  saveAgainAfterLosing({ name: 'gone-501', lose: (box) => box.forgetShow('Jurassic Car Park') }))

test('box wait: Stop while waiting for the box ends the save at once and keeps the partial files', async () => {
  const { box, app, page, saveFolder } = await startBoxWaitSave({ name: 'box-stop' })
  try {
    box.powerOff()
    await page.locator('#overall-line', { hasText: 'Waiting for the Fetch box to answer…' }).waitFor({ timeout: 15000 })
    const stoppedAt = Date.now()
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('heading', { name: 'Stopped', exact: true }).waitFor({ timeout: 5000 })
    assert.ok(Date.now() - stoppedAt < 3000, 'Stop took more than 3 s during the wait')
    const files = await listFiles(saveFolder)
    assert.ok(files.some(file => file.endsWith('.ts.part')), `no partial file in ${files.join(', ')}`)
    assert.equal(files.some(file => file.endsWith('.lock')), false)
  } finally {
    await app.close()
    await box.stop()
  }
})

const QUIT_EXIT_MS = 3000
const quitShows = () => [{
  title: 'Master Cook',
  items: [
    { title: 'S1 E1 - Auditions', size: 24 * MB, duration: '0:58:12' },
    { title: 'S1 E2 - Mystery Box', size: 24 * MB, duration: '0:57:40' },
    { title: 'S1 E3 - Team Challenge', size: 24 * MB, duration: '0:59:03' }
  ]
}]

const quitApp = ({ app }) => { setTimeout(() => app.quit(), 0) }
const closeWindow = ({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0) }

const startQuitSave = async ({ name, shows = quitShows(), quirks = {}, env = {} }) => {
  const box = await startFakeBox({ shows, quirks: { rangeNotSatisfiable: false, ...quirks }, bytesPerSecond: 2 * MB })
  const userData = await freshDir(`user-data-${name}`)
  const saveFolder = await freshDir(name)
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData, env })
  const page = await openApp(app)
  await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.status', { hasText: / MB of / }).first().waitFor()
  await waitForPartialFile(saveFolder)
  return { box, app, child: app.process(), page, userData, saveFolder }
}

const waitForPartialFile = async (folder, timeout = 15000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await hasStartedPartialFile(folder)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`no partial file with bytes in ${folder} after ${timeout} ms`)
}

const hasStartedPartialFile = async (folder) => {
  const parts = (await listFiles(folder)).filter(file => file.endsWith('.ts.part'))
  const sizes = await Promise.all(parts.map(part => fs.stat(path.join(folder, part)).then(stat => stat.size, () => 0)))
  return sizes.some(size => size > 0)
}

const answerCloseQuestion = ({ app, button }) => app.evaluate(({ dialog }, label) => {
  globalThis.closeQuestions = 0
  dialog.showMessageBox = async (...args) => {
    globalThis.closeQuestions += 1
    const { buttons } = args.at(-1)
    if (label) return { response: buttons.indexOf(label) }
    return new Promise(resolve => {
      globalThis.sendCloseAnswer = () => resolve({ response: buttons.indexOf('Stop and close') })
    })
  }
}, button)

const closeQuestionCount = (app) => app.evaluate(() => globalThis.closeQuestions)

const quitAndTime = async ({ app, child, quit }) => {
  const exited = new Promise(resolve => child.once('exit', () => resolve('exited')))
  const started = Date.now()
  await app.evaluate(quit)
  const outcome = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve('running'), QUIT_EXIT_MS))])
  return { outcome, ms: Date.now() - started }
}

const stopIfRunning = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  process.kill(child.pid, 'SIGKILL')
  await exited
}

const assertResumableParts = async ({ box, saveFolder }) => {
  const files = await listFiles(saveFolder)
  const parts = files.filter(file => file.endsWith('.ts.part'))
  assert.ok(parts.length > 0, `no partial file in ${files.join(', ')}`)
  assert.equal(files.some(file => file.endsWith('.lock')), false, `a lock file is left in ${files.join(', ')}`)
  for (const part of parts) {
    const title = path.basename(part, '.ts.part')
    const item = [...box.catalogue.items.values()].find(entry => entry.title === title)
    const saved = await fs.readFile(path.join(saveFolder, part))
    assert.ok(saved.length < item.actualSize, `${part} is not partial`)
    assert.ok(saved.equals(recordingBytes(item).subarray(0, saved.length)), `${part} does not match the start of the recording`)
  }
}

const assertQuitEndsSave = async ({ name, quit, quirks, env, during = async () => {} }) => {
  const { box, app, child, page, saveFolder } = await startQuitSave({ name, quirks, env })
  try {
    await during({ box, page })
    await answerCloseQuestion({ app, button: 'Stop and close' })
    const { outcome, ms } = await quitAndTime({ app, child, quit })
    assert.equal(outcome, 'exited', `the app was still running ${ms} ms after the quit`)
    await assertResumableParts({ box, saveFolder })
  } finally {
    await stopIfRunning(child)
    await box.stop()
  }
}

test('quit during save: app.quit asks first, then ends the save at once, and a later save carries on from the partial files', async () => {
  const { box, app, child, userData, saveFolder } = await startQuitSave({ name: 'quit-app' })
  try {
    await answerCloseQuestion({ app, button: 'Stop and close' })
    const { outcome, ms } = await quitAndTime({ app, child, quit: quitApp })
    assert.equal(outcome, 'exited', `the app was still running ${ms} ms after app.quit()`)
    await assertResumableParts({ box, saveFolder })
  } catch (error) {
    await stopIfRunning(child)
    await box.stop()
    throw error
  }
  const again = await launchApp({ userData })
  try {
    const page = await openApp(again)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    for (const { title } of quitShows()[0].items) await assertSameBytes({ box, folder: saveFolder, file: `Master Cook/${title}.ts`, title })
    assert.ok(box.requests.some(request => request.range && !/^bytes=0-/.test(request.range)), 'no recording resumed with a Range request')
  } finally {
    await again.close()
    await box.stop()
  }
})

test('quit during save: closing the window asks first, then ends the save at once', () =>
  assertQuitEndsSave({ name: 'quit-window', quit: closeWindow }))

test('quit during save: quitting while the box is silent mid-stream ends the save at once', () =>
  assertQuitEndsSave({
    name: 'quit-silent',
    quit: quitApp,
    quirks: { goSilentAt: 4 * MB },
    during: ({ page }) => page.waitForTimeout(3000)
  }))

test('quit during save: quitting while waiting for the box ends the save at once', () =>
  assertQuitEndsSave({
    name: 'quit-box-wait',
    quit: quitApp,
    env: BOX_WAIT_ENV,
    during: async ({ box, page }) => {
      box.powerOff()
      await page.locator('#overall-line', { hasText: 'Waiting for the Fetch box to answer…' }).waitFor({ timeout: 15000 })
    }
  }))

test('quit during save: Stop and close still closes when the save ends while the question is open', async () => {
  const shows = [{ title: 'Master Cook', items: [{ title: 'S1 E1 - Auditions', size: 4 * MB, duration: '0:58:12' }] }]
  const { box, app, child, page } = await startQuitSave({ name: 'quit-late-answer', shows })
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args) => new Promise(resolve => {
        globalThis.sendCloseAnswer = () => resolve({ response: args.at(-1).buttons.indexOf('Stop and close') })
      })
    })
    await app.evaluate(quitApp)
    await waitForFinish({ page, heading: 'All done', timeout: 30000 })
    const { outcome, ms } = await quitAndTime({ app, child, quit: () => { setTimeout(() => globalThis.sendCloseAnswer(), 0) } })
    assert.equal(outcome, 'exited', `the app was still running ${ms} ms after Stop and close`)
  } finally {
    await stopIfRunning(child)
    await box.stop()
  }
})

test('quit during save: Keep saving cancels the quit, and an unanswered question keeps the app open', async () => {
  const { box, app, child, page } = await startQuitSave({ name: 'quit-keep' })
  try {
    await answerCloseQuestion({ app, button: 'Keep saving' })
    const kept = await quitAndTime({ app, child, quit: quitApp })
    assert.equal(kept.outcome, 'running')
    assert.equal(await closeQuestionCount(app), 1)
    await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor()
    await answerCloseQuestion({ app, button: null })
    const waiting = await quitAndTime({ app, child, quit: closeWindow })
    assert.equal(waiting.outcome, 'running')
    assert.equal(await closeQuestionCount(app), 1)
    const closed = await quitAndTime({ app, child, quit: () => { setTimeout(() => globalThis.sendCloseAnswer(), 0) } })
    assert.equal(closed.outcome, 'exited')
  } finally {
    await stopIfRunning(child)
    await box.stop()
  }
})

test('quit during save: quitting again while the question is open asks once, then Stop and close quits', async () => {
  const { box, app, child } = await startQuitSave({ name: 'quit-twice' })
  try {
    await app.evaluate(({ dialog }) => {
      globalThis.closeQuestions = 0
      dialog.showMessageBox = async (...args) => new Promise(resolve => {
        globalThis.closeQuestions += 1
        globalThis.sendCloseAnswer = () => resolve({ response: args.at(-1).buttons.indexOf('Stop and close') })
      })
    })
    await app.evaluate(quitApp)
    await app.evaluate(quitApp)
    await app.evaluate(closeWindow)
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.equal(await closeQuestionCount(app), 1)
    const { outcome, ms } = await quitAndTime({ app, child, quit: () => { setTimeout(() => globalThis.sendCloseAnswer(), 0) } })
    assert.equal(outcome, 'exited', `the app was still running ${ms} ms after Stop and close`)
  } finally {
    await stopIfRunning(child)
    await box.stop()
  }
})

test('quit during save: after Keep saving cancels a quit, a window that fails to load still offers a reload', async () => {
  const { box, app, child, userData } = await startQuitSave({ name: 'quit-keep-reload' })
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args) => ({ response: Math.max(0, args.at(-1).buttons.indexOf('Keep saving')) })
    })
    const kept = await quitAndTime({ app, child, quit: quitApp })
    assert.equal(kept.outcome, 'running')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.loadURL('file:///fmr-missing-page.html').catch(() => null)
    })
    const deadline = Date.now() + 10000
    while (!/Reloading the window\./.test(await readMainLog(userData)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200))
    assert.match(await readMainLog(userData), /The window did not load: .*\n.*Reloading the window\./s)
    await answerCloseQuestion({ app, button: 'Stop and close' })
    const closed = await quitAndTime({ app, child, quit: quitApp })
    assert.equal(closed.outcome, 'exited')
  } finally {
    await stopIfRunning(child)
    await box.stop()
  }
})

test('a cancelled box, modelled on the real captures, says it has no recordings', async () => {
  const box = await startFakeBox({ cancelled: true })
  const userData = await freshDir('user-data-cancelled')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'No recordings on this box' }).waitFor()
    assert.match(await readMainLog(userData), /Listed recordings from box 127\.0\.0\.1: empty\./)
  } finally {
    await app.close()
    await box.stop()
  }
})

test('a show the box answers error 501 for is left out of the list, quickly', async () => {
  const box = await startFakeBox({ shows: demoShows({ size: MB }) })
  box.forgetShow('Jurassic Car Park')
  const userData = await freshDir('user-data-forgotten')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    const startedAt = Date.now()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    assert.ok(Date.now() - startedAt < 5000, 'the list took longer than 5 s')
    await page.locator('li.show-row[data-show="Master Cook"]').waitFor()
    assert.equal(await page.locator('li.show-row[data-show="Jurassic Car Park"]').count(), 0)
    assert.equal(box.requests.filter(request => request.method === 'POST').length, 2 + box.catalogue.showFolders.length, 'a show browse was retried')
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
    await page.locator('#empty-reason', { hasText: 'The box answered, and it has no recordings.' }).waitFor()
    await page.mouse.click(5, 5)
    await page.locator('#info-dialog').waitFor({ state: 'hidden' })
    assert.match(await readMainLog(userData), /Listed recordings from box 127\.0\.0\.1: empty\./)
  } finally {
    await app.close()
    await box.stop()
  }
})

test('a box with no Recordings folder says it is not sharing its recordings', async () => {
  const box = await startFakeBox({ rootFolders: ['Live TV'] })
  const userData = await freshDir('user-data-not-sharing')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'The box is not sharing its recordings' }).waitFor()
    await page.locator('#check-tv', { hasText: 'Check the TV. If it shows the Fetch setup or activation screen, the box has lost its Fetch service.' }).waitFor()
    await page.getByRole('button', { name: 'More about: The box is not sharing its recordings' }).click()
    await page.locator('#lost-service', { hasText: 'the account is cancelled or suspended, or the box cannot reach the internet' }).waitFor()
    assert.match(await readMainLog(userData), /Listed recordings from box 127\.0\.0\.1: no-recordings-folder\. The box listed these folders: Live TV\./)
  } finally {
    await app.close()
    await box.stop()
  }
})

test('a box that fails the Recordings request asks for a restart, not an empty list', async () => {
  const box = await startFakeBox({ failingBrowses: ['1'] })
  const userData = await freshDir('user-data-no-answer')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'The box did not send its recordings' }).waitFor({ timeout: 60000 })
    await page.locator('#restart-box', { hasText: 'Restart the Fetch box, then try again.' }).waitFor()
    await page.getByRole('button', { name: 'Try again' }).waitFor()
    await page.getByRole('button', { name: 'Search again' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'No recordings on this box' }).count(), 0)
    assert.match(await readMainLog(userData), /Listed recordings from box 127\.0\.0\.1: recordings-browse-failed\. Error: .*500/)
  } finally {
    await app.close()
    await box.stop()
  }
})

test('a box that fails the root folder request asks for a restart, not an empty list', async () => {
  const box = await startFakeBox({ failingBrowses: ['0'] })
  const userData = await freshDir('user-data-root-no-answer')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'The box did not send its recordings' }).waitFor({ timeout: 60000 })
    assert.equal(await page.getByRole('heading', { name: 'No recordings on this box' }).count(), 0)
    assert.match(await readMainLog(userData), /Listed recordings from box 127\.0\.0\.1: browse-failed\. Error: .*500/)
  } finally {
    await app.close()
    await box.stop()
  }
})

test('a box that fails every show request asks for a restart, not an empty list', async () => {
  const shows = demoShows().slice(0, 2)
  const box = await startFakeBox({ shows, failingBrowses: ['100', '101'] })
  const userData = await freshDir('user-data-shows-no-answer')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'The box did not send its recordings' }).waitFor({ timeout: 60000 })
    assert.equal(await page.getByRole('heading', { name: 'No recordings on this box' }).count(), 0)
    assert.match(await readMainLog(userData), /Listed recordings from box 127\.0\.0\.1: items-browse-failed\. Error: .*500/)
  } finally {
    await app.close()
    await box.stop()
  }
})

const readMainLog = (userData) => fs.readFile(path.join(userData, 'logs', 'main.log'), 'utf8').catch(() => '')

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
    await dialog.getByRole('button', { name: 'Convert to MP4' }).click()
    await dialog.getByRole('button', { name: 'Record free-to-air' }).click()
    await dialog.getByRole('heading', { name: 'Record free-to-air TV without Fetch' }).waitFor()
    await dialog.getByRole('button', { name: 'Learn about Freetvarr' }).click()
    assert.deepEqual(await page.evaluate(() => window.fetchtv.openLink({ name: 'https://example.com/' })), { error: 'unknown-link' })
    await page.waitForTimeout(200)
    assert.deepEqual(await app.evaluate(() => globalThis.openedLinks), ['https://www.videolan.org/vlc/', 'https://furey.github.io/freetvarr/guide/leaving-fetch#converting-recordings-to-mp4', 'https://furey.github.io/freetvarr/'])
    await dialog.getByRole('button', { name: 'On your TV' }).click()
    await dialog.getByRole('button', { name: 'Save again with Plex names' }).click()
    await page.getByRole('heading', { name: 'Choose a folder' }).waitFor()
    assert.equal(await page.getByRole('switch', { name: 'Names for Plex, Jellyfin or Kodi' }).getAttribute('aria-checked'), 'true')
    const plainFiles = (await listFiles(saveFolder)).filter(file => file.endsWith('.ts'))
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    const files = (await listFiles(saveFolder)).filter(file => file.endsWith('.ts'))
    const plexFiles = files.filter(file => file.includes('/Season 01/'))
    assert.equal(plexFiles.length, plainFiles.length)
    assert.deepEqual(files.filter(file => !plexFiles.includes(file)), plainFiles)
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
    assert.ok(pageGlobals.api.every(name => typeof name === 'string') && pageGlobals.api.length === 18)
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

test('step bar: completed steps go back and keep the box, ticks, and folder; current and later steps stay put', async () => {
  const box = await startFakeBox()
  const userData = await freshDir('user-data-steps')
  const saveFolder = await freshDir('steps')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    assert.deepEqual(await stepButtonNames(page), ['Back to Find your Fetch box'])
    assert.equal(await cursorOf(page.locator('#steps li[data-step="1"] .step')), 'pointer')
    assert.equal(await cursorOf(page.locator('#steps li[data-step="2"] .step')), 'auto')
    await page.locator('li.show-row[data-show="Master Cook"] .row-main input[type="checkbox"]').first().uncheck()
    const selection = await page.locator('#selection-summary').innerText()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('heading', { name: 'Choose a folder' }).waitFor()
    await page.getByRole('switch', { name: 'Names for Plex, Jellyfin or Kodi' }).click()
    assert.deepEqual(await stepButtonNames(page), ['Back to Find your Fetch box', 'Back to Choose recordings'])

    await page.getByRole('button', { name: 'Back to Choose recordings' }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    assert.equal(await page.locator('#selection-summary').innerText(), selection)

    await page.getByRole('button', { name: 'Back to Find your Fetch box' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Fetch box found' }).waitFor()
    assert.deepEqual(await stepButtonNames(page), [])
    await page.getByRole('button', { name: /Test Fetch Box/ }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    assert.equal(await page.locator('#selection-summary').innerText(), selection)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.locator(`#folder-path[data-path="${cssString(saveFolder)}"]`).waitFor()
    assert.equal(await page.getByRole('switch', { name: 'Names for Plex, Jellyfin or Kodi' }).getAttribute('aria-checked'), 'true')

    await page.getByRole('button', { name: 'Back to start' }).click()
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
  } finally {
    await app.close()
    await box.stop()
  }
})

test('logo: goes back to start, and asks first while a save is running', async () => {
  const box = await startFakeBox({
    shows: [{ title: 'Master Cook', items: [{ title: 'S1 E1 - Auditions', size: 24 * MB, duration: '0:58:12' }] }],
    quirks: { rangeNotSatisfiable: false },
    bytesPerSecond: 2 * MB
  })
  const userData = await freshDir('user-data-logo')
  const saveFolder = await freshDir('logo')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await openApp(app)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    const home = page.getByRole('button', { name: 'Back to start' })
    await home.hover()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.home-tip')).opacity === '1')
    assert.equal(await page.locator('.home-tip').innerText(), 'Back to start')
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.locator('.status', { hasText: / MB of / }).first().waitFor()

    await home.click()
    await page.locator('#info-dialog').getByRole('heading', { name: 'Recordings are still saving' }).waitFor()
    await page.getByRole('button', { name: 'Keep saving' }).click()
    await page.locator('#info-dialog').waitFor({ state: 'hidden' })
    await page.getByRole('heading', { name: 'Saving', exact: true }).waitFor()

    await home.click()
    await page.getByRole('button', { name: 'Stop and go to start' }).click()
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor({ timeout: 30000 })
    const files = await listFiles(saveFolder)
    assert.ok(files.some(file => file.endsWith('.ts.part')), `no partial file in ${files.join(', ')}`)
    assert.equal(files.some(file => file.endsWith('.lock')), false)
  } finally {
    await app.close()
    await box.stop()
  }
})

test('find your Fetch box: a background search that found nothing is redone, visibly, on arrival', async () => {
  const silent = await startSilentBox()
  const userData = await freshDir('user-data-arrival')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: silent.address }))
  const app = await launchApp({ userData })
  let box = null
  try {
    const page = await app.firstWindow()
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
    await waitUntil(() => silent.requests.length >= 1)
    await page.waitForTimeout(500)
    await silent.stop()
    box = await startFakeBox({ port: silent.port })
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('heading', { name: 'Looking for your Fetch box' }).waitFor()
    await page.locator('#search-status', { hasText: 'Searching your home network…' }).waitFor()
    await capture({ app, page, name: '1-searching-on-arrival' })
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 20000 })
    await page.locator('#box-card').getByText(box.address).waitFor()
  } finally {
    await app.close()
    await silent.stop()
    await box?.stop()
  }
})

test('not found: searches twice before saying so, names the firewall, and every busy state shows for long enough', async () => {
  const silent = await startSilentBox()
  const box = await startFakeBox()
  const userData = await freshDir('user-data-busy')
  const saveFolder = await freshDir('busy')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: silent.address, lastFolder: saveFolder }))
  const app = await launchApp({ userData })
  try {
    const page = await app.firstWindow()
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
    await waitUntil(() => silent.requests.length >= 1)
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('heading', { name: 'No Fetch box found' }).waitFor({ timeout: 20000 })
    assert.equal(silent.requests.length, 3)
    await page.getByRole('button', { name: 'More about: No Fetch box found' }).click()
    await page.locator('#firewall-tip', { hasText: 'If a firewall app (such as Little Snitch) or your computer asked to allow Fetch My Recordings on your local network, allow it, then choose Search again.' }).waitFor()
    await capture({ app, page, name: '1-not-found-info' })
    await page.keyboard.press('Escape')

    await recordScreens(page)
    await page.getByRole('button', { name: 'Search again' }).click()
    await page.getByRole('heading', { name: 'No Fetch box found' }).waitFor({ timeout: 20000 })
    assert.equal(silent.requests.length, 5)
    assertShownFor({ log: await screenLog(page), text: 'Looking for your Fetch box', ms: 800 })

    await recordScreens(page)
    await page.getByLabel('Or type its IP address').fill(box.address)
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    const connecting = await screenLog(page)
    assertShownFor({ log: connecting, text: 'Connecting…', ms: 800 })
    assertShownFor({ log: connecting, text: 'Reading your recordings', ms: 800 })

    await recordScreens(page)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.locator('#folder-info', { hasText: 'Needs' }).waitFor()
    assertShownFor({ log: await screenLog(page), text: 'Checking free space…', ms: 800 })

    await stubFolderPicker({ app, folder: await freshDir('busy-other') })
    await recordScreens(page)
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await page.locator('#folder-info', { hasText: 'Needs' }).waitFor()
    assertShownFor({ log: await screenLog(page), text: 'Checking free space…', ms: 800 })

    await recordScreens(page)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForFinish({ page, heading: 'All done', timeout: 60000 })
    assertShownFor({ log: await screenLog(page), text: 'Saving', ms: 800 })
  } finally {
    await app.close()
    await silent.stop()
    await box.stop()
  }
})

test('remembered box: a direct check of the saved address finds it without a network search', async () => {
  const box = await startFakeBox()
  const userData = await freshDir('user-data-remembered')
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address }))
  const app = await launchApp({ userData, discovery: true })
  try {
    const page = await openApp(app)
    const started = Date.now()
    await page.getByRole('heading', { name: 'Reading your recordings' }).waitFor()
    assert.ok(Date.now() - started < 2500, `finding the remembered box took ${Date.now() - started} ms, so a network search ran`)
    await page.getByRole('heading', { name: 'Choose recordings' }).waitFor()
    assert.ok(box.requests.some(request => request.method === 'GET' && request.url === '/MediaServer.xml'))
  } finally {
    await app.close()
    await box.stop()
  }
})

const startSilentBox = async ({ port = 0 } = {}) => {
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(404)
    res.end()
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  const actualPort = server.address().port
  return {
    address: `127.0.0.1:${actualPort}`,
    port: actualPort,
    requests,
    stop: async () => {
      if (!server.listening) return
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}

const waitUntil = async (condition, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

const stepButtonNames = (page) => page.locator('#steps [role="button"]').evaluateAll(steps => steps.map(step => step.getAttribute('aria-label')))

const cursorOf = (locator) => locator.evaluate(element => getComputedStyle(element).cursor)

const recordScreens = (page) => page.evaluate(() => {
  window.screenObserver?.disconnect()
  const snapshot = () => [
    document.querySelector('#view h1')?.textContent ?? '',
    document.querySelector('.address-form button[type="submit"]')?.textContent ?? '',
    document.getElementById('folder-info')?.textContent ?? ''
  ].join(' | ')
  const log = []
  const note = () => {
    const text = snapshot()
    if (log.at(-1)?.text !== text) log.push({ at: performance.now(), text })
  }
  window.screenLog = log
  window.screenObserver = new MutationObserver(note)
  window.screenObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
  note()
})

const screenLog = (page) => page.evaluate(() => window.screenLog)

const assertShownFor = ({ log, text, ms }) => {
  const start = log.findIndex(entry => entry.text.includes(text))
  assert.ok(start >= 0, `"${text}" never showed in ${JSON.stringify(log.map(entry => entry.text))}`)
  const end = log.findIndex((entry, index) => index > start && !entry.text.includes(text))
  assert.ok(end > start, `"${text}" never went away`)
  const shown = log[end].at - log[start].at
  assert.ok(shown >= ms, `"${text}" showed for ${Math.round(shown)} ms, under ${ms} ms`)
}

const launchApp = async ({ userData, discovery = false, env: extraEnv = {} }) => {
  const env = {
    ...process.env,
    FETCHTV_USER_DATA: userData,
    FETCHTV_DISCOVERY: discovery ? 'on' : 'off',
    FETCHTV_RETRY_DELAYS_MS: '50,50',
    FMR_QUIET_WINDOW: '1',
    ...extraEnv
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
