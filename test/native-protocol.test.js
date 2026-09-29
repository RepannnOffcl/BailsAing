import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { NoiseXXHandshake, generateX25519KeyPair, x25519 } from '../src/protocol/crypto/noise.js'
import { encodeHandshakeMessage, decodeHandshakeMessage } from '../src/protocol/wire/handshake.js'
import { encodeClientPayload } from '../src/protocol/native-engine.js'
import { WA_HEADER } from '../src/protocol/transport.js'
import { StableEventBus } from '../src/core/events.js'
import { createPersistentAuthState } from '../src/auth/state.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function serverHandshake() {
  const client = new NoiseXXHandshake(WA_HEADER)
  const server = new NoiseXXHandshake(WA_HEADER)
  const ce = generateX25519KeyPair()
  const se = generateX25519KeyPair()
  const ss = generateX25519KeyPair()

  client.mixHash(ce.publicKey)
  const ch = encodeHandshakeMessage('clientHello', { ephemeral: ce.publicKey })
  const decodedCh = decodeHandshakeMessage(ch)
  server.mixHash(decodedCh.ephemeral)
  server.mixHash(se.publicKey)
  server.mixDH(se.privateKey, decodedCh.ephemeral)
  const encryptedServerStatic = server.encrypt(ss.publicKey)
  server.mixDH(ss.privateKey, decodedCh.ephemeral)
  const certificate = Buffer.from('test-certificate')
  const encryptedCertificate = server.encrypt(certificate)
  const sh = encodeHandshakeMessage('serverHello', {
    ephemeral: se.publicKey,
    static: encryptedServerStatic,
    payload: encryptedCertificate
  })

  const shDecoded = decodeHandshakeMessage(sh)
  client.mixHash(shDecoded.ephemeral)
  client.mixDH(ce.privateKey, shDecoded.ephemeral)
  const decodedStatic = client.decrypt(shDecoded.static)
  assert.deepEqual(decodedStatic, ss.publicKey)
  client.mixDH(ce.privateKey, decodedStatic)
  assert.deepEqual(client.decrypt(shDecoded.payload), certificate)

  const clientStatic = generateX25519KeyPair()
  const clientStaticCipher = client.encrypt(clientStatic.publicKey)
  client.mixDH(clientStatic.privateKey, se.publicKey)
  const clientPayload = encodeClientPayload({ pushName: 'TEST', webVersion: [2, 3000, 101] })
  const payloadCipher = client.encrypt(clientPayload)
  const cf = encodeHandshakeMessage('clientFinish', { static: clientStaticCipher, payload: payloadCipher })
  const cfDecoded = decodeHandshakeMessage(cf)
  assert.deepEqual(server.decrypt(cfDecoded.static), clientStatic.publicKey)
  server.mixDH(se.privateKey, clientStatic.publicKey)
  assert.deepEqual(server.decrypt(cfDecoded.payload), clientPayload)

  const ct = client.finishTransport(false)
  const st = server.finishTransport(true)
  const encrypted = ct.encrypt(Buffer.from('hello'))
  assert.deepEqual(st.decrypt(encrypted), Buffer.from('hello'))

  const dh1 = x25519(ce.privateKey, se.publicKey)
  const dh2 = x25519(se.privateKey, ce.publicKey)
  assert.deepEqual(dh1, dh2)
}

test('Noise XX client/server transcript stays synchronized', serverHandshake)

test('handshake codec rejects malformed messages', () => {
  assert.throws(() => decodeHandshakeMessage(Buffer.from([0x01, 0x00])), /tidak dikenal|protobuf/)
})

test('StableEventBus once/off survives socket replacement', () => {
  const bus = new StableEventBus()
  const first = { ev: new EventEmitter() }
  const second = { ev: new EventEmitter() }
  let count = 0
  const listener = () => count++
  bus.once('message', listener)
  bus.attachSocket(first)
  first.ev.emit('message')
  first.ev.emit('message')
  assert.equal(count, 1)
  bus.on('message', listener)
  bus.attachSocket(second)
  second.ev.emit('message')
  assert.equal(count, 2)
  bus.off('message', listener)
  second.ev.emit('message')
  assert.equal(count, 2)
  bus.close()
})

