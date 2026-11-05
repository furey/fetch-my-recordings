'use strict'

const api = window.fetchtv

const state = {
  info: null,
  step: 0,
  visit: 0,
  background: null,
  folderCheck: 0,
  boxes: [],
  box: null,
  shows: [],
  selected: new Set(),
  open: new Set(),
  folder: '',
  forPlex: false,
  copyAgain: false,
  folderInfo: null,
  save: null,
  saving: false,
  saveRun: null,
  leavingForStart: false,
  listIsStale: false
}

const MINIMUM_BUSY_MS = 900
const BOX_LINE_MINIMUM_MS = 2000
const BOX_STATE_LINES = {
  waiting: 'Waiting for the Fetch box to answer…',
  answering: 'The box is answering again.'
}
const BACKGROUND_SEARCH_FRESH_MS = 10000

const start = async () => {
  state.info = await api.appInfo()
  state.folder = state.info.settings.lastFolder || state.info.defaultFolder
  state.forPlex = Boolean(state.info.settings.forPlex)
  document.getElementById('about-line').textContent = `Fetch My Recordings ${state.info.version} · Not affiliated with Fetch TV`
  document.getElementById('footer-github').replaceWith(githubLink())
  setUpSoundToggle(state.info.settings.sound !== false)
  setUpDialog()
  setUpHeader()
  pauseWhenHidden()
  api.onListProgress(showListProgress)
  api.onSaveProgress(updateSaveProgress)
  api.onSaveResult(updateSaveResult)
  api.onSaveBoxState(updateBoxState)
  api.onSaveRetry(updateSaveRetry)
  showWelcome()
}

const showWelcome = () => {
  state.copyAgain = false
  startBackgroundSearch()
  showScreen(0, welcomeScreen())
}

const setUpSoundToggle = (on) => {
  const toggle = document.getElementById('sound-toggle')
  const apply = (value) => {
    sounds.setEnabled(value)
    toggle.setAttribute('aria-checked', String(value))
  }
  apply(on)
  toggle.addEventListener('click', () => {
    const value = !sounds.isEnabled()
    apply(value)
    api.setSound({ on: value })
  })
}

const begin = () => {
  sounds.play('start')
  searchForBoxes({ autoPick: true })
}

const searchForBoxes = async ({ autoPick, wholeNetwork = false }) => {
  const visit = showScreen(1, searchingScreen())
  const boxes = await withMinimumDuration(findBoxesWithRetry({ wholeNetwork }))
  if (!isCurrentVisit(visit)) return
  state.boxes = boxes
  sounds.play(boxes.length === 0 ? 'failed' : 'found')
  if (autoPick && boxes.length === 1) return useBox(boxes[0])
  showScreen(1, boxes.length === 0 ? notFoundScreen() : chooseBoxScreen())
}

const findBoxesWithRetry = async ({ wholeNetwork }) => {
  const first = (wholeNetwork ? null : await takeBackgroundSearch()) ?? await api.findBoxes({ wholeNetwork })
  if (first.boxes.length > 0) return first.boxes
  const second = await api.findBoxes({ wholeNetwork })
  return second.boxes
}

const startBackgroundSearch = () => {
  const search = { finishedAt: null, boxes: [] }
  search.promise = api.findBoxes().then((result) => {
    search.finishedAt = Date.now()
    search.boxes = result.boxes
    return result
  })
  state.background = search
}

const takeBackgroundSearch = () => {
  const search = state.background
  state.background = null
  if (!search) return null
  if (search.finishedAt === null) return search.promise
  const isFresh = Date.now() - search.finishedAt <= BACKGROUND_SEARCH_FRESH_MS
  return search.boxes.length > 0 && isFresh ? search.promise : null
}

const chooseBox = (box) => {
  const hasCurrentList = state.box?.id === box.id && state.shows.length > 0 && !state.listIsStale
  if (hasCurrentList) return showScreen(2, recordingsScreen())
  useBox(box)
}

const useBox = async (box, { thenSave = null } = {}) => {
  state.box = box
  state.shows = []
  state.selected = new Set()
  state.open = new Set()
  state.listIsStale = false
  const visit = showScreen(2, loadingListScreen())
  const result = await withMinimumDuration(api.listRecordings({ boxId: box.id }))
  if (!isCurrentVisit(visit)) return
  if (result.error) {
    sounds.play('failed')
    return showScreen(2, listFailedScreen())
  }
  if (result.problem === 'no-answer') return showScreen(2, boxDidNotAnswerScreen())
  if (result.problem === 'not-sharing') return showScreen(2, notSharingScreen())
  state.shows = result.shows
  if (thenSave) return saveSameRecordings(thenSave)
  state.selected = new Set(savableEpisodes(state.shows).filter(isWanted).map(episode => episode.id))
  showScreen(2, state.shows.length === 0 ? emptyListScreen() : recordingsScreen())
}

const connectByAddress = async ({ address, form }) => {
  const message = form.querySelector('.form-message')
  const button = form.querySelector('button[type="submit"]')
  message.textContent = ''
  button.disabled = true
  button.textContent = 'Connecting…'
  const visit = state.visit
  const result = await withMinimumDuration(api.connectToBox({ address }))
  if (!isCurrentVisit(visit)) return
  button.disabled = false
  button.textContent = 'Connect'
  if (result.box) {
    sounds.play('found')
    return useBox(result.box)
  }
  if (result.error !== 'invalid-address') sounds.play('failed')
  message.textContent = result.error === 'invalid-address'
    ? 'That is not an IP address.'
    : `No box answered at ${address.trim()}.`
}

const goToFolderStep = async () => {
  showScreen(3, folderScreen())
  await refreshFolderInfo()
}

const refreshFolderInfo = async () => {
  const check = ++state.folderCheck
  state.folderInfo = null
  renderFolderInfo()
  const info = await withMinimumDuration(api.describeFolder({ folder: state.folder, forPlex: state.forPlex, copyAgain: state.copyAgain, episodeIds: [...state.selected] }))
  if (check !== state.folderCheck) return
  state.folderInfo = info.error ? null : info
  renderFolderInfo()
}

const changeFolder = async () => {
  const { folder } = await api.chooseFolder({ current: state.folder })
  if (!folder) return
  state.folder = folder
  document.getElementById('folder-path').replaceWith(folderLabel())
  await refreshFolderInfo()
}

const beginSave = async () => {
  const order = savableEpisodes(state.shows).filter(episode => state.selected.has(episode.id))
  state.save = {
    order,
    rows: new Map(order.map(episode => [episode.id, { status: 'waiting', bytes: 0, total: episode.size, firstBytes: null, reason: '' }])),
    elements: new Map(),
    startedAt: Date.now(),
    waitedMs: 0,
    waitStartedAt: null,
    boxGaveUp: false,
    line: { mode: 'progress', since: 0, queue: [], timer: null },
    summary: null
  }
  state.saving = true
  const visit = showScreen(4, savingScreen())
  const copyAgain = state.copyAgain
  state.copyAgain = false
  state.saveRun = withMinimumDuration(api.startSave({ folder: state.folder, forPlex: state.forPlex, copyAgain, episodeIds: order.map(episode => episode.id) }))
  const result = await state.saveRun
  state.saving = false
  state.listIsStale = true
  state.save.summary = result.summary ?? null
  state.save.error = result.error ?? null
  if (state.leavingForStart || !isCurrentVisit(visit)) return
  playFinishSound(state.save.summary)
  showScreen(4, finishedScreen())
}

const goToStart = () => {
  if (state.saving) return confirmStopForStart()
  showWelcome()
}

