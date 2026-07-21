import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeYouTubeUrl } from '../server.mjs'

test('accepts YouTube URLs and rejects lookalike hosts', () => {
  assert.equal(normalizeYouTubeUrl('https://youtu.be/BaW_jenozKc#t=1'), 'https://youtu.be/BaW_jenozKc')
  assert.match(normalizeYouTubeUrl('https://music.youtube.com/watch?v=BaW_jenozKc'), /^https:\/\/music\.youtube\.com\//)
  assert.throws(() => normalizeYouTubeUrl('https://youtube.com.example.com/watch?v=x'), /valid youtube/i)
  assert.throws(() => normalizeYouTubeUrl('http://youtube.com/watch?v=x'), /valid youtube/i)
})
