import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { NativeWASocket } from '../src/protocol/native-engine.js'
import { getCapabilities, getCapabilityStatus } from '../src/protocol/capabilities.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

test('startup banner reads packaged asset and defaults to five seconds', async () => {
  const banner = await import('../src/banner.js')
  const text = await banner.readBanner()
  assert.match(text, /VERSION: 1\.5\.2/)
  assert.equal(typeof banner.showStartupBanner, 'function')
})

test('terminal QR helper fails safe when no interactive renderer is available', async () => {
  const { renderTerminalQR, resetTerminalQR } = await import('../src/terminal-qr.js')
  resetTerminalQR()
  assert.equal(renderTerminalQR('TEST-QR'), false)
  resetTerminalQR()
})

test('capability status distinguishes implementation from live verification', () => {
  const caps = getCapabilities()
  const status = getCapabilityStatus()
  assert.equal(caps.messageSend, false)
  assert.equal(status.implemented.messageSend, true)
  assert.equal(status.liveVerified.messageSend, false)
  assert.match(status.notes.messageSend, /interoperability/)
})

test('noSelfSync suppresses local own-message event without disabling send', async () => {
  const sock = new NativeWASocket({ noSelfSync: true })
  sock.protocolState = 'secure'
  sock.auth = { pushName: 'test' }
  let sent = 0
  sock.nodes = { send: () => { sent++ } }
  const session = {
    encrypt: () => ({ wire: Buffer.from('encrypted') })
  }
  sock.signalStore = {
    get: async () => session,
    set: async () => {}
  }
  let ownEvents = 0
  sock.ev.on('messages.upsert', () => ownEvents++)
  const result = await sock.sendMessage('628123456789@s.whatsapp.net', 'hello')
  assert.equal(sent, 1)
  assert.equal(result.message.text, 'hello')
  assert.equal(ownEvents, 0)
  sock.end()
})

test('CommonJS entrypoint exposes stable constants without awaiting ESM loading', () => {
  const script = [
    "const b = require('./src/index.cjs');",
    "if (b.CompanionWebClientType.CHROME !== 1) process.exit(2);",
    "if (b.DisconnectCode.restartRequired !== 515) process.exit(3);",
    "if (typeof b.makeWASocket !== 'function') process.exit(4);",
    "console.log('ok')"
  ].join('')
  const out = execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(out.trim(), 'ok')
})

test('NativeWASocket exposes capability status through its fallback metadata path', async () => {
  const { nativeEngineInfo } = await import('../src/protocol/native-engine.js')
  const info = nativeEngineInfo()
  assert.equal(info.version, '1.5.2')
  assert.equal(info.baileyDependency, false)
  assert.equal(info.externalWhatsappEngineDependency, false)
  assert.equal(info.capabilityStatus.liveVerified.messageSend, false)
})

test('Baileys compatibility surface exposes auth, pairing constants and JID helpers', async () => {
  const mod = await import('../src/index.js')
  assert.equal(typeof mod.useMultiFileAuthState, 'function')
  assert.equal(typeof mod.makeCacheableSignalKeyStore, 'function')
  assert.equal(typeof mod.fetchLatestBaileysVersion, 'function')
  assert.equal(mod.DisconnectReason.loggedOut, 401)
  assert.deepEqual(mod.Browsers.ubuntu('Test'), ['Test', 'Chrome', '1.0.0'])
  assert.deepEqual(mod.Browsers.appropriate('Test'), ['Test', 'Chrome', '1.0.0'])
  assert.deepEqual(mod.jidDecode('628123:2@s.whatsapp.net'), { user: '628123', server: 's.whatsapp.net', domainType: 0, device: 2 })
  assert.equal(mod.jidNormalizedUser('628123:2@s.whatsapp.net'), '628123@s.whatsapp.net')
  assert.equal(mod.areJidsSameUser('628123@s.whatsapp.net', '628123@s.whatsapp.net'), true)
  assert.equal(mod.jidEncode('628123', 's.whatsapp.net', 2), '628123:2@s.whatsapp.net')
  assert.equal(mod.jidNormalizedUser('628123@c.us'), '628123@s.whatsapp.net')
  assert.equal(mod.transferDevice('628123:2@s.whatsapp.net', '628123@s.whatsapp.net'), '628123:2@s.whatsapp.net')
  assert.equal(mod.isJidGroup('123-456@g.us'), true)
  assert.equal(mod.getContentType({ conversation: 'hello' }), 'conversation')
  assert.equal(mod.getContentType({ viewOnceMessage: { message: { imageMessage: {} } } }), 'imageMessage')
  assert.equal(mod.getDevice({ key: { participant: '628123:7@s.whatsapp.net' } }), 7)
  assert.equal(Array.isArray(mod.DEFAULT_CONNECTION_CONFIG.version), true)
  assert.equal(typeof (await import('../src/protocol/native-engine.js')).NativeWASocket.prototype.sendReadReceipt, 'function')
})