const confirmStopForStart = () => {
  const stopButton = h('button', { type: 'button', className: 'btn stop', id: 'stop-and-start' }, 'Stop and go to start')
  stopButton.addEventListener('click', () => stopAndGoToStart(stopButton))
  openInfo({
    title: 'Recordings are still saving',
    body: [h('p', {}, 'If you stop now, a recording that is part way keeps what it has. Save the same recordings to the same folder next time to carry on from there.')],
    footer: [
      h('button', { type: 'button', className: 'btn quiet', id: 'keep-saving', onclick: closeInfo }, 'Keep saving'),
      stopButton
    ]
  })
}

const stopAndGoToStart = async (button) => {
  button.disabled = true
  button.textContent = 'Stopping…'
  state.leavingForStart = true
  await api.cancelSave()
  await state.saveRun
  state.leavingForStart = false
  closeInfo()
  showWelcome()
}

const goBackToStep = (step) => {
  if (step === 1) return showScreen(1, chooseBoxScreen())
  if (step === 2) return state.listIsStale || state.shows.length === 0 ? useBox(state.box) : showScreen(2, recordingsScreen())
  if (step === 3) return goToFolderStep()
}

const playFinishSound = (summary) => {
  if (!summary) return sounds.play('failed')
  if (summary.stopped > 0) return
  sounds.play(summary.notSaved > 0 ? 'failed' : 'finished')
}

const stopSave = async (button) => {
  button.disabled = true
  button.textContent = 'Stopping…'
  await api.cancelSave()
}

const welcomeScreen = () => ({
  content: [
    h('section', { className: 'welcome' },
      animatedMark(),
      h('h1', {}, 'Fetch My Recordings'),
      h('p', { className: 'lead' }, 'Copy the recordings on your Fetch box to this computer.'),
      h('button', { type: 'button', className: 'link', id: 'about-app', onclick: openAbout }, 'About this app'))
  ],
  actions: [
    h('span', { className: 'spacer' }),
    h('button', { type: 'button', className: 'btn primary', id: 'start', onclick: begin }, 'Start'),
    h('span', { className: 'spacer' })
  ]
})

const openAbout = () => openInfo({
  title: 'About this app',
  body: [
    h('ol', { className: 'how' },
      h('li', {}, 'Find the Fetch box on your home network'),
      h('li', {}, 'Choose the recordings you want'),
      h('li', {}, 'Choose a folder, then save')),
    h('p', {}, 'Free and open source, built on the ', fetchtvLink(), '. It talks only to your Fetch box, on your home network. It needs no Fetch account, and it deletes nothing from the box.'),
    h('p', { id: 'independence' }, 'Fetch My Recordings is an independent, free tool made by a Fetch customer. It is not made, endorsed, or supported by Fetch TV. Fetch is a trademark of its owner.'),
    h('p', { className: 'meta' }, `Version ${state.info.version}. Licence GPL-3.0-or-later. GitHub mark from GitHub Octicons, MIT licence. Figtree and Geist Mono fonts under the SIL Open Font Licence 1.1.`),
    h('p', {}, githubLink())
  ]
})

const searchingScreen = () => ({
  content: [
    h('h1', {}, 'Looking for your Fetch box'),
    h('p', { className: 'meta', id: 'search-status' }, 'Searching your home network…'),
    h('div', { className: 'progress is-busy searching', role: 'progressbar', 'aria-label': 'Searching' }, h('span', {}))
  ]
})

const notFoundScreen = () => ({
  content: [
    illustration('no-box'),
    headingWithInfo({ text: 'No Fetch box found', info: notFoundInfo }),
    h('p', {}, h('button', { type: 'button', className: 'btn', onclick: () => searchForBoxes({ autoPick: true }) }, 'Search again')),
    addressForm()
  ]
})

const notFoundInfo = () => openInfo({
  title: 'No Fetch box found',
  body: [
    h('p', {}, 'Check that:'),
    h('ul', { className: 'checks' },
      h('li', {}, 'the Fetch box is turned on'),
      h('li', {}, 'this computer is on the same Wi-Fi or home network as the Fetch box')),
    h('p', {}, 'Then search again, or type the IP address of the box.'),
    h('p', { id: 'firewall-tip' }, 'If a firewall app (such as Little Snitch) or your computer asked to allow Fetch My Recordings on your local network, allow it, then choose Search again.'),
    h('p', { id: 'vpn-tip' }, 'A VPN that sends all traffic through its tunnel can block the search. Allow local network access in the VPN app, or type the IP address of the box.')
  ]
})

const boxesToChoose = () => [...new Map([...state.boxes, state.box].filter(Boolean).map(box => [box.id, box])).values()]

const chooseBoxScreen = () => ({
  content: [
    h('h1', {}, boxesToChoose().length > 1 ? 'Choose your Fetch box' : 'Fetch box found'),
    h('ul', { className: 'table' }, ...boxesToChoose().map(box => h('li', { className: 'row' },
      h('button', { type: 'button', className: 'choice', onclick: () => chooseBox(box) },
        h('span', { className: 'box-dot' }),
        h('span', { className: 'row-text' },
          h('span', { className: 'row-title' }, box.name),
          h('span', { className: 'row-detail mono' }, box.address)))))),
    h('p', {}, h('button', { type: 'button', className: 'link', onclick: () => searchForBoxes({ autoPick: false, wholeNetwork: true }) }, 'Search again')),
    addressForm()
  ]
})

const addressForm = () => {
  const input = h('input', {
    id: 'box-address',
    type: 'text',
    inputMode: 'decimal',
    autocomplete: 'off',
    spellcheck: false,
    value: state.info.settings.lastAddress ?? ''
  })
  const form = h('form', { className: 'panel address-form', novalidate: true },
    h('div', { className: 'field' },
      h('span', { className: 'label-row' },
        h('label', { htmlFor: 'box-address' }, 'Or type its IP address'),
        infoButton({ label: 'Where to find the IP address', onclick: ipInfo })),
      input,
      h('button', { type: 'submit', className: 'btn' }, 'Connect')),
    h('p', { className: 'form-message', role: 'alert' }))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    connectByAddress({ address: input.value, form })
  })
  return form
}

const ipInfo = () => openInfo({
  title: 'The IP address of your Fetch box',
  body: [
    h('p', {}, 'It is four numbers with dots between them, such as 192.168.1.50.'),
    h('p', {}, 'Find it in your router’s list of connected devices, or in the network details of the Fetch box’s settings menu.')
  ]
})

const loadingListScreen = () => ({
  content: [
    boxCard(),
    h('h1', {}, 'Reading your recordings'),
    h('p', { className: 'meta', id: 'list-progress' }, ''),
    h('div', { className: 'progress is-busy searching', role: 'progressbar', 'aria-label': 'Reading' }, h('span', {}))
  ]
})

const showListProgress = ({ done, total }) => {
  const line = document.getElementById('list-progress')
  if (line && total > 0) line.textContent = `${done} of ${total} shows`
}

const emptyListScreen = () => ({
  content: [
    boxCard(),
    illustration('no-recordings'),
    headingWithInfo({ text: 'No recordings on this box', info: emptyInfo }),
    h('p', {}, h('button', { type: 'button', className: 'btn', onclick: () => useBox(state.box) }, 'Check again'))
  ]
})

const emptyInfo = () => openInfo({
  title: 'No recordings on this box',
  body: [
    h('p', { id: 'empty-reason' }, 'The box answered, and it has no recordings.'),
    h('p', {}, 'If your TV shows Fetch’s setup or activation screen, the box has lost its Fetch service. A box in that state shows no recordings.')
  ]
})

