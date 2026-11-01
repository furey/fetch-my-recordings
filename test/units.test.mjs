import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBoxAddress, describeBox, findBoxes } from '../src/boxes.js'
import { FETCH_MANUFACTURER_URL, MEDIA_SERVER_TARGET, parseSearchResponse, searchForFetchBoxes } from '../src/discovery.js'
import { plainReason, summariseResults } from '../src/saving.js'

test('address: accepts an IP address, with or without a port or a URL around it', () => {
  assert.deepEqual(parseBoxAddress(' 192.168.1.50 '), { ip: '192.168.1.50', port: 49152 })
  assert.deepEqual(parseBoxAddress('192.168.1.50:50000'), { ip: '192.168.1.50', port: 50000 })
  assert.deepEqual(parseBoxAddress('http://192.168.1.50:49152/MediaServer.xml'), { ip: '192.168.1.50', port: 49152 })
})

test('address: rejects text that is not an address', () => {
  for (const input of ['', '300.1.2.3', '192.168.1', '192.168.1.50:99999', 'my box', undefined]) {
    assert.equal(parseBoxAddress(input), null, String(input))
  }
})

test('box: hides the usual Fetch port and shows any other', () => {
  assert.equal(describeBox({ url: 'http://192.168.1.50:49152/MediaServer.xml', friendlyName: 'Lounge' }).address, '192.168.1.50')
  assert.equal(describeBox({ url: 'http://127.0.0.1:5000/MediaServer.xml' }).address, '127.0.0.1:5000')
  assert.equal(describeBox({ url: 'http://127.0.0.1:5000/MediaServer.xml' }).name, 'Fetch box')
})

test('reasons: each result gets a plain reason with no error codes', () => {
  const reason = (status, extra = {}) => plainReason({ status, ...extra })
  assert.equal(reason('saved'), '')
  assert.equal(reason('already_saved'), 'Already saved in this folder.')
  assert.match(reason('still_recording'), /Still recording/)
  assert.match(reason('locked'), /Another save/)
  assert.equal(reason('cancelled', { warning: 'Stopped before this recording started.' }), 'Not started.')
  assert.match(reason('cancelled', { warning: 'Stopped. Partial file kept for resume.' }), /carry on/)
  assert.match(reason('failed', { error: 'Write error: ENOSPC: no space left on device' }), /ran out of space/)
  assert.match(reason('failed', { error: 'EACCES: permission denied' }), /Could not write/)
  assert.match(reason('failed', { warning: 'The Fetch box rejected the resume of X at 1 MB of 2 MB.' }), /would not carry on/)
  assert.match(reason('failed', { error: 'Download initiation failed: connect ECONNREFUSED 1.2.3.4:49152' }), /stopped answering/)
  assert.match(reason('failed', { warning: 'Download interrupted for X at 50.0%. (Connection reset) Partial file kept for resume.' }), /stopped part way/)
  assert.doesNotMatch(reason('failed', { error: 'something odd' }), /odd/)
})

test('summary: counts saved, skipped, not saved, and stopped', () => {
  const statuses = ['saved', 'saved', 'already_saved', 'failed', 'locked', 'still_recording', 'cancelled']
  assert.deepEqual(summariseResults(statuses.map(status => ({ status }))), { total: 7, saved: 2, alreadySaved: 1, notSaved: 3, stopped: 1 })
})

test('find: a remembered box that answers skips the network search', async () => {
  const box = { url: 'http://192.168.1.50:49152/MediaServer.xml' }
  const searches = []
  const search = async () => { searches.push('search'); return [] }
  assert.deepEqual(await findBoxes({ rememberedAddress: '192.168.1.50', connect: async () => box, search }), [box])
  assert.equal(searches.length, 0)
  assert.deepEqual(await findBoxes({ rememberedAddress: '192.168.1.50', connect: async () => null, search }), [])
  assert.equal(searches.length, 1)
  assert.deepEqual(await findBoxes({ rememberedAddress: '192.168.1.50', wholeNetwork: true, connect: async () => box, search }), [box])
  assert.equal(searches.length, 2)
})

test('search: keeps only media server answers that give a location', () => {
  const answer = (st, location = 'http://192.168.1.50:49152/MediaServer.xml') => ['HTTP/1.1 200 OK', `ST: ${st}`, `LOCATION: ${location}`, '', ''].join('\r\n')
  assert.deepEqual(parseSearchResponse(answer(MEDIA_SERVER_TARGET)), { location: 'http://192.168.1.50:49152/MediaServer.xml', server: '' })
  assert.equal(parseSearchResponse(answer('urn:dial-multiscreen-org:device:dial:1')), null)
  assert.equal(parseSearchResponse(answer(MEDIA_SERVER_TARGET, 'not a url')), null)
  assert.equal(parseSearchResponse('NOTIFY * HTTP/1.1\r\nLOCATION: http://192.168.1.9/x.xml\r\n\r\n'), null)
})

test('search: reads only the Fetch-shaped answer, stops once a Fetch box answers, and closes its sockets', async () => {
  const fetchLocation = 'http://192.168.1.50:49152/MediaServer.xml'
  const otherLocation = 'http://192.168.1.60/dms/device.xml'
  const harness = fakeNetwork([otherLocation, fetchLocation])
  const started = Date.now()
  const found = await searchForFetchBoxes({ timeoutMs: 3000, settleMs: 50, ...harness })
  assert.deepEqual(found.map(device => device.url), [fetchLocation])
  assert.deepEqual(harness.read, [fetchLocation])
  assert.equal(harness.closed(), true)
  assert.ok(Date.now() - started < 1000)
})

test('search: with no Fetch-shaped answer, it reads the other media servers when the round ends', async () => {
  const otherFetch = 'http://192.168.1.70:8200/rootDesc.xml'
  const harness = fakeNetwork([otherFetch], { fetchUrls: [otherFetch] })
  const found = await searchForFetchBoxes({ timeoutMs: 100, settleMs: 50, ...harness })
  assert.deepEqual(found.map(device => device.url), [otherFetch])
  assert.deepEqual(harness.read, [otherFetch])
})

const fakeNetwork = (locations, { fetchUrls = locations.filter(location => location.endsWith('/MediaServer.xml')) } = {}) => {
  const read = []
  const socket = { isClosed: false, close() { this.isClosed = true } }
  return {
    read,
    closed: () => socket.isClosed,
    openSockets: async ({ onResponse }) => {
      locations.forEach(location => onResponse(['HTTP/1.1 200 OK', `ST: ${MEDIA_SERVER_TARGET}`, `LOCATION: ${location}`, '', ''].join('\r\n')))
      return [socket]
    },
    readDevice: async (location) => {
      read.push(location)
      return { url: location, manufacturerURL: fetchUrls.includes(location) ? FETCH_MANUFACTURER_URL : 'http://example.com/' }
    }
  }
}