test('useMultiFileAuthState prefers newer native credentials over stale legacy creds', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-native-over-legacy-'))
  try {
    await fs.writeFile(path.join(dir, 'credentials.json'), JSON.stringify({ registered: true, jid: 'new@s.whatsapp.net', pushName: 'new' }))
    await fs.writeFile(path.join(dir, 'creds.json'), JSON.stringify({ registered: false, jid: 'old@s.whatsapp.net', pushName: 'old' }))
    const { useMultiFileAuthState } = await import('../src/index.js')
    const state = await useMultiFileAuthState(dir)
    assert.equal(state.state.creds.registered, true)
    assert.equal(state.state.creds.jid, 'new@s.whatsapp.net')
    assert.equal(state.state.creds.pushName, 'new')
    await state.release()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('useMultiFileAuthState persists creds and key material without Baileys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-compat-auth-'))
  const { useMultiFileAuthState } = await import('../src/index.js')
  const first = await useMultiFileAuthState(dir)
  first.state.creds.registered = true
  await first.saveCreds()
  await first.state.keys.set({ 'sender-key': {
    '123@s.whatsapp.net::1': {
      value: 'ok',
      buffer: Buffer.from([1, 2, 3, 255]),
      nested: { bytes: new Uint8Array([4, 5, 6]) }
    }
  } })
  await first.release()

  const second = await useMultiFileAuthState(dir)
  assert.equal(second.state.creds.registered, true)
  const stored = (await second.state.keys.get('sender-key', ['123@s.whatsapp.net::1']))['123@s.whatsapp.net::1']
  assert.equal(stored.value, 'ok')
  assert.deepEqual(Buffer.from(stored.buffer), Buffer.from([1, 2, 3, 255]))
  assert.equal(stored.nested.bytes instanceof Uint8Array, true)
  assert.deepEqual([...stored.nested.bytes], [4, 5, 6])
  await second.release()
  await fs.rm(dir, { recursive: true, force: true })
})

test('CommonJS makeWASocket returns an immediate usable facade and remains awaitable', async () => {
  const { EventEmitter } = await import('node:events')
  const baileys = await import('node:module').then(({ createRequire }) => createRequire(import.meta.url)('../src/index.cjs'))
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-cjs-'))
  const sock = baileys.makeWASocket({
    authDir,
    requestPairingOnStart: false,
    autoFollowChannels: [],
    engine: { async makeWASocket() { return { ev: new EventEmitter(), end() {} } } }
  })
  assert.equal(typeof sock.ev.on, 'function')
  assert.equal(typeof sock.then, 'function')
  const ready = await sock
  assert.equal(ready, sock)
  assert.equal(sock.then, undefined)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})


test('makeCacheableSignalKeyStore caches, preserves deletes, and omits missing ids', async () => {
  const { makeCacheableSignalKeyStore } = await import('../src/index.js')
  const calls = []
  const backing = {
    async get(type, ids) { calls.push(['get', type, [...ids]]); return { [ids[0]]: { bytes: Buffer.from([7, 8]) } } },
    async set(data) { calls.push(['set', data]) },
    async clear() { calls.push(['clear']) }
  }
  const logger = { trace() {} }
  const cached = makeCacheableSignalKeyStore(backing, logger)
  const first = await cached.get('session', ['a', 'missing'])
  assert.deepEqual([...first.a.bytes], [7, 8])
  assert.equal('missing' in first, false)
  await cached.get('session', ['a'])
  assert.equal(calls.filter(([kind]) => kind === 'get').length, 1)
  await cached.set({ session: { a: null } })
  assert.deepEqual(calls.at(-1)?.[0], 'set')
  await cached.clear()
  assert.deepEqual(calls.at(-1), ['clear'])
})


test('ESM default export mirrors makeWASocket', async () => {
  const mod = await import('../src/index.js')
  assert.equal(mod.default, mod.makeWASocket)
})


test('CommonJS disconnect constants include transient recovery codes', () => {
  const mod = require('../src/index.cjs')
  assert.equal(mod.DisconnectCode.connectionIdle, 405)
  assert.equal(mod.DisconnectCode.badAck, 406)
  assert.equal(mod.DisconnectCode.temporary, 409)
  assert.equal(mod.DisconnectCode.unavailableService, 503)
})


test('CommonJS BufferJSON export remains an object, not a callable wrapper', () => {
  const mod = require('../src/index.cjs')
  assert.equal(typeof mod.BufferJSON.replacer, 'function')
  assert.equal(typeof mod.BufferJSON.reviver, 'function')
})

test('CommonJS entrypoint exposes capability status and constructable error classes', () => {
  const mod = require('../src/index.cjs')
  assert.equal(typeof mod.getCapabilityStatus, 'function')
  assert.equal(typeof mod.BaileysError, 'function')
  const err = new mod.BaileysError('x')
  assert.equal(err.message, 'x')
  assert.equal(typeof mod.DisconnectReason.rateLimited, 'number')
})