const boxDidNotAnswerScreen = () => ({
  content: [
    boxCard(),
    illustration('no-box'),
    headingWithInfo({ text: 'The box did not send its recordings', info: boxDidNotAnswerInfo }),
    h('p', { className: 'lead', id: 'restart-box' }, 'Restart the Fetch box, then try again.'),
    h('p', {}, h('button', { type: 'button', className: 'btn', onclick: () => useBox(state.box) }, 'Try again')),
    h('p', {}, h('button', { type: 'button', className: 'link', onclick: () => searchForBoxes({ autoPick: false, wholeNetwork: true }) }, 'Search again'))
  ]
})

const boxDidNotAnswerInfo = () => openInfo({
  title: 'The box did not send its recordings',
  body: [
    h('p', {}, 'The Fetch box answered, but it did not answer the request for its list of recordings properly. This does not mean the box has no recordings.'),
    h('p', {}, 'To restart the box, turn it off at the wall, wait 10 seconds, and turn it on again. When the TV shows the Fetch home screen, click Try again.')
  ]
})

const notSharingScreen = () => ({
  content: [
    boxCard(),
    illustration('no-recordings'),
    headingWithInfo({ text: 'The box is not sharing its recordings', info: notSharingInfo }),
    h('p', { className: 'lead', id: 'check-tv' }, 'Check the TV. If it shows the Fetch setup or activation screen, the box has lost its Fetch service.'),
    h('p', {}, h('button', { type: 'button', className: 'btn', onclick: () => useBox(state.box) }, 'Check again'))
  ]
})

const notSharingInfo = () => openInfo({
  title: 'The box is not sharing its recordings',
  body: [
    h('p', {}, 'The Fetch box answered, but it does not share a list of recordings.'),
    h('p', { id: 'lost-service' }, 'A Fetch box shows its setup or activation screen on the TV when it has lost its Fetch service: the account is cancelled or suspended, or the box cannot reach the internet.'),
    h('p', {}, 'The app cannot list the recordings until the box has its Fetch service again. If the box cannot reach the internet, check its network cable or Wi-Fi and your router.')
  ]
})

const listFailedScreen = () => ({
  content: [
    boxCard(),
    h('h1', {}, 'Could not read the recordings'),
    h('p', {}, h('button', { type: 'button', className: 'btn', onclick: () => useBox(state.box) }, 'Try again'))
  ]
})

const boxCard = () => h('div', { className: 'box-card', id: 'box-card' },
  h('span', { className: 'box-dot' }),
  h('span', { className: 'box-text' },
    h('span', { className: 'box-name' }, state.box.name),
    h('span', { className: 'box-address mono' }, state.box.address)),
  h('button', { type: 'button', className: 'link', onclick: () => searchForBoxes({ autoPick: false, wholeNetwork: true }) }, 'Change'))

const recordingsScreen = () => {
  const summary = h('span', { className: 'summary', id: 'selection-summary' })
  const next = h('button', { type: 'button', className: 'btn primary', id: 'next-to-folder', onclick: goToFolderStep }, 'Next')
  const allButton = h('button', { type: 'button', className: 'segment', onclick: () => { selectAll(); refreshAll() } }, 'Select all')
  const noneButton = h('button', { type: 'button', className: 'segment', onclick: () => { state.selected.clear(); refreshAll() } }, 'Select none')
  const rows = state.shows.map(showRow)
  const refreshAll = () => {
    rows.forEach(row => row.refresh())
    refreshSelectionSummary({ summary, next, allButton, noneButton })
  }
  rows.forEach(row => { row.onChange = refreshAll })
  refreshSelectionSummary({ summary, next, allButton, noneButton })
  return {
    content: [
      boxCard(),
      h('h1', {}, 'Choose recordings'),
      h('p', { className: 'meta', id: 'saved-summary' }, savedSummaryLine()),
      h('div', { className: 'toolbar' }, h('div', { className: 'segmented', role: 'group', 'aria-label': 'Selection' }, allButton, noneButton)),
      h('ul', { className: 'table', id: 'show-list' }, ...rows.map(row => row.element))
    ],
    actions: [
      summary,
      h('button', { type: 'button', className: 'btn quiet', onclick: () => showScreen(1, chooseBoxScreen()) }, 'Back'),
      next
    ]
  }
}

const savedSummaryLine = () => {
  const episodes = savableEpisodes(state.shows)
  const count = (savedState) => episodes.filter(episode => savedStateOf(episode) === savedState).length
  return [
    `${count('new')} new`,
    count('saved') > 0 && `${count('saved')} already saved`,
    count('missing') > 0 && `${count('missing')} moved or deleted`
  ].filter(Boolean).join(' · ')
}

