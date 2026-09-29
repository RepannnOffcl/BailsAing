import path from 'node:path'
import fs from 'node:fs/promises'
import { StableEventBus } from './core/events.js'
import { ReconnectController, DisconnectCode, getDisconnectCode, shouldReconnect } from './core/reconnect.js'
import { SessionHealth, Watchdog } from './core/health.js'
import { createPersistentAuthState } from './auth/state.js'
import { ensureAuthDir, writeMeta, clearAuthContents, atomicWrite } from './auth/file-store.js'
import { normalizeNewsletterJids, normalizePhone } from './utils/jid.js'
import { SendRateLimiter } from './utils/rate-limit.js'
import { createLogger } from './utils/logger.js'
import { showStartupBanner } from './banner.js'
import { renderTerminalQR } from './terminal-qr.js'
import { BaileysError, BaileysConnectionError, BaileysPairingError, BaileysSessionError } from './core/errors.js'
import { createNativeEngineSocket, nativeEngineInfo } from './protocol/native-engine.js'
import { createOfficialEngineSocket, officialEngineInfo } from './protocol/official-engine.js'
import { getCapabilities, getCapabilityStatus } from './protocol/capabilities.js'
import { fetchLatestWaWebVersion, resolveWaWebVersion, getFallbackWaWebVersion } from './protocol/version.js'
import { DEFAULT_PUBLIC_BROWSER, normalizeBrowserTuple } from './pairing/platform.js'
import { useMultiFileAuthState, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, resolveLatestBaileysVersion, Browsers, DisconnectReason, delay, jidEncode, jidDecode, jidNormalizedUser, transferDevice, areJidsSameUser, isJid, isJidUser, isPnUser, isLidUser, isHostedPnUser, isHostedLidUser, isJidGroup, isJidBroadcast, isJidNewsletter, isJidStatusBroadcast, isJidMetaAI, isJidBot, generateMessageID, generateMessageIDV2, BufferJSON, getContentType, getDevice, DEFAULT_CONNECTION_CONFIG } from './compat/baileys.js'

export { readBanner, showStartupBanner } from './banner.js'
export { renderTerminalQR, resetTerminalQR } from './terminal-qr.js'

export { BaileysError, BaileysConnectionError, BaileysPairingError, BaileysSessionError, BaileysProtocolError, BaileysDecryptError, BaileysRateLimitError, BaileysLoggedOutError } from './core/errors.js'
export { DisconnectCode, backoffDelay, getDisconnectCode, shouldReconnect, ReconnectController } from './core/reconnect.js'
export { SessionHealth, Watchdog } from './core/health.js'
export { getCapabilities, getCapabilityStatus } from './protocol/capabilities.js'
export { nativeEngineInfo, createNativeEngineSocket } from './protocol/native-engine.js'
export { OFFICIAL_BAILEYS_VERSION, OFFICIAL_BAILEYS_PACKAGE, officialEngineInfo, loadOfficialBaileys, createOfficialEngineSocket } from './protocol/official-engine.js'
export { doctor } from './doctor.js'
export { buildLinkedDeviceQR, parseLinkedDeviceQR, parsePairDeviceNode, createQRReference } from './pairing/qr.js'
export { buildPairingCodeRequest, buildCompanionFinishRequest, parsePairingCodeNode, parsePairingHelloResponse, normalizePairingPhone, normalizeCustomPairingCode, generatePairingCode, generatePairingEphemeralKeyPair, derivePairingCodeKey, wrapPairingEphemeralPublic, unwrapPairingEphemeralPublic } from './pairing/code.js'
export { createCompanionKeys, decodeCompanionKeys, takePreKey, replenishPreKeys } from './auth/companion.js'
export { NativeSignalSession, SignalSessionStore, encodeSignalMessage, decodeSignalMessage, encodePreKeySignalMessage, decodePreKeySignalMessage } from './protocol/signal/index.js'
export { encodeMessageContent, decodeMessageContent, MESSAGE_FIELD_MAP, SUPPORTED_MESSAGE_TYPES } from './messaging/index.js'
export { encryptMedia, decryptMedia, deriveMediaKeys, generateMediaKey, downloadAndDecryptMedia, mediaUploadDescriptor, normalizeMediaType, MEDIA_KEY_INFO } from './media/crypto.js'
export { fetchLatestWaWebVersion, resolveWaWebVersion, getFallbackWaWebVersion } from './protocol/version.js'
export { DEFAULT_PUBLIC_BROWSER, normalizeBrowserTuple } from './pairing/platform.js'
export { getCompanionPlatformId, getCompanionPlatformDisplay, CompanionWebClientType } from './pairing/platform.js'
let cachedNativeEngine = null
let cachedOfficialEngine = null

