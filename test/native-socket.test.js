import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { NativeWASocket, createNativeEngineSocket } from '../src/protocol/native-engine.js'
import { makeWASocket } from '../src/index.js'
import { NoiseXXHandshake, generateX25519KeyPair } from '../src/protocol/crypto/noise.js'
import { WA_HEADER } from '../src/protocol/transport.js'
import { encodeHandshakeMessage, decodeHandshakeMessage } from '../src/protocol/wire/handshake.js'
import { createIq, encodeBinaryNode, decodeBinaryNode } from '../src/protocol/wire/binary-node.js'

function frame(data) {
  const body = Buffer.from(data)
  const len = Buffer.alloc(3)
  len.writeUIntBE(body.length, 0, 3)
  return Buffer.concat([len, body])
}

class MockWSServerSocket {
  constructor() {
    this.handlers = new Map()
    this.readyState = 0
    this.server = new MockServer(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open')
    })
  }
  on(event, handler) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event).add(handler); return this }
  once(event, handler) { const wrapped = (...args) => { this.off(event, wrapped); handler(...args) }; return this.on(event, wrapped) }
  off(event, handler) { this.handlers.get(event)?.delete(handler); return this }
  emit(event, ...args) { for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args) }
  send(data) { this.server.receive(Buffer.from(data)) }
  close(code = 1000, reason = 'closed') { this.readyState = 3; queueMicrotask(() => this.emit('close', code, Buffer.from(reason))) }
}

class MockServer {
  constructor(client) {
    this.client = client
    this.noise = new NoiseXXHandshake(WA_HEADER)
    this.serverEphemeral = generateX25519KeyPair()
    this.serverStatic = generateX25519KeyPair()
    this.cipher = null
    this.step = 0
  }
  receive(packet) {
    let offset = 0
    if (this.step === 0) {
      assert.deepEqual(packet.subarray(0, WA_HEADER.length), WA_HEADER)
      this.gotHeader = true
      offset = WA_HEADER.length
    }
    const len = packet.readUIntBE(offset, 3)
    const payload = packet.subarray(offset + 3, offset + 3 + len)
    if (this.step === 0) {
      assert.equal(this.gotHeader, true)
      const hello = decodeHandshakeMessage(payload)
      assert.equal(hello.kind, 'clientHello')
      this.clientEphemeral = hello.ephemeral
      this.noise.mixHash(this.clientEphemeral)
      this.noise.mixHash(this.serverEphemeral.publicKey)
      this.noise.mixDH(this.serverEphemeral.privateKey, this.clientEphemeral)
      const encryptedStatic = this.noise.encrypt(this.serverStatic.publicKey)
      this.noise.mixDH(this.serverStatic.privateKey, this.clientEphemeral)
      const encryptedCert = this.noise.encrypt(Buffer.from('mock-cert'))
      const serverHello = encodeHandshakeMessage('serverHello', {
        ephemeral: this.serverEphemeral.publicKey,
        static: encryptedStatic,
        payload: encryptedCert
      })
      this.step = 1
      queueMicrotask(() => this.client.emit('message', frame(serverHello)))
      return
    }
    if (this.step === 1) {
      const finish = decodeHandshakeMessage(payload)
      assert.equal(finish.kind, 'clientFinish')
      const clientStatic = this.noise.decrypt(finish.static)
      this.noise.mixDH(this.serverEphemeral.privateKey, clientStatic)
      this.noise.decrypt(finish.payload)
      this.cipher = this.noise.finishTransport(true)
      this.step = 2
      const pairQr = encodeBinaryNode({ tag: 'iq', attrs: { id: 'pair-ref', type: 'set' }, content: [{ tag: 'pair-device', attrs: { ref: 'MOCK-REF' } }] })
      const success = encodeBinaryNode({ tag: 'success', attrs: { jid: '628123@s.whatsapp.net', deviceId: '1' } })
      const response = encodeBinaryNode(createIq({ id: 'mock-response', type: 'result' }))
      queueMicrotask(() => this.client.emit('message', frame(this.cipher.encrypt(pairQr))))
      queueMicrotask(() => this.client.emit('message', frame(this.cipher.encrypt(success))))
      queueMicrotask(() => this.client.emit('message', frame(this.cipher.encrypt(response))))
      return
    }
    if (this.step === 2) {
      const node = decodeBinaryNode(this.noDecrypt(payload))
      assert.equal(node.tag, 'iq')
      const reg = node.content?.[0]
      assert.equal(reg?.tag, 'link_code_companion_reg')
      assert.equal(reg?.attrs?.jid, '6281234567890@s.whatsapp.net')
      assert.equal(reg?.content?.[0]?.tag, 'link_code_pairing_wrapped_companion_ephemeral_pub')
      assert.equal(reg?.content?.[0]?.content?.length, 80)
      const result = encodeBinaryNode({ tag: 'iq', attrs: { id: node.attrs.id, type: 'result' }, content: [{ tag: 'link_code_pairing', attrs: { code: 'AB12-CD34' } }] })
      queueMicrotask(() => this.client.emit('message', frame(this.cipher.encrypt(result))))
    }
  }
  noDecrypt(payload) { return this.cipher.decrypt(payload) }
}