const showRow = (show) => {
  const savable = show.episodes.filter(isSavable)
  const status = savable.length === 0 ? showStatus(show) : null
  const checkbox = h('input', { type: 'checkbox', 'aria-label': show.title })
  const row = { onChange: () => {} }
  const episodeRows = show.episodes.map(episode => episodeRow({ episode, onChange: () => row.onChange() }))
  const drawer = h('ul', { className: 'drawer', hidden: !state.open.has(show.id) }, ...episodeRows.map(item => item.element))
  const side = h('span', { className: 'row-side-value mono' })
  const reveal = h('span', { className: 'row-reveal' })
  const detail = h('span', { className: `row-detail${status ? ` is-${status.kind}` : ''}` })
  const main = h('div', { className: `row-main is-clickable${status ? ' is-unsavable' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(state.open.has(show.id)), title: status?.reason },
    status ? statusIcon(status) : h('label', { className: 'check', onclick: (event) => event.stopPropagation() }, checkbox),
    h('span', { className: 'row-text' }, h('span', { className: 'row-title' }, show.title), detail),
    h('span', { className: 'row-side' }, reveal, h('br', {}), side))

  const toggle = () => toggleDrawer({ show, drawer, main, reveal })
  main.addEventListener('click', toggle)
  main.addEventListener('keydown', (event) => {
    if (event.target !== main || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggle()
  })

  checkbox.addEventListener('change', () => {
    savable.forEach(episode => checkbox.checked ? state.selected.add(episode.id) : state.selected.delete(episode.id))
    row.onChange()
  })

  row.refresh = () => {
    const chosen = savable.filter(episode => state.selected.has(episode.id)).length
    checkbox.checked = chosen > 0 && chosen === savable.length
    checkbox.indeterminate = chosen > 0 && chosen < savable.length
    side.textContent = savable.length > 0 ? `${chosen} of ${savable.length}` : ''
    detail.textContent = showDetail(show)
    reveal.textContent = state.open.has(show.id) ? 'Hide' : 'Show'
    episodeRows.forEach(item => item.refresh())
  }
  row.refresh()

  row.element = h('li', { className: 'row show-row', 'data-show': show.title }, main, drawer)
  return row
}

const episodeRow = ({ episode, onChange }) => {
  if (!isSavable(episode)) return unsavableEpisodeRow(episode)
  const checkbox = h('input', { type: 'checkbox', 'aria-label': episode.title })
  checkbox.addEventListener('change', () => {
    checkbox.checked ? state.selected.add(episode.id) : state.selected.delete(episode.id)
    onChange()
  })
  const savedState = savedStateOf(episode)
  const main = h('div', { className: 'row-main is-clickable', 'data-saved': savedState },
    h('label', { className: 'check', onclick: (event) => event.stopPropagation() }, checkbox),
    h('span', { className: 'row-text' },
      h('span', { className: 'row-title' }, episode.title),
      h('span', { className: 'row-detail' }, formatDuration(episode.duration))),
    episodeSide({ episode, savedState }))
  main.addEventListener('click', () => checkbox.click())
  return {
    element: h('li', { className: 'row episode-row', 'data-episode': episode.id }, main),
    refresh: () => { checkbox.checked = state.selected.has(episode.id) }
  }
}

const unsavableEpisodeRow = (episode) => {
  const status = episodeStatus(episode)
  const main = h('div', { className: 'row-main is-unsavable', title: status.reason },
    statusIcon(status),
    h('span', { className: 'row-text' },
      h('span', { className: 'row-title' }, episode.title),
      h('span', { className: `row-detail is-${status.kind}` }, status.label)),
    h('span', { className: 'row-side' }))
  return {
    element: h('li', { className: 'row episode-row', 'data-episode': episode.id, 'data-status': status.kind }, main),
    refresh: () => {}
  }
}

const episodeStatus = (episode) => {
  if (episode.unavailable) return UNSAVABLE_STATUSES.missing
  if (episode.growing) return UNSAVABLE_STATUSES.recording
  return UNSAVABLE_STATUSES.sizeUnknown
}

const showStatus = (show) => {
  const kinds = new Set(show.episodes.map(episode => episodeStatus(episode).kind))
  if (kinds.size === 1) return episodeStatus(show.episodes[0])
  return UNSAVABLE_STATUSES.mixed
}

const UNSAVABLE_STATUSES = {
  recording: {
    kind: 'recording',
    label: 'Still recording',
    reason: 'The Fetch box is recording this now. After it ends, go Back and choose the box again to save it.'
  },
  sizeUnknown: {
    kind: 'size-unknown',
    label: 'May still be recording',
    reason: 'The Fetch box has not given a size for this recording yet. It may still be recording. After it ends, go Back and choose the box again to save it.'
  },
  missing: {
    kind: 'missing',
    label: 'File missing on the box',
    reason: 'The Fetch box lists this recording, but its file could not be opened. It may have been deleted on the box.'
  },
  mixed: {
    kind: 'mixed',
    label: 'Cannot be saved now',
    reason: 'None of these recordings can be saved now. Show them to see why.'
  }
}

const statusIcon = (status) => h('span', { className: `check is-status is-${status.kind}`, role: 'img', 'aria-label': 'Cannot be saved' }, statusGlyph(status.kind))

const statusGlyph = (kind) => {
  const svg = svgElement('svg', { viewBox: '0 0 24 24', width: 24, height: 24, class: 'status-glyph', 'aria-hidden': 'true' })
  STATUS_GLYPHS[kind].forEach(([tag, attributes]) => svg.append(svgElement(tag, attributes)))
  return svg
}

const CLOCK_GLYPH = [
  ['circle', { cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }],
  ['path', { d: 'M12 7.5V12l3 2', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]
]

const STATUS_GLYPHS = {
  recording: [['circle', { cx: 12, cy: 12, r: 6, fill: 'currentColor' }]],
  'size-unknown': CLOCK_GLYPH,
  missing: [
    ['circle', { cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }],
    ['path', { d: 'M5.8 18.2L18.2 5.8', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }]
  ],
  mixed: CLOCK_GLYPH
}

const episodeSide = ({ episode, savedState }) => {
  if (savedState === 'saved') return h('span', { className: 'row-side is-saved' }, 'Saved')
  if (savedState === 'missing') {
    return h('span', { className: 'row-side' }, h('button', {
      type: 'button',
      className: 'status-button is-warning',
      onclick: (event) => {
        event.stopPropagation()
        missingInfo(episode)
      }
    }, 'Moved or deleted'))
  }
  return h('span', { className: 'row-side mono' }, formatBytes(episode.size))
}

const missingInfo = (episode) => {
  const { path: filePath, savedAt } = episode.saved
  openInfo({
    title: 'Moved or deleted',
    body: [
      h('p', { id: 'missing-detail' }, `Saved ${savedDate(savedAt)}to ${lastParts(filePath, 2)}. It is no longer there.`),
      h('p', { className: 'example selectable' }, filePath),
      h('p', { className: 'meta' }, 'It is ticked, so Save copies it again.')
    ]
  })
}

const savedDate = (iso) => (iso ? `on ${new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })} ` : '')

const lastParts = (filePath, count) => filePath.split(/[\\/]/).filter(Boolean).slice(-count).join('/')

const savedStateOf = (episode) => episode.saved?.state ?? 'new'

const isWanted = (episode) => savedStateOf(episode) !== 'saved'

const toggleDrawer = ({ show, drawer, main, reveal }) => {
  const isOpen = state.open.has(show.id)
  isOpen ? state.open.delete(show.id) : state.open.add(show.id)
  drawer.hidden = isOpen
  main.setAttribute('aria-expanded', String(!isOpen))
  reveal.textContent = isOpen ? 'Show' : 'Hide'
}

const refreshSelectionSummary = ({ summary, next, allButton, noneButton }) => {
  const all = savableEpisodes(state.shows)
  const chosen = all.filter(episode => state.selected.has(episode.id))
  next.disabled = chosen.length === 0
  allButton.setAttribute('aria-pressed', String(chosen.length === all.length && all.length > 0))
  noneButton.setAttribute('aria-pressed', String(chosen.length === 0))
  summary.replaceChildren(...(chosen.length === 0
    ? ['Nothing selected']
    : [h('strong', {}, `${plural(chosen.length, 'recording')} selected`), ' · ', h('span', { className: 'mono' }, formatBytes(sumSizes(chosen)))]))
}

const selectAll = () => savableEpisodes(state.shows).forEach(episode => state.selected.add(episode.id))

const showDetail = (show) => {
  const savable = show.episodes.filter(isSavable)
  if (savable.length === 0) return showStatus(show).label
  const unsavable = show.episodes.length - savable.length
  const allSaved = savable.every(episode => savedStateOf(episode) === 'saved')
  return [
    ...(allSaved ? ['All saved'] : [plural(savable.length, 'recording'), formatBytes(sumSizes(savable))]),
    unsavable > 0 && `${unsavable} cannot be saved now`
  ].filter(Boolean).join(' · ')
}

const folderScreen = () => {
  const plexSwitch = h('button', {
    type: 'button',
    role: 'switch',
    className: 'toggle',
    id: 'plex-switch',
    'aria-checked': String(state.forPlex),
    'aria-labelledby': 'plex-label'
  }, h('span', { className: 'toggle-track' }, h('span', { className: 'toggle-knob' })))
  plexSwitch.addEventListener('click', () => {
    state.forPlex = !state.forPlex
    plexSwitch.setAttribute('aria-checked', String(state.forPlex))
    if (state.copyAgain) refreshFolderInfo()
  })
  return {
    content: [
      h('h1', {}, 'Choose a folder'),
      h('div', { className: 'panel' },
        h('div', { className: 'folder' },
          folderLabel(),
          infoButton({ label: 'Full path of the folder', onclick: folderInfo }),
          h('button', { type: 'button', className: 'btn', id: 'change-folder', onclick: changeFolder }, 'Change')),
        h('div', { id: 'folder-info', 'aria-live': 'polite' })),
      h('div', { className: 'setting' },
        plexSwitch,
        h('span', { className: 'setting-title', id: 'plex-label', onclick: () => plexSwitch.click() }, 'Names for Plex, Jellyfin or Kodi'),
        infoButton({ label: 'About names for Plex, Jellyfin or Kodi', onclick: plexInfo }))
    ],
    actions: [
      h('span', { className: 'spacer' }),
      h('button', { type: 'button', className: 'btn quiet', onclick: () => showScreen(2, recordingsScreen()) }, 'Back'),
      h('button', { type: 'button', className: 'btn primary', id: 'start-save', onclick: beginSave }, 'Save')
    ]
  }
}

const folderLabel = () => h('span', { className: 'folder-label', id: 'folder-path', title: state.folder, 'data-path': state.folder },
  h('span', { className: 'folder-name' }, lastParts(state.folder, 1)),
  h('span', { className: 'folder-parent' }, `in ${lastParts(parentOf(state.folder), 1) || 'this computer'}`))

const parentOf = (folder) => folder.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')

const folderInfo = () => openInfo({
  title: 'Folder',
  body: [h('p', { className: 'example selectable', id: 'folder-full-path' }, state.folder)]
})

const plexInfo = () => openInfo({
  title: 'Names for Plex, Jellyfin or Kodi',
  body: [
    h('p', {}, 'Media library apps need a folder for each season and the season and episode number in each file name. Turn this on if you watch recordings in one of them.'),
    h('p', {}, 'On'),
    h('p', { className: 'example', id: 'example-on' }, layoutExample({ forPlex: true })),
    h('p', {}, 'Off'),
    h('p', { className: 'example', id: 'example-off' }, layoutExample({ forPlex: false })),
    h('p', { className: 'meta' }, 'A recording without a season and episode number, such as a film, keeps its own name.')
  ]
})

const renderFolderInfo = () => {
  const box = document.getElementById('folder-info')
  if (!box) return
  const info = state.folderInfo
  const startButton = document.getElementById('start-save')
  if (!info) {
    box.replaceChildren(h('p', { className: 'meta space' }, 'Checking free space…'))
    if (startButton) startButton.disabled = true
    return
  }
  if (startButton) startButton.disabled = !info.canWrite
  box.replaceChildren(...folderInfoLines(info))
}

const folderInfoLines = (info) => {
  if (!info.canWrite) return [h('p', { className: 'notice', role: 'alert' }, 'Saving to this folder is not allowed.')]
  const free = info.freeBytes === null ? 'unknown' : formatBytes(info.freeBytes)
  const parts = [
    h('span', {}, 'Needs ', h('strong', {}, formatBytes(info.neededBytes))),
    h('span', {}, 'Free ', h('strong', {}, free)),
    info.alreadySavedCount > 0 ? h('span', { id: 'already-here' }, h('strong', {}, String(info.alreadySavedCount)), ' already here') : null
  ]
  const lines = [h('div', { className: 'space' }, ...parts)]
  if (info.freeBytes !== null && info.neededBytes > info.freeBytes) {
    lines.push(h('p', { className: 'notice', role: 'alert' }, 'Not enough space for all of these.'))
  }
  return lines
}

const layoutExample = ({ forPlex }) => {
  const episodes = savableEpisodes(state.shows).filter(item => state.selected.has(item.id))
  const episode = episodes.find(item => /S(?:eason)?\s*\d{1,3}\s*E(?:pisode)?\s*\d{1,3}/i.test(item.title)) ?? episodes[0]
  const show = state.shows.find(item => item.episodes.includes(episode))
  if (!episode || !show) return ''
  const numbers = episode.title.match(/S(?:eason)?\s*(\d{1,3})\s*E(?:pisode)?\s*(\d{1,3})/i)
  if (forPlex && numbers) {
    const season = numbers[1].padStart(2, '0')
    const number = numbers[2].padStart(2, '0')
    return `${show.title}/Season ${season}/${show.title} - S${season}E${number}.ts`
  }
  return `${show.title}/${episode.title}.ts`
}

const savingScreen = () => {
  const list = h('ul', { className: 'table' }, ...state.save.order.map(episode => saveRow(episode)))
  const stopButton = h('button', { type: 'button', className: 'btn stop', id: 'stop-save' }, 'Stop')
  stopButton.addEventListener('click', () => stopSave(stopButton))
  return {
    content: [
      headingWithInfo({ text: 'Saving', info: savingInfo }),
      h('div', { className: 'overall' },
        h('span', { className: 'overall-percent', id: 'overall-percent' }, '0%'),
        h('span', { className: 'overall-text', id: 'overall-line', role: 'status', 'aria-live': 'off' }, '')),
      h('div', { className: 'progress is-overall', role: 'progressbar', 'aria-label': 'All recordings', id: 'overall-bar' }, h('span', {})),
      list
    ],
    actions: [h('span', { className: 'spacer' }), stopButton],
    after: refreshOverall
  }
}

const savingInfo = () => openInfo({
  title: 'While it saves',
  body: [
    h('p', {}, 'This computer stays awake until the save finishes. Keep it on the same network as the Fetch box.'),
    h('p', {}, 'If you stop, a recording that is part way keeps what it has. Save the same recordings to the same folder again to carry on from there.')
  ]
})

const saveRow = (episode) => {
  const status = h('span', { className: 'status' }, 'Waiting')
  const bar = h('div', { className: 'progress', hidden: true }, h('span', {}))
  state.save.elements.set(episode.id, { status, bar })
  const show = state.shows.find(item => item.episodes.includes(episode))
  return h('li', { className: 'row save-row', 'data-episode': episode.id },
    h('div', { className: 'row-main' },
      h('span', { className: 'row-text' },
        h('span', { className: 'row-title' }, recordingName({ show, episode })),
        bar),
      status))
}

const updateSaveProgress = ({ id, bytes, total }) => {
  const row = state.save?.rows.get(id)
  if (!row || isFinal(row.status)) return
  if (row.firstBytes === null) row.firstBytes = bytes
  row.status = 'saving'
  row.isStalled = false
  row.bytes = bytes
  row.total = total > 1 ? total : row.total
  const elements = state.save.elements.get(id)
  if (elements) {
    elements.status.textContent = `${formatBytes(bytes)} of ${formatBytes(row.total)}`
    elements.status.className = 'status is-saving'
    elements.bar.hidden = false
    elements.bar.firstChild.style.width = `${percent(bytes, row.total)}%`
  }
  refreshOverall()
}

const updateSaveResult = ({ id, status, reason }) => {
  const row = state.save?.rows.get(id)
  if (!row) return
  row.status = status
  row.reason = reason
  if (status === 'saved' || status === 'already_saved') row.bytes = row.total
  const elements = state.save.elements.get(id)
  if (elements) {
    elements.bar.hidden = true
    elements.status.textContent = statusLabel(row)
    elements.status.className = `status ${statusClass(status)}`
  }
  refreshOverall()
}

const updateSaveRetry = ({ id }) => {
  const row = state.save?.rows.get(id)
  if (!row || isFinal(row.status)) return
  setRowStatus({ id, text: 'Trying again', className: 'status' })
}

const updateBoxState = ({ state: boxState }) => {
  const save = state.save
  if (!save) return
  if (boxState === 'lost') {
    save.waitStartedAt = Date.now()
    markStalledRows(save)
    showOverallLine({ save, mode: 'waiting' })
    return
  }
  endWait(save)
  if (boxState === 'gave-up') {
    save.boxGaveUp = true
    return
  }
  resumeStalledRows(save)
  showOverallLine({ save, mode: 'answering' })
  showOverallLine({ save, mode: 'progress' })
}

const endWait = (save) => {
  if (save.waitStartedAt === null) return
  save.waitedMs += Date.now() - save.waitStartedAt
  save.waitStartedAt = null
}

const markStalledRows = (save) => {
  for (const [id, row] of save.rows) {
    if (row.status !== 'saving') continue
    row.isStalled = true
    setRowStatus({ id, text: 'Box not answering', className: 'status' })
  }
}

const resumeStalledRows = (save) => {
  for (const [id, row] of save.rows) {
    if (!row.isStalled || row.status !== 'saving') continue
    row.isStalled = false
    setRowStatus({ id, text: `${formatBytes(row.bytes)} of ${formatBytes(row.total)}`, className: 'status is-saving' })
  }
}

const setRowStatus = ({ id, text, className }) => {
  const elements = state.save.elements.get(id)
  if (!elements) return
  elements.status.textContent = text
  elements.status.className = className
}

const showOverallLine = ({ save, mode }) => {
  const line = save.line
  if (mode === 'waiting') line.queue = line.queue.filter(queued => queued !== 'progress')
  if ((line.queue.at(-1) ?? line.mode) === mode) return
  line.queue.push(mode)
  advanceOverallLine(save)
}

const advanceOverallLine = (save) => {
  const line = save.line
  if (line.timer || line.queue.length === 0 || state.save !== save) return
  const remaining = line.mode === 'progress' ? 0 : BOX_LINE_MINIMUM_MS - (Date.now() - line.since)
  if (remaining > 0) {
    line.timer = setTimeout(() => {
      line.timer = null
      advanceOverallLine(save)
    }, remaining)
    return
  }
  line.mode = line.queue.shift()
  line.since = Date.now()
  refreshOverall()
  advanceOverallLine(save)
}

const refreshOverall = () => {
  const rows = [...state.save.rows.values()]
  const total = rows.reduce((sum, row) => sum + row.total, 0)
  const done = rows.reduce((sum, row) => sum + Math.min(row.bytes, row.total), 0)
  const finished = rows.filter(row => isFinal(row.status)).length
  const line = document.getElementById('overall-line')
  const bar = document.getElementById('overall-bar')
  if (!line || !bar) return
  const mode = state.save.line.mode
  if (mode === 'waiting') return setOverallLine({ line, text: BOX_STATE_LINES.waiting, isBoxState: true })
  const share = percent(done, total)
  document.getElementById('overall-percent').textContent = `${Math.floor(share)}%`
  bar.firstChild.style.width = `${share}%`
  bar.setAttribute('aria-valuenow', String(Math.round(share)))
  if (mode === 'answering') return setOverallLine({ line, text: BOX_STATE_LINES.answering, isBoxState: true })
  const eta = timeLeft({ rows, total, done })
  setOverallLine({ line, text: [`${finished} of ${rows.length} done`, `${formatBytes(done)} of ${formatBytes(total)}`, eta].filter(Boolean).join(' · '), isBoxState: false })
}

const setOverallLine = ({ line, text, isBoxState }) => {
  if (line.textContent !== text) line.textContent = text
  line.classList.toggle('is-box-state', isBoxState)
  line.setAttribute('aria-live', isBoxState ? 'polite' : 'off')
}

const timeLeft = ({ rows, total, done }) => {
  const now = Date.now()
  const waiting = state.save.waitedMs + (state.save.waitStartedAt === null ? 0 : now - state.save.waitStartedAt)
  const elapsed = (now - state.save.startedAt - waiting) / 1000
  const copied = rows.reduce((sum, row) => sum + (row.firstBytes === null ? 0 : Math.max(0, Math.min(row.bytes, row.total) - row.firstBytes)), 0)
  if (elapsed < 10 || copied <= 0) return ''
  const seconds = (total - done) / (copied / elapsed)
  if (seconds < 60) return 'under a minute left'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min left`
  return `about ${Math.floor(minutes / 60)} hr ${minutes % 60} min left`
}