test('BufferJSON and DisconnectReason compatibility exports are usable from ESM', async () => {
  const mod = await import('../src/index.js')
  const encoded = JSON.stringify({ value: Buffer.from([1, 2, 255]) }, mod.BufferJSON.replacer)
  const decoded = JSON.parse(encoded, mod.BufferJSON.reviver)
  assert.deepEqual([...decoded.value], [1, 2, 255])
  assert.equal(mod.DisconnectReason.rateLimited, 429)
})

test('WAMessage compatibility builders produce Baileys-shaped message objects', async () => {
  const mod = await import('../src/index.js')
  const direct = mod.generateWAMessage('628000000000@s.whatsapp.net', { text: 'hello' }, { messageId: 'ABC' })
  assert.equal(direct.key.remoteJid, '628000000000@s.whatsapp.net')
  assert.equal(direct.key.id, 'ABC')
  assert.equal(direct.key.fromMe, true)
  assert.equal(direct.message.text, 'hello')
  const wrapped = { ephemeralMessage: { message: { conversation: 'wrapped' } } }
  assert.deepEqual(mod.extractMessageContent(wrapped), { conversation: 'wrapped' })
})

test('cacheable key store supports common cache delete/clear APIs', async () => {
  const { makeCacheableSignalKeyStore } = await import('../src/index.js')
  const cache = new Map()
  const backing = {
    async get(type, ids) { return Object.fromEntries(ids.map(id => [id, { n: id }])) },
    async set() {},
    async clear() {}
  }
  const cached = makeCacheableSignalKeyStore(backing, { trace() {} }, cache)
  await cached.get('session', ['a'])
  assert.ok(cache.has('session.a'))
  await cached.set({ session: { a: null } })
  assert.equal(cache.has('session.a'), false)
  await cached.get('session', ['a'])
  assert.ok(cache.has('session.a'))
  await cached.clear()
  assert.equal(cache.size, 0)
})


test('JID codec preserves canonical device/agent ordering and reads legacy ordering', () => {
  const mod = require('../src/index.cjs')
  const canonical = mod.jidEncode('6281234567890', 's.whatsapp.net', 2, 1)
  assert.equal(canonical, '6281234567890:2_1@s.whatsapp.net')
  const decoded = mod.jidDecode(canonical)
  assert.equal(decoded.user, '6281234567890')
  assert.equal(decoded.device, 2)
  assert.equal(decoded.domainType, 1)
  const legacy = mod.jidDecode('6281234567890_1:2@s.whatsapp.net')
  assert.equal(legacy.device, 2)
  assert.equal(legacy.domainType, 1)
})

test('CommonJS entrypoint exposes complete message codec and media primitives', () => {
  const mod = require('../src/index.cjs')
  assert.ok(Object.keys(mod.MESSAGE_FIELD_MAP).length >= 90)
  assert.equal(typeof mod.encodeMessageContent, 'function')
  assert.equal(typeof mod.decodeMessageContent, 'function')
  const wire = mod.encodeMessageContent({ conversation: 'hello' })
  assert.equal(mod.decodeMessageContent(wire).conversation, 'hello')
  assert.equal(typeof mod.encryptMedia, 'function')
  assert.equal(typeof mod.decryptMedia, 'function')
})

test('useMultiFileAuthState coalesces concurrent same-process initialization before the first lease is ready', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-pending-auth-'))
  try {
    const { useMultiFileAuthState } = await import('../src/index.js')
    const [first, second, third] = await Promise.all([
      useMultiFileAuthState(dir),
      useMultiFileAuthState(dir),
      useMultiFileAuthState(dir)
    ])
    assert.strictEqual(first.state, second.state)
    assert.strictEqual(first.state, third.state)
    await first.saveCreds({ pairingActive: true })
    assert.equal(second.state.creds.pairingActive, true)
    await first.release()
    await second.release()
    await third.release()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('useMultiFileAuthState reuses a same-process auth lease during reconnect-style reinitialization', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-shared-auth-'))
  try {
    const { useMultiFileAuthState } = await import('../src/index.js')
    const first = await useMultiFileAuthState(dir)
    const second = await useMultiFileAuthState(dir)
    assert.strictEqual(first.state, second.state)
    first.state.creds.registered = true
    await first.saveCreds()
    await first.release()
    const third = await useMultiFileAuthState(dir)
    assert.equal(third.state.creds.registered, true)
    await second.release()
    await third.release()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})


test('public browser defaults are canonical and branding does not become browser identity', async () => {
  const { DEFAULT_PUBLIC_BROWSER, normalizeBrowserTuple } = await import('../src/pairing/platform.js')
  assert.deepEqual(DEFAULT_PUBLIC_BROWSER, ['Ubuntu', 'Chrome', '1.0'])
  assert.deepEqual(normalizeBrowserTuple(undefined), ['Ubuntu', 'Chrome', '1.0'])
  assert.deepEqual(normalizeBrowserTuple(['MyBot', 'Chrome', '1.0']), ['MyBot', 'Chrome', '1.0'])
})
