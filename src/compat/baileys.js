import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createPersistentAuthState } from '../auth/state.js'
import { atomicWrite, ensureAuthDir } from '../auth/file-store.js'
import { fetchLatestWaWebVersion, resolveWaWebVersion } from '../protocol/version.js'
import { generateMessageId, normalizeMessageContent } from '../messaging/codec.js'
import { WRAPPER_MESSAGE_TYPES } from '../messaging/schema.js'

export const DisconnectReason = Object.freeze({
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  timedOut: 408,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  multideviceMismatch: 411,
  forbidden: 403,
  unavailableService: 503,
  connectionIdle: 405,
  temporary: 409,
  badAck: 406,
  clientOffline: 500,
  rateLimited: 429
})

const DEFAULT_VERSION = ['RepanOffcl', 'Chrome', '1.0.0']


export const BufferJSON = Object.freeze({
  replacer: (_key, value) => {
    if (Buffer.isBuffer(value)) return { type: 'Buffer', data: Array.from(value) }
    if (value instanceof Uint8Array) return { type: 'Buffer', data: Array.from(value) }
    if (value instanceof Date) return value.toISOString()
    return value
  },
  reviver: (_key, value) => {
    if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data)
    return value
  }
})


export const DEFAULT_CONNECTION_CONFIG = Object.freeze({
  version: [2, 3000, 1043857760],
  browser: [...DEFAULT_VERSION],
  waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
  connectTimeoutMs: 20_000,
  keepAliveIntervalMs: 30_000,
  markOnlineOnConnect: false,
  syncFullHistory: false,
  defaultQueryTimeoutMs: 60_000,
  emitOwnEvents: true
})

export const Browsers = Object.freeze({
  ubuntu: (name = 'RepanXTEnka') => [String(name), 'Chrome', '1.0.0'],
  macOS: (name = 'RepanXTEnka') => [String(name), 'Chrome', '1.0.0'],
  windows: (name = 'RepanXTEnka') => [String(name), 'Chrome', '1.0.0'],
  baileys: (name = 'RepanXTEnka') => [String(name), 'Chrome', '1.0.0'],
  android: (name = 'RepanXTEnka') => [String(name), 'Chrome', '1.0.0'],
  appropriate: (name = 'RepanXTEnka') => [String(name), 'Chrome', '1.0.0']
})

export const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)))

export function jidEncode(user, server, device, agent) {
  const u = user == null ? '' : String(user)
  return `${u}${device ? `:${device}` : ''}${agent ? `_${agent}` : ''}@${server}`
}

export function jidDecode(jid) {
  if (typeof jid !== 'string' || !jid) return undefined
  const sep = jid.indexOf('@')
  if (sep < 0) return undefined
  const server = jid.slice(sep + 1)
  const combined = jid.slice(0, sep)
  if (!combined) return undefined
  let user = combined
  let device
  let agent
  const legacy = combined.match(/^(.+?)_(\d+):(\d+)$/)
  const canonical = combined.match(/^(.+?):(\d+)(?:_(\d+))?$/)
  if (legacy) {
    user = legacy[1]
    agent = Number(legacy[2])
    device = Number(legacy[3])
  } else if (canonical) {
    user = canonical[1]
    device = Number(canonical[2])
    if (canonical[3] != null) agent = Number(canonical[3])
  } else {
    const agentOnly = combined.match(/^(.+?)_(\d+)$/)
    if (agentOnly) {
      user = agentOnly[1]
      agent = Number(agentOnly[2])
    }
  }
  if (!user) return undefined
  return {
    user,
    server,
    domainType: agent == null ? (server === 'lid' ? 1 : server === 'hosted' ? 128 : server === 'hosted.lid' ? 129 : 0) : agent,
    ...(device != null ? { device } : {})
  }
}

export function jidNormalizedUser(jid) {
  const parsed = jidDecode(jid)
  if (!parsed) return ''
  const server = parsed.server === 'c.us' ? 's.whatsapp.net' : parsed.server
  return jidEncode(parsed.user, server)
}

