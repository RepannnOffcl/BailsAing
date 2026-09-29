import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import { NodeClient } from './node-client.js'
import { getCapabilities, getCapabilityStatus } from './capabilities.js'
import { randomBytes } from 'node:crypto'
import { WAFrameTransport, WA_HEADER } from './transport.js'
import { NoiseXXHandshake, deriveX25519Public, generateX25519KeyPair, WA_ORIGIN, WA_URL } from './crypto/noise.js'
import { encodeHandshakeMessage, decodeHandshakeMessage } from './wire/handshake.js'
import { fieldBytes, fieldFixed32, fieldString, fieldVarint } from './wire/protobuf.js'
import { decodeCompanionKeys } from '../auth/companion.js'
import { buildLinkedDeviceQR, parsePairDeviceNode, findNodeChild } from '../pairing/qr.js'
import { buildPairingCodeRequest, buildCompanionFinishRequest, normalizePairingPhone, normalizeCustomPairingCode, parsePairingCodeNode, parsePairingHelloResponse, findPairingNode, getNodeBuffer, generatePairingCode, generatePairingEphemeralKeyPair } from '../pairing/code.js'
import { normalizeNewsletterJids } from '../utils/jid.js'
import { hkdfExtract, hkdfExpand, x25519, aeadEncrypt } from './crypto/noise.js'
import { BaileysProtocolError } from '../core/errors.js'
import { resolveWaWebVersion } from './version.js'
import { DEFAULT_PUBLIC_BROWSER, getCompanionPlatformId, getCompanionPlatformDisplay, normalizeBrowserTuple } from '../pairing/platform.js'
import { SignalSessionStore } from './signal/store.js'
import { decodeWebMessageInfo, encodeWebMessageInfo, generateMessageId, normalizeMessageContent } from '../messaging/codec.js'
import { buildPresenceNode, buildPresenceSubscribeNode, buildBulkReceiptNodes, buildGroupQuery, extractGroupMetadata, buildGroupActionNodes } from './chat.js'

function encodeMessage(parts) { return Buffer.concat(parts.filter(Boolean)) }
function assertSecureTransport(socket) {
  if (!socket.nodes || !['secure', 'authenticated'].includes(socket.protocolState)) {
    throw new Error('Native node transport belum secure')
  }
}
function encodeAppVersion(v = [2, 3000, 1043857760]) {
  return encodeMessage([fieldVarint(1, v[0]), fieldVarint(2, v[1]), fieldVarint(3, v[2])])
}
function encodeUserAgent(options = {}) {
  const browser = normalizeBrowserTuple(options.browser ?? DEFAULT_PUBLIC_BROWSER)
  const isAndroid = String(browser[1] ?? '').toLowerCase().includes('android')
  const isRegistration = options.registered !== true
  const defaultPlatform = isAndroid ? 0 : 14
  return encodeMessage([
    fieldVarint(1, options.platform ?? defaultPlatform),
    fieldBytes(2, encodeAppVersion(options.webVersion ?? [2, 3000, 1043857760])),
    fieldString(3, options.mcc ?? '000'),
    fieldString(4, options.mnc ?? '000'),
    fieldString(5, options.osVersion ?? '0.1'),
    ...(options.manufacturer ? [fieldString(6, options.manufacturer)] : []),
    fieldString(7, options.device ?? 'Desktop'),
    fieldString(8, options.osBuildNumber ?? '0.1'),
    fieldVarint(10, options.releaseChannel ?? 0),
    fieldString(11, options.localeLanguage ?? 'en'),
    fieldString(12, options.localeCountry ?? 'US'),
    ...(options.phoneId ? [fieldString(9, options.phoneId)] : []),
    ...(options.deviceBoard ? [fieldString(13, options.deviceBoard)] : [])
  ])
}

function encodeWebInfo() {
  // ClientPayload.WebInfo.webSubPlatform is field 4; 0 = WEB_BROWSER.
  return fieldVarint(4, 0)
}

function encodeBigEndian(value, length = 4) {
  let n = BigInt(Math.max(0, Number(value) || 0))
  const minimal = Math.max(1, Math.ceil(n.toString(16).length / 2))
  const size = Math.max(length ?? minimal, 1)
  const out = Buffer.alloc(size)
  for (let i = size - 1; i >= 0; i -= 1) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  if (n !== 0n) throw new RangeError('big-endian integer overflow')
  return out
}

function encodeHistorySyncConfig(options = {}) {
  const parts = [
    fieldVarint(3, 10240),
    fieldVarint(4, 1),
    fieldVarint(6, 0),
    fieldVarint(7, 1),
    fieldVarint(8, 1),
    fieldVarint(9, 1),
    fieldVarint(10, 1),
    fieldVarint(11, 1),
    fieldVarint(12, 1),
    fieldVarint(14, 1)
  ]
  return encodeMessage(parts)
}

function encodeDeviceProps(options = {}) {
  const browser = normalizeBrowserTuple(options.browser ?? DEFAULT_PUBLIC_BROWSER)
  const platform = String(browser[1] ?? 'Chrome').toUpperCase()
  const platformType = platform.includes('ANDROID') ? 16 : platform.includes('FIREFOX') ? 2 : platform.includes('SAFARI') ? 5 : 1
  const appVersion = encodeMessage([fieldVarint(1, 10), fieldVarint(2, 15), fieldVarint(3, 7)])
  const history = encodeHistorySyncConfig(options)
  return encodeMessage([
    fieldString(1, browser[0]),
    fieldBytes(2, appVersion),
    fieldVarint(3, platformType),
    fieldVarint(4, options.syncFullHistory ? 1 : 0),
    fieldBytes(5, history)
  ])
}