const finishedScreen = () => {
  const summary = state.save.summary
  if (!summary) return saveErrorScreen()
  const remaining = summary.notSaved + summary.stopped
  const title = summary.stopped > 0 ? 'Stopped' : remaining > 0 ? 'Some not saved' : 'All done'
  return {
    content: [
      headingWithInfo({ text: title, info: finishedInfo }),
      h('div', { className: 'stats', id: 'save-totals' },
        stat({ label: 'Saved', value: summary.saved, tone: 'is-good', list: 'saved' }),
        stat({ label: 'Already saved', value: summary.alreadySaved, list: 'already' }),
        stat({ label: 'Not saved', value: summary.notSaved, tone: summary.notSaved > 0 ? 'is-bad' : '', list: 'not-saved' }),
        summary.stopped > 0 ? stat({ label: 'Stopped', value: summary.stopped, list: 'stopped' }) : null),
      summary.saved + summary.alreadySaved > 0
        ? h('section', { className: 'finished-section' }, whatNowCard())
        : null
    ],
    actions: [
      h('button', { type: 'button', className: `btn${remaining > 0 ? '' : ' primary'}`, id: 'open-folder', onclick: () => api.openSavedFolder() }, 'Open folder'),
      h('span', { className: 'spacer' }),
      h('button', { type: 'button', className: 'btn quiet', onclick: () => useBox(state.box) }, 'Choose other recordings'),
      h('button', { type: 'button', className: `btn${remaining > 0 ? ' primary' : ''}`, id: 'save-again', onclick: saveAgain }, 'Save again')
    ]
  }
}

