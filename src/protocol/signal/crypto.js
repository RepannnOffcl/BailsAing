import crypto from 'node:crypto'
import { hkdfExtract, hkdfExpand, sha256, x25519 } from '../crypto/noise.js'

const ZERO = Buffer.alloc(32)
const ENC_INFO = Buffer.from('Baileys-Signal-Message-v1')
const ROOT_INFO = Buffer.from('Baileys-Signal-Root-v1')

export function hmacSha256(key, data) {
  return crypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(data)).digest()
}

export function deriveInitialRoot(sharedMaterial, transcript = Buffer.alloc(0)) {
  const prk = hkdfExtract(ZERO, Buffer.concat([Buffer.from(sharedMaterial), sha256(Buffer.from(transcript))]))
  return hkdfExpand(prk, ROOT_INFO, 32)
}

export function kdfRoot(rootKey, dhOutput) {
  const prk = hkdfExtract(rootKey, dhOutput)
  const out = hkdfExpand(prk, ROOT_INFO, 96)
  return {
    rootKey: out.subarray(0, 32),
    chainA: out.subarray(32, 64),
    chainB: out.subarray(64, 96)
  }
}

export function kdfChain(chainKey) {
  const next = hmacSha256(chainKey, Buffer.from([0x01]))
  const messageKey = hmacSha256(chainKey, Buffer.from([0x02]))
  return { chainKey: next, messageKey }
}

function padPkcs7(data, blockSize = 16) {
  const input = Buffer.from(data)
  const padding = blockSize - (input.length % blockSize)
  return Buffer.concat([input, Buffer.alloc(padding, padding)])
}

function unpadPkcs7(data, blockSize = 16) {
  const input = Buffer.from(data)
  if (!input.length || input.length % blockSize !== 0) throw new Error('Signal plaintext padding invalid')
  const n = input[input.length - 1]
  if (!n || n > blockSize || n > input.length) throw new Error('Signal plaintext padding invalid')
  for (let i = input.length - n; i < input.length; i++) if (input[i] !== n) throw new Error('Signal plaintext padding invalid')
  return input.subarray(0, input.length - n)
}

export function encryptMessageKey(messageKey, plaintext, associatedData = Buffer.alloc(0)) {
  const mk = Buffer.from(messageKey)
  if (mk.length !== 32) throw new RangeError('Signal message key harus 32 byte')
  const keyMaterial = hkdfExpand(hkdfExtract(ZERO, mk), ENC_INFO, 80)
  const cipherKey = keyMaterial.subarray(0, 32)
  const iv = keyMaterial.subarray(32, 48)
  const macKey = keyMaterial.subarray(48, 80)
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv)
  const ciphertext = Buffer.concat([cipher.update(padPkcs7(plaintext)), cipher.final()])
  const mac = hmacSha256(macKey, Buffer.concat([Buffer.from(associatedData), ciphertext])).subarray(0, 32)
  return { ciphertext, mac }
}

export function decryptMessageKey(messageKey, ciphertext, mac, associatedData = Buffer.alloc(0)) {
  const mk = Buffer.from(messageKey)
  if (mk.length !== 32) throw new RangeError('Signal message key harus 32 byte')
  const keyMaterial = hkdfExpand(hkdfExtract(ZERO, mk), ENC_INFO, 80)
  const cipherKey = keyMaterial.subarray(0, 32)
  const iv = keyMaterial.subarray(32, 48)
  const macKey = keyMaterial.subarray(48, 80)
  const expected = hmacSha256(macKey, Buffer.concat([Buffer.from(associatedData), Buffer.from(ciphertext)])).subarray(0, 32)
  const received = Buffer.from(mac)
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) throw new Error('Signal message MAC invalid')
  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv)
  const padded = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()])
  return unpadPkcs7(padded)
}

export function deriveX3DHMaterial({
  initiatorIdentityPrivate,
  initiatorEphemeralPrivate,
  responderIdentityPublic,
  responderSignedPreKeyPublic,
  responderOneTimePreKeyPublic = null
}) {
  const parts = [
    x25519(initiatorIdentityPrivate, responderSignedPreKeyPublic),
    x25519(initiatorEphemeralPrivate, responderIdentityPublic),
    x25519(initiatorEphemeralPrivate, responderSignedPreKeyPublic)
  ]
  if (responderOneTimePreKeyPublic) parts.push(x25519(initiatorEphemeralPrivate, responderOneTimePreKeyPublic))
  return Buffer.concat(parts)
}

export function deriveX3DHResponderMaterial({
  responderIdentityPrivate,
  responderSignedPreKeyPrivate,
  responderOneTimePreKeyPrivate = null,
  initiatorIdentityPublic,
  initiatorEphemeralPublic
}) {
  const parts = [
    x25519(responderSignedPreKeyPrivate, initiatorIdentityPublic),
    x25519(responderIdentityPrivate, initiatorEphemeralPublic),
    x25519(responderSignedPreKeyPrivate, initiatorEphemeralPublic)
  ]
  if (responderOneTimePreKeyPrivate) parts.push(x25519(responderOneTimePreKeyPrivate, initiatorEphemeralPublic))
  return Buffer.concat(parts)
}

export function deriveDirectionalChains(rootKey, firstDH, role = 'initiator') {
  const { rootKey: rk, chainA, chainB } = kdfRoot(rootKey, firstDH)
  const send = role === 'initiator' ? chainA : chainB
  const recv = role === 'initiator' ? chainB : chainA
  return { rootKey: rk, sendChainKey: send, recvChainKey: recv }
}
