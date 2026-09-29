import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLinkedDeviceQR, parseLinkedDeviceQR, parsePairDeviceNode } from '../src/pairing/qr.js'

test('linked-device QR roundtrip preserves 32-byte material', () => {
  const input = {
    ref: 'REF123',
    noisePublicKey: Buffer.alloc(32, 1),
    identityPublicKey: Buffer.alloc(32, 2),
    advSecretKey: Buffer.alloc(32, 3),
    clientType: 'web'
  }
  const qr = buildLinkedDeviceQR(input)
  const parsed = parseLinkedDeviceQR(qr)
  assert.equal(parsed.ref, input.ref)
  assert.deepEqual(parsed.noisePublicKey, input.noisePublicKey)
  assert.deepEqual(parsed.identityPublicKey, input.identityPublicKey)
  assert.deepEqual(parsed.advSecretKey, input.advSecretKey)
  assert.equal(parsed.clientType, 'web')
})

test('pair-device references are recursively discovered', () => {
  const node = { tag: 'iq', attrs: {}, content: [{ tag: 'x', attrs: {}, content: [{ tag: 'pair-device', attrs: { ref: 'abc' } }] }] }
  assert.equal(parsePairDeviceNode(node)[0].ref, 'abc')
})

import { buildPairingCodeRequest, parsePairingCodeNode, normalizePairingPhone } from '../src/pairing/code.js'

test('pairing-code request builder produces native companion hello IQ', () => {
  const node = buildPairingCodeRequest({
    phoneNumber: '+62 812-3456-7890',
    pairingCode: 'REPAN777',
    pairingEphemeralPublicKey: Buffer.alloc(32, 1),
    noisePublicKey: Buffer.alloc(32, 2),
    id: 'pair-1'
  })
  assert.equal(node.tag, 'iq')
  assert.equal(node.attrs.id, 'pair-1')
  assert.equal(node.content[0].tag, 'link_code_companion_reg')
  assert.equal(node.content[0].attrs.jid, '6281234567890@s.whatsapp.net')
  assert.equal(node.content[0].content[0].tag, 'link_code_pairing_wrapped_companion_ephemeral_pub')
  assert.equal(node.content[0].content[0].content.length, 80)
})

test('legacy pairing builder still exposes explicit customCode for old mocks', () => {
  const node = buildPairingCodeRequest({ phoneNumber: '6281234567890', customCode: 'REPAN777', id: 'legacy-1' })
  assert.equal(node.content[0].content[0].tag, 'link_code_pairing')
  assert.equal(node.content[0].content[0].attrs.code, 'REPAN777')
})

test('pairing-code parser tolerates nested response variants', () => {
  const node = { tag: 'iq', attrs: { type: 'result' }, content: [{ tag: 'x', content: [{ tag: 'link_code_pairing', attrs: { code: 'ab12-cd34' } }] }] }
  assert.equal(parsePairingCodeNode(node), 'AB12-CD34')
  assert.equal(normalizePairingPhone('+62 812 3456 7890'), '6281234567890')
})

import { aeadEncrypt, aeadDecrypt } from '../src/protocol/crypto/noise.js'

test('pairing hello response preserves opaque binary reference losslessly', async () => {
  const { parsePairingHelloResponse } = await import('../src/pairing/code.js')
  const ref = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0x01])
  const node = { tag: 'iq', attrs: {}, content: [{ tag: 'link_code_companion_reg', attrs: { stage: 'companion_hello' }, content: [{ tag: 'link_code_pairing_ref', attrs: {}, content: ref }] }] }
  const parsed = parsePairingHelloResponse(node)
  assert.equal(parsed.ref, ref.toString('base64url'))
  assert.deepEqual(parsed.refBuffer, ref)
})

test('AES-GCM helper accepts protocol 12-byte nonce buffers', () => {
  const key = Buffer.alloc(32, 7)
  const nonce = Buffer.alloc(12, 9)
  const plain = Buffer.from('baileys pairing')
  const encrypted = aeadEncrypt(key, nonce, plain)
  assert.deepEqual(aeadDecrypt(key, nonce, encrypted), plain)
})