const WHAT_NOW_SECTIONS = [
  { id: 'computer', tab: 'On this computer', heading: 'On this computer' },
  { id: 'tv', tab: 'On your TV', heading: 'On your TV' },
  { id: 'record', tab: 'Record free-to-air', heading: 'Record free-to-air TV without Fetch' }
]

const whatNowSection = (id) => {
  const section = WHAT_NOW_SECTIONS.find(item => item.id === id)
  return [
    illustration(`watch-${id}`),
    h('h3', {}, section.heading),
    ...whatNowBody(id)
  ]
}

const whatNowBody = (id) => {
  if (id === 'computer') {
    return [
      h('p', {}, 'Open them in VLC, a free video player that plays them all. QuickTime Player on a recent Mac plays many of them too.'),
      h('p', {}, linkButton({ label: 'Download VLC', name: 'vlc' })),
      h('p', {}, 'Need an MP4 instead? This guide shows how to convert them.'),
      h('p', {}, linkButton({ label: 'Convert to MP4', name: 'mp4' }))
    ]
  }
  if (id === 'tv') {
    return [h('ul', { className: 'options' },
      h('li', {}, h('strong', {}, 'USB drive. '), inlineLink({ label: 'Format the USB drive as ExFAT', name: 'usb' }), ', copy the folder to it, then plug it into a TV or media player that plays .ts files.'),
      h('li', {}, h('strong', {}, 'Apple TV, phone or tablet. '), 'Open them in Infuse or VLC from a shared folder.'),
      h('li', {}, h('strong', {}, 'Plex, Jellyfin or Kodi. '), state.forPlex
        ? 'Add the folder to your library. The files already have the names these apps need.'
        : 'Add the folder to your library. These apps need the Plex, Jellyfin or Kodi names. Saving again with them makes a second copy.',
      state.forPlex ? null : h('p', { className: 'option-action' }, h('button', { type: 'button', className: 'btn', id: 'save-with-plex-names', onclick: saveAgainWithPlexNames }, 'Save again with Plex names'))))]
  }
  return [
    h('p', {}, 'If you have, or are happy to buy, a TV tuner for your aerial (such as an HDHomeRun) and a computer or NAS that stays on, ', h('strong', {}, 'Freetvarr'), ' records free-to-air TV into the same kind of library. It’s free, from the same author.'),
    h('p', {}, linkButton({ label: 'Learn about Freetvarr', name: 'freetvarr' }))
  ]
}

const saveAgainWithPlexNames = () => {
  closeInfo()
  state.forPlex = true
  state.copyAgain = true
  goToFolderStep()
}

const inlineLink = ({ label, name }) => h('button', { type: 'button', className: 'link is-inline', 'data-link': name, onclick: () => api.openLink({ name }) }, label)

const linkButton = ({ label, name }) => h('button', { type: 'button', className: 'btn', 'data-link': name, onclick: () => api.openLink({ name }) }, label)

