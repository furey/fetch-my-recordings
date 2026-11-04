import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import NodeSsdp from 'node-ssdp'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const mediaServerFixture = path.join(fixturesDir, 'media-server.xml')
const REAL_BOX_SERVER = 'Linux/4.1.20-1.9, UPnP/1.0, DLNADOC/1.50'

export const FETCH_BOX_OVERSTATEMENT = 84
export const MB = 1024 * 1024

export const demoShows = ({ size = 3 * MB } = {}) => [
  {
    title: 'Master Cook',
    items: [
      { title: 'S1 E1 - Auditions', size, duration: '0:58:12' },
      { title: 'S1 E2 - Mystery Box', size: size + 4096, duration: '0:57:40' },
      { title: 'S1 E3 - Team Challenge', size: size + 8192, duration: '0:59:03' },
      { title: 'S1 E4 - Elimination', size: size + 12288, duration: '1:01:27' }
    ]
  },
  {
    title: 'Backyard Builders',
    items: [
      { title: 'S3 E1 - The Shed', size: size * 2, duration: '0:44:10', parentTaskName: 'Backyard Builders S3 E1' },
      { title: 'S3 E2 - The Deck', size: size * 2 + 2048, duration: '0:44:55', parentTaskName: 'Backyard Builders S3 E2' }
    ]
  },
  {
    title: 'Mission Improbable',
    items: [{ title: 'Mission Improbable', size: size * 3, duration: '1:52:30' }]
  },
  {
    title: 'Jurassic Car Park',
    items: [{ title: 'Jurassic Car Park', size: size * 2, duration: '2:07:15' }]
  },
  {
    title: 'Bigger Brother',
    items: [
      { title: 'S2 E5 - Day Forty', size: size + 1024, duration: '0:28:45' },
      { title: 'S2 E6 - Eviction Night', size: -1, duration: '0:00:00', stillRecording: true }
    ]
  },
  {
    title: 'The Footy Panel',
    items: [{ title: 'The Footy Panel', size: Math.round(size / 2), duration: '0:58:00' }]
  }
]

const BIG_LIBRARY_SERIES = [
  'Master Cook', 'Bigger Brother', 'Backyard Builders', 'Coastal Kitchen', 'Grand Resigns', 'Married at First Fright',
  'The Amazing Pace', 'Thriver: Bondi Car Park', 'Gardening Austral-ish', 'Better Homes and Sheds', 'The Blockheads',
  'Australian Idle', 'Soft Quiz', 'Gobblebox', 'Escape to the Outer Suburbs', 'The Great Australian Fake Off',
  'A Very Long Programme About Restoring Old Caravans in the Middle of Nowhere', 'Blue Sky Thinking', 'The Race to the Fridge',
  'Dancing With the Stairs', 'Who Wants to Be a Thousandaire', 'Location Location Relocation', 'Selling Mouses Australia',
  'Kitchen Daydreams at Nan’s', 'Love Peninsula', 'The Choice', 'Fishing Down Under the Bridge', 'Antiques Showroad',
  'Restoration Garbage', 'Police Tea Break', 'Bondi Pet', 'The Footy Panel', 'The Sports Show', 'Football'
]

const BIG_LIBRARY_FILMS = ['Mission Improbable', 'Space Wars', 'Jurassic Car Park', 'Lord of the Wings', 'Back to the Futon', 'Raiders of the Lost Car Keys']

const EPISODE_WORDS = ['Auditions', 'Mystery Box', 'Team Challenge', 'Elimination', 'Grand Final', 'Road Trip', 'The Big Reveal', 'Family Week', 'Second Chances', 'Finale']

export const bigLibrary = ({ size = 64 * 1024, failEvery = 23 } = {}) => {
  let count = 0
  const nextQuirks = () => (++count % failEvery === 0 ? { alwaysDropAt: Math.round(size / 2) } : undefined)
  const series = BIG_LIBRARY_SERIES.map((title, index) => {
    const season = 1 + (index % 9)
    const episodes = 4 + (index % 6) + (index % 3)
    return {
      title,
      items: Array.from({ length: episodes }, (_, episode) => ({
        title: `S${season} E${episode + 1} - ${EPISODE_WORDS[(index + episode) % EPISODE_WORDS.length]}${index % 7 === 0 ? ', Part Two of a Much Longer Story Than Expected' : ''}`,
        size: size + episode * 512,
        duration: '0:58:00',
        quirks: nextQuirks()
      }))
    }
  })
  const films = BIG_LIBRARY_FILMS.map(title => ({ title, items: [{ title, size: size * 2, duration: '1:58:00', quirks: nextQuirks() }] }))
  return [...series, ...films]
}