test('public makeWASocket waits for native secure lifecycle before pairing', async () => {
  const authDir = await (await import('node:fs/promises')).mkdtemp((await import('node:path')).join(process.cwd(), '.tmp-baileys-public-'))
  const engine = { makeWASocket: createNativeEngineSocket }
  const sock = await makeWASocket({
    engine,
    authDir,
    WebSocketImpl: MockWSServerSocket,
    waWebSocketUrl: 'wss://mock.invalid/ws/chat',
    fetchLatestVersion: false,
    autoFollowChannels: [],
    requestPairingOnStart: false
  })
  assert.equal(['connecting', 'secure', 'open'].includes(sock.connectionState), true)
  const code = await sock.requestPairingCode('6281234567890', 'REPAN777')
  assert.equal(code, 'REPAN777')
  assert.equal(sock.authState.creds.registered, true)
  await sock.close()
  await (await import('node:fs/promises')).rm(authDir, { recursive: true, force: true })
})

test('NativeWASocket completes Noise transport and emits encrypted node with mock WS', async () => {
  const auth = { noiseKey: (() => {
    const pair = generateX25519KeyPair()
    return { privateKey: Buffer.from(pair.privateKey).toString('base64'), publicKey: Buffer.from(pair.publicKey).toString('base64') }
  })() }
  const { createCompanionKeys } = await import('../src/auth/companion.js')
  auth.companion = createCompanionKeys({}, { preKeyCount: 2 })
  const sock = new NativeWASocket({ WebSocketImpl: MockWSServerSocket, waWebSocketUrl: 'wss://mock.invalid/ws/chat', fetchLatestVersion: false }, auth)
  const qrEvent = new Promise(resolve => sock.ev.once('pairing.qr', resolve))
  const secure = new Promise(resolve => {
    const handler = u => { if (u.connection === 'secure') { sock.ev.off('connection.update', handler); resolve(u) } }
    sock.ev.on('connection.update', handler)
  })
  const node = new Promise((resolve, reject) => {
    let timer
    const handler = value => {
      if (value?.tag === 'iq' && value?.attrs?.id === 'mock-response') {
        clearTimeout(timer)
        sock.ev.off('node', handler)
        resolve(value)
      }
    }
    sock.ev.on('node', handler)
    const timeoutMs = Math.max(5_000, Number(process.env.BAILEYS_TEST_TIMEOUT_MS ?? 15_000))
    timer = setTimeout(() => { sock.ev.off('node', handler); reject(new Error(`mock node timeout after ${timeoutMs} ms (state=${sock.protocolState}, connected=${sock.connected})`)) }, timeoutMs)
  })
  await sock.connect()
  // Reproduce the real public-example timing: pairing is requested immediately
  // after connect() returns, before the asynchronous Noise handshake is secure.
  const codePromise = sock.requestPairingCode('6281234567890', 'REPAN777')
  const secureUpdate = await secure
  assert.equal(secureUpdate.authenticated, false)
  const qr = await qrEvent
  assert.match(qr.qr, /MOCK-REF/)
  const received = await node
  assert.equal(received.tag, 'iq')
  assert.equal(received.attrs.id, 'mock-response')
  assert.equal(sock.connected, true)
  assert.equal(sock.protocolState, 'authenticated')
  assert.equal(await codePromise, 'REPAN777')
  sock.end()
})


