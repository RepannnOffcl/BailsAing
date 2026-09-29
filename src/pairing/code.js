import crypto from 'node:crypto'
import { createIq, createNodeId } from '../protocol/wire/binary-node.js'
import { generateX25519KeyPair, hkdfExtract, hkdfExpand, x25519, aeadEncrypt } from '../protocol/crypto/noise.js'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const PAIRING_PBKDF2_ITERATIONS = 131072
const PAIRING_KEY_INFO = 'pairing-code-key'

export function normalizePairingPhone(value) {
  const phone = String(value ?? '').replace(/\D/g, '')
  if (phone.length < 8 || phone.length > 15) throw new TypeError('Nomor pairing harus 8-15 digit.')
  return phone
}

export function normalizeCustomPairingCode(value) {
  if (value == null || value === '') return null
  const code = String(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (code.length !== 8) throw new TypeError('Custom pairing code harus tepat 8 karakter alfanumerik.')
  return code
}

export function generatePairingCode(bytes = 5) {
  const raw = crypto.randomBytes(bytes)
  let value = 0n
  for (const byte of raw) value = (value << 8n) | BigInt(byte)
  let out = ''
  while (value > 0n) {
    out = CROCKFORD[Number(value & 31n)] + out
    value >>= 5n
  }
  return out.padStart(Math.ceil(bytes * 8 / 5), '0').slice(0, 8)
}

export function generatePairingEphemeralKeyPair() {
  return generateX25519KeyPair()
}

export function derivePairingCodeKey(pairingCode, salt) {
  const code = String(pairingCode ?? '')
  const saltBuffer = Buffer.from(salt)
  if (!code) throw new TypeError('Pairing code kosong')
  if (saltBuffer.length !== 32) throw new RangeError('Pairing salt harus 32 byte')
  // PBKDF2 is the current Web pairing-code KDF. The protocol uses the fixed
  // iteration count below; PAIRING_KEY_INFO exists as an explicit identifier
  // for diagnostics and future protocol versions.
  void PAIRING_KEY_INFO
  return crypto.pbkdf2Sync(Buffer.from(code, 'utf8'), saltBuffer, PAIRING_PBKDF2_ITERATIONS, 32, 'sha256')
}

export function aesCtrEncrypt(plaintext, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-ctr', Buffer.from(key), Buffer.from(iv))
  return Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
}

export function aesCtrDecrypt(ciphertext, key, iv) {
  const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(key), Buffer.from(iv))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()])
}

export function wrapPairingEphemeralPublic(pairingCode, publicKey) {
  const pub = Buffer.from(publicKey)
  if (pub.length !== 32) throw new RangeError('Pairing ephemeral public key harus 32 byte')
  const salt = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const key = derivePairingCodeKey(pairingCode, salt)
  return Buffer.concat([salt, iv, aesCtrEncrypt(pub, key, iv)])
}

export function unwrapPairingEphemeralPublic(pairingCode, wrapped) {
  const buffer = Buffer.from(wrapped)
  if (buffer.length < 80) throw new RangeError('Wrapped pairing ephemeral public key terlalu pendek')
  const salt = buffer.subarray(0, 32)
  const iv = buffer.subarray(32, 48)
  const ciphertext = buffer.subarray(48)
  const plain = aesCtrDecrypt(ciphertext, derivePairingCodeKey(pairingCode, salt), iv)
  if (plain.length !== 32) throw new Error('Pairing ephemeral public key hasil decrypt invalid')
  return plain
}

export function buildPairingCodeRequest({
  phoneNumber,
  pairingCode,
  customCode,
  pairingEphemeralPublicKey,
  noisePublicKey,
  platformId = '1',
  platformDisplay = 'Chrome (RepanXTEnka)',
  nonce = '0',
  shouldShowPushNotification = 'true',
  id = createNodeId('pair'),
} = {}) {
  const phone = normalizePairingPhone(phoneNumber)
  const code = normalizeCustomPairingCode(pairingCode ?? customCode) ?? String(pairingCode ?? customCode ?? '')
  if (code.length !== 8) throw new TypeError('Pairing code harus 8 karakter')
  const wrapped = pairingEphemeralPublicKey
    ? wrapPairingEphemeralPublic(code, pairingEphemeralPublicKey)
    : null
  const useLegacyMock = !pairingEphemeralPublicKey && customCode != null
  const noise = noisePublicKey == null ? Buffer.alloc(32) : Buffer.from(noisePublicKey)
  if (noise.length !== 32) throw new RangeError('Noise public key harus 32 byte')
  return createIq({
    id,
    to: 's.whatsapp.net',
    type: 'set',
    xmlns: 'md',
    content: [{
      tag: 'link_code_companion_reg',
      attrs: {
        jid: `${phone}@s.whatsapp.net`,
        stage: 'companion_hello',
        should_show_push_notification: shouldShowPushNotification
      },
      content: [
        ...(wrapped
          ? [{ tag: 'link_code_pairing_wrapped_companion_ephemeral_pub', attrs: {}, content: wrapped }]
          : useLegacyMock ? [{ tag: 'link_code_pairing', attrs: { code } }] : []),
        { tag: 'companion_server_auth_key_pub', attrs: {}, content: noise },
        { tag: 'companion_platform_id', attrs: {}, content: String(platformId) },
        { tag: 'companion_platform_display', attrs: {}, content: String(platformDisplay) },
        { tag: 'link_code_pairing_nonce', attrs: {}, content: String(nonce) }
      ]
    }]
  })
}

