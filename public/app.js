import { PitchShifter } from '/vendor/soundtouch.js'

const $ = (selector) => document.querySelector(selector)
const elements = {
  form: $('#load-form'),
  url: $('#youtube-url'),
  loadButton: $('#load-button'),
  status: $('#load-status'),
  empty: $('#empty-state'),
  workspace: $('#workspace'),
  artwork: $('#artwork'),
  title: $('#track-title'),
  artist: $('#track-artist'),
  duration: $('#track-duration'),
  canvas: $('#waveform-canvas'),
  seek: $('#seek'),
  current: $('#current-time'),
  remaining: $('#remaining-time'),
  transportCurrent: $('#transport-current'),
  transportDuration: $('#transport-duration'),
  play: $('#play-button'),
  reset: $('#reset-button'),
  speed: $('#speed-slider'),
  speedOutput: $('#speed-output'),
  speedDown: $('#speed-down'),
  speedUp: $('#speed-up'),
  pitch: $('#pitch-slider'),
  pitchOutput: $('#pitch-output'),
  pitchHelp: $('#pitch-help'),
  pitchDown: $('#pitch-down'),
  pitchUp: $('#pitch-up'),
}

let audioContext
let gainNode
let shifter
let audioBuffer
let peaks = []
let playing = false
let previousMode = 'linked'
let resumeAfterSeek = false
let drawQueued = false

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const selectedMode = () => document.querySelector('input[name="mode"]:checked').value

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

function setStatus(message = '', state = '') {
  elements.status.textContent = message
  elements.status.dataset.state = state
}

function setLoading(loading) {
  elements.url.disabled = loading
  elements.loadButton.disabled = loading
  elements.loadButton.dataset.loading = String(loading)
  elements.loadButton.textContent = loading ? 'Loading…' : 'Load track'
}

function ensureAudio() {
  if (audioContext) return
  audioContext = new AudioContext()
  gainNode = audioContext.createGain()
  gainNode.connect(audioContext.destination)
}

function pause() {
  if (!shifter || !playing) return
  try { shifter.disconnect() } catch {}
  playing = false
  elements.play.textContent = '▶ Play'
}

async function play() {
  if (!shifter || playing) return
  if (shifter.percentagePlayed >= 99.9) seekTo(0)
  await audioContext.resume()
  shifter.connect(gainNode)
  playing = true
  elements.play.textContent = 'Ⅱ Pause'
}

function togglePlayback() {
  if (playing) pause()
  else play().catch((error) => setStatus(error.message, 'error'))
}

function updateProgress(percent, time = (audioBuffer?.duration || 0) * percent / 100) {
  const value = clamp(Number(percent) || 0, 0, 100)
  const duration = audioBuffer?.duration || 0
  elements.seek.value = String(value)
  elements.current.textContent = formatTime(time)
  elements.remaining.textContent = `-${formatTime(duration - time)}`
  elements.transportCurrent.textContent = formatTime(time)
  queueWaveformDraw()
}

function setPlayhead(percent) {
  if (!shifter) return
  const value = clamp(Number(percent) || 0, 0, 100)
  shifter.percentagePlayed = value / 100
  updateProgress(value, (audioBuffer?.duration || 0) * value / 100)
}

function seekTo(percent) {
  const resume = playing
  pause()
  setPlayhead(percent)
  if (resume) play().catch((error) => setStatus(error.message, 'error'))
}

function onTrackEnd() {
  if (playing) {
    try { shifter.disconnect() } catch {}
  }
  playing = false
  elements.play.textContent = '↻ Replay'
  updateProgress(100, audioBuffer?.duration || 0)
}

function makePeaks(buffer, count = 240) {
  const samples = buffer.getChannelData(0)
  const bucketSize = samples.length / count
  const values = []
  let largest = 0

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.floor((bucket + 1) * bucketSize)
    const stride = Math.max(1, Math.floor((end - start) / 180))
    let total = 0
    let sampled = 0
    for (let index = start; index < end; index += stride) {
      total += Math.abs(samples[index])
      sampled += 1
    }
    const average = sampled ? total / sampled : 0
    largest = Math.max(largest, average)
    values.push(average)
  }

  return values.map((value) => largest ? value / largest : 0)
}

function drawWaveform() {
  drawQueued = false
  const canvas = elements.canvas
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(rect.width * ratio)
  canvas.height = Math.round(rect.height * ratio)
  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, rect.width, rect.height)

  const styles = getComputedStyle(document.documentElement)
  const muted = styles.getPropertyValue('--line-strong').trim()
  const accent = styles.getPropertyValue('--accent').trim()
  const progressX = rect.width * Number(elements.seek.value) / 100
  const top = 3.25 * 16
  const bottom = 2.25 * 16
  const available = Math.max(20, rect.height - top - bottom)
  const middle = top + available / 2
  const barWidth = rect.width / Math.max(1, peaks.length)

  peaks.forEach((peak, index) => {
    const height = Math.max(2, peak * available)
    const x = index * barWidth
    context.fillStyle = x <= progressX ? accent : muted
    context.fillRect(x, middle - height / 2, Math.max(1, barWidth - 1), height)
  })

  if (audioBuffer) {
    context.fillStyle = accent
    context.fillRect(progressX, top - 6, 2, available + 12)
  }
}