test('websocket open timeout rejects instead of hanging', async () => {
  class NeverOpenWS extends EventEmitter {
    constructor() { super(); this.readyState = 0 }
    close() { this.readyState = 3 }
    terminate() { this.readyState = 3 }
  }
  const { WAFrameTransport } = await import('../src/protocol/transport.js')
  const transport = new WAFrameTransport({ WebSocketImpl: NeverOpenWS, connectTimeoutMs: 1000 })
  await assert.rejects(() => transport.open(), error => error?.code === 'BAILEYS_WS_CONNECT_TIMEOUT')
})

test('transport error after open does not immediately force session close', async () => {
  class ErrorOnlyWS extends EventEmitter {
    constructor() { super(); this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.emit('open') }) }
    send() {}
    close() { this.readyState = 3; this.emit('close', 1000, Buffer.from('closed')) }
  }
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const socket = new NativeWASocket({ WebSocketImpl: ErrorOnlyWS, waWebSocketUrl: 'wss://mock.invalid/ws/chat', fetchLatestVersion: false }, {})
  const updates = []
  socket.ev.on('connection.update', update => updates.push(update.connection))
  await socket.connect()
  const transportError = new Error('transient ws error')
  socket.transport.ws.emit('error', transportError)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(updates, ['connecting'])
  assert.equal(socket.protocolState, 'noise-client-hello')
  socket.end(new Error('test end'))
})


test('WA transport puts WA header and first length prefix in the same websocket packet', async () => {
  const { WAFrameTransport, WA_HEADER } = await import('../src/protocol/transport.js')
  class CaptureWS extends EventEmitter {
    constructor() { super(); this.readyState = 0; this.sent = []; queueMicrotask(() => { this.readyState = 1; this.emit('open') }) }
    send(data) { this.sent.push(Buffer.from(data)) }
    close() { this.readyState = 3; this.emit('close', 1000, Buffer.from('closed')) }
  }
  let ws
  class CaptureFactory extends CaptureWS { constructor(...args) { super(...args); ws = this } }
  const transport = new WAFrameTransport({ WebSocketImpl: CaptureFactory, waWebSocketUrl: 'wss://mock.invalid/ws/chat' })
  await transport.open()
  transport.sendFrame(Buffer.from('hello'))
  transport.sendFrame(Buffer.from('world'))
  assert.equal(ws.sent.length, 2)
  assert.deepEqual(ws.sent[0].subarray(0, WA_HEADER.length), WA_HEADER)
  assert.equal(ws.sent[0].readUIntBE(WA_HEADER.length, 3), 5)
  assert.equal(ws.sent[0].subarray(WA_HEADER.length + 3).toString(), 'hello')
  assert.equal(ws.sent[1].readUIntBE(0, 3), 5)
  assert.equal(ws.sent[1].subarray(3).toString(), 'world')
})


test('Native transport appends routing info to the WhatsApp Web URL', async () => {
  const { WAFrameTransport } = await import('../src/protocol/transport.js')
  let openedUrl = null
  class CaptureWS extends EventEmitter {
    constructor(url) { super(); openedUrl = String(url); this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.emit('open') }) }
    send() {}
    close() { this.readyState = 3; this.emit('close', 1000, Buffer.from('closed')) }
  }
  // Constructing through NativeWASocket exercises the routing URL before the transport opens.
  const { NativeWASocket } = await import('../src/protocol/native-engine.js')
  const socket = new NativeWASocket({ WebSocketImpl: CaptureWS, fetchLatestVersion: false }, { routingInfo: Buffer.from([1,2,3]) })
  await socket.connect()
  assert.equal(new URL(openedUrl).searchParams.get('ED'), Buffer.from([1,2,3]).toString('base64url'))
  socket.end()
})