export function transferDevice(fromJid, toJid) {
  const from = jidDecode(fromJid)
  const to = jidDecode(toJid)
  if (!from || !to) return toJid
  return jidEncode(to.user, to.server, from.device)
}

export function areJidsSameUser(a, b) {
  return jidDecode(a)?.user === jidDecode(b)?.user
}

export function isJidUser(jid) { return Boolean(jidDecode(jid)?.server === 's.whatsapp.net') }
export function isPnUser(jid) { return jidNormalizedUser(jid).endsWith('@s.whatsapp.net') }
export function isLidUser(jid) { return jid?.endsWith('@lid') === true }
export function isHostedPnUser(jid) { return jid?.endsWith('@hosted') === true }
export function isHostedLidUser(jid) { return jid?.endsWith('@hosted.lid') === true }
export function isJidGroup(jid) { return Boolean(jidDecode(jid)?.server === 'g.us') }
export function isJidBroadcast(jid) { return Boolean(jidDecode(jid)?.server === 'broadcast') }
export function isJidNewsletter(jid) { return Boolean(jidDecode(jid)?.server === 'newsletter') }
export function isJidStatusBroadcast(jid) { return jid === 'status@broadcast' }
export function isJidMetaAI(jid) { return jid?.endsWith('@bot') === true }
export function isJidBot(jid) { return typeof jid === 'string' && /^(1313555\d{4}|131655500\d{2})@c\.us$/.test(jid) }
export function isJid(jid) { return Boolean(jidDecode(jid)) }

export function generateMessageID() { return generateMessageId() }
export function generateMessageIDV2() { return generateMessageId() }

export function extractMessageContent(message) {
  let current = message?.message ?? message ?? null
  for (let i = 0; i < 8 && current && typeof current === 'object'; i += 1) {
    const wrapperKey = Object.keys(current).find(key => WRAPPER_MESSAGE_TYPES.has(key) && current[key]?.message)
    const next = wrapperKey ? current[wrapperKey].message : null
    if (!next || next === current) break
    current = next
  }
  return current
}

export function generateWAMessageContent(content) {
  return normalizeMessageContent(content)
}

export function generateWAMessageFromContent(jid, message, options = {}) {
  const remoteJid = jidNormalizedUser(jid) || String(jid)
  const normalized = message && typeof message === 'object' ? message : generateWAMessageContent(message)
  const id = options.messageId ?? generateMessageId()
  return {
    key: { remoteJid, fromMe: options.fromMe !== false, id, ...(options.participant ? { participant: options.participant } : {}) },
    message: normalized,
    messageTimestamp: options.messageTimestamp ?? Math.floor(Date.now() / 1000),
    ...(options.pushName ? { pushName: options.pushName } : {})
  }
}

export function generateWAMessage(jid, content, options = {}) {
  return generateWAMessageFromContent(jid, generateWAMessageContent(content), options)
}

export function getContentType(content) {
  if (!content || typeof content !== 'object') return undefined
  let unwrapped = content
  for (let i = 0; i < 8 && unwrapped && typeof unwrapped === 'object'; i += 1) {
    const wrapperKey = Object.keys(unwrapped).find(key => WRAPPER_MESSAGE_TYPES.has(key) && unwrapped[key]?.message)
    const next = wrapperKey ? unwrapped[wrapperKey].message : null
    if (!next || next === unwrapped) break
    unwrapped = next
  }
  if (typeof unwrapped.conversation === 'string' || typeof unwrapped.text === 'string') return 'conversation'
  const keys = Object.keys(unwrapped).filter(key => key !== 'messageContextInfo' && key !== 'senderKeyDistributionMessage' && key !== 'text' && key !== '_unknownFields')
  return keys[0]
}

export function getDevice(message) {
  const jid = message?.key?.participant || message?.key?.remoteJid
  const decoded = jidDecode(jid)
  return decoded?.device ?? 0
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, clone(val)]))
}