export const startFakeBox = async ({
  shows = demoShows(),
  name = 'Test Fetch Box',
  host = '127.0.0.1',
  port = 0,
  ssdp = false,
  quirks = {},
  bytesPerSecond = 0,
  rootFolders = ['Recordings', 'Live TV'],
  failingBrowses = [],
  cancelled = false
} = {}) => {
  const catalogue = buildCatalogue(cancelled ? [] : shows)
  const requests = []
  const attempts = new Map()
  const forgotten = new Set()
  const mediaServerXml = cancelled
    ? (await fs.readFile(path.join(fixturesDir, 'cancelled-media-server.xml'), 'utf8')).replace(/<friendlyName>[^<]*<\/friendlyName>/, `<friendlyName>STB ${escapeXml(host)}</friendlyName>`)
    : (await fs.readFile(mediaServerFixture, 'utf8')).replace('Fetch TV Test Box', escapeXml(name))
  const cancelledBrowse = cancelled ? await readCancelledBrowse() : null

  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, range: req.headers.range ?? null })
    if (cancelled) {
      res.setHeader('SERVER', REAL_BOX_SERVER)
      res.setHeader('CONNECTION', 'close')
    }
    if (req.method === 'GET' && req.url === '/MediaServer.xml') return sendXml(res, mediaServerXml)
    if (req.method === 'POST' && req.url === '/web/cds_control' && cancelled) return answerCancelledBrowse({ req, res, cancelledBrowse })
    if (req.method === 'POST' && req.url === '/upnp/control/ContentDirectory') return answerBrowse({ req, res, catalogue, baseUrl: baseUrlOf(), rootFolders, failingBrowses, forgotten })
    const itemMatch = req.url.match(/^\/item\/(\d+)$/)
    if (itemMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const item = catalogue.items.get(itemMatch[1])
      if (!item || item.missing) return notFound(res)
      const attempt = (attempts.get(item.id) ?? 0) + 1
      attempts.set(item.id, attempt)
      return sendRecording({ req, res, item, quirks: { ...DEFAULT_QUIRKS, ...quirks, ...item.quirks }, attempt, bytesPerSecond })
    }
    notFound(res)
  })

  await new Promise(resolve => server.listen(port, host, resolve))
  const actualPort = server.address().port
  const advertisedHost = host === '0.0.0.0' ? lanAddress() : host
  const baseUrlOf = () => `http://${advertisedHost}:${actualPort}`
  const ssdpServer = ssdp ? await startSsdp({ location: `${baseUrlOf()}/MediaServer.xml` }) : null

  return {
    url: `${baseUrlOf()}/MediaServer.xml`,
    address: `${advertisedHost}:${actualPort}`,
    port: actualPort,
    requests,
    catalogue,
    forgetShow: (title) => forgotten.add(catalogue.showFolders.find(show => show.title === title).id),
    powerOff: () => {
      server.closeAllConnections()
      server.close()
    },
    powerOn: () => new Promise(resolve => server.listen(actualPort, host, resolve)),
    stop: async () => {
      ssdpServer?.stop()
      server.closeAllConnections()
      if (server.listening) await new Promise(resolve => server.close(resolve))
    }
  }
}

export const recordingBytes = (item) => patternBytes({ start: 0, end: item.actualSize, seed: Number(item.id) })

const DEFAULT_QUIRKS = {
  overstate: FETCH_BOX_OVERSTATEMENT,
  resetAtEnd: true,
  rangeNotSatisfiable: true,
  dropFirstAttemptAt: 0,
  alwaysDropAt: 0
}

const buildCatalogue = (shows) => {
  const items = new Map()
  const showFolders = shows.map((show, showIndex) => {
    const showId = String(100 + showIndex)
    const showItems = show.items.map((item, itemIndex) => {
      const id = String(1000 + showIndex * 100 + itemIndex)
      const recordingInProgress = item.stillRecording || item.missing || item.size <= 0
      const entry = {
        ...item,
        id,
        parentId: showId,
        actualSize: recordingInProgress ? 0 : item.size,
        quirks: item.quirks ?? {}
      }
      items.set(id, entry)
      return entry
    })
    return { id: showId, title: show.title, items: showItems }
  })
  return { showFolders, items }
}