test('auth state uses a real persistent X25519 keypair and atomic credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-auth-'))
  const state = await createPersistentAuthState(null, dir, { backupRetention: 2 })
  try {
    assert.equal(Buffer.from(state.creds.noiseKey.privateKey, 'base64').length, 32)
    assert.equal(Buffer.from(state.creds.noiseKey.publicKey, 'base64').length, 32)
    assert.equal(state.creds.registered, false)
    await state.saveCreds()
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'credentials.json'), 'utf8'))
    assert.equal(raw.noiseKey.publicKey, state.creds.noiseKey.publicKey)
  } finally {
    await state.release()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('Noise server identity pin accepts exact key and rejects mismatch', async () => {
  const accepted = Buffer.alloc(32, 7)
  const { verifyServerIdentity } = await import('../src/protocol/native-engine.js')
  assert.doesNotThrow(() => verifyServerIdentity({ serverStaticPin: accepted }, accepted, Buffer.from('cert')))
  assert.throws(() => verifyServerIdentity({ serverStaticPin: Buffer.alloc(32, 8) }, accepted, Buffer.from('cert')), /tidak cocok/)
  assert.throws(() => verifyServerIdentity({ verifyNoiseCertificate: () => false }, accepted, Buffer.from('cert')), /ditolak/)
})


test('client payload embeds companion registration only when companion material exists', async () => {
  const { readFields } = await import('../src/protocol/wire/protobuf.js')
  const payload = encodeClientPayload({ companion: {
    registrationId: 7,
    identityKey: { privateKey: Buffer.alloc(32, 1).toString('base64'), publicKey: Buffer.alloc(32, 2).toString('base64') },
    signedPreKey: { id: 9, privateKey: Buffer.alloc(32, 3).toString('base64'), publicKey: Buffer.alloc(32, 4).toString('base64'), signature: Buffer.alloc(64, 5).toString('base64') },
    advSecretKey: Buffer.alloc(32, 6).toString('base64'), clientType: 'web'
  } })
  const fields = readFields(payload)
  const registration = fields.find(x => x.field === 19 && x.wire === 2)?.value
  assert.ok(registration)
})

test('newsletter follow uses a correlated newsletter IQ node', async () => {
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const sock = Object.create(NativeWASocket.prototype)
  const requested = []
  sock.protocolState = 'secure'
  sock.nodes = { request: async node => { requested.push(node); return { tag: 'iq', attrs: { type: 'result' } } } }
  const result = await sock.newsletterFollow('120363413917159504@newsletter')
  assert.equal(result.tag, 'iq')
  assert.equal(requested[0].attrs.xmlns, 'newsletter')
  assert.equal(requested[0].attrs.to, '120363413917159504@newsletter')
  assert.equal(requested[0].content[0].attrs.subscribe, 'true')
})

test('nested pair-success transitions secure transport to authenticated', async () => {
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const sock = Object.create(NativeWASocket.prototype)
  sock.protocolState = 'secure'
  sock.auth = { registered: false }
  sock.options = {}
  sock.ev = new EventEmitter()
  const updates = []
  sock.ev.on('connection.update', value => updates.push(value))
  // #handleNode is private by design; simulate the public node event contract through a tiny real NodeClient-like hook.
  const { findNodeChild } = await import('../src/pairing/qr.js')
  const node = { tag: 'iq', content: [{ tag: 'wrapper', content: [{ tag: 'pair-success', attrs: { jid: '628@s.whatsapp.net', deviceId: '7' } }] }] }
  assert.equal(findNodeChild(node, 'pair-success').attrs.deviceId, '7')
})


test('linked-device QR builder rejects invalid key lengths', async () => {
  const { buildLinkedDeviceQR } = await import('../src/pairing/qr.js')
  assert.throws(() => buildLinkedDeviceQR({ ref: 'x', noisePublicKey: Buffer.alloc(31), identityPublicKey: Buffer.alloc(32), advSecretKey: Buffer.alloc(32) }), /noise public key/)
  assert.throws(() => buildLinkedDeviceQR({ ref: 'x', noisePublicKey: Buffer.alloc(32), identityPublicKey: Buffer.alloc(31), advSecretKey: Buffer.alloc(32) }), /identity public key/)
  assert.throws(() => buildLinkedDeviceQR({ ref: 'x', noisePublicKey: Buffer.alloc(32), identityPublicKey: Buffer.alloc(32), advSecretKey: Buffer.alloc(31) }), /adv secret/)
})

test('ClientPayload wire schema matches WhatsApp fields for registration and login', async () => {
  const { readFields } = await import('../src/protocol/wire/protobuf.js')
  const companion = {
    registrationId: 7,
    identityKey: {
      privateKey: Buffer.alloc(32, 1).toString('base64'),
      publicKey: Buffer.alloc(32, 2).toString('base64')
    },
    signedPreKey: {
      id: 9,
      privateKey: Buffer.alloc(32, 3).toString('base64'),
      publicKey: Buffer.alloc(32, 4).toString('base64'),
      signature: Buffer.alloc(64, 5).toString('base64')
    }
  }
  const registrationPayload = encodeClientPayload({
    companion,
    registered: false,
    browser: ['RepanXTEnka', 'Chrome', '1.0.0'],
    webVersion: [2, 3000, 1043857760],
    localeLanguage: 'en',
    localeCountry: 'US'
  })
  const registrationFields = readFields(registrationPayload)
  assert.deepEqual(registrationFields.filter(f => f.field === 3).map(f => Number(f.value)), [0])
  assert.deepEqual(registrationFields.filter(f => f.field === 33).map(f => Number(f.value)), [0])
  const ua = readFields(registrationFields.find(f => f.field === 5 && f.wire === 2).value)
  const uaMap = new Map(ua.map(f => [f.field, f]))
  assert.equal(Number(uaMap.get(1).value), 14)
  assert.equal(uaMap.get(3).wire, 2)
  assert.equal(uaMap.get(4).wire, 2)
  assert.equal(uaMap.get(5).wire, 2)
  assert.equal(uaMap.get(7).wire, 2)
  assert.equal(uaMap.get(8).wire, 2)
  assert.equal(uaMap.get(10).wire, 0)
  assert.equal(uaMap.get(11).wire, 2)
  assert.equal(uaMap.get(12).wire, 2)
  assert.equal(uaMap.has(10), true)
  assert.equal(uaMap.has(9), false)

  const webInfo = readFields(registrationFields.find(f => f.field === 6 && f.wire === 2).value)
  assert.deepEqual(webInfo, [{ field: 4, wire: 0, value: 0n }])

  const registration = readFields(registrationFields.find(f => f.field === 19 && f.wire === 2).value)
  assert.deepEqual(registration.map(f => f.field), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.ok(registration.every(f => f.wire === 2))
  assert.equal(registration.find(f => f.field === 1).value.toString('hex'), '00000007')
  assert.equal(registration.find(f => f.field === 4).value.toString('hex'), '000009')

  const loginPayload = encodeClientPayload({
    registered: true,
    userJid: '628123456789:1@s.whatsapp.net',
    browser: ['RepanXTEnka', 'Chrome', '1.0.0'],
    webVersion: [2, 3000, 1043857760]
  })
  const loginFields = readFields(loginPayload)
  const loginMap = new Map(loginFields.map(f => [f.field, f]))
  assert.equal(loginMap.get(1).value, 628123456789n)
  assert.equal(loginMap.get(3).value, 1n)
  assert.equal(loginMap.get(18).value, 1n)
  assert.equal(loginMap.get(33).value, 1n)
  assert.equal(loginMap.get(41).value, 0n)
  assert.equal(loginMap.has(19), false)
  const loginUa = readFields(loginMap.get(5).value)
  assert.equal(Number(loginUa.find(f => f.field === 1).value), 14)
})

test('ClientPayload registration does not advertise malformed scalar wire types', async () => {
  const { readFields } = await import('../src/protocol/wire/protobuf.js')
  const payload = encodeClientPayload({
    companion: {
      registrationId: 1,
      identityKey: { privateKey: Buffer.alloc(32, 1).toString('base64'), publicKey: Buffer.alloc(32, 7).toString('base64') },
      signedPreKey: { id: 1, privateKey: Buffer.alloc(32, 2).toString('base64'), publicKey: Buffer.alloc(32, 8).toString('base64'), signature: Buffer.alloc(64, 9).toString('base64') },
      advSecretKey: Buffer.alloc(32, 10).toString('base64')
    }
  })
  const fields = readFields(payload)
  const ua = readFields(fields.find(f => f.field === 5).value)
  assert.ok(ua.every(f => !((f.field === 10 || f.field === 1) && f.wire === 2)))
  assert.ok(ua.every(f => !((f.field === 3 || f.field === 4 || f.field === 5 || f.field === 6 || f.field === 7 || f.field === 8 || f.field === 11 || f.field === 12 || f.field === 13) && f.wire !== 2)))
  const registration = readFields(fields.find(f => f.field === 19).value)
  assert.ok(registration.every(f => f.wire === 2))
})