function textContent(node) {
  if (!node) return ''
  if (Buffer.isBuffer(node.content)) return node.content.toString('utf8')
  if (typeof node.content === 'string') return node.content
  return ''
}

export function findPairingNode(node) {
  if (!node) return null
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()
    if (current?.tag === 'link_code_companion_reg') return current
    if (Array.isArray(current?.content)) for (const child of current.content) stack.push(child)
  }
  return null
}

export function getNodeBuffer(node, tag) {
  const root = node?.tag === 'link_code_companion_reg' ? node : findPairingNode(node)
  if (!root || !Array.isArray(root.content)) return null
  const child = root.content.find(item => item?.tag === tag)
  return Buffer.isBuffer(child?.content) ? Buffer.from(child.content) : null
}

export function parsePairingCodeNode(node) {
  // Server-side pairing-code flow does not normally return the code: the
  // companion generates it locally and submits it in encrypted form. This
  // parser remains useful for compatibility with older/mocked servers.
  const found = []
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
    if (current.tag === 'link_code_pairing' || current.tag === 'pairing-code' || current.tag === 'pairing_code') {
      const direct = current.attrs?.code ?? current.attrs?.value
      if (direct) found.push(String(direct))
      const text = textContent(current).trim()
      if (text) found.push(text)
    }
    if (current.attrs?.pairingCode) found.push(String(current.attrs.pairingCode))
    if (Array.isArray(current.content)) for (const child of current.content) stack.push(child)
  }
  const code = found.find(value => value.replace(/[^A-Za-z0-9]/g, '').length >= 4)
  return code ? code.replace(/\s+/g, '').toUpperCase() : null
}

export function parsePairingHelloResponse(node) {
  const root = findPairingNode(node)
  if (!root) return null
  const refBuffer = getNodeBuffer(root, 'link_code_pairing_ref')
  return {
    stage: root.attrs?.stage ?? null,
    // Pairing references are opaque bytes on the wire. Base64url keeps them
    // lossless while remaining safe for auth JSON/events.
    ref: refBuffer ? refBuffer.toString('base64url') : null,
    refBuffer,
    node: root
  }
}

export function buildCompanionFinishRequest({
  pairingCode,
  pairingEphemeralPrivateKey,
  wrappedPrimaryEphemeralPublic,
  primaryIdentityPublic,
  companionIdentityPrivateKey,
  companionIdentityPublicKey,
  meId,
  ref,
  id = createNodeId('pair-finish')
} = {}) {
  const code = normalizeCustomPairingCode(pairingCode)
  const pairingPrivate = Buffer.from(pairingEphemeralPrivateKey ?? [])
  const wrapped = Buffer.from(wrappedPrimaryEphemeralPublic ?? [])
  const primaryIdentity = Buffer.from(primaryIdentityPublic ?? [])
  const identityPrivate = Buffer.from(companionIdentityPrivateKey ?? [])
  const identityPublic = Buffer.from(companionIdentityPublicKey ?? [])
  const refBuffer = Buffer.isBuffer(ref) ? Buffer.from(ref) : Buffer.from(String(ref ?? ''), 'base64url')
  if (!code) throw new TypeError('Pairing code wajib 8 karakter')
  if (pairingPrivate.length !== 32) throw new RangeError('Pairing ephemeral private key harus 32 byte')
  if (wrapped.length < 80) throw new RangeError('Wrapped primary ephemeral public key terlalu pendek')
  if (primaryIdentity.length !== 32) throw new RangeError('Primary identity public key harus 32 byte')
  if (identityPrivate.length !== 32 || identityPublic.length !== 32) throw new RangeError('Companion identity key harus 32 byte')
  if (!refBuffer.length) throw new RangeError('Pairing reference kosong')

  const primaryEphemeralPublic = unwrapPairingEphemeralPublic(code, wrapped)
  const companionSharedKey = x25519(pairingPrivate, primaryEphemeralPublic)
  const random = crypto.randomBytes(32)
  const salt = crypto.randomBytes(32)
  const nonce = crypto.randomBytes(12)
  const bundleKey = hkdfExpand(
    hkdfExtract(salt, companionSharedKey),
    Buffer.from('link_code_pairing_key_bundle_encryption_key'),
    32
  )
  const plaintext = Buffer.concat([identityPublic, primaryIdentity, random])
  const encrypted = aeadEncrypt(bundleKey, nonce, plaintext, Buffer.alloc(0))
  const wrappedBundle = Buffer.concat([salt, nonce, encrypted])
  const identitySharedKey = x25519(identityPrivate, primaryIdentity)
  const advSecretKey = hkdfExpand(
    hkdfExtract(Buffer.alloc(32), Buffer.concat([companionSharedKey, identitySharedKey, random])),
    Buffer.from('adv_secret'),
    32
  )

  const request = {
    tag: 'iq',
    attrs: { to: 's.whatsapp.net', type: 'set', id, xmlns: 'md' },
    content: [{
      tag: 'link_code_companion_reg',
      attrs: { jid: meId, stage: 'companion_finish' },
      content: [
        { tag: 'link_code_pairing_wrapped_key_bundle', attrs: {}, content: wrappedBundle },
        { tag: 'companion_identity_public', attrs: {}, content: identityPublic },
        { tag: 'link_code_pairing_ref', attrs: {}, content: refBuffer }
      ]
    }]
  }
  return { request, advSecretKey, refBuffer, wrappedBundle }
}

export const PAIRING_CODE_CONSTANTS = Object.freeze({
  pbkdf2Iterations: PAIRING_PBKDF2_ITERATIONS,
  defaultBytes: 5,
  defaultLength: 8
})