// Baileys persists binary signal material through BufferJSON. Keep the same
// practical behavior while also accepting the explicit Baileys Uint8Array tag.
function encodeStoredValue(value) {
  if (value == null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: Array.from(value) }
  if (value instanceof Uint8Array) return { __baileys_type: 'Uint8Array', data: Array.from(value) }
  if (value instanceof Date) return { __baileys_type: 'Date', data: value.toISOString() }
  if (Array.isArray(value)) return value.map(encodeStoredValue)
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, encodeStoredValue(val)]))
}

function decodeStoredValue(value) {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decodeStoredValue)
  if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data)
  if (value.__baileys_type === 'Uint8Array' && Array.isArray(value.data)) return new Uint8Array(value.data)
  if (value.__baileys_type === 'Date' && typeof value.data === 'string') return new Date(value.data)
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, decodeStoredValue(val)]))
}

function keyStorageDir(authDir) { return path.join(path.resolve(authDir), 'keys') }

function createFileLock() {
  const locks = new Map()
  return async (file, work) => {
    const previous = locks.get(file) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    locks.set(file, current.finally(() => {
      if (locks.get(file) === current) locks.delete(file)
    }))
    return current
  }
}

async function readKeyFile(root, type, id, withLock = async fn => fn()) {
  const file = path.join(root, type, `${encodeURIComponent(id)}.json`)
  return withLock(file, async () => {
    try {
      const raw = await fs.readFile(file, 'utf8')
      return decodeStoredValue(JSON.parse(raw))
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  })
}

async function writeKeyFile(root, type, id, value, withLock = async fn => fn()) {
  const dir = path.join(root, type)
  const file = path.join(dir, `${encodeURIComponent(id)}.json`)
  return withLock(file, async () => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const encoded = encodeStoredValue(value)
    await atomicWrite(file, JSON.stringify(encoded), { mode: 0o600 })
  })
}

const SHARED_AUTH_STATES = new Map()
const SHARED_AUTH_PENDING = new Map()

const OFFICIAL_AUTH_STATES = new Map()
const OFFICIAL_AUTH_PENDING = new Map()
let officialAuthLoader = null

async function loadOfficialAuthModule() {
  if (!officialAuthLoader) {
    officialAuthLoader = import('@whiskeysockets/baileys').catch(() => null)
  }
  return officialAuthLoader
}

async function useOfficialMultiFileAuthState(authDir) {
  if (process.env.REPAN_BAILEYS_AUTH_ENGINE === 'native') return null
  const mod = await loadOfficialAuthModule()
  if (!mod?.useMultiFileAuthState) return null
  const dir = path.resolve(authDir)
  const existing = OFFICIAL_AUTH_STATES.get(dir)
  if (existing) return existing
  const pending = OFFICIAL_AUTH_PENDING.get(dir)
  if (pending) return pending
  const task = (async () => {
    const again = OFFICIAL_AUTH_STATES.get(dir)
    if (again) return again
    const auth = await mod.useMultiFileAuthState(dir)
    const wrapped = {
      dir,
      state: auth.state,
      saveCreds: auth.saveCreds,
      backup: async () => null,
      release: async () => {}
    }
    OFFICIAL_AUTH_STATES.set(dir, wrapped)
    return wrapped
  })()
  OFFICIAL_AUTH_PENDING.set(dir, task)
  try { return await task } finally {
    if (OFFICIAL_AUTH_PENDING.get(dir) === task) OFFICIAL_AUTH_PENDING.delete(dir)
  }
}

function createSharedAuthView(shared) {
  let released = false
  shared.refs += 1
  return {
    state: shared.auth.state,
    saveCreds: shared.auth.saveCreds,
    backup: shared.auth.backup,
    async release() {
      if (released) return
      released = true
      shared.refs -= 1
      if (shared.refs > 0) return
      SHARED_AUTH_STATES.delete(shared.dir)
      await shared.auth.release()
    }
  }
}

