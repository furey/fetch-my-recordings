import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { chromium, _electron as electron } from 'playwright-core'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(process.env.FMR_ROOT ?? path.join(SCRIPT_DIR, '..'))
const ELECTRON = createRequire(path.join(APP_ROOT, 'package.json'))('electron')
const OUT = path.resolve(process.env.SOCIAL_OUT ?? path.join(APP_ROOT, 'docs/img/social-preview.png'))
const SCREEN = process.env.SOCIAL_SCREEN ?? 'choose'

const NAME = 'Fetch My Recordings'
const REPO_URL = 'github.com/furey/fetch-my-recordings'
const TAGLINES = {
  a: ['Copy your Fetch&nbsp;TV recordings to your computer.', 'Watch them on your&nbsp;TV.'],
  b: ['Keep your Fetch&nbsp;TV recordings.', 'Copy them to your computer and watch on your&nbsp;TV.']
}
const TAGLINE = TAGLINES[process.env.SOCIAL_TAGLINE ?? 'a']

const card = { width: 1280, height: 640 }
const WINDOW_SIZE = { width: 760, height: 700 }
const SHOWN_ADDRESS = '192.168.1.50'

const main = async () => {
  const [assets, shot] = await Promise.all([loadAssets(), captureApp()])
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: card, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.setContent(cardHtml({ assets, shot }))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => [...document.images].every((img) => img.complete))
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await page.screenshot({ path: OUT, type: 'png' })
  await browser.close()
  console.log(`[social] wrote ${OUT}`)
}

const captureApp = async () => {
  const { MB, demoShows, startFakeBox } = await import(path.join(APP_ROOT, 'test/fake-box.mjs'))
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fetch-my-recordings-social-'))
  const userData = path.join(work, 'user-data')
  const folder = path.join(work, 'Movies', 'Fetch recordings')
  await fs.mkdir(userData, { recursive: true })
  const box = await startFakeBox({
    shows: demoShows({ size: 140 * MB }),
    name: 'Lounge room box',
    bytesPerSecond: 6 * MB
  })
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastAddress: box.address, lastFolder: folder }))
  try {
    return await withApp({ userData, realAddress: box.address }, SCREEN === 'saving' ? shootSaving : shootChoose)
  } finally {
    await box.stop()
    await fs.rm(work, { recursive: true, force: true })
  }
}

const shootChoose = async ({ page, shot }) => {
  await openChooseRecordings(page)
  await page.locator('li.show-row[data-show="Master Cook"] .row-main').first().click()
  await page.locator('main').evaluate((element) => { element.scrollTop = 0 })
  return shot()
}

const shootSaving = async ({ page, shot }) => {
  await openChooseRecordings(page)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: 'Saving' }).waitFor({ timeout: 30000 })
  await page.waitForTimeout(9000)
  return shot()
}

const openChooseRecordings = async (page) => {
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByRole('heading', { name: 'Choose recordings' }).waitFor({ timeout: 30000 })
}

const withApp = async ({ userData, realAddress }, run) => {
  const env = { ...process.env, FETCHTV_USER_DATA: userData, FETCHTV_DISCOVERY: 'off', FMR_QUIET_WINDOW: '1' }
  const app = await electron.launch({ executablePath: ELECTRON, args: [APP_ROOT], cwd: APP_ROOT, env })
  try {
    await app.evaluate(({ shell }) => { shell.openPath = async () => '' })
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
    }, WINDOW_SIZE)
    await page.getByRole('heading', { name: NAME }).waitFor()
    await showAddressAs({ page, real: realAddress, shown: SHOWN_ADDRESS })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(1500)
    const shot = async () => {
      await page.mouse.move(0, 0)
      await page.evaluate(() => { if (!document.querySelector('dialog[open]')) document.activeElement?.blur() })
      await page.waitForTimeout(400)
      return (await page.screenshot({ type: 'png' })).toString('base64')
    }
    return await run({ page, shot })
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

