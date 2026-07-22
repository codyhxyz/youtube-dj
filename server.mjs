import { createReadStream } from 'node:fs'
import { access, mkdir, stat, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = dirname(fileURLToPath(import.meta.url))
const publicDir = join(root, 'public')
const cacheDir = join(root, '.cache')
const maxBodyBytes = 8_192

export function normalizeYouTubeUrl(input) {
  let url
  try {
    url = new URL(String(input).trim())
  } catch {
    throw new Error('Enter a valid YouTube URL.')
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const allowed = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']
  if (url.protocol !== 'https:' || !allowed.includes(host) || url.username || url.password) {
    throw new Error('Enter a valid youtube.com or youtu.be URL.')
  }

  url.hash = ''
  return url.toString()
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body) > maxBodyBytes) throw new Error('Request is too large.')
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('Invalid request.')
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function sendFile(req, res, path, type, cacheControl = 'no-store', deleteAfterSend = false) {
  try {
    const file = await stat(path)
    res.writeHead(200, {
      'content-type': type,
      'content-length': file.size,
      'cache-control': cacheControl,
    })
    if (req.method === 'HEAD') return res.end()

    if (deleteAfterSend) {
      let deleted = false
      const remove = () => {
        if (deleted) return
        deleted = true
        unlink(path).catch(() => {})
      }
      res.once('finish', remove)
      res.once('close', remove)
    }
    createReadStream(path).pipe(res)
  } catch {
    json(res, 404, { error: 'Not found.' })
  }
}

function commandError(error) {
  if (error.code === 'ENOENT') return 'yt-dlp or ffmpeg is not installed.'
  const line = String(error.stderr || error.message)
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1)
  return (line || 'Could not load this video.').replace(/^ERROR:\s*/i, '').slice(0, 300)
}

async function loadTrack(url) {
  await mkdir(cacheDir, { recursive: true })

  let info
  try {
    const { stdout } = await exec(
      'yt-dlp',
      [
        '--no-warnings',
        '--no-playlist',
        '--no-simulate',
        '--match-filter',
        'duration <= 1200',
        '--max-filesize',
        '100M',
        '--extract-audio',
        '--audio-format',
        'm4a',
        '--audio-quality',
        '0',
        '--output',
        '%(id)s.%(ext)s',
        '--print',
        'after_move:%(.{id,title,artist,uploader,channel,duration,thumbnail})j',
        url,
      ],
      { cwd: cacheDir, maxBuffer: 1024 * 1024, timeout: 15 * 60_000 },
    )
    info = JSON.parse(stdout.trim().split('\n').at(-1))
  } catch (error) {
    throw new Error(commandError(error))
  }

  const id = String(info.id || '').replace(/[^\w-]/g, '')
  if (!id) throw new Error('yt-dlp did not return a video ID.')
  if (!(await exists(join(cacheDir, `${id}.m4a`)))) throw new Error('Audio conversion did not produce an m4a file.')

  return {
    id,
    title: info.title || 'Untitled track',
    artist: info.artist || info.uploader || info.channel || 'Unknown artist',
    duration: Number(info.duration) || 0,
    thumbnail: typeof info.thumbnail === 'string' ? info.thumbnail : '',
    audioUrl: `/audio/${encodeURIComponent(id)}.m4a`,
  }
}

export function createAppServer() {
  let downloading = false

  return createServer(async (req, res) => {
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; img-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')

    const requestUrl = new URL(req.url || '/', 'http://localhost')

    if ((req.method === 'GET' || req.method === 'HEAD') && ['/', '/index.html'].includes(requestUrl.pathname)) {
      return sendFile(req, res, join(publicDir, 'index.html'), 'text/html; charset=utf-8')
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && requestUrl.pathname === '/app.js') {
      return sendFile(req, res, join(publicDir, 'app.js'), 'text/javascript; charset=utf-8')
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && requestUrl.pathname === '/vendor/soundtouch.js') {
      return sendFile(
        req,
        res,
        join(root, 'node_modules', 'soundtouchjs', 'dist', 'soundtouch.js'),
        'text/javascript; charset=utf-8',
        'public, max-age=31536000, immutable',
      )
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/load') {
      if (downloading) {
        res.setHeader('retry-after', '10')
        return json(res, 429, { error: 'Another track is downloading. Try again shortly.' })
      }

      downloading = true
      try {
        const { url } = await readJson(req)
        return json(res, 200, await loadTrack(normalizeYouTubeUrl(url)))
      } catch (error) {
        return json(res, 400, { error: error.message || 'Could not load this track.' })
      } finally {
        downloading = false
      }
    }

    const audioMatch = requestUrl.pathname.match(/^\/audio\/([\w-]+)\.m4a$/)
    if ((req.method === 'GET' || req.method === 'HEAD') && audioMatch) {
      return sendFile(
        req,
        res,
        join(cacheDir, `${audioMatch[1]}.m4a`),
        'audio/mp4',
        'private, max-age=86400',
        process.env.NODE_ENV === 'production',
      )
    }

    json(res, 404, { error: 'Not found.' })
  })
}

export function start(port = Number(process.env.PORT) || 3000) {
  const server = createAppServer()
  server.listen(port, () => console.log(`YouTube DJ: http://localhost:${port}`))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
