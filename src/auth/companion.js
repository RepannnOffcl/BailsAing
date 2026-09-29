import crypto from 'node:crypto'
import { generateX25519KeyPair } from '../protocol/crypto/noise.js'
import { xeddsaSign } from '../protocol/crypto/xed25519.js'

const DEFAULT_SIGNED_PREKEY_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const DEFAULT_PREKEY_COUNT = 50
const MAX_PREKEY_ID = 0x7fffffff

function b64(value) {
  return Buffer.from(value).toString('base64')
}

function bytes(value, label = 'key') {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'base64')
  throw new TypeError(`${label} harus bytes/base64`)
}

function randomRegistrationId() {
  return crypto.randomInt(1, 16380)
}

function nextPreKeyId(preKeys = []) {
  const max = preKeys.reduce((highest, item) => Math.max(highest, Number(item?.id) || 0), 0)
  return max >= MAX_PREKEY_ID ? 1 : Math.max(1, max + 1)
}

function makePreKey(id) {
  const pair = generateX25519KeyPair()
  return {
    id: Number(id),
    privateKey: b64(pair.privateKey),
    publicKey: b64(pair.publicKey),
    createdAt: Date.now()
  }
}

function normalizeIdentity(previous) {
  const old = previous?.identityKey
  if (old?.privateKey && old?.publicKey) {
    const privateKey = bytes(old.privateKey, 'identity privateKey')
    const publicKey = bytes(old.publicKey, 'identity publicKey')
    if (privateKey.length === 32 && publicKey.length === 32) {
      return { privateKey: b64(privateKey), publicKey: b64(publicKey) }
    }
  }
  const pair = generateX25519KeyPair()
  return { privateKey: b64(pair.privateKey), publicKey: b64(pair.publicKey) }
}

function normalizeSignedPreKey(previous, identityPrivate, now, maxAge) {
  const old = previous?.signedPreKey
  if (old?.privateKey && old?.publicKey && old?.signature && old?.id != null) {
    const createdAt = Number(old.createdAt ?? 0)
    if (createdAt > 0 && now - createdAt < maxAge) {
      const privateKey = bytes(old.privateKey)
      const publicKey = bytes(old.publicKey)
      const signature = bytes(old.signature)
      if (privateKey.length === 32 && publicKey.length === 32 && signature.length === 64) {
        return {
          id: Number(old.id),
          privateKey: b64(privateKey),
          publicKey: b64(publicKey),
          signature: b64(signature),
          createdAt
        }
      }
    }
  }

  const pair = generateX25519KeyPair()
  const signature = xeddsaSign(Buffer.from(identityPrivate, 'base64'), pair.publicKey)
  return {
    id: Number(old?.id ?? 0) + 1 || 1,
    privateKey: b64(pair.privateKey),
    publicKey: b64(pair.publicKey),
    signature: b64(signature),
    createdAt: now
  }
}

export function createCompanionKeys(previous = {}, options = {}) {
  const now = Number(options.now ?? Date.now())
  const maxAge = Math.max(60_000, Number(options.signedPreKeyMaxAgeMs ?? DEFAULT_SIGNED_PREKEY_MAX_AGE))
  const targetCount = Math.max(1, Math.floor(Number(options.preKeyCount ?? DEFAULT_PREKEY_COUNT)))
  const identityKey = normalizeIdentity(previous)
  const signedPreKey = normalizeSignedPreKey(previous, identityKey.privateKey, now, maxAge)

  const preserved = Array.isArray(previous?.preKeys) ? previous.preKeys
    .map(item => {
      try {
        const privateKey = bytes(item.privateKey)
        const publicKey = bytes(item.publicKey)
        const id = Number(item.id)
        if (!Number.isInteger(id) || id < 1 || privateKey.length !== 32 || publicKey.length !== 32) return null
        return { id, privateKey: b64(privateKey), publicKey: b64(publicKey), createdAt: Number(item.createdAt ?? now) }
      } catch {
        return null
      }
    })
    .filter(Boolean) : []

  const used = new Set(preserved.map(item => item.id))
  let cursor = nextPreKeyId(preserved)
  while (preserved.length < targetCount) {
    while (used.has(cursor)) cursor = cursor >= MAX_PREKEY_ID ? 1 : cursor + 1
    preserved.push(makePreKey(cursor))
    used.add(cursor)
    cursor = cursor >= MAX_PREKEY_ID ? 1 : cursor + 1
  }

  return {
    version: 1,
    registrationId: Number(previous?.registrationId) > 0 ? Number(previous.registrationId) : randomRegistrationId(),
    identityKey,
    signedPreKey,
    preKeys: preserved,
    advSecretKey: typeof previous?.advSecretKey === 'string' ? previous.advSecretKey : b64(crypto.randomBytes(32)),
    clientType: previous?.clientType ?? 'web',
    createdAt: Number(previous?.createdAt ?? now),
    updatedAt: now
  }
}