test('buildCompanionFinishRequest produces companion_finish IQ with native wire fields', async () => {
  const { buildCompanionFinishRequest, generatePairingEphemeralKeyPair, wrapPairingEphemeralPublic } = await import('../src/pairing/code.js')
  const serverPrimary = generatePairingEphemeralKeyPair()
  const companionPairing = generatePairingEphemeralKeyPair()
  const identity = generatePairingEphemeralKeyPair()
  const primaryIdentity = Buffer.alloc(32, 8)
  const wrapped = wrapPairingEphemeralPublic('REPAN777', serverPrimary.publicKey)
  const result = buildCompanionFinishRequest({
    pairingCode: 'REPAN777',
    pairingEphemeralPrivateKey: companionPairing.privateKey,
    wrappedPrimaryEphemeralPublic: wrapped,
    primaryIdentityPublic: primaryIdentity,
    companionIdentityPrivateKey: identity.privateKey,
    companionIdentityPublicKey: identity.publicKey,
    meId: '628123@s.whatsapp.net',
    ref: Buffer.from([0, 255, 16, 128])
  })
  const reg = result.request.content[0]
  assert.equal(result.request.tag, 'iq')
  assert.equal(result.request.attrs.xmlns, 'md')
  assert.equal(reg.attrs.stage, 'companion_finish')
  assert.equal(reg.attrs.jid, '628123@s.whatsapp.net')
  assert.equal(reg.content[0].content.length >= 112, true)
  assert.equal(reg.content[1].content.length, 32)
  assert.deepEqual(reg.content[2].content, Buffer.from([0, 255, 16, 128]))
  assert.equal(result.advSecretKey.length, 32)
})


test('pairing-code transport failure clears transient pairing credentials', async () => {
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const sock = new NativeWASocket({ fetchLatestVersion: false }, { noiseKey: null, companion: null })
  sock.protocolState = 'secure'
  let saved = 0
  sock.nodes = { send() { throw new Error('send failed') } }
  sock.options.saveCreds = async () => { saved++ }
  await assert.rejects(() => sock.requestPairingCode('6281234567890', 'REPAN777'), /send failed/)
  assert.equal(sock.auth.pairingActive, false)
  assert.equal(sock.auth.pairingCode, undefined)
  assert.equal(sock.auth.pairingEphemeralKeyPair, undefined)
  assert.ok(saved >= 2)
  sock.end()
})

test('pairing-code request builder matches fire-and-notify semantics', async () => {
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const { EventEmitter } = await import('node:events')
  const sock = new NativeWASocket({ fetchLatestVersion: false }, { noiseKey: null, companion: null })
  sock.protocolState = 'secure'
  sock.nodes = { sent: [], send(node) { this.sent.push(node) }, request() { throw new Error('pairing must not await IQ result') } }
  const pair = await sock.requestPairingCode('6281234567890', 'REPAN777')
  assert.equal(pair, 'REPAN777')
  assert.equal(sock.nodes.sent.length, 1)
  assert.equal(sock.nodes.sent[0].content[0].attrs.stage, 'companion_hello')
})

test('default pairing code is random and bot-supplied custom code is opt-in', async () => {
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const sock = new NativeWASocket({ fetchLatestVersion: false }, { noiseKey: null, companion: null })
  sock.protocolState = 'secure'
  sock.nodes = { sent: [], send(node) { this.sent.push(node) } }

  const random = await sock.requestPairingCode('6281234567890')
  assert.match(random, /^[0-9A-HJKMNP-TV-Z]{8}$/)
  assert.notEqual(random, 'REPANOFFCL')
  assert.equal(sock.nodes.sent.length, 1)
  sock.end()
})


test('public default uses random pairing plus canonical WhatsApp companion identity', async () => {
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const sock = new NativeWASocket({
    fetchLatestVersion: false,
    browser: ['MyBot Brand', 'Chrome', '99.0'],
    safePairingIdentity: true
  }, { noiseKey: null, companion: null })
  sock.protocolState = 'secure'
  sock.nodes = { sent: [], send(node) { this.sent.push(node) } }

  const code = await sock.requestPairingCode('6281234567890')
  const root = sock.nodes.sent[0].content[0]
  const platform = root.content.find(item => item.tag === 'companion_platform_id')
  const display = root.content.find(item => item.tag === 'companion_platform_display')

  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/)
  assert.equal(platform.content, '1')
  assert.equal(display.content, 'Chrome (Ubuntu)')
  sock.end()
})

test('bot branding stays separate from WhatsApp protocol identity', async () => {
  const { makeWASocket } = await import('../src/index.js')
  assert.equal(typeof makeWASocket, 'function')
})
