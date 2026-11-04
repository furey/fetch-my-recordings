import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBoxAddress, describeBox, findBoxes } from '../src/boxes.js'
import { FETCH_MANUFACTURER_URL, MEDIA_SERVER_TARGET, parseSearchResponse, searchForFetchBoxes } from '../src/discovery.js'
import { plainReason, summariseResults } from '../src/saving.js'
import { describeFolder } from '../src/folders.js'
import { describeListing, listingProblemFor } from '../src/recordings.js'
import { createInstallAccessRecord, previousStartFailedAccessCheck } from '../src/install-access.js'
import { createLaunchGuard } from '../src/launch-guard.js'
import { createSettings } from '../src/settings.js'
import { createHistory } from '../src/history.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  const asleep = 'The box stopped answering. Check whether it is in standby. If it is, turn it on with its remote, then save again.'
  assert.equal(reason('failed', { warning: 'Download interrupted for X at 40.0%. (The box sent no data for 60 s) Partial file kept for resume.' }), asleep)
  assert.equal(reason('failed', { error: 'Download initiation failed: timeout of 30000ms exceeded' }), asleep)
  assert.equal(reason('failed', { error: 'Download initiation failed: connect ETIMEDOUT 192.168.1.50:49152' }), asleep)
  assert.equal(reason('failed', { error: 'Download initiation failed: connect EHOSTDOWN 192.168.1.50:49152' }), asleep)
  assert.notEqual(reason('failed', { error: 'Write error: ETIMEDOUT: connection timed out, write' }), asleep)
  assert.equal(reason('failed', { error: 'The box lists this recording but did not send it. It may have been deleted on the box.' }), 'The Fetch box lists this recording, but its file could not be opened. It may have been deleted on the box.')
  assert.equal(reason('failed', { error: 'box-unreachable' }), 'The box did not answer for 10 minutes. Check whether it is in standby. If it is, turn it on with its remote. Also check that this computer is on the same network. Then save again.')
  assert.match(reason('failed', { error: "Directory creation failed: ENAMETOOLONG: name too long, mkdir 'C:\\Users\\x\\Reset Timeout'" }), /^The file name is too long for this folder\. Choose a folder with a shorter path/)
  assert.match(reason('failed', { error: "Write error: EINVAL: invalid argument, open 'D:\\Fetch\\CON\\x.ts.part'" }), /^This folder does not accept the file name\. Choose another folder\.$/)
  assert.match(reason('failed', { error: "Directory creation failed: ENOTDIR: not a directory, mkdir '/x/y'" }), /does not accept the file name/)
  assert.match(reason('failed', { error: "Directory creation failed: EINVAL: invalid argument, mkdir 'D:\\Fetch\\AUX'" }), /does not accept the file name/)
  assert.doesNotMatch(reason('failed', { error: 'Download initiation failed: connect EINVAL 192.168.1.50:49152 - Local (0.0.0.0:0)' }), /file name/)
  for (const error of ['ENAMETOOLONG: name too long', "EINVAL: invalid argument, open 'x'", 'ENOTDIR: not a directory']) {
    assert.doesNotMatch(reason('failed', { error }), /Save again|save again/)
  }
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

test('install access: finds the access check failure only in the given start of chromium.log', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fmr-units-'))
  const chromiumLogFile = path.join(folder, 'chromium.log')
  fs.writeFileSync(chromiumLogFile, [
    '[4100:1102/170628.715:INFO:CONSOLE:5] "Some message", source: file:///index.html (5)',
    '[4200:1102/170700.100:FATAL:electron\\shell\\browser\\install_dir_access.cc(97)] Sandboxed processes cannot read the folder.',
    ''
  ].join('\r\n'))
  assert.equal(previousStartFailedAccessCheck({ chromiumLogFile, pid: 4200 }), true)
  assert.equal(previousStartFailedAccessCheck({ chromiumLogFile, pid: 4100 }), false)
  assert.equal(previousStartFailedAccessCheck({ chromiumLogFile, pid: 420 }), false)
  assert.equal(previousStartFailedAccessCheck({ chromiumLogFile, pid: null }), false)
  assert.equal(previousStartFailedAccessCheck({ chromiumLogFile: path.join(folder, 'missing.log'), pid: 4200 }), false)
  fs.rmSync(folder, { recursive: true, force: true })
})

test('install access: the repair is recorded once per Electron version', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fmr-units-'))
  const record = createInstallAccessRecord({ folder, electronVersion: '44.9.0' })
  assert.equal(record.alreadyRepaired(), false)
  record.markRepaired()
  assert.equal(record.alreadyRepaired(), true)
  assert.equal(createInstallAccessRecord({ folder, electronVersion: '45.0.0' }).alreadyRepaired(), false)
  fs.rmSync(folder, { recursive: true, force: true })
})

