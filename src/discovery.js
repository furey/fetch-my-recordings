import dgram from 'node:dgram'
import os from 'node:os'
import { parseLocations } from 'fetchtv'

export const MEDIA_SERVER_TARGET = 'urn:schemas-upnp-org:device:MediaServer:1'
export const FETCH_MANUFACTURER_URL = 'http://www.fetch.com/'

export const searchForFetchBoxes = ({
  timeoutMs = 3500,
  settleMs = 500,
  readDevice = readDeviceAt,
  openSockets = openSearchSockets
} = {}) => new Promise((resolve) => {
  const seen = new Set()
  const laterCandidates = []
  const found = new Map()
  const checks = new Set()
  let finished = false
  let settleTimer = null
  let sockets = []

  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(roundTimer)
    clearTimeout(settleTimer)
    sockets.forEach(closeQuietly)
    resolve([...found.values()])
  }

  const check = (location) => {
    const pending = readDevice(location).then((device) => {
      if (finished || !isFetchDevice(device)) return
      found.set(device.url, device)
      settleTimer ??= setTimeout(finish, settleMs)
    })
    checks.add(pending)
    pending.finally(() => checks.delete(pending))
    return pending
  }

  const onResponse = (text) => {
    const response = parseSearchResponse(text)
    if (finished || !response || seen.has(response.location)) return
    seen.add(response.location)
    if (looksLikeFetch(response)) check(response.location)
    else laterCandidates.push(response.location)
  }

  const endRound = async () => {
    if (finished) return
    sockets.forEach(closeQuietly)
    await Promise.all([...checks])
    if (found.size === 0) await Promise.all(laterCandidates.map(check))
    finish()
  }

  const roundTimer = setTimeout(endRound, timeoutMs)
  openSockets({ onResponse }).then((opened) => {
    sockets = opened
    if (finished) opened.forEach(closeQuietly)
  }, () => endRound())
})

export const parseSearchResponse = (text) => {
  const lines = String(text).split(/\r?\n/)
  if (!/^HTTP\/1\.[01] 200\b/i.test(lines[0] ?? '')) return null
  const headers = Object.fromEntries(lines.slice(1)
    .map(line => line.match(/^([^:]+):\s*(.*)$/))
    .filter(Boolean)
    .map(([, name, value]) => [name.trim().toUpperCase(), value.trim()]))
  if (!headers.LOCATION || !/^https?:\/\//i.test(headers.LOCATION)) return null
  if (headers.ST && headers.ST !== MEDIA_SERVER_TARGET) return null
  return { location: headers.LOCATION, server: headers.SERVER ?? '' }
}

export const looksLikeFetch = ({ location }) => {
  try {
    return new URL(location).pathname === '/MediaServer.xml'
  } catch {
    return false
  }
}

export const searchMessage = () => Buffer.from([
  'M-SEARCH * HTTP/1.1',
  `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  'MX: 2',
  `ST: ${MEDIA_SERVER_TARGET}`,
  '',
  ''
].join('\r\n'))

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const RESEND_AFTER_MS = 600
const DEVICE_READ_TIMEOUT_MS = 4000

const isFetchDevice = (device) => device?.manufacturerURL === FETCH_MANUFACTURER_URL

const readDeviceAt = async (location) => {
  const reading = parseLocations([location]).then(([device]) => device ?? null, () => null)
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), DEVICE_READ_TIMEOUT_MS))
  return Promise.race([reading, timeout])
}

const openSearchSockets = async ({ onResponse }) => {
  const addresses = localIpv4Addresses()
  const opened = await Promise.all(addresses.map(address => openSearchSocket({ address, onResponse })))
  return opened.filter(Boolean)
}

const openSearchSocket = ({ address, onResponse }) => new Promise((resolve) => {
  const socket = dgram.createSocket({ type: 'udp4' })
  socket.on('error', () => {
    closeQuietly(socket)
    resolve(null)
  })
  socket.on('message', (message) => onResponse(String(message)))
  socket.bind(0, address, () => {
    try {
      socket.setMulticastInterface(address)
      socket.setMulticastTTL(2)
    } catch {
      return resolve(null)
    }
    sendSearch(socket)
    setTimeout(() => sendSearch(socket), RESEND_AFTER_MS).unref()
    resolve(socket)
  })
})

const sendSearch = (socket) => {
  try {
    socket.send(searchMessage(), SSDP_PORT, SSDP_ADDRESS, () => {})
  } catch {
    return null
  }
}

const localIpv4Addresses = () => Object.values(os.networkInterfaces())
  .flat()
  .filter(entry => entry && !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
  .map(entry => entry.address)

const closeQuietly = (socket) => {
  try {
    socket.close()
  } catch {
    return null
  }
}
