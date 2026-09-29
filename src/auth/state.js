import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createCompanionKeys } from './companion.js'
import { acquireAuthLock, atomicWrite, backupAuthDir, clearAuthContents, ensureAuthDir } from './file-store.js'
import { generateX25519KeyPair } from '../protocol/crypto/noise.js'

const CREDENTIAL_FILES = ['credentials.json', 'creds.json']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function clone(value) {
  if (value == null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
}

function encode(value) {
  if (value == null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: [...value] }
  if (value instanceof Uint8Array) return { __baileys_type: 'Uint8Array', data: [...value] }
  if (Array.isArray(value)) return value.map(encode)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]))
}

function decode(value) {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decode)
  if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data)
  if (value.__baileys_type === 'Uint8Array' && Array.isArray(value.data)) return new Uint8Array(value.data)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]))
}

function readJson(file) {
  return fs.readFile(file, 'utf8').then(raw => decode(JSON.parse(raw))).catch(error => {
    if (error?.code === 'ENOENT') return null
    if (error?.name === 'SyntaxError') return null
    throw error
  })
}

function normalizeCredentials(raw = {}) {
  const creds = raw && typeof raw === 'object' ? clone(raw) : {}
  return ensureCredentialShape(creds)
}

function ensureCredentialShape(creds) {
  if (!creds.noiseKey?.privateKey || !creds.noiseKey?.publicKey) {
    const pair = generateX25519KeyPair()
    creds.noiseKey = {
      privateKey: Buffer.from(pair.privateKey).toString('base64'),
      publicKey: Buffer.from(pair.publicKey).toString('base64')
    }
  }
  creds.companion = createCompanionKeys(creds.companion ?? {}, {
    preKeyCount: Number(creds.companion?.preKeyCount ?? 50)
  })
  if (creds.me?.id && !creds.jid) creds.jid = creds.me.id
  if (creds.jid && !creds.me) creds.me = { id: creds.jid }
  creds.registered = creds.registered === true
  creds.version = Number(creds.version ?? 1)
  creds.updatedAt = Date.now()
  return creds
}

function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object') return target
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array) && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {}
      mergePatch(target[key], value)
    } else {
      target[key] = clone(value)
    }
  }
  return target
}

export async function createPersistentAuthState(_engine, dir, options = {}) {
  const authDir = await ensureAuthDir(dir)
  const lock = await acquireAuthLock(authDir, options)
  let released = false

  const release = async () => {
    if (released) return
    released = true
    await lock.release()
  }

  try {
    let creds = null
    for (const filename of CREDENTIAL_FILES) {
      const candidate = await readJson(path.join(authDir, filename))
      if (candidate) {
        creds = normalizeCredentials(candidate)
        break
      }
    }
    if (!creds) creds = normalizeCredentials({})

    const write = async () => {
      if (released) throw Object.assign(new Error('Auth state sudah dilepas'), { code: 'BAILEYS_AUTH_LOCK_LOST' })
      await lock.assertOwnership()
      creds.updatedAt = Date.now()
      const encoded = JSON.stringify(encode(creds), null, 2)
      await atomicWrite(path.join(authDir, 'credentials.json'), encoded, { mode: 0o600 })
      // Keep the legacy filename synchronized for older bot code.
      await atomicWrite(path.join(authDir, 'creds.json'), encoded, { mode: 0o600 })
      return clone(creds)
    }

    // Migrate and normalize existing credentials immediately. This also repairs
    // partial legacy files before the native engine starts using them.
    await write()

    const state = {
      creds,
      async saveCreds(patch = null) {
        await lock.assertOwnership()
        mergePatch(creds, patch)
        ensureCredentialShape(creds)
        state.creds = creds
        return write()
      },
      async backup(label = 'backup') {
        return backupAuthDir(authDir, label, { retention: options.backupRetention ?? 5 })
      },
      async clearAndReinitialize() {
        await lock.assertOwnership()
        await backupAuthDir(authDir, 'pre-reinitialize', { retention: options.backupRetention ?? 5 })
        await clearAuthContents(authDir, { preserve: ['backups', '.baileys.lock'] })
        creds = normalizeCredentials({})
        state.creds = creds
        await write()
        return state
      },
      async assertOwned() {
        if (released) throw Object.assign(new Error('Auth state sudah dilepas'), { code: 'BAILEYS_AUTH_LOCK_LOST' })
        await lock.assertOwnership()
        return true
      },
      async release() { return release() }
    }

    return {
      dir: authDir,
      state,
      creds,
      get saveCreds() { return state.saveCreds },
      get backup() { return state.backup },
      get clearAndReinitialize() { return state.clearAndReinitialize },
      get assertOwned() { return state.assertOwned },
      get creds() { return state.creds },
      release
    }
  } catch (error) {
    try { await lock.release() } catch {}
    throw error
  }
}