function encodeCompanionRegistration(companion = {}, options = {}) {
  const c = decodeCompanionKeys(companion)
  if (!c.identityKey || !c.signedPreKey) return null
  const version = (options.webVersion ?? [2, 3000, 1043857760]).join('.')
  const buildHash = crypto.createHash('md5').update(version).digest()
  const keyType = Buffer.from([5])
  const deviceProps = encodeDeviceProps(options)
  return Buffer.concat([
    fieldBytes(1, encodeBigEndian(c.registrationId)),
    fieldBytes(2, keyType),
    fieldBytes(3, c.identityKey.publicKey),
    fieldBytes(4, encodeBigEndian(c.signedPreKey.id, 3)),
    fieldBytes(5, c.signedPreKey.publicKey),
    fieldBytes(6, c.signedPreKey.signature),
    fieldBytes(7, buildHash),
    fieldBytes(8, deviceProps)
  ])
}

function parseUserJid(jid) {
  if (typeof jid !== 'string') return null
  const left = jid.split('@')[0] ?? ''
  const deviceMatch = left.match(/^(\d+)(?::(\d+))?/)
  if (!deviceMatch) return null
  return { username: BigInt(deviceMatch[1]), device: Number(deviceMatch[2] ?? 0) }
}

export function encodeClientPayload(options = {}) {
  const registered = options.registered === true
  const parsed = parseUserJid(options.userJid ?? options.me?.id)
  const parts = [
    ...(registered && parsed ? [fieldVarint(1, parsed.username), fieldVarint(3, 1), fieldVarint(33, 1), fieldVarint(18, parsed.device)] : [fieldVarint(3, 0), fieldVarint(33, 0)]),
    fieldBytes(5, encodeUserAgent(options)),
    fieldBytes(6, encodeWebInfo()),
    ...(options.pushName ? [fieldString(7, options.pushName)] : []),
    fieldFixed32(9, options.sessionId ?? 0),
    fieldVarint(12, options.connectType ?? 1),
    fieldVarint(13, options.connectReason ?? (options.reconnect ? 3 : 1)),
    fieldVarint(16, options.connectAttemptCount ?? 0),
    fieldVarint(20, 0)
  ]
  if (registered) {
    parts.push(fieldVarint(41, 0))
  } else if (options.includeCompanionRegistration !== false) {
    const registration = encodeCompanionRegistration(options.companion, options)
    if (registration) parts.push(fieldBytes(19, registration))
  }
  return encodeMessage(parts)
}

export function verifyServerIdentity(options = {}, serverStatic, certificate = Buffer.alloc(0)) {
  const expected = options.serverStaticPublicKey ?? options.serverStaticPin
  if (expected) {
    const pinned = Buffer.isBuffer(expected) ? expected : Buffer.from(String(expected).replace(/^base64:/, ''), 'base64')
    if (pinned.length !== 32 || serverStatic.length !== 32 || !crypto.timingSafeEqual(pinned, serverStatic)) {
      throw new Error('Noise server static key tidak cocok dengan pin yang dikonfigurasi')
    }
  }
  if (typeof options.verifyNoiseCertificate === 'function') {
    const result = options.verifyNoiseCertificate({ certificate: Buffer.from(certificate), serverStatic: Buffer.from(serverStatic) })
    if (result === false) throw new Error('Verifikasi Noise server certificate ditolak')
  }
}

function normalizeNoiseKey(value) {
  if (!value?.privateKey) return generateX25519KeyPair()
  const privateKey = Buffer.isBuffer(value.privateKey) ? value.privateKey : Buffer.from(value.privateKey, 'base64')
  const publicKey = value.publicKey
    ? (Buffer.isBuffer(value.publicKey) ? value.publicKey : Buffer.from(value.publicKey, 'base64'))
    : deriveX25519Public(privateKey)
  return { privateKey, publicKey }
}

export class NativeWASocket extends EventEmitter {
  constructor(options = {}, auth) {
    super()
    this.options = options
    this.auth = auth ?? {}
    this.ev = new EventEmitter()
    this.transport = null
    this.noise = null
    this.transportCipher = null
    this.nodes = null
    this.generation = 0
    this.closed = false
    this.connected = false
    this.closeEmitted = false
    this.lastError = null
    this.keepAliveFailureCount = 0
    this.keepAliveInFlight = false
    this.pairingCode = null
    this.protocolState = 'idle'
    this.keepAliveTimer = null
    this.pairingInFlight = null
    this.pairingCodeInFlight = null
    this.pairingKeepaliveTimer = null
    this.currentPairingRef = null
    this._noiseKeys = normalizeNoiseKey(this.auth.noiseKey)
    this.companion = this.auth.companion ?? null
    this.signalStore = this.options?.signalStore ?? (this.options?.signalDir ? new SignalSessionStore(this.options.signalDir) : null)
    if (this.auth && !this.auth.noiseKey) {
      this.auth.noiseKey = {
        privateKey: Buffer.from(this._noiseKeys.privateKey).toString('base64'),
        publicKey: Buffer.from(this._noiseKeys.publicKey).toString('base64')
      }
    }
  }