export function takePreKey(creds, requestedId = null) {
  if (!creds || !Array.isArray(creds.preKeys)) return null
  const index = requestedId == null
    ? 0
    : creds.preKeys.findIndex(item => Number(item.id) === Number(requestedId))
  if (index < 0 || !creds.preKeys[index]) return null
  const [selected] = creds.preKeys.splice(index, 1)
  creds.updatedAt = Date.now()
  return selected
}

export function replenishPreKeys(creds, targetCount = DEFAULT_PREKEY_COUNT) {
  if (!creds || typeof creds !== 'object') throw new TypeError('Companion credentials harus object')
  const target = Math.max(1, Math.floor(Number(targetCount) || DEFAULT_PREKEY_COUNT))
  if (!Array.isArray(creds.preKeys)) creds.preKeys = []
  const used = new Set(creds.preKeys.map(item => Number(item?.id)).filter(Number.isInteger))
  let cursor = nextPreKeyId(creds.preKeys)
  while (creds.preKeys.length < target) {
    while (used.has(cursor)) cursor = cursor >= MAX_PREKEY_ID ? 1 : cursor + 1
    creds.preKeys.push(makePreKey(cursor))
    used.add(cursor)
    cursor = cursor >= MAX_PREKEY_ID ? 1 : cursor + 1
  }
  creds.updatedAt = Date.now()
  return creds
}

export function decodeCompanionKeys(companion = {}) {
  if (!companion || typeof companion !== 'object') return {}
  const out = {
    registrationId: Number(companion.registrationId ?? 0),
    identityKey: null,
    signedPreKey: null,
    preKeys: [],
    advSecretKey: null,
    clientType: companion.clientType ?? 'web'
  }

  try {
    if (companion.identityKey?.privateKey && companion.identityKey?.publicKey) {
      out.identityKey = {
        privateKey: bytes(companion.identityKey.privateKey, 'identity privateKey'),
        publicKey: bytes(companion.identityKey.publicKey, 'identity publicKey')
      }
    }
    if (companion.signedPreKey?.privateKey && companion.signedPreKey?.publicKey) {
      out.signedPreKey = {
        id: Number(companion.signedPreKey.id ?? 0),
        privateKey: bytes(companion.signedPreKey.privateKey, 'signed pre-key privateKey'),
        publicKey: bytes(companion.signedPreKey.publicKey, 'signed pre-key publicKey'),
        signature: companion.signedPreKey.signature ? bytes(companion.signedPreKey.signature, 'signed pre-key signature') : null
      }
    }
    if (Array.isArray(companion.preKeys)) {
      out.preKeys = companion.preKeys.map(item => ({
        id: Number(item.id),
        privateKey: bytes(item.privateKey),
        publicKey: bytes(item.publicKey)
      }))
    }
    if (companion.advSecretKey) out.advSecretKey = bytes(companion.advSecretKey, 'advSecretKey')
  } catch (error) {
    throw new TypeError(`Companion credentials rusak: ${error.message}`)
  }
  return out
}