const answerBrowse = async ({ req, res, catalogue, baseUrl, rootFolders, failingBrowses, forgotten }) => {
  const objectId = objectIdOf(await readBody(req))
  if (failingBrowses.includes(objectId)) {
    res.writeHead(500)
    return res.end()
  }
  const didl = forgotten.has(objectId) ? null : didlFor({ objectId, catalogue, baseUrl, rootFolders })
  if (!didl) return sendNoSuchObject(res)
  sendXml(res, browseEnvelope(didl.xml, didl.count))
}

const readCancelledBrowse = async () => {
  const [root, empty, noSuchObject] = await Promise.all(['cancelled-browse-root.xml', 'cancelled-browse-empty.xml', 'upnp-error-501.xml']
    .map(name => fs.readFile(path.join(fixturesDir, name), 'utf8')))
  return { root, empty, noSuchObject }
}

const answerCancelledBrowse = async ({ req, res, cancelledBrowse }) => {
  const objectId = objectIdOf(await readBody(req))
  if (objectId === '0') return sendXml(res, cancelledBrowse.root)
  if (objectId === '1' || objectId === '2') return sendXml(res, cancelledBrowse.empty)
  sendNoSuchObject(res)
}

const objectIdOf = (body) => body.match(/<ObjectID>([^<]*)<\/ObjectID>/)?.[1] ?? '0'

const sendNoSuchObject = async (res) => {
  res.writeHead(500, { 'Content-Type': 'text/xml; charset="utf-8"' })
  res.end(await fs.readFile(path.join(fixturesDir, 'upnp-error-501.xml'), 'utf8'))
}

const ROOT_FOLDER_IDS = { Recordings: '1', 'Live TV': '2' }

const didlFor = ({ objectId, catalogue, baseUrl, rootFolders }) => {
  if (objectId === '0') {
    return { count: rootFolders.length, xml: rootFolders.map(title => container({ id: ROOT_FOLDER_IDS[title] ?? title, parentId: '0', title })).join('') }
  }
  if (objectId === '1') {
    return { count: catalogue.showFolders.length, xml: catalogue.showFolders.map(show => container({ id: show.id, parentId: '1', title: show.title })).join('') }
  }
  if (rootFolders.some(title => (ROOT_FOLDER_IDS[title] ?? title) === objectId)) return { count: 0, xml: '' }
  const show = catalogue.showFolders.find(folder => folder.id === objectId)
  if (!show) return null
  return { count: show.items.length, xml: show.items.map(item => itemXml({ item, baseUrl })).join('') }
}

const container = ({ id, parentId, title }) =>
  `<container id="${id}" parentID="${parentId}" restricted="1"><dc:title>${escapeXml(title)}</dc:title><upnp:class>object.container</upnp:class></container>`

const itemXml = ({ item, baseUrl }) => {
  const listedSize = listedSizeOf(item)
  const taskName = item.parentTaskName ? ` parentTaskName="${escapeXml(item.parentTaskName)}"` : ''
  return `<item id="${item.id}" parentID="${item.parentId}" restricted="1"><dc:title>${escapeXml(item.title)}</dc:title>` +
    `<dc:description>${escapeXml(item.title)}</dc:description><upnp:class>object.item.videoItem</upnp:class>` +
    `<res protocolInfo="http-get:*:video/mpeg-tts:DLNA.ORG_PN=AVC_TS_HD_AC3;DLNA.ORG_OP=01" size="${listedSize}" duration="${item.duration ?? '0:30:00'}"${taskName}>` +
    `${baseUrl}/item/${item.id}</res></item>`
}

const listedSizeOf = (item) => {
  if (item.listedAsRecording) return RECORDING_MARKER_SIZE
  if (item.actualSize > 0 && !item.listedSizeUnknown) return item.actualSize + (item.quirks.overstate ?? FETCH_BOX_OVERSTATEMENT)
  return -1
}

const RECORDING_MARKER_SIZE = 4398046510080

const browseEnvelope = (didlXml, count) => `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <Result>${escapeXml(`<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">${didlXml}</DIDL-Lite>`)}</Result>
      <NumberReturned>${count}</NumberReturned>
      <TotalMatches>${count}</TotalMatches>
      <UpdateID>1</UpdateID>
    </u:BrowseResponse>
  </s:Body>