async function loadEngine(options = {}) {
  const mode = process.env.REPAN_BAILEYS_CONNECTION_ENGINE ?? options.connectionEngine ?? 'official'
  if (mode === 'native') {
    if (!cachedNativeEngine) {
      cachedNativeEngine = { ...nativeEngineInfo(), makeWASocket: createNativeEngineSocket }
    }
    return cachedNativeEngine
  }
  if (!cachedOfficialEngine) {
    cachedOfficialEngine = { ...officialEngineInfo(), makeWASocket: createOfficialEngineSocket }
  }
  return cachedOfficialEngine
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function validateCustomPairingCode(code) {
  if (code == null) return null
  const value = String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (value.length !== 8) throw new TypeError('Custom pairing code harus tepat 8 karakter alfanumerik.')
  return value
}

function isFunction(value) { return typeof value === 'function' }

function isUsableSocket(socket) {
  return Boolean(socket && !socket.closed && socket.protocolState !== 'closed' && (socket.protocolState == null || socket.protocolState === 'secure' || socket.protocolState === 'authenticated'))
}

async function waitForActiveSocket(state, timeoutMs = 25_000) {
  const timeout = Math.max(1_000, Number(timeoutMs) || 25_000)
  const deadline = Date.now() + timeout
  while (!state.closed) {
    if (isUsableSocket(state.current)) return state.current
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const rebuilding = state.rebuilding
    if (rebuilding) {
      await Promise.race([rebuilding.catch(() => null), sleep(Math.min(remaining, 250))])
      continue
    }
    const current = state.current
    if (current?.waitForSecure && !current.closed) {
      try {
        await Promise.race([
          current.waitForSecure(Math.min(remaining, timeout)),
          sleep(Math.min(remaining, 250))
        ])
      } catch {}
      continue
    }
    if (state.ready && !state.readyResolved) {
      await Promise.race([state.ready.catch(() => null), sleep(Math.min(remaining, 250))])
      continue
    }
    await sleep(Math.min(remaining, 100))
  }
  if (state.closed) throw new BaileysConnectionError('Socket sudah ditutup.')
  throw new BaileysConnectionError('Socket belum aktif setelah menunggu recovery.', { statusCode: 408 })
}

function createSocketFacade(state) {
  const target = {}
  let facade
  facade = new Proxy(target, {
    get(_target, prop) {
      if (prop === 'then') {
        if (state.readyResolved) return undefined
        return (resolve, reject) => state.ready.then(() => {
          state.readyResolved = true
          resolve(facade)
        }, reject)
      }
      if (prop === 'ev') return state.events
      if (prop === 'authState') return state.authState
      if (prop === 'health') return state.health.snapshot()
      if (prop === 'botName') return state.botName
      if (prop === 'browser') return [...state.browser]
      if (prop === 'connectionState') return state.connectionState
      if (prop === 'isAuthenticated') return state.connectionState === 'open' && state.authState?.creds?.registered === true
      if (prop === 'user') return state.authState?.creds?.me ?? (state.authState?.creds?.jid ? { id: state.authState.creds.jid } : undefined)
      if (prop === 'capabilities') return getCapabilities()
      if (prop === 'reconnectNow') return () => state.reconnectNow ? state.reconnectNow('manual') : state.ready.then(() => state.reconnectNow('manual'))
      if (prop === 'getHealth') return () => state.health.snapshot()
      if (prop === 'getPairingCode') return () => state.pairingCode
      if (prop === 'getPairingState') return () => ({ active: Boolean(state.authState?.creds?.pairingActive), phone: state.pairingNumber, code: state.pairingCode })
      if (prop === 'getCapabilityStatus') return () => state.current?.getCapabilityStatus?.() ?? getCapabilityStatus()
      if (prop === 'close' || prop === 'end') return () => state.stop ? state.stop('manual') : state.ready.then(() => state.stop('manual'))
      if (prop === 'requestPairingCode') return (...args) => state.requestPairingCode(...args)
      if (prop === 'requestPairingCodeCustom') return async (...args) => {
        if (args.length < 1) throw new TypeError('Custom pairing code wajib disertai kode.')
        const phone = args.length >= 2 ? args[0] : state.options.pairingNumber
        if (!phone) throw new TypeError('Nomor pairing tidak valid')
        return state.requestPairingCode(phone, args.length >= 2 ? args[1] : args[0])
      }
      if (prop === 'setSignalSession' || prop === 'getSignalSession' || prop === 'deleteSignalSession') return (...args) => state.invokeSend(prop, args)
      if (prop === 'newsletterFollow' || prop === 'newsletterUnfollow') return (...args) => state.invokeSend(prop, args)
      if (prop === 'schedulePairingRequest') return () => state.schedulePairingRequest()
      if (prop === '__baileys') return Object.freeze({ version: state.version, generation: state.generation })
      const socket = state.current
      if (!socket) {
        const deferred = new Set(['sendMessage', 'relayMessage', 'logout', 'sendNode', 'requestNode', 'sendEncryptedFrame', 'newsletterFollow', 'newsletterUnfollow', 'sendPresenceUpdate', 'presenceSubscribe', 'readMessages', 'sendReadReceipt', 'groupMetadata', 'groupCreate', 'groupLeave', 'groupUpdateSubject', 'groupUpdateDescription', 'groupParticipantsUpdate', 'groupInviteCode', 'groupRevokeInvite', 'groupAcceptInvite', 'groupGetInviteInfo', 'groupSettingUpdate', 'waitForSocketOpen'])
        if (deferred.has(prop)) return (...args) => waitForActiveSocket(state, state.options.operationTimeoutMs ?? 25_000).then(active => {
          const fn = active?.[prop]
          if (typeof fn !== 'function') throw new TypeError(`${String(prop)} tersedia di engine`)
          return fn.apply(active, args)
        })
        return undefined
      }
      const value = socket[prop]
      if (!isFunction(value)) return value
      if (prop === 'sendMessage' || prop === 'relayMessage') {
        return (...args) => state.sendLimiter.schedule(async () => {
          try {
            return await state.invokeSend(prop, args)
          } catch (error) {
            const code = getDisconnectCode(error)
            if (code === DisconnectCode.rateLimited) state.sendLimiter.backoff(state.options.rateLimitBackoffMs ?? 5000)
            else if ([DisconnectCode.connectionLost, DisconnectCode.connectionClosed, DisconnectCode.timedOut, DisconnectCode.temporary, DisconnectCode.unavailableService, DisconnectCode.connectionIdle, DisconnectCode.badAck, DisconnectCode.restartRequired].includes(code)) {
              state.sendLimiter.backoff(state.options.transientSendBackoffMs ?? 1500)
              if (!state.closed) void state.requestReconnect('send-error', code).catch(reconnectError => state.events.emit('baileys.error', new BaileysConnectionError('Recovery setelah send error gagal.', { cause: reconnectError })))
            }
            throw error
          }
        })
      }
      return value.bind(socket)
    },
    set(_target, prop, value) {
      if (!state.current) return false
      state.current[prop] = value
      return true
    },
    has(_target, prop) {
      if (prop === 'ev' || prop === 'health' || prop === 'connectionState' || prop === 'isAuthenticated' || prop === 'user' || prop === '__baileys') return true
      return Boolean(state.current && prop in state.current)
    }
  })
  return facade
}

function sanitizeEngineOptions(options, auth, logger, official = false) {
  const out = { ...options }
  for (const key of [
    'authDir', 'pairingNumber', 'pairingCode', 'customPairingCode', 'autoFollowChannels',
    'autoFollowOnce', 'autoRepairBadSession', 'backupRetention', 'lockStaleMs', 'maxReconnectAttempts',
    'baseReconnectDelay', 'maxReconnectDelay', 'reconnectJitter', 'watchdog', 'watchdogIntervalMs',
    'watchdogDeadMs', 'keepaliveFailureThreshold', 'reconnectOnKeepaliveFailure', 'logger', 'engine', 'onReconnect', 'onReady', 'onClose',
    'retryBadSession', 'retryMultideviceMismatch', 'allowUnknownDisconnectRetry'
  ]) delete out[key]
  out.signalDir = out.signalDir ?? path.join(auth.dir, 'signal-sessions')
  out.auth = official ? auth.state : (auth.state?.creds ?? auth.creds ?? {})
  out.saveCreds = auth.saveCreds
  out.logger = logger
  if (out.markOnlineOnConnect == null) out.markOnlineOnConnect = false
  if (out.syncFullHistory == null) out.syncFullHistory = false
  return out
}

async function maybeRepairSession(state, code, error) {
  if (code !== DisconnectCode.badSession) return false
  if (!state.options.autoRepairBadSession) return false
  const dir = state.auth.dir
  await state.auth?.backup(`repair-${code}`)
  if (typeof state.auth?.clearAndReinitialize === 'function') {
    await state.auth.clearAndReinitialize()
    state.authState = state.auth.state
    state.saveCreds = state.auth.saveCreds
  } else {
    await clearAuthContents(dir)
    await state.auth?.release?.()
    state.auth = await createPersistentAuthState(state.engine, dir, state.options)
    state.authState = state.auth.state
    state.saveCreds = state.auth.saveCreds
  }
  state.health.markReconnect()
  state.logger.warn({ code }, 'session state di-reset setelah disconnect terminal yang diizinkan')
  return true
}

async function followChannels(state, socket) {
  if (!state.channels.length || !isFunction(socket.newsletterFollow)) return
  const markerPath = path.join(state.auth.dir, '.baileys-followed.json')
  let markers = {}
  try { markers = JSON.parse(await fs.readFile(markerPath, 'utf8')) } catch {}
  let changed = false
  for (const jid of state.channels) {
    if (state.options.autoFollowOnce !== false && markers[jid]) continue
    let error = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await socket.newsletterFollow(jid)
        markers[jid] = { followedAt: new Date().toISOString() }
        changed = true
        state.logger.info({ jid }, 'newsletter channel followed')
        error = null
        break
      } catch (err) {
        error = err
        if (attempt < 3) await sleep(500 * 2 ** (attempt - 1))
      }
    }
    if (error) state.logger.warn({ jid, err: error }, 'newsletter auto-follow gagal setelah retry')
  }
  if (changed) {
    await atomicWrite(markerPath, JSON.stringify(markers, null, 2), { mode: 0o600 })
  }
}

