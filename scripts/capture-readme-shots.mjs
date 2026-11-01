import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { MB, demoShows, startFakeBox } from '../test/fake-box.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { executable: { type: 'string' }, out: { type: 'string' }, address: { type: 'string', default: '192.168.1.50' } } })

const main = async () => {
  const out = path.resolve(values.out)
  await fs.mkdir(out, { recursive: true })
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fetch-my-recordings-shots-'))
  const userData = path.join(work, 'user-data')
  const folder = path.join(work, 'Movies', 'Fetch recordings')
  await fs.mkdir(userData, { recursive: true })
  const box = await startFakeBox({ shows: demoShows({ size: 70 * MB }), name: 'Lounge room box' })
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: folder }))
  try {
    await withApp({ userData, realAddress: box.address }, async ({ page, shot }) => {
      await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
      await page.waitForTimeout(2500)
      await shot(path.join(out, 'app-welcome.png'))
      await page.getByRole('button', { name: 'Start', exact: true }).click()
      await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 30000 })
      await page.getByRole('button', { name: 'Select none' }).click()
      const masterCook = page.locator('li.show-row[data-show="Master Cook"]')
      await masterCook.locator('.row-main').first().click()
      await masterCook.getByLabel('S1 E1 - Auditions').check()
      await masterCook.getByLabel('S1 E2 - Mystery Box').check()
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('heading', { name: 'All done' }).waitFor({ timeout: 60000 })
    })
    await fs.rm(path.join(folder, 'Master Cook', 'S1 E2 - Mystery Box.ts'))
    await withApp({ userData, realAddress: box.address }, async ({ page, shot }) => {
      await page.getByRole('button', { name: 'Start', exact: true }).click()
      await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 30000 })
      const masterCook = page.locator('li.show-row[data-show="Master Cook"]')
      await masterCook.locator('.row-main').first().click()
      await page.locator('main').evaluate((element) => {
        const row = element.querySelector('li.show-row[data-show="Master Cook"]').previousElementSibling
        element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 24
        const top = element.getBoundingClientRect().top
        const firstCut = [...element.querySelectorAll('li.show-row')].find(show => show.getBoundingClientRect().bottom > top && show.getBoundingClientRect().top < top)
        if (firstCut) element.scrollTop -= top - firstCut.getBoundingClientRect().top + 16
      })
      await shot(path.join(out, 'app-choose-recordings.png'))
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('heading', { name: 'All done' }).waitFor({ timeout: 60000 })
      await shot(path.join(out, 'app-all-done.png'))
      await page.getByRole('button', { name: 'How to watch your recordings' }).click()
      await page.locator('#info-dialog').getByRole('button', { name: 'On your TV' }).click()
      await shot(path.join(out, 'app-how-to-watch.png'))
    })
  } finally {
    await box.stop()
    await fs.rm(work, { recursive: true, force: true })
  }
}

const withApp = async ({ userData, realAddress }, run) => {
  const env = { ...process.env, FETCHTV_USER_DATA: userData, FETCHTV_DISCOVERY: 'off' }
  const app = values.executable
    ? await electron.launch({ executablePath: values.executable, env })
    : await electron.launch({ args: [appRoot], cwd: appRoot, env })
  try {
    await app.evaluate(({ shell }) => { shell.openPath = async () => '' })
    const page = await app.firstWindow()
    await page.getByRole('heading', { name: 'Fetch My Recordings' }).waitFor()
    await showAddressAs({ page, real: realAddress, shown: values.address })
    await page.evaluate(() => document.fonts.ready)
    const shot = async (file) => {
      await page.mouse.move(0, 0)
      await page.evaluate(() => { if (!document.querySelector('dialog[open]')) document.activeElement?.blur() })
      await page.waitForTimeout(400)
      await page.screenshot({ path: file })
    }
    await run({ page, shot })
  } finally {
    await app.close()
  }
}

const showAddressAs = ({ page, real, shown }) => page.evaluate(({ real, shown }) => {
  const rewrite = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.includes(real)) walker.currentNode.nodeValue = walker.currentNode.nodeValue.replaceAll(real, shown)
    }
  }
  new MutationObserver(() => rewrite(document.body)).observe(document.body, { subtree: true, childList: true, characterData: true })
  rewrite(document.body)
}, { real, shown })

await main()
