import { discoverFetch, findNode, getApiService, getXmlText, httpClient, parseXml } from 'fetchtv'
import { searchForFetchBoxes } from './discovery.js'

export const FETCH_PORT = 49152

export const findBoxes = async ({
  rememberedAddress,
  searchNetwork = true,
  wholeNetwork = false,
  connect = connectToAddress,
  search = searchForFetchBoxes
}) => {
  const remembered = rememberedAddress
    ? await connect(rememberedAddress, { timeoutMs: REMEMBERED_TIMEOUT_MS })
    : null
  if (remembered && !wholeNetwork) return [remembered]
  const found = searchNetwork ? await search() : []
  return uniqueByUrl([remembered, ...found].filter(Boolean))
}

export const connectToAddress = async (address, { timeoutMs = CONNECT_TIMEOUT_MS } = {}) => {
  const target = parseBoxAddress(address)
  if (!target) return null
  return withTimeout(discoverFetch(target), timeoutMs)
}

export const parseBoxAddress = (input) => {
  const text = String(input ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  const match = text.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/i)
  if (!match) return null
  const [, ip, portText] = match
  const port = portText ? Number(portText) : FETCH_PORT
  if (port < 1 || port > 65535) return null
  if (/^[\d.]+$/.test(ip) && !isIpv4(ip)) return null
  return { ip, port }
}

export const describeBox = (location) => {
  const url = new URL(location.url)
  const port = Number(url.port || 80)
  return {
    id: location.url,
    name: location.friendlyName || 'Fetch box',
    model: location.modelName || '',
    address: port === FETCH_PORT ? url.hostname : `${url.hostname}:${port}`,
    key: boxKeyOf(location)
  }
}

const boxKeyOf = (location) => {
  const udn = String(location._rawDeviceXml?.UDN ?? '').trim()
  return udn || new URL(location.url).host
}

export const countRecordings = async ({ location, budgetMs = COUNT_BUDGET_MS, signal }) => {
  const apiService = await getApiService(location)
  if (!apiService) return null
  const stop = new AbortController()
  const signals = [AbortSignal.timeout(budgetMs), stop.signal, signal].filter(Boolean)
  const browse = browserFor({ apiService, signal: AbortSignal.any(signals) })
  try {
    return await countWith(browse)
  } catch {
    return null
  } finally {
    stop.abort()
  }
}

const countWith = async (browse) => {
  const root = await browseAll({ browse, objectId: '0' })
  const recordings = root.containers.find(folder => getXmlText({ node: folder.title }) === 'Recordings')
  if (!recordings) return null
  if (childCountOf(recordings) === 0) return 0
  const { containers: shows } = await browseAll({ browse, objectId: idOf(recordings) })
  const childCounts = shows.map(childCountOf)
  if (childCounts.every(isChildCount)) return sum(childCounts)
  const showCounts = await mapWithConcurrency({
    values: shows,
    limit: SHOW_COUNT_CONCURRENCY,
    work: show => countShow({ browse, objectId: idOf(show) })
  })
  return sum(showCounts)
}

const countShow = async ({ browse, objectId }) => {
  const first = await browse({ objectId, requestedCount: 1 })
  if (Number.isInteger(first.totalMatches)) return first.totalMatches
  const { items } = await browseAll({ browse, objectId })
  return items.length
}

const browseAll = async ({ browse, objectId }) => {
  const seen = new Set()
  const entries = { containers: [], items: [] }
  let received = 0
  for (let page = 1; page <= MAX_BROWSE_PAGES; page++) {
    const { didl, totalMatches } = await browse({ objectId, startingIndex: received })
    const replyEntries = { containers: listOf(didl.container), items: listOf(didl.item) }
    const replyCount = replyEntries.containers.length + replyEntries.items.length
    const added = addUnseen({ seen, entries, replyEntries })
    received += replyCount
    const isTotalKnown = Number.isInteger(totalMatches) && totalMatches > 0
    if (!isTotalKnown || received >= totalMatches || replyCount === 0 || added === 0) break
  }
  return entries
}

const addUnseen = ({ seen, entries, replyEntries }) => {
  let added = 0
  for (const kind of ['containers', 'items']) {
    for (const node of replyEntries[kind]) {
      const key = node['@_id'] === undefined ? Symbol(kind) : `${kind}:${node['@_id']}`
      if (seen.has(key)) continue
      seen.add(key)
      entries[kind].push(node)
      added++
    }
  }
  return added
}

const browserFor = ({ apiService, signal }) => async ({ objectId, startingIndex = 0, requestedCount = 0 }) => {
  const { cd_ctr: controlUrl, cd_service: serviceType } = apiService
  const response = await httpClient.post(controlUrl, browsePayload({ serviceType, objectId, startingIndex, requestedCount }), {
    headers: { 'Content-Type': 'text/xmlcharset="utf-8"', 'SOAPAction': `"${serviceType}#Browse"` },
    signal
  })
  const reply = findNode({ obj: parseXml(response.data), path: 'Envelope.Body.BrowseResponse' })
  const result = findNode({ obj: reply, path: 'Result' })
  const didl = typeof result === 'string' ? parseXml(result)?.['DIDL-Lite'] : undefined
  if (didl === undefined) throw new Error('The box sent a Browse reply with no DIDL-Lite result')
  return { didl: didl || {}, totalMatches: findNode({ obj: reply, path: 'TotalMatches' }) }
}

const browsePayload = ({ serviceType, objectId, startingIndex, requestedCount }) => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
 <s:Body>
  <u:Browse xmlns:u="${serviceType}">
   <ObjectID>${objectId}</ObjectID>
   <BrowseFlag>BrowseDirectChildren</BrowseFlag>
   <Filter>*</Filter>
   <StartingIndex>${startingIndex}</StartingIndex>
   <RequestedCount>${requestedCount}</RequestedCount>
   <SortCriteria></SortCriteria>
  </u:Browse>
 </s:Body>
</s:Envelope>`

const listOf = (value) => [value].flat().filter(Boolean)

const idOf = (node) => String(node['@_id'])

const childCountOf = (node) => node['@_childCount']

const isChildCount = (value) => Number.isInteger(value) && value >= 0

const sum = (numbers) => numbers.reduce((total, number) => total + number, 0)

const mapWithConcurrency = async ({ values, limit, work }) => {
  const results = new Array(values.length)
  let next = 0
  const worker = async () => {
    while (next < values.length) {
      const index = next++
      results[index] = await work(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return results
}

const COUNT_BUDGET_MS = 5000
const MAX_BROWSE_PAGES = 200
const SHOW_COUNT_CONCURRENCY = 4
const CONNECT_TIMEOUT_MS = 8000
const REMEMBERED_TIMEOUT_MS = 2500

const uniqueByUrl = (locations) => [...new Map(locations.map(location => [location.url, location])).values()]

const isIpv4 = (text) => {
  const parts = text.split('.')
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

const withTimeout = (promise, ms) => Promise.race([
  promise.catch(() => null),
  new Promise(resolve => setTimeout(() => resolve(null), ms))
])