function queueWaveformDraw() {
  if (drawQueued) return
  drawQueued = true
  requestAnimationFrame(drawWaveform)
}

function applyAudioSettings() {
  const speed = Number(elements.speed.value)
  const mode = selectedMode()
  const pitch = mode === 'linked' ? 12 * Math.log2(speed) : Number(elements.pitch.value)

  if (mode === 'linked') elements.pitch.value = String(clamp(pitch, -12, 12))
  elements.speedOutput.textContent = `${speed.toFixed(2)}x`
  elements.pitchOutput.textContent = `${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}`
  elements.pitch.disabled = mode === 'linked'
  elements.pitchDown.disabled = mode === 'linked'
  elements.pitchUp.disabled = mode === 'linked'
  elements.pitchHelp.textContent = mode === 'linked' ? 'Linked: pitch follows speed like vinyl.' : 'Independent: speed and pitch are separate.'

  if (shifter) {
    shifter.pitchSemitones = pitch
    shifter.tempo = speed
  }
}

function changeRange(input, amount) {
  input.value = String(clamp(Number(input.value) + amount, Number(input.min), Number(input.max)))
  applyAudioSettings()
}

function resetTrack() {
  if (!shifter) return
  pause()
  document.querySelector('input[name="mode"][value="linked"]').checked = true
  previousMode = 'linked'
  elements.speed.value = '1'
  elements.pitch.value = '0'
  applyAudioSettings()
  seekTo(0)
}

function showTrack(track) {
  elements.title.textContent = track.title
  elements.artist.textContent = track.artist
  elements.duration.textContent = formatTime(track.duration)
  elements.transportDuration.textContent = formatTime(track.duration)
  elements.artwork.style.backgroundImage = track.thumbnail ? `url("${track.thumbnail}")` : ''
  elements.artwork.setAttribute('aria-label', track.thumbnail ? `${track.title} thumbnail` : '')
  elements.artwork.hidden = !track.thumbnail
  elements.empty.hidden = true
  elements.workspace.hidden = false
}

async function loadTrack(event) {
  event.preventDefault()
  setLoading(true)
  setStatus('Downloading and converting audio with yt-dlp…', 'loading')

  try {
    const response = await fetch('/api/load', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: elements.url.value }),
    })
    const track = await response.json()
    if (!response.ok) throw new Error(track.error || 'Could not load this track.')

    setStatus('Decoding audio in the browser…', 'loading')
    ensureAudio()
    pause()
    if (shifter) shifter.off()

    const audioResponse = await fetch(track.audioUrl)
    if (!audioResponse.ok) throw new Error('The local audio file could not be read.')
    const bytes = await audioResponse.arrayBuffer()
    audioBuffer = await audioContext.decodeAudioData(bytes)
    peaks = makePeaks(audioBuffer)
    shifter = new PitchShifter(audioContext, audioBuffer, 4096, onTrackEnd)
    shifter.on('play', ({ percentagePlayed, timePlayed }) => updateProgress(percentagePlayed, timePlayed))

    document.querySelector('input[name="mode"][value="linked"]').checked = true
    previousMode = 'linked'
    elements.speed.value = '1'
    elements.pitch.value = '0'
    applyAudioSettings()
    updateProgress(0)
    showTrack(track)
    queueWaveformDraw()
    setStatus()
  } catch (error) {
    setStatus(error.message || 'Could not load this track.', 'error')
  } finally {
    setLoading(false)
  }
}

elements.form.addEventListener('submit', loadTrack)
elements.play.addEventListener('click', togglePlayback)
elements.reset.addEventListener('click', resetTrack)
elements.seek.addEventListener('input', () => {
  if (playing) {
    resumeAfterSeek = true
    pause()
  }
  setPlayhead(elements.seek.value)
})
elements.seek.addEventListener('change', () => {
  if (resumeAfterSeek) play().catch((error) => setStatus(error.message, 'error'))
  resumeAfterSeek = false
})
elements.speed.addEventListener('input', applyAudioSettings)
elements.pitch.addEventListener('input', applyAudioSettings)
elements.speedDown.addEventListener('click', () => changeRange(elements.speed, -0.01))
elements.speedUp.addEventListener('click', () => changeRange(elements.speed, 0.01))
elements.pitchDown.addEventListener('click', () => changeRange(elements.pitch, -0.1))
elements.pitchUp.addEventListener('click', () => changeRange(elements.pitch, 0.1))

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener('change', () => {
    const mode = selectedMode()
    if (previousMode === 'linked' && mode === 'independent') {
      elements.pitch.value = String(clamp(12 * Math.log2(Number(elements.speed.value)), -12, 12))
    }
    previousMode = mode
    applyAudioSettings()
  })
})

document.addEventListener('keydown', (event) => {
  if (!shifter || ['INPUT', 'BUTTON'].includes(event.target.tagName)) return
  if (event.code === 'Space') {
    event.preventDefault()
    togglePlayback()
  } else if (event.key === 'ArrowLeft') {
    seekTo(Number(elements.seek.value) - 100 * 5 / audioBuffer.duration)
  } else if (event.key === 'ArrowRight') {
    seekTo(Number(elements.seek.value) + 100 * 5 / audioBuffer.duration)
  } else if (event.key.toLowerCase() === 'r') {
    resetTrack()
  }
})

new ResizeObserver(queueWaveformDraw).observe(elements.canvas)
applyAudioSettings()
