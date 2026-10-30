import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppServer, normalizeYouTubeUrl } from '../server.mjs'

test('accepts YouTube URLs and rejects lookalike hosts', () => {
  assert.equal(normalizeYouTubeUrl('https://youtu.be/BaW_jenozKc#t=1'), 'https://youtu.be/BaW_jenozKc')
  assert.match(normalizeYouTubeUrl('https://music.youtube.com/watch?v=BaW_jenozKc'), /^https:\/\/music\.youtube\.com\//)
  assert.throws(() => normalizeYouTubeUrl('https://youtube.com.example.com/watch?v=x'), /valid youtube/i)
  assert.throws(() => normalizeYouTubeUrl('http://youtube.com/watch?v=x'), /valid youtube/i)
})

test('serves robots.txt, sitemap.xml and og.png as real files', async (t) => {
  const server = createAppServer().listen(0)
  t.after(() => server.close())
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const robots = await fetch(`${base}/robots.txt`)
  assert.match(robots.headers.get('content-type'), /^text\/plain/)
  assert.match(await robots.text(), /^Sitemap: https:\/\/youtubedj\.codyh\.xyz\/sitemap\.xml$/m)

  const sitemap = await fetch(`${base}/sitemap.xml`)
  assert.match(sitemap.headers.get('content-type'), /xml/)
  assert.match(await sitemap.text(), /<urlset/)

  const og = await fetch(`${base}/og.png`, { method: 'HEAD' })
  assert.equal(og.status, 200)
  assert.equal(og.headers.get('content-type'), 'image/png')
})