const loadAssets = async () => {
  const fontDir = path.join(APP_ROOT, 'src/renderer/fonts')
  const [figtree, mono, icon] = await Promise.all([
    fs.readFile(path.join(fontDir, 'figtree-latin-variable.woff2')),
    fs.readFile(path.join(fontDir, 'geist-mono-latin-500-normal.woff2')),
    fs.readFile(path.join(APP_ROOT, 'build/icons/256x256.png'))
  ])
  return {
    figtree: figtree.toString('base64'),
    mono: mono.toString('base64'),
    icon: icon.toString('base64')
  }
}

const layoutOf = () => {
  const unit = card.height / 630
  return {
    left: Math.round(64 * unit),
    copyWidth: Math.round(470 * unit),
    iconSize: Math.round(96 * unit),
    nameSize: Math.round(44 * unit),
    headlineSize: Math.round(35 * unit),
    urlSize: Math.round(22 * unit),
    urlBottom: Math.round(56 * unit),
    frameLeft: card.width - Math.round(628 * unit),
    frameTop: Math.round(48 * unit),
    frameWidth: Math.round(690 * unit),
    barHeight: Math.round(34 * unit),
    dot: Math.round(11 * unit),
    radius: Math.round(14 * unit)
  }
}

const cardHtml = ({ assets, shot }) => {
  const l = layoutOf()
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face {
  font-family: "Figtree";
  font-weight: 300 900;
  src: url(data:font/woff2;base64,${assets.figtree}) format("woff2");
}
@font-face {
  font-family: "Geist Mono";
  font-weight: 500;
  src: url(data:font/woff2;base64,${assets.mono}) format("woff2");
}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${card.width}px; height: ${card.height}px; overflow: hidden; }
body {
  position: relative;
  background: #0b1117;
  color: #f2f5f7;
  font-family: "Figtree", sans-serif;
}
.copy {
  position: absolute;
  left: ${l.left}px;
  top: 0;
  bottom: ${l.urlBottom + l.urlSize}px;
  width: ${l.copyWidth}px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.brand {
  display: flex;
  align-items: center;
  gap: ${Math.round(l.iconSize * 0.22)}px;
  margin-bottom: ${Math.round(l.iconSize * 0.42)}px;
}
.brand img { width: ${l.iconSize}px; height: ${l.iconSize}px; margin-left: -${Math.round(l.iconSize * 0.06)}px; }
.name {
  font-size: ${l.nameSize}px;
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: -0.02em;
  text-wrap: balance;
}
h1 {
  font-size: ${l.headlineSize}px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.015em;
  text-wrap: balance;
}
h1 span { display: block; text-wrap: balance; }
.url {
  position: absolute;
  left: ${l.left}px;
  bottom: ${l.urlBottom}px;
  color: #a9b4be;
  font-family: "Geist Mono", monospace;
  font-weight: 500;
  font-size: ${l.urlSize}px;
}
.frame {
  position: absolute;
  left: ${l.frameLeft}px;
  top: ${l.frameTop}px;
  width: ${l.frameWidth}px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: ${l.radius}px;
  overflow: hidden;
  background: #141c24;
}
.bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: ${Math.round(l.dot * 0.75)}px;
  height: ${l.barHeight}px;
  padding: 0 ${Math.round(l.dot * 1.3)}px;
  background: #141c24;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.bar i { width: ${l.dot}px; height: ${l.dot}px; border-radius: 50%; background: #26323e; }
.frame img { display: block; width: 100%; }
</style>
</head>
<body>
  <div class="copy">
    <div class="brand"><img src="data:image/png;base64,${assets.icon}" alt=""><div class="name">Fetch&nbsp;My Recordings</div></div>
    <h1>${TAGLINE.map((sentence) => `<span>${sentence}</span>`).join(' ')}</h1>
  </div>
  <span class="url">${REPO_URL}</span>
  <div class="frame">
    <div class="bar"><i></i><i></i><i></i></div>
    <img src="data:image/png;base64,${shot}">
  </div>
</body>
</html>`
}

await main()