const whatNowInfo = () => {
  const panel = h('div', { className: 'what-now-panel' })
  const buttons = WHAT_NOW_SECTIONS.map(section => h('button', { type: 'button', className: 'segment what-now-tab', 'data-section': section.id, onclick: () => show(section.id) },
    lineIcon(section.id), h('span', {}, section.tab)))
  const show = (id) => {
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.section === id)))
    panel.replaceChildren(...whatNowSection(id))
    const bodyElement = document.getElementById('info-body')
    if (bodyElement) {
      bodyElement.scrollTop = 0
      updateScrollableBody()
    }
  }
  show('computer')
  openInfo({
    title: 'How to watch your recordings',
    variant: 'tabbed',
    body: [h('div', { className: 'segmented is-fill', role: 'group', 'aria-label': 'Where to watch' }, ...buttons), panel]
  })
}

const whatNowCard = () => h('div', { className: 'what-now-card', id: 'what-now-card' },
  illustration('watch-card'),
  h('div', { className: 'what-now-card-text' },
    h('h2', {}, 'I have my files, but now what?'),
    h('button', { type: 'button', className: 'btn', id: 'what-now', onclick: whatNowInfo }, 'How to watch your recordings')))

const finishedInfo = () => openInfo({
  title: 'Your recordings',
  body: [
    h('p', {}, 'They are in this folder:'),
    h('p', { className: 'example' }, state.folder),
    h('p', {}, 'They play in VLC, a free video player, or in a media library app such as Plex, Jellyfin or Kodi.'),
    h('p', {}, 'Save again skips the recordings that are already saved and carries on with the rest.')
  ]
})

const RESULT_LISTS = {
  saved: { title: 'Saved recordings', statuses: ['saved'] },
  already: { title: 'Already saved', statuses: ['already_saved'] },
  'not-saved': { title: 'Not saved', statuses: ['failed', 'locked', 'still_recording'] },
  stopped: { title: 'Stopped', statuses: ['cancelled'] }
}

const stat = ({ label, value, tone = '', list }) => {
  const parts = [h('span', { className: 'stat-label' }, label), h('span', { className: 'stat-value' }, String(value))]
  if (value === 0) return h('div', { className: `stat ${tone}`, 'data-list': list }, ...parts)
  return h('button', {
    type: 'button',
    className: `stat is-clickable ${tone}`,
    'data-list': list,
    'aria-label': `${label}: ${value}. Show list`,
    onclick: () => openResultList(list)
  }, ...parts, h('span', { className: 'stat-more' }, 'Show list'))
}

const resultEpisodes = (list) => state.save.order.filter(episode => RESULT_LISTS[list].statuses.includes(state.save.rows.get(episode.id)?.status))

const openResultList = (list) => {
  const episodes = resultEpisodes(list)
  const explained = list === 'not-saved' || list === 'stopped'
  const body = [
    list === 'saved' || list === 'already'
      ? h('p', { className: 'meta', id: 'result-folder' }, 'In ', h('strong', {}, lastParts(state.folder, 1)))
      : null,
    h('ul', { className: 'table', id: `result-list-${list}` }, ...episodes.map(episode => explained ? problemRow(episode) : resultRow(episode)))
  ]
  const footer = explained
    ? [h('button', { type: 'button', className: 'btn primary', id: 'dialog-save-again', onclick: saveAgainFromDialog }, 'Save again')]
    : []
  openInfo({ title: RESULT_LISTS[list].title, body, footer })
}

const recordingName = ({ show, episode }) => (!show || show.title === episode.title ? episode.title : `${show.title} · ${episode.title}`)

const resultRow = (episode) => {
  const show = state.shows.find(item => item.episodes.includes(episode))
  return h('li', { className: 'row' },
    h('div', { className: 'row-main is-plain' },
      h('span', { className: 'row-text' }, h('span', { className: 'row-title' }, recordingName({ show, episode })))))
}

const saveAgainFromDialog = () => {
  closeInfo()
  saveAgain()
}

const saveAgain = () => (state.save?.boxGaveUp ? saveAgainAfterLostBox() : beginSave())

const saveAgainAfterLostBox = async () => {
  const wanted = { counts: recordingKeys(state.selected), ids: new Set(state.selected) }
  const visit = showScreen(1, searchingScreen())
  const boxes = await withMinimumDuration(findBoxesWithRetry({ wholeNetwork: false }))
  if (!isCurrentVisit(visit)) return
  state.boxes = boxes
  const sameBox = boxes.find(box => box.key === state.box?.key)
  sounds.play(sameBox ? 'found' : 'failed')
  if (!sameBox) return showScreen(1, boxes.length === 0 ? notFoundScreen() : chooseBoxScreen())
  useBox(sameBox, { thenSave: wanted })
}

const saveSameRecordings = ({ counts, ids }) => {
  const left = new Map(counts)
  const candidates = state.shows.flatMap(show => show.episodes
    .filter(isSavable)
    .map(episode => ({ episode, key: recordingKey({ show, episode }) })))
  const sameIds = candidates.filter(({ episode, key }) => ids.has(episode.id) && takeOne({ left, key }))
  const sameIdSet = new Set(sameIds.map(({ episode }) => episode.id))
  const sameKeys = candidates.filter(({ episode, key }) => !sameIdSet.has(episode.id) && takeOne({ left, key }))
  state.selected = new Set([...sameIds, ...sameKeys].map(({ episode }) => episode.id))
  const isEveryRecordingFound = [...left.values()].every(count => count === 0)
  if (!isEveryRecordingFound || state.selected.size === 0) return showScreen(2, recordingsScreen())
  beginSave()
}

const takeOne = ({ left, key }) => {
  const count = left.get(key) ?? 0
  if (count === 0) return false
  left.set(key, count - 1)
  return true
}

const recordingKeys = (episodeIds) => {
  const counts = new Map()
  for (const show of state.shows) {
    for (const episode of show.episodes.filter(episode => episodeIds.has(episode.id))) {
      const key = recordingKey({ show, episode })
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

const recordingKey = ({ show, episode }) => `${show.title}\n${episode.title}\n${episode.size}`

const saveErrorScreen = () => ({
  content: [
    h('h1', {}, 'Could not save here'),
    h('p', { className: 'lead' }, state.save.error === 'no-space' ? 'The folder is full.' : 'Choose another folder.')
  ],
  actions: [
    h('span', { className: 'spacer' }),
    h('button', { type: 'button', className: 'btn primary', onclick: goToFolderStep }, 'Choose a folder')
  ]
})

const problemRow = (episode) => {
  const row = state.save.rows.get(episode.id)
  const show = state.shows.find(item => item.episodes.includes(episode))
  const reason = h('p', { className: 'drawer-text', hidden: true }, row.reason || 'Not started.')
  const reveal = h('span', { className: 'row-reveal is-always' }, 'Why')
  const main = h('div', { className: 'row-main is-clickable', role: 'button', tabindex: '0', 'aria-expanded': 'false' },
    h('span', { className: 'row-text' },
      h('span', { className: 'row-title' }, recordingName({ show, episode })),
      statusLabel(row) === 'Not saved' ? null : h('span', { className: 'row-detail' }, statusLabel(row))),
    h('span', { className: 'row-side' }, reveal))
  const toggle = () => {
    reason.hidden = !reason.hidden
    main.setAttribute('aria-expanded', String(!reason.hidden))
    reveal.textContent = reason.hidden ? 'Why' : 'Hide'
  }
  main.addEventListener('click', toggle)
  main.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle()
  })
  return h('li', { className: 'row problem-row' }, main, reason)
}

const statusLabel = (row) => {
  if (row.status === 'saved') return 'Saved'
  if (row.status === 'already_saved') return 'Already saved'
  if (row.status === 'cancelled') return row.reason === 'Not started.' ? 'Not started' : 'Stopped'
  return 'Not saved'
}

const statusClass = (status) => {
  if (status === 'saved' || status === 'already_saved') return 'saved'
  if (status === 'cancelled') return ''
  return 'failed'
}

const isFinal = (status) => status !== 'waiting' && status !== 'saving'

const headingWithInfo = ({ text, info }) => h('div', { className: 'heading-row' },
  h('h1', {}, text),
  infoButton({ label: `More about: ${text}`, onclick: info }))

const infoButton = ({ label, onclick }) => h('button', { type: 'button', className: 'info-button', 'aria-label': label, title: label, onclick }, 'i')

const setUpDialog = () => {
  const dialog = document.getElementById('info-dialog')
  window.addEventListener('resize', () => { if (dialog.open) updateScrollableBody() })
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })
  document.getElementById('info-close').addEventListener('click', () => dialog.close())
}