export function makeWASocket(options = {}) {
  const authDir = path.resolve(options.authDir ?? './auth/baileys')
  const events = new StableEventBus().setMaxListeners(options.maxEventListeners ?? 100)
  const health = new SessionHealth()
  const watchdog = new Watchdog({ intervalMs: options.watchdogIntervalMs, deadMs: options.watchdogDeadMs })
  const reconnect = new ReconnectController()
  const channels = normalizeNewsletterJids(options.autoFollowChannels ?? [])
  const state = {
    engine: options.engine ?? null,
    connectionEngine: options.connectionEngine ?? 'official',
    logger: options.logger ?? null,
    options,
    version: '1.5.2',
    botName: String(options.botName ?? '').trim() || null,
    browser: normalizeBrowserTuple(options.browser ?? DEFAULT_PUBLIC_BROWSER),
    auth: null,
    authState: null,
    saveCreds: null,
    current: null,
    generation: 0,
    connectionState: 'idle',
    pairingNumber: options.pairingNumber ? normalizePhone(options.pairingNumber) : null,
    pairingCode: null,
    pairingRequested: false,
    pairingRenewalPending: false,
    pairingRenewalAttempts: 0,
    pairingAttempts: 0,
    pairingPromise: null,
    pairingTimer: null,
    closed: false,
    rebuilding: null,
    initializing: true,
    ready: null,
    readyResolved: false,
    reconnect,
    health,
    watchdog,
    events,
    channels,
    sendLimiter: new SendRateLimiter({ minDelayMs: options.sendMinDelayMs ?? 300, jitterMs: options.sendJitterMs ?? 75, maxQueue: options.maxSendQueue ?? 1000 }),
    stop: null,
    reconnectNow: null,
    requestReconnect: null,
    requestPairingCode: null,
    pairingOperation: null,
    waitForActiveSocket: null,
    keepaliveFailures: 0,
    invokeSend: null,
    schedulePairingRequest: null
  }

  const facade = createSocketFacade(state)
  let installSocket = null
  state.waitForActiveSocket = timeoutMs => waitForActiveSocket(state, timeoutMs)

  state.stop = async reason => {
    if (state.closed) return
    state.closed = true
    if (state.pairingTimer) clearTimeout(state.pairingTimer)
    state.pairingTimer = null
    state.connectionState = 'closing'
    reconnect.cancel()
    watchdog.stop()
    try { await state.sendLimiter.close() } catch {}
    const socket = state.current
    try { events.detachSocket(socket) } catch {}
    try { socket?.ev?.off?.('pairing.qr', socket?.__baileysQrHandler) } catch {}
    try { socket?.ev?.off?.('creds.update', socket?.__baileysCredsHandler ?? state.saveCreds) } catch {}
    try { socket?.ev?.off?.('connection.update', state.onConnection) } catch {}
    try { socket?.end?.(new Error(`Baileys closed: ${reason}`)) } catch {}
    try { socket?.ws?.close?.() } catch {}
    events.emit('baileys.stopped', { reason })
    events.close()
    try { await state.auth?.release?.() } catch (error) {
      state.connectionState = 'closed'
      state.events.emit('baileys.error', new BaileysSessionError('Gagal melepaskan auth state saat shutdown.', { cause: error }))
      return
    }
    state.connectionState = 'closed'
  }

  state.invokeSend = async (method, args) => {
    const socket = await waitForActiveSocket(state, state.options.operationTimeoutMs ?? 25_000)
    try {
      const fn = socket[method]
      if (typeof fn !== 'function') throw new TypeError(`${method} tersedia di engine`)
      return await fn.apply(socket, args)
    } catch (error) {
      state.health.markSendError()
      throw error
    }
  }

  state.requestPairingCode = async (number = state.pairingNumber, custom = options.customPairingCode ?? options.pairingCode) => {
    const phone = normalizePhone(number)
    const code = validateCustomPairingCode(custom)
    if (state.pairingOperation) {
      const samePhone = state.pairingOperation.phone === phone
      const sameCode = (state.pairingOperation.code ?? null) === (code ?? null)
      if (samePhone && sameCode) return state.pairingOperation.promise
      throw new BaileysPairingError('Pairing code request sedang aktif untuk sesi ini; selesaikan pairing yang sedang berjalan atau tutup socket lalu mulai ulang.')
    }
    state.pairingRequested = true
    state.pairingNumber = phone
    const operation = (async () => {
      const socket = await waitForActiveSocket(state, state.options.pairingReadyTimeoutMs ?? state.options.operationTimeoutMs ?? 25_000)
      if (typeof socket.requestPairingCode !== 'function') throw new BaileysPairingError('Socket pairing belum siap; engine tidak mengekspos requestPairingCode().')
      try {
        const result = code ? await socket.requestPairingCode(phone, code) : await socket.requestPairingCode(phone)
        state.pairingCode = result
        state.pairingAttempts = 0
        state.pairingRenewalAttempts = 0
        state.pairingRenewalPending = false
        state.events.emit('baileys.pairing', { code: result, phone })
        return result
      } catch (error) {
        state.pairingRequested = false
        state.authState?.creds && (state.authState.creds.pairingActive = false)
        try { await state.saveCreds?.({ pairingActive: false }) } catch {}
        throw new BaileysPairingError('Gagal meminta pairing code.', { cause: error })
      }
    })()
    state.pairingOperation = { phone, code: code ?? null, promise: operation }
    try {
      return await operation
    } finally {
      if (state.pairingOperation?.promise === operation) state.pairingOperation = null
    }
  }

  state.schedulePairingRequest = () => {
    if (state.pairingPromise || state.closed || state.pairingRequested || !state.pairingNumber || state.authState?.creds?.registered) return state.pairingPromise
    state.pairingPromise = (async () => {
      const maxAttempts = Math.max(1, Number(options.maxPairingAttempts ?? 3))
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (state.closed || state.pairingRequested || state.authState?.creds?.registered) return null
        state.pairingAttempts = attempt
        try {
          return await state.requestPairingCode()
        } catch (error) {
          if (attempt >= maxAttempts) {
            state.events.emit('baileys.error', error)
            return null
          }
          await sleep(Math.max(250, Number(options.pairingRetryDelayMs ?? 1000)) * attempt)
        }
      }
      return null
    })().finally(() => { state.pairingPromise = null })
    return state.pairingPromise
  }

  state.requestReconnect = (reason = 'reconnect', code = null) => {
    if (state.closed) return Promise.reject(new BaileysConnectionError('Socket sudah ditutup.'))
    if (state.reconnect.pending) return state.reconnect.run(async () => state.current, options)
    state.health.markReconnect()
    return state.reconnect.run(async attempt => {
      state.events.emit('baileys.reconnect', { attempt, code, reason })
      return installSocket(`${reason}:${code ?? 'unknown'}`)
    }, options)
  }

  const initialize = (async () => {
    await showStartupBanner(options)
    if (state.closed) {
      state.initializing = false
      state.connectionState = 'closed'
      state.readyResolved = true
      return facade
    }
    options.browser = state.browser
    state.engine ??= await loadEngine(options)
    state.connectionEngine = state.engine?.kind ?? 'native'
    if (state.closed) {
      state.initializing = false
      state.connectionState = 'closed'
      state.readyResolved = true
      return facade
    }
    state.logger ??= await createLogger(options)
    if (state.closed) {
      state.initializing = false
      state.connectionState = 'closed'
      state.readyResolved = true
      return facade
    }

    if (options.auth?.state && options.auth?.saveCreds) {
      state.auth = { dir: authDir, state: options.auth.state, saveCreds: options.auth.saveCreds, backup: async () => null, release: async () => {} }
      state.authState = options.auth.state
      state.saveCreds = options.auth.saveCreds
    } else {
      if (state.connectionEngine === 'official') {
        // The official engine needs its complete AuthenticationState (creds + keys).
        // Our compat useMultiFileAuthState() delegates to WhiskeySockets Baileys when
        // the official engine is available, while retaining our custom fallback.
        state.auth = await useMultiFileAuthState(authDir)
      } else {
        state.auth = await createPersistentAuthState(state.engine, authDir, options)
      }
      if (state.closed) {
        try { await state.auth?.release?.() } catch {}
        state.initializing = false
        state.connectionState = 'closed'
        state.readyResolved = true
        return facade
      }
      state.authState = state.auth.state
      state.saveCreds = state.auth.saveCreds
    }

    if (state.closed) {
      try { await state.auth?.release?.() } catch {}
      state.initializing = false
      state.connectionState = 'closed'
      state.readyResolved = true
      return facade
    }
    await ensureAuthDir(authDir)
    if (state.closed) {
      try { await state.auth?.release?.() } catch {}
      state.initializing = false
      state.connectionState = 'closed'
      state.readyResolved = true
      return facade
    }
    await writeMeta(authDir, { package: '@repanxtenka/baileys', version: state.version })

    installSocket = async reason => {
      if (state.closed) return null
      if (state.rebuilding) return state.rebuilding
      state.rebuilding = (async () => {
        const old = state.current
        if (old) {
          state.current = null
          try { events.detachSocket(old) } catch {}
          try { old.ev?.off?.('creds.update', old.__baileysCredsHandler ?? state.saveCreds) } catch {}
          try { old.ev?.off?.('connection.update', old.__baileysConnectionHandler ?? state.onConnection) } catch {}
          try { old.ev?.off?.('frame', old.__baileysFrameHandler) } catch {}
          try { old.ev?.off?.('messages.upsert', old.__baileysMessageUpHandler) } catch {}
          try { old.ev?.off?.('messages.update', old.__baileysMessageUpdateHandler) } catch {}
          try { old.ev?.off?.('CB:stream:error', old.__baileysStreamErrorHandler) } catch {}
          try { old.ev?.off?.('frame.tx', old.__baileysFrameTxHandler) } catch {}
          try { old.ev?.off?.('keepalive.ok', old.__baileysKeepaliveOkHandler) } catch {}
          try { old.ev?.off?.('keepalive.error', old.__baileysKeepaliveErrorHandler) } catch {}
          try { old.ev?.off?.('pairing.qr', old.__baileysQrHandler) } catch {}
          try { old.end?.(new Error(`Baileys socket replaced: ${reason}`)) } catch {}
          try { old.ws?.close?.() } catch {}
        }
        state.generation += 1
        const generation = state.generation
        state.connectionState = 'connecting'
        state.keepaliveFailures = 0
        state.events.emit('baileys.socket', { generation, reason })
        // Keep the pairing request state across reconnects. A transport restart
        // must never send the CLI back to the phone-number prompt. If the
        // previous pairing transport died before registration, onConnection()
        // renews the code silently on the new socket.
        const config = sanitizeEngineOptions(state.options, state.auth, state.logger, state.connectionEngine === 'official')
        const socket = await state.engine.makeWASocket(config, state.authState?.creds)
        if (state.closed) {
          try { socket?.end?.(new Error('Baileys ditutup saat engine masih membuat socket')) } catch {}
          try { socket?.ws?.close?.() } catch {}
          throw Object.assign(new Error('Baileys initialization dibatalkan karena socket sudah ditutup.'), { code: 'BAILEYS_INIT_ABORTED' })
        }
        state.current = socket
        events.attachSocket(socket)
        if (socket.ev?.on) {
          const qrHandler = payload => {
            const qr = payload?.qr
            if (!qr) return
            state.events.emit('baileys.pairing', { qr, ref: payload?.ref, rotated: payload?.rotated === true })
            if (options.printQRInTerminal !== false && options.terminalQR !== false) {
              renderTerminalQR(qr, { small: options.qrSmall !== false, clear: false, clearAfterMs: Number(options.qrClearAfterMs ?? 0) })
            }
          }
          socket.__baileysQrHandler = qrHandler
          socket.ev.on('pairing.qr', qrHandler)

          const connectionHandler = update => state.onConnection(update, socket, generation).catch?.(error => state.events.emit('baileys.error', error))
          const credsHandler = patch => Promise.resolve(state.saveCreds?.(patch)).catch(error => state.events.emit('baileys.error', new BaileysSessionError('Gagal menyimpan credentials.', { cause: error })))
          const messageUpHandler = () => state.health.markMessage()
          const messageUpdateHandler = () => state.health.markMessage()
          const frameHandler = () => state.health.markFrame()
          const streamErrorHandler = error => { state.health.markProtocolError(); state.events.emit('baileys.error', error) }
          const frameTxHandler = () => state.health.markTx()
          const keepaliveOkHandler = () => { state.health.markKeepaliveSuccess(); state.health.markFrame(); state.keepaliveFailures = 0 }
          const keepaliveErrorHandler = payload => {
            const error = payload?.error ?? payload
            const count = Number(payload?.count ?? (state.keepaliveFailures + 1))
            state.keepaliveFailures = count
            state.health.markKeepaliveError()
            state.events.emit('baileys.keepalive', { error, count, generation })
            if (options.reconnectOnKeepaliveFailure !== false && count >= Math.max(1, Number(options.keepaliveFailureThreshold ?? 3)) && !state.closed) {
              void state.requestReconnect('keepalive').catch(reconnectError => {
                state.events.emit('baileys.error', new BaileysConnectionError('Recovery keepalive gagal.', { cause: reconnectError }))
              })
            }
          }
          socket.__baileysConnectionHandler = connectionHandler
          socket.__baileysCredsHandler = credsHandler
          socket.__baileysMessageUpHandler = messageUpHandler
          socket.__baileysMessageUpdateHandler = messageUpdateHandler
          socket.__baileysFrameHandler = frameHandler
          socket.__baileysStreamErrorHandler = streamErrorHandler
          socket.__baileysFrameTxHandler = frameTxHandler
          socket.__baileysKeepaliveOkHandler = keepaliveOkHandler
          socket.__baileysKeepaliveErrorHandler = keepaliveErrorHandler
          socket.ev.on('creds.update', credsHandler)
          socket.ev.on('connection.update', connectionHandler)
          socket.ev.on('messages.upsert', messageUpHandler)
          socket.ev.on('messages.update', messageUpdateHandler)
          socket.ev.on('frame', frameHandler)
          socket.ev.on('CB:stream:error', streamErrorHandler)
          socket.ev.on('frame.tx', frameTxHandler)
          socket.ev.on('keepalive.ok', keepaliveOkHandler)
          socket.ev.on('keepalive.error', keepaliveErrorHandler)
        }
        if (socket.closed || socket.protocolState === 'closed') {
          const closeError = socket.lastError ?? new Error('Native socket ditutup sebelum lifecycle listener terpasang')
          throw Object.assign(closeError, { statusCode: closeError.statusCode ?? 408 })
        }
        if (state.connectionState === 'connecting') {
          if (socket.protocolState === 'authenticated') await state.onConnection({ connection: 'open', authenticated: true }, socket, generation)
          else if (socket.protocolState === 'secure') await state.onConnection({ connection: 'secure', authenticated: false }, socket, generation)
        }
        state.events.emit('baileys.health', state.health.snapshot())
        return socket
      })()
      try { return await state.rebuilding } finally { state.rebuilding = null }
    }

    state.onConnection = async (update, sourceSocket = state.current, sourceGeneration = state.generation) => {
      if (state.closed || sourceSocket !== state.current || sourceGeneration !== state.generation) return
      const { connection, lastDisconnect, qr } = update ?? {}
      state.health.markFrame()
      if (qr) state.events.emit('baileys.pairing', { qr })
      if (connection === 'connecting') state.connectionState = 'connecting'
      if (connection === 'secure') {
        state.connectionState = 'secure'
        state.events.emit('baileys.health', state.health.snapshot())

        // Initial pairing: request exactly once and keep the number in memory.
        if (state.pairingNumber && !state.authState?.creds?.registered && !state.authState?.creds?.pairingActive && options.requestPairingOnStart !== false && !state.pairingRequested && !state.pairingRenewalPending) {
          const pairingDelay = Math.max(0, Number(options.pairingDelayMs ?? 0))
          if (state.pairingTimer) clearTimeout(state.pairingTimer)
          state.pairingTimer = setTimeout(() => {
            state.pairingTimer = null
            if (!state.closed) state.schedulePairingRequest()
          }, pairingDelay)
        }

        // If the transport died after a pairing request but before registration,
        // silently renew the pairing request on the replacement socket. This is
        // intentionally separate from schedulePairingRequest(), because that
        // method is guarded by pairingRequested to prevent duplicate user prompts.
        if (state.pairingRenewalPending && state.pairingNumber && !state.authState?.creds?.registered && !state.closed) {
          const maxRenewals = Math.max(1, Number(options.maxPairingRenewals ?? 3))
          if (state.pairingRenewalAttempts < maxRenewals) {
            state.pairingRenewalPending = false
            state.pairingRenewalAttempts += 1
            const retryDelay = Math.max(0, Number(options.pairingRenewalDelayMs ?? 500))
            if (state.pairingTimer) clearTimeout(state.pairingTimer)
            state.pairingTimer = setTimeout(() => {
              state.pairingTimer = null
              if (state.closed || state.authState?.creds?.registered) return
              void state.requestPairingCode().catch(error => {
                state.pairingRenewalPending = true
                state.events.emit('baileys.error', new BaileysPairingError('Pairing code renewal gagal.', { cause: error }))
              })
            }, retryDelay)
          } else {
            state.events.emit('baileys.error', new BaileysPairingError('Pairing transport terputus berulang kali; tidak meminta nomor baru. Jalankan requestPairingCode() secara manual setelah jaringan stabil.'))
          }
        }
        return
      }
      if (connection === 'open') {
        state.connectionState = 'open'
        state.health.markOpen()
        state.reconnect.complete(facade)
        watchdog.start(state.health, () => { void state.requestReconnect('watchdog').catch(error => state.events.emit('baileys.error', new BaileysConnectionError('Watchdog recovery gagal.', { cause: error }))) })
        state.events.emit('baileys.ready', facade)
        try { if (options.onReady) await options.onReady(facade) } catch (callbackError) {
          state.events.emit('baileys.error', callbackError)
        }
        try { await state.auth?.backup?.('open') } catch (backupError) {
          state.events.emit('baileys.error', new BaileysSessionError('Backup credentials setelah open gagal.', { cause: backupError }))
        }
        try { await followChannels(state, state.current) } catch (followError) {
          state.events.emit('baileys.error', followError)
        }
        return
      }
      if (connection !== 'close') return
      state.connectionState = 'closed'
      watchdog.stop()
      const error = lastDisconnect?.error
      const code = getDisconnectCode(error)
      state.health.markDisconnect(code)
      if (!state.authState?.creds?.registered && state.pairingRequested) {
        // The transport can die between the initial pairing request and the
        // primary_hello response. Preserve the original number and silently
        // renew the code after reconnect instead of reopening the CLI prompt.
        state.pairingRenewalPending = true
      }
      state.events.emit('baileys.close', { error, code, generation: state.generation })
      if (state.closed) return

      const repaired = await maybeRepairSession(state, code, error).catch(err => {
        state.events.emit('baileys.error', err)
        return false
      })
      if (state.closed || sourceSocket !== state.current || sourceGeneration !== state.generation) return

      const retry = repaired || shouldReconnect(error, {
        retryBadSession: options.retryBadSession === true,
        retryMultideviceMismatch: options.retryMultideviceMismatch === true,
        unknownIsRetryable: options.allowUnknownDisconnectRetry !== false
      })
      if (!retry) {
        state.events.emit('baileys.stopped', { error, code })
        if (options.onClose) await options.onClose({ error, code })
        await state.auth?.release?.()
        return
      }

      try {
        try { await state.auth?.backup?.(`disconnect-${code ?? 'unknown'}`) } catch {}
        const result = await state.requestReconnect('disconnect', code)
        if (options.onReconnect) await options.onReconnect(result)
      } catch (reconnectError) {
        state.events.emit('baileys.error', new BaileysConnectionError('Reconnect gagal.', { cause: reconnectError, statusCode: code }))
      }
    }

    state.reconnectNow = reason => {
      if (state.closed) return Promise.reject(new BaileysConnectionError('Socket sudah ditutup.'))
      state.reconnect.cancel()
      state.health.markReconnect()
      return installSocket(`manual:${reason}`)
    }

    if (!state.closed) {
      try {
        await installSocket('initial')
      } catch (initialError) {
        if (!shouldReconnect(initialError, { unknownIsRetryable: false })) throw initialError
        await state.requestReconnect('initial', getDisconnectCode(initialError))
      }
    }
    state.initializing = false
    state.readyResolved = true
    return facade
  })()

  state.ready = initialize
  initialize.catch(error => {
    state.initializing = false
    state.connectionState = 'closed'
    state.events.emit('baileys.error', error)
  })

  return facade
}

export const createRebelsSocket = makeWASocket
export const createBaileysSocket = makeWASocket

export {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  resolveLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  delay,
  jidEncode,
  jidDecode,
  jidNormalizedUser,
  transferDevice,
  areJidsSameUser,
  isJid,
  isJidUser,
  isPnUser,
  isLidUser,
  isHostedPnUser,
  isHostedLidUser,
  isJidGroup,
  isJidBroadcast,
  isJidNewsletter,
  isJidStatusBroadcast,
  isJidMetaAI,
  isJidBot,
  generateMessageID,
  generateMessageIDV2,
  BufferJSON,
  normalizeMessageContent,
  getContentType,
  getDevice,
  extractMessageContent,
  generateWAMessageContent,
  generateWAMessageFromContent,
  generateWAMessage,
  DEFAULT_CONNECTION_CONFIG
} from './compat/baileys.js'

export async function loadEngineExports() {
  const engine = await loadEngine()
  const { makeWASocket: _make, ...exports } = engine
  return exports
}

export function loadProtocolInfo() { return { ...nativeEngineInfo(), capabilities: getCapabilities(), capabilityStatus: getCapabilityStatus() } }

export default makeWASocket