</s:Envelope>`

const sendRecording = ({ req, res, item, quirks, attempt, bytesPerSecond }) => {
  const statedSize = item.actualSize + (quirks.overstate ?? 0)
  const start = rangeStartOf(req.headers.range)
  if (item.actualSize <= 0) {
    res.writeHead(200, { 'Content-Type': 'video/mpeg', 'Content-Length': String(RECORDING_MARKER_SIZE) })
    return res.end()
  }
  if (start !== null && quirks.rangeNotSatisfiable) {
    res.writeHead(416, { 'Content-Range': `bytes */${statedSize}` })
    return res.end()
  }
  if (start !== null && start >= item.actualSize) {
    res.writeHead(416, { 'Content-Range': `bytes */${item.actualSize}` })
    return res.end()
  }
  const from = start ?? 0
  const headers = start === null
    ? { 'Content-Type': 'video/mpeg', 'Content-Length': String(statedSize) }
    : { 'Content-Type': 'video/mpeg', 'Content-Length': String(statedSize - from), 'Content-Range': `bytes ${from}-${statedSize - 1}/${statedSize}` }
  res.writeHead(start === null ? 200 : 206, headers)
  if (req.method === 'HEAD') return res.end()
  const dropAt = quirks.alwaysDropAt || (attempt === 1 ? quirks.dropFirstAttemptAt : 0)
  if (quirks.goSilentAt) return streamBytes({ res, item, from, end: Math.max(from, quirks.goSilentAt), bytesPerSecond, finish: () => {} })
  const end = dropAt > from ? Math.min(dropAt, item.actualSize) : item.actualSize
  streamBytes({ res, item, from, end, bytesPerSecond, finish: () => (end < item.actualSize || quirks.resetAtEnd ? resetConnection(res) : res.end()) })
}

const resetConnection = (res) => {
  if (res.socket) res.socket.destroy()
  else res.destroy()
}

const streamBytes = ({ res, item, from, end, bytesPerSecond, finish }) => {
  const chunkSize = 256 * 1024
  const delay = bytesPerSecond > 0 ? Math.round((chunkSize / bytesPerSecond) * 1000) : 0
  let offset = from
  const writeNext = () => {
    if (res.destroyed) return
    if (offset >= end) return setTimeout(finish, 20)
    const next = Math.min(end, offset + chunkSize)
    const chunk = patternBytes({ start: offset, end: next, seed: Number(item.id) })
    offset = next
    const ready = res.write(chunk)
    const proceed = () => (delay ? setTimeout(writeNext, delay) : setImmediate(writeNext))
    if (ready) proceed()
    else res.once('drain', proceed)
  }
  writeNext()
}

const PATTERN_PERIOD = 256
const patternCache = new Map()

const patternBytes = ({ start, end, seed }) => {
  const length = end - start
  const pattern = patternFor({ seed, length: length + PATTERN_PERIOD })
  const offset = start % PATTERN_PERIOD
  return pattern.subarray(offset, offset + length)
}

const patternFor = ({ seed, length }) => {
  const cached = patternCache.get(seed)
  if (cached && cached.length >= length) return cached
  const buffer = Buffer.allocUnsafe(Math.max(length, 1024 * 1024 + PATTERN_PERIOD))
  for (let index = 0; index < buffer.length; index++) buffer[index] = (index * 31 + seed) & 0xff
  patternCache.set(seed, buffer)
  return buffer
}

const startSsdp = async ({ location }) => {
  const server = new NodeSsdp.Server({ location, udn: 'uuid:fetchtv-fake-box', reuseAddr: true, ssdpTtl: 2 })
  server.addUSN('upnp:rootdevice')
  server.addUSN('urn:schemas-upnp-org:device:MediaServer:1')
  await server.start()
  return server
}

const lanAddress = () => Object.values(os.networkInterfaces()).flat()
  .find(entry => entry && entry.family === 'IPv4' && !entry.internal)?.address ?? '127.0.0.1'

const rangeStartOf = (header) => {
  const match = String(header ?? '').match(/bytes=(\d+)-/)
  return match ? Number(match[1]) : null
}

const readBody = (req) => new Promise((resolve, reject) => {
  let body = ''
  req.setEncoding('utf8')
  req.on('data', chunk => { body += chunk })
  req.on('end', () => resolve(body))
  req.on('error', reject)
})

const sendXml = (res, xml) => {
  res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' })
  res.end(xml)
}

const notFound = (res) => {
  res.writeHead(404)
  res.end()
}

const escapeXml = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
