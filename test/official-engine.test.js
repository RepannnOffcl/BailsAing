import test from 'node:test'
import assert from 'node:assert/strict'
import { officialEngineInfo, OFFICIAL_BAILEYS_PACKAGE, OFFICIAL_BAILEYS_VERSION } from '../src/protocol/official-engine.js'


test('official engine is the default public transport identity', () => {
  const info = officialEngineInfo()
  assert.equal(info.kind, 'official')
  assert.equal(info.package, OFFICIAL_BAILEYS_PACKAGE)
  assert.equal(info.version, OFFICIAL_BAILEYS_VERSION)
  assert.equal(info.scope, 'transport-auth-pairing')
})

test('official engine is pinned instead of following upstream breaking releases', () => {
  assert.equal(OFFICIAL_BAILEYS_PACKAGE, '@whiskeysockets/baileys')
  assert.equal(OFFICIAL_BAILEYS_VERSION, '7.0.0-rc14')
})