export async function useMultiFileAuthState(authDir) {
  const official = await useOfficialMultiFileAuthState(authDir)
  if (official) return official
  const dir = await ensureAuthDir(authDir)
  const shared = SHARED_AUTH_STATES.get(dir)
  if (shared) return createSharedAuthView(shared)
  const pending = SHARED_AUTH_PENDING.get(dir)
  if (pending) {
    const ready = await pending
    return createSharedAuthView(ready)
  }

  const initialize = (async () => {
    const existing = SHARED_AUTH_STATES.get(dir)
    if (existing) return existing
    const legacyCredsFile = path.join(dir, 'creds.json')
  const nativeCredsFile = path.join(dir, 'credentials.json')
  const auth = await createPersistentAuthState(null, dir, {})
  const creds = auth.creds

  const root = await keyStorageDir(dir)
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const withLock = createFileLock()
  const transactionLock = createFileLock()
  const legacyKeyFile = (type, id) => path.join(dir, `${type}-${encodeURIComponent(id)}.json`)
  const nestedKeyFile = (type, id) => path.join(root, type, `${encodeURIComponent(id)}.json`)

  const readJsonValue = async file => {
    try {
      const raw = await fs.readFile(file, 'utf8')
      return decodeStoredValue(JSON.parse(raw))
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      if (error?.name === 'SyntaxError') return undefined
      throw error
    }
  }

  const readCompatKey = async (type, id) => {
    const legacy = await readJsonValue(legacyKeyFile(type, id))
    if (legacy !== undefined) return legacy
    return readJsonValue(nestedKeyFile(type, id))
  }

  const writeCompatKey = async (type, id, value) => {
    const encoded = JSON.stringify(encodeStoredValue(value))
    const legacy = legacyKeyFile(type, id)
    const nested = nestedKeyFile(type, id)
    await fs.mkdir(path.dirname(nested), { recursive: true, mode: 0o700 })
    await atomicWrite(legacy, encoded, { mode: 0o600 })
    await atomicWrite(nested, encoded, { mode: 0o600 })
  }

  const deleteCompatKey = async (type, id) => {
    for (const file of [legacyKeyFile(type, id), nestedKeyFile(type, id)]) {
      try { await fs.unlink(file) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
  }

  const saveCompatCreds = async patch => {
    const saved = await auth.saveCreds(patch)
    await atomicWrite(nativeCredsFile, JSON.stringify(saved, null, 2), { mode: 0o600 })
    await atomicWrite(legacyCredsFile, JSON.stringify(encodeStoredValue(saved), null, 2), { mode: 0o600 })
    return saved
  }

  if (creds.me?.id && !creds.jid) creds.jid = creds.me.id
  if (creds.jid && !creds.me) creds.me = { id: creds.jid }
  await saveCompatCreds()

  const keys = {
    async get(type, ids) {
      await auth.assertOwned?.()
      const out = {}
      for (const id of ids ?? []) {
        const file = legacyKeyFile(type, id)
        const value = await withLock(file, () => readCompatKey(type, id))
        if (value !== undefined) out[id] = value
      }
      return out
    },
    async set(data = {}) {
      await auth.assertOwned?.()
      for (const [type, values] of Object.entries(data)) {
        if (!values || typeof values !== 'object') continue
        for (const [id, value] of Object.entries(values)) {
          const file = legacyKeyFile(type, id)
          await withLock(file, async () => value == null ? deleteCompatKey(type, id) : writeCompatKey(type, id, value))
        }
      }
    },
    async clear() {
      await auth.assertOwned?.()
      await fs.rm(root, { recursive: true, force: true })
      await fs.mkdir(root, { recursive: true, mode: 0o700 })
      const knownTypes = new Set([
        'pre-key', 'session', 'sender-key', 'sender-key-memory',
        'app-state-sync-key', 'app-state-sync-version', 'lid-mapping',
        'device-list', 'tctoken'
      ])
      const entries = await fs.readdir(dir)
      await Promise.all(entries.filter(name => {
        const dash = name.indexOf('-')
        if (dash <= 0 || !name.endsWith('.json')) return false
        return [...knownTypes].some(prefix => name.startsWith(`${prefix}-`))
      }).map(name => fs.unlink(path.join(dir, name)).catch(() => {})))
    },
    async transaction(work, key = 'auth') {
      await auth.assertOwned?.()
      return transactionLock(key, () => work(keys))
    }
  }

  const saveCreds = async patch => saveCompatCreds(patch)
  const sharedRecord = {
    dir,
    auth: {
      state: { creds, keys },
      saveCreds,
      release: auth.release,
      backup: auth.backup
    },
    refs: 0
  }
    SHARED_AUTH_STATES.set(dir, sharedRecord)
    return sharedRecord
  })()
  SHARED_AUTH_PENDING.set(dir, initialize)
  try {
    const ready = await initialize
    return createSharedAuthView(ready)
  } finally {
    if (SHARED_AUTH_PENDING.get(dir) === initialize) SHARED_AUTH_PENDING.delete(dir)
  }
}
export function makeCacheableSignalKeyStore(keys, logger, customCache) {
  const cache = customCache && typeof customCache.get === 'function' && typeof customCache.set === 'function'
    ? customCache
    : null
  const memory = new Map()
  const ttlMs = 5 * 60 * 1000
  const now = () => Date.now()
  const cacheGet = async key => {
    if (cache) return cache.get(key)
    const item = memory.get(key)
    if (!item) return undefined
    if (item.expiresAt <= now()) { memory.delete(key); return undefined }
    return clone(item.value)
  }
  const cacheSet = async (key, value) => {
    if (cache) return cache.set(key, value, ttlMs)
    memory.set(key, { value: clone(value), expiresAt: now() + ttlMs })
  }
  const cacheDel = async key => {
    if (cache?.del) return cache.del(key)
    if (cache?.delete) return cache.delete(key)
    memory.delete(key)
  }
  const cacheFlush = async () => {
    if (cache?.flushAll) return cache.flushAll()
    if (cache?.clear) return cache.clear()
    if (cache?.reset) return cache.reset()
    memory.clear()
  }
  const keyId = (type, id) => `${type}.${id}`
  return {
    async get(type, ids) {
      const result = {}
      const missing = []
      for (const id of ids ?? []) {
        const value = await cacheGet(keyId(type, id))
        if (value !== undefined) result[id] = value
        else missing.push(id)
      }
      if (missing.length && typeof keys?.get === 'function') {
        logger?.trace?.({ items: missing.length }, 'loading signal keys from store')
        const loaded = await keys.get(type, missing)
        for (const id of missing) {
          const value = loaded?.[id]
          if (value !== undefined && value !== null) {
            await cacheSet(keyId(type, id), value)
            result[id] = clone(value)
          }
        }
      }
      return result
    },
    async set(data = {}) {
      let count = 0
      await keys?.set?.(data)
      for (const [type, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values ?? {})) {
          count += 1
          if (value == null) await cacheDel(keyId(type, id))
          else await cacheSet(keyId(type, id), value)
        }
      }
      logger?.trace?.({ keys: count }, 'updated signal key cache')
    },
    async clear() {
      await cacheFlush()
      await keys?.clear?.()
    },
    async transaction(work, key = 'auth') {
      if (typeof keys?.transaction === 'function') return keys.transaction(async () => work(this), key)
      return work(this)
    }
  }
}

export async function fetchLatestBaileysVersion(options = {}) {
  const result = await fetchLatestWaWebVersion(options)
  return { version: result.version, isLatest: result.isLatest, source: result.source, error: result.error }
}

export async function resolveLatestBaileysVersion(options = {}) {
  const result = await resolveWaWebVersion(options)
  return { version: result.version, isLatest: result.isLatest, source: result.source, error: result.error }
}

export function normalizeVersion(version) {
  if (!Array.isArray(version) || version.length !== 3) return null
  const parsed = version.map(Number)
  return parsed.every(Number.isFinite) ? parsed : null
}

export function getDefaultBrowser() { return [...DEFAULT_VERSION] }

export { normalizeMessageContent }
