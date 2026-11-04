import { getFetchRecordings, isCurrentlyRecording, sortRecordingsByTitle } from 'fetchtv'

export const listRecordings = async ({ location, onProgress }) => {
  let outcome = { outcome: 'ok' }
  const onOutcome = (reported) => { outcome = reported }
  const shows = sortRecordingsByTitle(await getFetchRecordings({ location, filters: {}, onProgress, onOutcome }))
  const summaries = await Promise.all(shows.map(summariseShow))
  return { shows, summaries, outcome }
}

export const listingProblemFor = (outcome) => LISTING_PROBLEMS[outcome] ?? null

const LISTING_PROBLEMS = {
  'no-content-directory': 'no-answer',
  'browse-failed': 'no-answer',
  'recordings-browse-failed': 'no-answer',
  'items-browse-failed': 'no-answer',
  'no-recordings-folder': 'not-sharing'
}

export const describeListing = ({ address, outcome, error, folders }) => [
  `Listed recordings from box ${address}: ${outcome}.`,
  error ? `Error: ${error}.` : '',
  folders ? `The box listed these folders: ${folders.length > 0 ? folders.join(', ') : 'none'}.` : ''
].filter(Boolean).join(' ')

export const pickEpisodes = ({ shows, episodeIds }) => {
  const wanted = new Set(episodeIds.map(String))
  return shows
    .map(show => ({ ...show, items: show.items.filter(item => wanted.has(String(item.id))) }))
    .filter(show => show.items.length > 0)
}

const summariseShow = async (show) => ({
  id: String(show.id),
  title: show.title,
  episodes: await Promise.all(show.items.map(summariseEpisode))
})

const summariseEpisode = async (item) => ({
  id: String(item.id),
  title: item.title,
  size: Number.isFinite(item.size) && item.size > 0 ? item.size : 0,
  duration: item.duration || 0,
  stillRecording: await isCurrentlyRecording(item),
  unavailable: item.unavailable === true
})