test('launch guard: hands the next start the PID of a start that closed before the window showed', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fmr-units-'))
  const guard = () => createLaunchGuard({ folder, maxRung: 2, electronVersion: '44.9.0' })
  assert.equal(guard().begin(111).previousPid, null)
  assert.deepEqual(guard().begin(222), { rung: 0, failedStarts: 1, atLastRung: false, previousPid: 111 })
  const shown = guard()
  shown.begin(333)
  shown.succeed(0)
  assert.equal(guard().begin(444).previousPid, null)
  fs.rmSync(folder, { recursive: true, force: true })
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

test('listing: each fetchtv listing outcome maps to the right screen', () => {
  assert.equal(listingProblemFor('no-content-directory'), 'no-answer')
  assert.equal(listingProblemFor('browse-failed'), 'no-answer')
  assert.equal(listingProblemFor('recordings-browse-failed'), 'no-answer')
  assert.equal(listingProblemFor('items-browse-failed'), 'no-answer')
  assert.equal(listingProblemFor('no-recordings-folder'), 'not-sharing')
  assert.equal(listingProblemFor('empty'), null)
  assert.equal(listingProblemFor('ok'), null)
})

test('listing: the log line names the box IP, the outcome, and any error or folders', () => {
  assert.equal(describeListing({ address: '192.168.1.50', outcome: 'ok' }), 'Listed recordings from box 192.168.1.50: ok.')
  assert.equal(describeListing({ address: '192.168.1.50', outcome: 'browse-failed', error: 'Request failed with status code 500' }),
    'Listed recordings from box 192.168.1.50: browse-failed. Error: Request failed with status code 500.')
  assert.equal(describeListing({ address: '192.168.1.50', outcome: 'no-recordings-folder', folders: [] }),
    'Listed recordings from box 192.168.1.50: no-recordings-folder. The box listed these folders: none.')
})

test('folder: counts as already saved only what the save will skip', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fmr-folder-'))
  const item = (id, title) => ({ id, title, size: 2048, ext: 'ts', season_number: '1', season_number_padded: '01', episode_number: id, episode_number_padded: id.padStart(2, '0') })
  const recordings = [{ title: 'Bluey', items: [item('1', 'S1 E1 - Saved'), item('2', 'S1 E2 - Missing'), item('3', 'S1 E3 - New')] }]
  fs.mkdirSync(path.join(folder, 'Bluey'))
  fs.writeFileSync(path.join(folder, 'Bluey', 'S1 E1 - Saved.ts'), Buffer.alloc(2048))
  fs.writeFileSync(path.join(folder, 'fetchtv.json'), JSON.stringify({
    1: { title: 'S1 E1 - Saved', size: 2048, path: 'Bluey/S1 E1 - Saved.ts' },
    2: { title: 'S1 E2 - Missing', size: 2048, path: 'Bluey/S1 E2 - Missing.ts' }
  }))
  try {
    const plain = await describeFolder({ folder, recordings })
    assert.equal(plain.alreadySavedCount, 1)
    assert.equal(plain.toSaveCount, 2)
    assert.equal(plain.neededBytes, 4096)
    assert.equal((await describeFolder({ folder, recordings, forPlex: true })).alreadySavedCount, 1)
    const again = await describeFolder({ folder, recordings, forPlex: true, copyAgain: true })
    assert.equal(again.alreadySavedCount, 0)
    assert.equal(again.toSaveCount, 3)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

const BAD_JSON_FILES = {
  'a byte order mark': '\uFEFF{"lastFolder":"/x"}',
  'a truncated file': '{"lastFolder":"/x", "sou',
  'an empty file': ''
}

for (const [name, text] of Object.entries(BAD_JSON_FILES)) {
  test(`settings and history: ${name} reads without failing`, async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fmr-json-'))
    const lines = []
    const log = (line) => lines.push(line)
    fs.writeFileSync(path.join(folder, 'settings.json'), text)
    fs.writeFileSync(path.join(folder, 'history.json'), text.replace('lastFolder', 'entries'))
    try {
      const settings = await createSettings(folder, { log }).read()
      const history = await createHistory(folder, { log }).read()
      if (name === 'a byte order mark') {
        assert.deepEqual(settings, { lastFolder: '/x' })
        assert.deepEqual(lines, [])
        return
      }
      assert.deepEqual(settings, {})
      assert.deepEqual(history, { entries: {} })
      assert.equal(lines.length, 2)
      assert.equal(fs.readFileSync(path.join(folder, 'settings.bad.json'), 'utf8'), text)
      assert.ok(fs.existsSync(path.join(folder, 'history.bad.json')))
      await createSettings(folder, { log }).update({ sound: false })
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'settings.json'), 'utf8')), { sound: false })
      assert.equal(fs.readFileSync(path.join(folder, 'settings.bad.json'), 'utf8'), text)
    } finally {
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })
}