const closeInfo = () => document.getElementById('info-dialog').close()

const setUpHeader = () => {
  document.getElementById('home').addEventListener('click', goToStart)
  document.querySelectorAll('#steps .step').forEach(item => {
    const step = Number(item.closest('li').dataset.step)
    const goBack = () => { if (item.getAttribute('role') === 'button') goBackToStep(step) }
    item.addEventListener('click', goBack)
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      goBack()
    })
  })
}

const refreshSteps = () => document.querySelectorAll('#steps li').forEach(item => {
  const itemStep = Number(item.dataset.step)
  const step = item.querySelector('.step')
  item.classList.toggle('is-done', itemStep < state.step)
  if (itemStep === state.step) item.setAttribute('aria-current', 'step')
  else item.removeAttribute('aria-current')
  const canGoBack = itemStep < state.step && !state.saving
  if (canGoBack) {
    step.setAttribute('role', 'button')
    step.setAttribute('tabindex', '0')
    step.setAttribute('aria-label', `Back to ${step.querySelector('.step-label').textContent}`)
    return
  }
  step.removeAttribute('role')
  step.removeAttribute('tabindex')
  step.removeAttribute('aria-label')
})

const openInfo = ({ title, body, footer = [], variant = '' }) => {
  const dialog = document.getElementById('info-dialog')
  const bodyElement = document.getElementById('info-body')
  const footElement = document.getElementById('info-foot')
  dialog.className = `dialog${variant ? ` is-${variant}` : ''}`
  document.getElementById('info-title').textContent = title
  bodyElement.replaceChildren(...body.filter(Boolean))
  footElement.replaceChildren(...footer.filter(Boolean))
  footElement.hidden = footer.filter(Boolean).length === 0
  dialog.showModal()
  bodyElement.scrollTop = 0
  updateScrollableBody()
  document.getElementById('info-close').focus()
}

const updateScrollableBody = () => {
  const bodyElement = document.getElementById('info-body')
  if (bodyElement.scrollHeight > bodyElement.clientHeight + 1) bodyElement.setAttribute('tabindex', '0')
  else bodyElement.removeAttribute('tabindex')
}

const showScreen = (step, screen) => {
  state.step = step
  state.visit += 1
  document.body.classList.toggle('is-welcome', step === 0)
  refreshSteps()
  const view = document.getElementById('view')
  view.replaceChildren(...screen.content.filter(Boolean))
  view.scrollTop = 0
  const actions = (screen.actions ?? []).filter(Boolean)
  document.getElementById('actions').replaceChildren(...(actions.length ? [h('div', { className: 'actions-inner' }, ...actions)] : []))
  if (screen.after) screen.after()
  view.focus({ preventScroll: true })
  return state.visit
}

const isCurrentVisit = (visit) => visit === state.visit

const withMinimumDuration = async (work, ms = MINIMUM_BUSY_MS) => {
  const [result] = await Promise.all([work, wait(ms)])
  return result
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const APP_REPOSITORY = 'furey/fetch-my-recordings'
const APP_REPOSITORY_URL = `https://github.com/${APP_REPOSITORY}`
const FETCHTV_REPOSITORY_URL = 'https://github.com/furey/fetchtv'
const GITHUB_MARK_PATH = 'M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656'

const githubLink = () => {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('width', '16')
  icon.setAttribute('height', '16')
  icon.setAttribute('fill', 'currentColor')
  icon.setAttribute('aria-hidden', 'true')
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  mark.setAttribute('d', GITHUB_MARK_PATH)
  icon.append(mark)
  return h('button', {
    type: 'button',
    className: 'github-link',
    'aria-label': 'Fetch My Recordings on GitHub',
    title: APP_REPOSITORY_URL,
    onclick: () => api.openProjectPage()
  }, icon, h('span', {}, APP_REPOSITORY))
}

const fetchtvLink = () => h('button', {
  type: 'button',
  className: 'link is-inline',
  title: FETCHTV_REPOSITORY_URL,
  onclick: () => api.openFetchtvPage()
}, 'fetchtv command-line tool')

const SVG_NS = 'http://www.w3.org/2000/svg'
const MARK_CHIPS = [
  { name: 'blue', y: 11, fill: '#3ba4ff' },
  { name: 'orange', y: 23, fill: '#f28c28' },
  { name: 'yellow', y: 35, fill: '#f5c542' }
]
const MARK_TRAY = 'M9 28V44Q9 50 15 50H49Q55 50 55 44V28'

const svgElement = (tag, attributes) => {
  const element = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
  return element
}

const animatedMark = () => {
  const svg = svgElement('svg', { viewBox: '0 0 64 64', width: 104, height: 104, class: 'mark is-large is-animated', role: 'img', 'aria-label': 'Fetch My Recordings', id: 'welcome-mark' })
  const chips = svgElement('g', { class: 'mark-chips' })
  MARK_CHIPS.forEach(chip => chips.append(svgElement('rect', { x: 16, y: chip.y, width: 32, height: 8, rx: 2.5, fill: chip.fill, class: `mark-chip is-${chip.name}` })))
  svg.append(chips)
  svg.append(svgElement('path', { d: MARK_TRAY, fill: 'none', stroke: '#5ce1c6', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'mark-tray' }))
  return svg
}

const pauseWhenHidden = () => {
  const apply = () => document.body.classList.toggle('is-hidden', document.visibilityState === 'hidden')
  document.addEventListener('visibilitychange', apply)
  apply()
}

const markElement = ({ large = false } = {}) => h('img', { className: `mark${large ? ' is-large' : ''}`, src: 'mark.svg', alt: '', width: large ? 104 : 36, height: large ? 104 : 36 })

const savableEpisodes = (shows) => shows.flatMap(show => show.episodes).filter(isSavable)

const isSavable = (episode) => !episode.stillRecording && !episode.unavailable

const sumSizes = (episodes) => episodes.reduce((total, episode) => total + (episode.size || 0), 0)

const percent = (part, whole) => (whole > 0 ? Math.min(100, (part / whole) * 100) : 0)

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const formatBytes = (bytes) => {
  if (!bytes || bytes < 0) return '0 MB'
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

const formatDuration = (seconds) => {
  if (!seconds) return ''
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

const h = (tag, props = {}, ...children) => {
  const element = document.createElement(tag)
  Object.entries(props).forEach(([key, value]) => setProp({ element, key, value }))
  children.flat().filter(child => child !== null && child !== undefined && child !== false)
    .forEach(child => element.append(child instanceof Node ? child : document.createTextNode(String(child))))
  return element
}

const setProp = ({ element, key, value }) => {
  if (value === undefined || value === null) return
  if (key.startsWith('on') && typeof value === 'function') return element.addEventListener(key.slice(2), value)
  if (key.includes('-') || key === 'role' || key === 'novalidate' || key === 'tabindex') return element.setAttribute(key, String(value))
  element[key] = value
}

start()