  async connect() {
    if (this.closed) throw new Error('native socket closed')
    if (!this.options.webVersion && this.options.fetchLatestVersion !== false) {
      const resolved = await resolveWaWebVersion(this.options)
      if (resolved.source === 'fallback' && this.options.requireLatestVersion !== false) {
        const error = Object.assign(new Error('WhatsApp Web version live tidak tersedia; refusing stale fallback version.'), {
          code: 'BAILEYS_WA_VERSION_UNAVAILABLE',
          statusCode: 503,
          cause: resolved.error
        })
        this.emit('web.version.error', error)
        throw error
      }
      this.options.webVersion = resolved.version
      this.emit('web.version', resolved)
    }
    let waWebSocketUrl = this.options.waWebSocketUrl ?? WA_URL
    if (this.auth?.routingInfo && String(waWebSocketUrl).startsWith('wss:')) {
      const routed = new URL(String(waWebSocketUrl))
      routed.searchParams.set('ED', Buffer.from(this.auth.routingInfo).toString('base64url'))
      waWebSocketUrl = routed.toString()
    }
    this.transport = new WAFrameTransport({
      url: waWebSocketUrl,
      origin: this.options.origin ?? WA_ORIGIN,
      WebSocketImpl: this.options.WebSocketImpl
    })
    this.transport.on('error', err => {
      this.emit('transport.error', err)
      this.ev.emit('transport.error', err)
      if (!this.transport?.opened) this.#emitClose(err)
    })
    this.transport.on('close', info => this.#emitClose(info))
    this.transport.on('frame', frame => this.#handleFrame(frame))
    this.closeEmitted = false
    this.lastError = null
    this.emitConnection('connecting')
    try {
      await this.transport.open()
    } catch (error) {
      if (error && error.statusCode == null) error.statusCode = 408
      throw error
    }
    this.noise = new NoiseXXHandshake(WA_HEADER)
    const ephemeral = generateX25519KeyPair()
    this._ephemeral = ephemeral
    this.protocolState = 'noise-client-hello'
    this.noise.mixHash(ephemeral.publicKey)
    this.transport.sendFrame(encodeHandshakeMessage('clientHello', { ephemeral: ephemeral.publicKey }))
    return this
  }

  async waitForSecure(timeoutMs = Number(this.options?.pairingReadyTimeoutMs ?? 20_000)) {
    if (['secure', 'authenticated'].includes(this.protocolState) && this.nodes) return { connection: this.protocolState, alreadyReady: true }
    if (this.closed || this.protocolState === 'closed') throw new Error('Native transport sudah ditutup sebelum menjadi secure.')
    const timeout = Math.max(1_000, timeoutMs)
    return new Promise((resolve, reject) => {
      let timer = null
      let settled = false
      const cleanup = () => {
        this.ev.off('connection.update', onUpdate)
        if (timer) clearTimeout(timer)
      }
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        cleanup()
        fn(value)
      }
      const onUpdate = update => {
        if (['secure', 'authenticated'].includes(update?.connection)) finish(resolve, update)
        else if (update?.connection === 'close') finish(reject, update?.lastDisconnect?.error ?? new Error('Native transport ditutup sebelum menjadi secure.'))
      }
      this.ev.on('connection.update', onUpdate)
      timer = setTimeout(() => finish(reject, new Error(`Menunggu native transport secure timeout setelah ${timeout} ms.`)), timeout)
      if (['secure', 'authenticated'].includes(this.protocolState) && this.nodes) finish(resolve, { connection: this.protocolState, alreadyReady: true })
      else if (this.closed || this.protocolState === 'closed') finish(reject, new Error('Native transport sudah ditutup sebelum menjadi secure.'))
    })
  }

  async requestPairingCode(phone, custom) {
    const number = normalizePairingPhone(phone)
    const code = normalizeCustomPairingCode(custom) ?? generatePairingCode()
    if (!['secure', 'authenticated'].includes(this.protocolState) || !this.nodes) {
      await this.waitForSecure(Number(this.options?.pairingReadyTimeoutMs ?? this.options?.pairingCodeTimeoutMs ?? 20_000))
    }
    if (this.closed || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native transport belum secure; pairing registration belum siap.')
    if (!this.nodes) throw new Error('Native node transport belum siap')
    if (this.pairingCodeInFlight) throw new Error('Pairing code request masih berjalan; tunggu request sebelumnya selesai.')
    const task = (async () => {
      const ephemeral = generatePairingEphemeralKeyPair()
      this.auth.pairingCode = code
      this.auth.pairingEphemeralKeyPair = {
        privateKey: Buffer.from(ephemeral.privateKey).toString('base64'),
        publicKey: Buffer.from(ephemeral.publicKey).toString('base64')
      }
      this.auth.me = { id: `${number}@s.whatsapp.net`, name: '~' }
      await Promise.resolve(this.options?.saveCreds?.())
      const pairingBrowser = this.options?.safePairingIdentity === false
        ? normalizeBrowserTuple(this.options?.browser)
        : DEFAULT_PUBLIC_BROWSER
      const request = buildPairingCodeRequest({
        phoneNumber: number,
        pairingCode: code,
        pairingEphemeralPublicKey: ephemeral.publicKey,
        noisePublicKey: this._noiseKeys.publicKey,
        platformId: this.options?.companionPlatformId ?? getCompanionPlatformId(pairingBrowser),
        platformDisplay: this.options?.companionPlatformDisplay ?? getCompanionPlatformDisplay(pairingBrowser)
      })
      this.auth.pairingActive = true
      await Promise.resolve(this.options?.saveCreds?.())
      // WhatsApp's pairing-code endpoint is fire-and-notify: the initial
      // companion_hello request does not need a normal IQ result. The actual
      // encrypted primary_hello arrives asynchronously and carries the ref.
      // Waiting for an IQ response here makes requestPairingCode time out on
      // compatible servers even though the code was accepted.
      try {
        await Promise.resolve(this.nodes.send(request))
      } catch (error) {
        this.auth.pairingActive = false
        delete this.auth.pairingCode
        delete this.auth.pairingEphemeralKeyPair
        await Promise.resolve(this.options?.saveCreds?.()).catch(() => {})
        throw error
      }
      this.pairingCode = code
      await Promise.resolve(this.options?.saveCreds?.())
      this.ev.emit('pairing.code', { code: this.pairingCode, phone: number, ref: this.auth.pairingRef })
      this.emit('pairing.code', { code: this.pairingCode, phone: number, ref: this.auth.pairingRef })
      return this.pairingCode
    })()
    this.pairingCodeInFlight = task
    try {
      return await task
    } finally {
      if (this.pairingCodeInFlight === task) this.pairingCodeInFlight = null
    }
  }

  async setSignalSession(jid, session) {
    if (!this.signalStore) throw new Error('Signal session store belum dikonfigurasi')
    await this.signalStore.set(String(jid), session)
    return session
  }

  async getSignalSession(jid) {
    if (!this.signalStore) return null
    return this.signalStore.get(String(jid))
  }

  async deleteSignalSession(jid) {
    if (!this.signalStore) return
    await this.signalStore.delete(String(jid))
  }

  async sendMessage(jid, content, options = {}) {
    return this.relayMessage(jid, content, options)
  }

  async #updateSignalSession(jid, worker) {
    if (!this.signalStore) throw new Error('Signal session store belum dikonfigurasi')
    if (typeof this.signalStore.update === 'function') return this.signalStore.update(String(jid), worker)
    const session = await this.signalStore.get(String(jid))
    const result = await worker(session)
    if (result?.delete === true) {
      await this.signalStore.delete?.(String(jid))
      return result.value
    }
    const next = result?.session ?? result
    if (next && typeof this.signalStore.set === 'function') await this.signalStore.set(String(jid), next)
    return result?.value ?? next
  }

  async relayMessage(jid, content, options = {}) {
    const target = String(jid ?? '').trim()
    if (!target || !target.includes('@')) throw new TypeError('JID tujuan wajib valid')
    if (/@(?:g\.us|broadcast|newsletter)$/.test(target)) throw new Error('Native direct message layer belum mendukung group/status/newsletter encryption')
    if (!this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native node transport belum secure')
    const suppressOwnEvent = options.noSelfSync === true || this.options?.noSelfSync === true
    const normalized = normalizeMessageContent(content)
    if (!this.signalStore) throw new Error('Signal session store belum dikonfigurasi')
    const id = options.messageId ?? generateMessageId()
    const result = await this.#updateSignalSession(target, async session => {
      if (!session) {
        const error = new BaileysProtocolError(`Signal session untuk ${target} belum tersedia`, { details: { jid: target, action: 'session-required' } })
        this.ev.emit('message.session.required', { jid: target, error })
        throw error
      }
      const wamessage = encodeWebMessageInfo({
        key: { remoteJid: target, fromMe: true, id },
        message: normalized,
        messageTimestamp: options.messageTimestamp ?? Math.floor(Date.now() / 1000),
        pushName: this.auth?.pushName
      })
      const encrypted = session.encrypt(wamessage, Buffer.alloc(0))
      const node = {
        tag: 'message',
        attrs: { id, to: target, type: 'text', t: String(Math.floor(Date.now() / 1000)) },
        content: [{ tag: 'enc', attrs: { v: '2', type: 'msg' }, content: encrypted.wire }]
      }
      this.nodes.send(node)
      return { session, value: { node, normalized, encrypted } }
    })
    const resultMessage = { key: { remoteJid: target, fromMe: true, id }, message: normalized, messageTimestamp: Math.floor(Date.now() / 1000) }
    if (this.options?.emitOwnEvents !== false && !suppressOwnEvent) {
      this.ev.emit('messages.upsert', { messages: [resultMessage], type: 'append' })
      this.emit('messages.upsert', { messages: [resultMessage], type: 'append' })
    }
    return resultMessage
  }
  async logout(reason = 'user_initiated') {
    if (!this.nodes || !this.auth?.registered) {
      this.end(Object.assign(new Error('Baileys logout'), { statusCode: 401, reason }))
      return
    }
    const jid = this.auth.jid ?? this.auth.me?.id
    try {
      await this.nodes.request({
        tag: 'iq',
        attrs: { to: 's.whatsapp.net', type: 'set', xmlns: 'md' },
        content: [{ tag: 'remove-companion-device', attrs: { jid, reason } }]
      }, { timeoutMs: Number(this.options?.logoutTimeoutMs ?? 15_000) })
    } finally {
      this.auth.registered = false
      await Promise.resolve(this.options?.saveCreds?.()).catch(() => {})
      this.end(Object.assign(new Error('Baileys logged out'), { statusCode: 401 }))
    }
  }
  async waitForSocketOpen(timeoutMs = Number(this.options?.connectTimeoutMs ?? 20_000)) {
    if (this.protocolState === 'authenticated' || this.protocolState === 'open') return
    if (this.closed || this.protocolState === 'closed') throw new Error('Native socket sudah ditutup')
    const timeout = Math.max(1_000, Number(timeoutMs) || 20_000)
    await new Promise((resolve, reject) => {
      let timer = null
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.ev.off('connection.update', onUpdate)
        fn(value)
      }
      const onUpdate = update => {
        if (update?.connection === 'open' || update?.authenticated) finish(resolve)
        else if (update?.connection === 'close') finish(reject, update?.lastDisconnect?.error ?? new Error('Socket ditutup sebelum open'))
      }
      this.ev.on('connection.update', onUpdate)
      timer = setTimeout(() => finish(reject, Object.assign(new Error(`waitForSocketOpen timeout setelah ${timeout} ms`), { statusCode: 408 })), timeout)
    })
  }

  async sendPresenceUpdate(type, jid) {
    if (!this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native node transport belum secure')
    const me = this.auth?.jid ?? this.auth?.me?.id
    const node = buildPresenceNode(type, me ?? '0@s.whatsapp.net', jid)
    this.nodes.send(node)
    this.ev.emit('presence.update', { id: jid ?? me, presences: { [me ?? 'me']: { lastKnownPresence: type === 'paused' ? 'available' : type } } })
    return node
  }

  async presenceSubscribe(jid) {
    if (!this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native node transport belum secure')
    const node = buildPresenceSubscribeNode(jid)
    this.nodes.send(node)
    return node
  }

  async readMessages(keys) {
    assertSecureTransport(this)
    const nodes = buildBulkReceiptNodes(keys, this.options?.readReceiptType ?? 'read')
    for (const node of nodes) this.nodes.send(node)
    return nodes
  }

  async sendReadReceipt(jid, participant, messageIds = []) {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds]
    const keys = ids.filter(Boolean).map(id => ({ remoteJid: jid, participant, id: String(id), fromMe: false }))
    return this.readMessages(keys)
  }

  async groupMetadata(jid) {
    assertSecureTransport(this)
    const result = await this.nodes.request(buildGroupQuery(jid, 'get', [{ tag: 'query', attrs: { request: 'interactive' } }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
    return extractGroupMetadata(result)
  }

  async groupCreate(subject, participants = []) {
    assertSecureTransport(this)
    const key = generateMessageId()
    const result = await this.nodes.request(buildGroupQuery('@g.us', 'set', [{ tag: 'create', attrs: { subject: String(subject), key }, content: participants.map(jid => ({ tag: 'participant', attrs: { jid: jidNormalizedUser(jid) || String(jid) } })) }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
    return extractGroupMetadata(result)
  }

  async groupLeave(jid) {
    assertSecureTransport(this)
    await this.nodes.request(buildGroupQuery('@g.us', 'set', [{ tag: 'leave', attrs: {}, content: [{ tag: 'group', attrs: { id: jid } }] }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
  }

  async groupUpdateSubject(jid, subject) {
    assertSecureTransport(this)
    await this.nodes.request(buildGroupQuery(jid, 'set', [{ tag: 'subject', attrs: {}, content: Buffer.from(String(subject), 'utf8') }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
  }

  async groupUpdateDescription(jid, description) {
    assertSecureTransport(this)
    const metadata = await this.groupMetadata(jid)
    const attrs = description ? { id: generateMessageId(), ...(metadata.descId ? { prev: metadata.descId } : {}) } : { delete: 'true', ...(metadata.descId ? { prev: metadata.descId } : {}) }
    const content = description ? [{ tag: 'body', attrs: {}, content: Buffer.from(String(description), 'utf8') }] : undefined
    await this.nodes.request(buildGroupQuery(jid, 'set', [{ tag: 'description', attrs, content }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
  }

  async groupParticipantsUpdate(jid, participants, action) {
    assertSecureTransport(this)
    const [node] = buildGroupActionNodes(participants, action)
    const result = await this.nodes.request(buildGroupQuery(jid, 'set', [node]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
    const response = findNodeChild(result, action)
    return Array.isArray(response?.content) ? response.content.filter(item => item?.tag === 'participant').map(item => ({ status: item.attrs?.error ?? '200', jid: item.attrs?.jid, content: item })) : []
  }

  async groupInviteCode(jid) {
    assertSecureTransport(this)
    const result = await this.nodes.request(buildGroupQuery(jid, 'get', [{ tag: 'invite', attrs: {} }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
    return findNodeChild(result, 'invite')?.attrs?.code
  }

  async groupRevokeInvite(jid) {
    assertSecureTransport(this)
    const result = await this.nodes.request(buildGroupQuery(jid, 'set', [{ tag: 'invite', attrs: {} }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
    return findNodeChild(result, 'invite')?.attrs?.code
  }

  async groupAcceptInvite(code) {
    assertSecureTransport(this)
    const result = await this.nodes.request(buildGroupQuery('@g.us', 'set', [{ tag: 'invite', attrs: { code: String(code) } }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
    return findNodeChild(result, 'group')?.attrs?.jid
  }

  async groupGetInviteInfo(code) {
    assertSecureTransport(this)
    const result = await this.nodes.request(buildGroupQuery('@g.us', 'get', [{ tag: 'invite', attrs: { code: String(code) } }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
    return extractGroupMetadata(result)
  }

  async groupSettingUpdate(jid, setting) {
    assertSecureTransport(this)
    if (!['announcement', 'not_announcement', 'locked', 'unlocked'].includes(setting)) throw new TypeError('Group setting tidak valid')
    await this.nodes.request(buildGroupQuery(jid, 'set', [{ tag: setting, attrs: {} }]), { timeoutMs: Number(this.options?.groupQueryTimeoutMs ?? 20_000) })
  }

  async newsletterFollow(jid) {
    const target = normalizeNewsletterJids([jid])[0]
    if (!target) throw new TypeError('Newsletter JID tidak valid')
    if (!this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native node transport belum secure')
    const request = {
      tag: 'iq',
      attrs: { to: target, type: 'set', xmlns: 'newsletter' },
      content: [{ tag: 'live', attrs: { subscribe: 'true' } }]
    }
    return this.nodes.request(request, { timeoutMs: Number((this.options ?? {}).newsletterTimeoutMs ?? 15_000) })
  }
  async newsletterUnfollow(jid) {
    const target = normalizeNewsletterJids([jid])[0]
    if (!target) throw new TypeError('Newsletter JID tidak valid')
    if (!this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native node transport belum secure')
    const request = {
      tag: 'iq',
      attrs: { to: target, type: 'set', xmlns: 'newsletter' },
      content: [{ tag: 'live', attrs: { subscribe: 'false' } }]
    }
    return this.nodes.request(request, { timeoutMs: Number((this.options ?? {}).newsletterTimeoutMs ?? 15_000) })
  }

  sendNode(node) {
    if (!this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native node transport belum secure')
    return this.nodes.send(node)
  }

  requestNode(node, options) {
    if (!this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Native node transport belum secure')
    return this.nodes.request(node, options)
  }

  sendEncryptedFrame(payload) {
    if (!this.transportCipher || !['secure', 'authenticated'].includes(this.protocolState)) throw new Error('Noise transport belum secure')
    this.transport.sendFrame(this.transportCipher.encrypt(Buffer.from(payload)))
    this.emit('frame.tx', { bytes: Buffer.byteLength(payload) })
    this.ev.emit('frame.tx', { bytes: Buffer.byteLength(payload) })
  }

  end(error) {
    if (this.closed) return
    this.closed = true
    this.#stopKeepAlive()
    this.protocolState = 'closed'
    this.nodes?.close?.(error)
    this.transport?.close?.()
    this.emit('end', error)
    this.#emitClose(error)
  }

  async #markAuthenticated(node) {
    if (this.protocolState === 'authenticated') return
    this.protocolState = 'authenticated'
    this.auth.registered = true
    if (node?.attrs?.jid) {
      this.auth.jid = node.attrs.jid
      this.auth.me = { ...(this.auth.me ?? {}), id: node.attrs.jid }
    }
    if (node?.attrs?.deviceId) this.auth.deviceId = node.attrs.deviceId
    if (node?.attrs?.device) this.auth.device = node.attrs.device
    this.auth.pairingActive = false
    delete this.auth.pairingEphemeralKeyPair
    delete this.auth.pairingCode
    delete this.auth.pairingRef
    await Promise.resolve((this.options ?? {}).saveCreds?.())
    this.#startKeepAlive()
    this.emitConnection('open', { protocol: 'noise-xx', authenticated: true })
  }

  #startKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.keepAliveFailureCount = 0
    this.keepAliveInFlight = false
    const interval = Math.max(10_000, Number(this.options?.keepAliveIntervalMs ?? 25_000))
    const timeoutMs = Math.max(3_000, Math.min(interval - 1000, Number(this.options?.keepAliveTimeoutMs ?? 10_000)))
    const threshold = Math.max(1, Number(this.options?.keepaliveFailureThreshold ?? 3))
    this.keepAliveTimer = setInterval(() => {
      if (this.keepAliveInFlight || !this.nodes || !['secure', 'authenticated'].includes(this.protocolState)) return
      this.keepAliveInFlight = true
      this.nodes.request({
        tag: 'iq',
        attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:p' },
        content: [{ tag: 'ping', attrs: {} }]
      }, { timeoutMs }).then(() => {
        this.keepAliveFailureCount = 0
        this.keepAliveInFlight = false
        this.emit('keepalive.ok')
        this.ev.emit('keepalive.ok')
      }).catch(error => {
        this.keepAliveFailureCount += 1
        this.keepAliveInFlight = false
        this.emit('keepalive.error', { error, count: this.keepAliveFailureCount, threshold })
        this.ev.emit('keepalive.error', { error, count: this.keepAliveFailureCount, threshold })
        if (this.keepAliveFailureCount >= threshold) {
          const closeError = Object.assign(new Error('Baileys keepalive gagal berulang kali'), {
            statusCode: 408,
            cause: error,
            keepaliveFailures: this.keepAliveFailureCount
          })
          this.end(closeError)
        }
      })
    }, interval)
    this.keepAliveTimer.unref?.()
  }

  #stopKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = null
    this.keepAliveInFlight = false
  }

  async #handleIncomingMessage(node) {
    const enc = findNodeChild(node, 'enc')
    if (!enc || !Buffer.isBuffer(enc.content)) return null
    const jid = node?.attrs?.from ?? node?.attrs?.participant ?? node?.attrs?.to
    if (!jid || !this.signalStore) return null
    const message = await this.#updateSignalSession(jid, async session => {
      if (!session) {
        const error = new BaileysProtocolError(`Signal session untuk incoming ${jid} belum tersedia`, { details: { jid, stanza: node } })
        this.ev.emit('message.session.required', { jid, error, incoming: true })
        throw error
      }
      const plaintext = session.decrypt(enc.content, Buffer.alloc(0))
      return { session, value: decodeWebMessageInfo(plaintext) }
    })
    this.ev.emit('messages.upsert', { messages: [message], type: 'notify' })
    this.emit('messages.upsert', { messages: [message], type: 'notify' })
    const id = node.attrs?.id
    if (id && this.nodes) {
      try { this.nodes.send({ tag: 'ack', attrs: { id, to: node.attrs?.from ?? 's.whatsapp.net', class: 'message' } }) } catch {}
    }
    return message
  }

  async #handlePairingNotification(node) {
    const root = findPairingNode(node)
    if (!root || root.attrs?.stage !== 'primary_hello') return false
    if (this.pairingInFlight) return this.pairingInFlight
    this.pairingInFlight = (async () => {
      const refBuffer = getNodeBuffer(root, 'link_code_pairing_ref')
      const ref = refBuffer?.toString('base64url')
      // Some server notifications use the same outer tag without carrying the
      // cryptographic primary_hello payload. Ignore those notifications rather
      // than treating missing buffers as a fatal pairing error.
      const wrapped = getNodeBuffer(root, 'link_code_pairing_wrapped_primary_ephemeral_pub')
      const primaryIdentityPublic = getNodeBuffer(root, 'primary_identity_pub')
      if (!refBuffer || !wrapped || !primaryIdentityPublic || primaryIdentityPublic.length !== 32) return false
      const expectedRef = this.auth?.pairingRef
      if (expectedRef && ref !== expectedRef) {
        this.ev.emit('pairing.stale', { ref, expectedRef })
        this.emit('pairing.stale', { ref, expectedRef })
        return false
      }
      this.auth.pairingRef = ref
      const pairingCode = this.auth?.pairingCode
      const pairingEphemeral = this.auth?.pairingEphemeralKeyPair
      if (!pairingCode || !pairingEphemeral?.privateKey) throw new Error('Pairing credentials tidak tersedia')
      const finish = buildCompanionFinishRequest({
        pairingCode,
        pairingEphemeralPrivateKey: Buffer.from(pairingEphemeral.privateKey, 'base64'),
        wrappedPrimaryEphemeralPublic: wrapped,
        primaryIdentityPublic,
        companionIdentityPrivateKey: Buffer.from(this.companion?.identityKey?.privateKey ?? '', 'base64'),
        companionIdentityPublicKey: Buffer.from(this.companion?.identityKey?.publicKey ?? '', 'base64'),
        meId: this.auth.me?.id,
        ref: refBuffer
      })
      const advSecret = finish.advSecretKey
      this.companion.advSecretKey = advSecret.toString('base64')
      this.auth.advSecretKey = advSecret.toString('base64')
      this.auth.pairingRef = ref
      this.auth.pairingCompletedAt = Date.now()
      const response = await this.nodes.request(finish.request, { timeoutMs: Number(this.options?.pairingFinishTimeoutMs ?? 20_000) })
      await Promise.resolve(this.options?.saveCreds?.())
      this.ev.emit('pairing.finish', { ref, response })
      this.emit('pairing.finish', { ref, response })
      return response
    })().catch(error => {
      this.ev.emit('pairing.error', error)
      this.emit('pairing.error', error)
      throw error
    }).finally(() => { this.pairingInFlight = null })
    return this.pairingInFlight
  }

  async #handleNode(node) {
    this.emit('node', node)
    this.ev.emit('node', node)
    if (node?.tag === 'success') {
      void this.#markAuthenticated(node).catch(error => {
        this.emit('auth.error', error)
        this.ev.emit('auth.error', error)
        this.end(Object.assign(new Error('Gagal menyimpan session setelah authentication.'), { statusCode: 503, cause: error }))
      })
      this.nodes?.request({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'set', xmlns: 'passive' }, content: [{ tag: 'active', attrs: {} }] }, { timeoutMs: 10_000 }).catch(() => {})
    }
    const pairingHello = findPairingNode(node)
    if (pairingHello?.attrs?.stage === 'companion_hello') {
      const hello = parsePairingHelloResponse(node)
      if (hello?.ref) {
        this.auth.pairingRef = hello.ref
        await Promise.resolve(this.options?.saveCreds?.()).catch(error => {
          this.ev.emit('auth.error', error)
          this.emit('auth.error', error)
        })
        this.ev.emit('pairing.ref', { ref: hello.ref, node })
        this.emit('pairing.ref', { ref: hello.ref, node })
      }
    }

    if (node?.tag === 'failure') {
      const message = node.attrs?.reason || node.attrs?.code || 'server failure'
      const error = new Error(`WhatsApp protocol failure: ${message}`)
      this.emit('protocolError', error)
      this.ev.emit('protocol.error', error)
    }
    const messageNode = node?.tag === 'message' ? node : findNodeChild(node, 'message')
    if (messageNode) void this.#handleIncomingMessage(messageNode).catch(error => {
      this.ev.emit('messages.error', { node: messageNode, error })
      this.emit('messages.error', { node: messageNode, error })
    })

    for (const item of parsePairDeviceNode(node)) {
      const ref = item.ref
      try {
        const c = decodeCompanionKeys(this.companion)
        const noisePublicKey = this._noiseKeys.publicKey
        const qr = buildLinkedDeviceQR({
          ref,
          noisePublicKey,
          identityPublicKey: c.identityKey?.publicKey,
          advSecretKey: c.advSecretKey,
          clientType: c.clientType
        })
        this.currentPairingRef = ref
        this.pairingCode = null
        const payload = { ref, qr, node: item.node }
        this.ev.emit('pairing.qr', payload)
        this.emit('pairing.qr', payload)
        this.emitConnection('connecting', { qr, pairingRef: ref, authenticated: false })
      } catch (error) {
        this.ev.emit('pairing.error', error)
        this.emit('pairing.error', error)
      }
    }

    if (node?.tag === 'iq' && node.attrs?.type === 'set' && findNodeChild(node, 'pair-device')) {
      const id = node.attrs?.id
      if (id && this.nodes) {
        try { this.nodes.send({ tag: 'iq', attrs: { to: node.attrs?.from ?? 's.whatsapp.net', type: 'result', id } }) }
        catch (error) { this.ev.emit('protocol.error', error); this.emit('protocolError', error) }
      }
    }
    const pairingNode = findPairingNode(node)
    if (pairingNode?.attrs?.stage === 'primary_hello') void this.#handlePairingNotification(node).catch(() => {})

    const passkey = findNodeChild(node, 'passkey_prologue_request')
    if (passkey) {
      const raw = passkey.content
      let options = raw
      if (Buffer.isBuffer(raw)) {
        try { options = JSON.parse(raw.toString('utf8')) } catch {}
      }
      try {
        const id = node?.attrs?.id
        if (id && this.nodes) this.nodes.send({ tag: 'ack', attrs: { id, to: node?.attrs?.from ?? 's.whatsapp.net', class: 'notification', type: 'passkey_prologue_request' } })
      } catch {}
      this.ev.emit('pairing.passkey.request', { node: passkey, options })
      this.emit('pairing.passkey.request', { node: passkey, options })
    }

    const refresh = findNodeChild(node, 'companion_reg_refresh')
    const rotateQr = findNodeChild(node, 'pair-device-rotate-qr')
    if (refresh || rotateQr) {
      const refreshNode = refresh || rotateQr
      try {
        const id = node?.attrs?.id
        if (id && this.nodes) this.nodes.send({ tag: 'ack', attrs: { id, to: node?.attrs?.from ?? 's.whatsapp.net', class: 'notification', type: refresh ? 'companion_reg_refresh' : 'pair-device-rotate-qr' } })
      } catch {}
      try {
        const nextAdvSecret = crypto.randomBytes(32)
        if (!this.auth.companion || typeof this.auth.companion !== 'object') this.auth.companion = {}
        this.auth.companion.advSecretKey = nextAdvSecret.toString('base64')
        this.auth.companion.updatedAt = Date.now()
        await Promise.resolve(this.options?.saveCreds?.())
        if (this.currentPairingRef) {
          const c = decodeCompanionKeys(this.auth.companion)
          const qr = buildLinkedDeviceQR({
            ref: this.currentPairingRef,
            noisePublicKey: this._noiseKeys.publicKey,
            identityPublicKey: c.identityKey?.publicKey,
            advSecretKey: c.advSecretKey,
            clientType: c.clientType
          })
          this.pairingCode = null
          const payload = { ref: this.currentPairingRef, qr, rotated: true, node: refreshNode }
          this.ev.emit('pairing.qr', payload)
          this.emit('pairing.qr', payload)
          this.emitConnection('connecting', { qr, pairingRef: this.currentPairingRef, rotated: true, authenticated: false })
        }
      } catch (error) {
        this.ev.emit('pairing.error', error)
        this.emit('pairing.error', error)
      }
      this.ev.emit('pairing.refresh', { node, refresh, rotateQr, rotated: true })
      this.emit('pairing.refresh', { node, refresh, rotateQr, rotated: true })
    }

    const pairSuccess = findNodeChild(node, 'pair-success')
    if (pairSuccess) {
      this.ev.emit('pairing.success', { node: pairSuccess })
      this.emit('pairing.success', { node: pairSuccess })
      const verify = (this.options ?? {}).verifyPairSuccess
      let accepted = true
      if (typeof verify === 'function') accepted = verify({ node: pairSuccess, auth: this.auth }) !== false
      if (accepted) {
        void this.#markAuthenticated(pairSuccess).then(() => {
          if (this.options?.autoRestartOnPairSuccess !== false) {
            const restart = Object.assign(new Error('WhatsApp requested connection restart after pairing'), { statusCode: 515 })
            queueMicrotask(() => this.end(restart))
          }
        }).catch(error => {
          this.ev.emit('creds.error', error)
          this.emit('creds.error', error)
        })
      }
    }
  }

  #handleFrame(frame) {
    try {
      if (!this.noise) throw new Error('Noise state belum dibuat')
      if (this.protocolState === 'noise-client-hello') {
        const message = decodeHandshakeMessage(frame)
        if (message.kind !== 'serverHello') throw new Error(`Server mengirim ${message.kind}, expected serverHello`)
        this.noise.mixHash(message.ephemeral)
        this.noise.mixDH(this._ephemeral.privateKey, message.ephemeral)
        const serverStatic = this.noise.decrypt(message.static)
        if (serverStatic.length !== 32) throw new Error('Server static key Noise invalid')
        this.noise.mixDH(this._ephemeral.privateKey, serverStatic)
        const certificate = this.noise.decrypt(message.payload)
        verifyServerIdentity(this.options, serverStatic, certificate)
        this.emit('noise.certificate', { data: certificate, serverStatic })

        const encryptedStatic = this.noise.encrypt(this._noiseKeys.publicKey)
        this.noise.mixDH(this._noiseKeys.privateKey, message.ephemeral)
        const clientPayload = encodeClientPayload({
          ...this.options,
          companion: this.companion,
          registered: this.auth?.registered === true && Boolean(this.auth?.me?.id),
          userJid: this.auth?.me?.id
        })
        const encryptedPayload = this.noise.encrypt(clientPayload)
        this.transport.sendFrame(encodeHandshakeMessage('clientFinish', { static: encryptedStatic, payload: encryptedPayload }))
        this.transportCipher = this.noise.finishTransport(false)
        this.protocolState = 'secure'
        this.connected = true
        this.nodes = new NodeClient(this)
        this.nodes.on('node', node => this.#handleNode(node))
        this.nodes.on('error', error => { this.emit('protocolError', error); this.ev.emit('protocol.error', error) })
        // Keepalive starts immediately after Noise, matching the upstream socket lifecycle.
        this.#startKeepAlive()
        this.emitConnection('secure', { protocol: 'noise-xx', authenticated: false })
        return
      }
      if (['secure', 'authenticated'].includes(this.protocolState)) {
        let plaintext
        try { plaintext = this.transportCipher.decrypt(frame) }
        catch (error) { this.emit('decrypt.error', error); this.ev.emit('decrypt.error', error); return }
        this.emit('frame', plaintext)
        this.ev.emit('frame', plaintext)
        this.ev.emit('CB:frame', plaintext)
      }
    } catch (error) {
      this.emit('protocolError', error)
      this.ev.emit('protocol.error', error)
      this.#emitClose(error)
    }
  }

  #emitClose(info) {
    if (this.closeEmitted) return
    this.nodes?.close?.(info instanceof Error ? info : new Error('Native transport closed'))
    this.closeEmitted = true
    if (info instanceof Error) {
      this.lastError = info
    } else if (info?.error instanceof Error) {
      this.lastError = info.error
    } else if (info) {
      const code = Number(info?.code ?? 0)
      const reason = Buffer.isBuffer(info?.reason) ? info.reason.toString('utf8') : String(info?.reason ?? '')
      const phase = this.protocolState === 'noise-client-hello' ? 'noise handshake' : this.protocolState
      const suffix = reason ? `: ${reason}` : ''
      this.lastError = Object.assign(new Error(`Native WhatsApp transport closed (WebSocket ${code || 'unknown'}) during ${phase}${suffix}`), {
        code: code || undefined,
        statusCode: code === 1006 ? 408 : code === 1008 ? 403 : code === 1011 ? 503 : undefined,
        wsCode: code || undefined,
        wsReason: reason || undefined
      })
    } else {
      this.lastError = null
    }
    this.connected = false
    if (this.protocolState !== 'closed') this.protocolState = 'closed'
    const payload = { connection: 'close' }
    if (info instanceof Error) payload.lastDisconnect = { error: info }
    else if (info) payload.lastDisconnect = { error: info }
    this.ev.emit('connection.update', payload)
    this.emit('connection.update', payload)
  }

  emitConnection(connection, extra) {
    const payload = { connection }
    if (extra instanceof Error) payload.lastDisconnect = { error: extra }
    else if (extra) Object.assign(payload, extra)
    this.ev.emit('connection.update', payload)
    this.emit('connection.update', payload)
  }
}

export async function createNativeEngineSocket(options, auth) {
  const socket = new NativeWASocket(options, auth)
  await socket.connect()
  return socket
}

export function nativeEngineInfo() {
  return Object.freeze({
    name: 'repanxtenka-native-wa',
    version: '1.5.2',
    baileyDependency: false,
    externalWhatsappEngineDependency: false,
    layers: ['websocket', 'wa-header', 'wa-frame', 'noise-xx', 'protobuf-wire', 'client-payload', 'binary-node', 'pairing-code', 'qr-reference', 'companion-auth', 'signal-foundation', 'message-codec'],
    capabilities: getCapabilities(),
    capabilityStatus: getCapabilityStatus(),
    limitations: ['live-whatsapp-interoperability', 'signal-device-discovery', 'media', 'groups', 'app-state-sync', 'history-sync']
  })
}
