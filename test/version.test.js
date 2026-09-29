import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLatestWaWebVersion, resolveWaWebVersion, getFallbackWaWebVersion } from '../src/protocol/version.js'
import { getCompanionPlatformId, getCompanionPlatformDisplay } from '../src/pairing/platform.js'

test('WA Web version parser reads client_revision from sw.js', async () => {
  const result = await fetchLatestWaWebVersion({
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return `x "client_revision": 1234567890 y` } })
  })
  assert.deepEqual(result.version, [2, 3000, 1234567890])
  assert.equal(result.isLatest, true)
  assert.equal(result.source, 'web')
})

test('WA Web version resolver falls back cleanly when network is unavailable', async () => {
  const result = await resolveWaWebVersion({ fetchImpl: async () => { throw new Error('offline') } })
  assert.deepEqual(result.version, getFallbackWaWebVersion())
  assert.equal(result.isLatest, false)
  assert.equal(result.source, 'fallback')
})

test('explicit WA Web version always wins over fetching', async () => {
  const result = await resolveWaWebVersion({ version: [2, 3000, 42], fetchImpl: async () => { throw new Error('should not call') } })
  assert.deepEqual(result.version, [2, 3000, 42])
  assert.equal(result.source, 'explicit')
})

test('companion platform IDs follow current browser mapping', () => {
  assert.equal(getCompanionPlatformId(['macOS', 'Chrome', '1']), '1')
  assert.equal(getCompanionPlatformId(['macOS', 'Safari', '1']), '6')
  assert.equal(getCompanionPlatformId(['Windows', 'Desktop', '1']), '8')
  assert.equal(getCompanionPlatformDisplay(['macOS', 'Chrome', '1']), 'Chrome (macOS)')
})


test('WA Web version parser also accepts escaped client_revision JSON', async () => {
  const result = await fetchLatestWaWebVersion({
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return 'x \"client_revision\": 987654321 y' } })
  })
  assert.deepEqual(result.version, [2, 3000, 987654321])
  assert.equal(result.isLatest, true)
  assert.equal(result.source, 'web')
})

test('live connection can refuse stale fallback versions', async () => {
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const socket = new NativeWASocket({ fetchLatestVersion: true, fetchImpl: async () => { throw new Error('offline') } }, {})
  await assert.rejects(() => socket.connect(), error => error?.code === 'BAILEYS_WA_VERSION_UNAVAILABLE')
})
