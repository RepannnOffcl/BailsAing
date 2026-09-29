import crypto from 'node:crypto'

export const NOISE_PROTOCOL = 'Noise_XX_25519_AESGCM_SHA256'
export const NOISE_START = Buffer.from(`${NOISE_PROTOCOL}\0\0\0\0`, 'ascii')
export const WA_ORIGIN = 'https://web.whatsapp.com'
export const WA_URL = 'wss://web.whatsapp.com/ws/chat'

const EMPTY = Buffer.alloc(0)

function b64u(buf) { return Buffer.from(buf).toString('base64url') }
function rawPublic(key) { return Buffer.from(key.export({ format: 'jwk' }).x, 'base64url') }
function rawPrivate(key) { return Buffer.from(key.export({ format: 'jwk' }).d, 'base64url') }
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

function x25519FromRawPrivate(raw) {
  if (raw.length !== 32) throw new RangeError('X25519 private key harus 32 byte')
  return crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, Buffer.from(raw)]), format: 'der', type: 'pkcs8' })
}
function x25519FromRawPublic(raw) {
  if (raw.length !== 32) throw new RangeError('X25519 public key harus 32 byte')
  return crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(raw)]), format: 'der', type: 'spki' })
}

export function generateX25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  return { publicKey: rawPublic(publicKey), privateKey: rawPrivate(privateKey) }
}

export function deriveX25519Public(privateRaw) {
  return rawPublic(crypto.createPublicKey(x25519FromRawPrivate(Buffer.from(privateRaw))))
}

export function x25519(privateRaw, publicRaw) {
  return crypto.diffieHellman({
    privateKey: x25519FromRawPrivate(Buffer.from(privateRaw)),
    publicKey: x25519FromRawPublic(Buffer.from(publicRaw))
  })
}

export function sha256(data) { return crypto.createHash('sha256').update(data).digest() }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest() }
export function hkdfExtract(salt, ikm) { return hmac(salt, Buffer.from(ikm)) }
export function hkdfExpand(prk, info, length) {
  const blocks = []
  let prev = EMPTY
  for (let i = 1; Buffer.concat(blocks).length < length; i++) {
    prev = hmac(prk, Buffer.concat([prev, Buffer.from(info), Buffer.from([i])]))
    blocks.push(prev)
  }
  return Buffer.concat(blocks).subarray(0, length)
}

function nonceBuffer(n) {
  if (Buffer.isBuffer(n) || n instanceof Uint8Array) {
    const raw = Buffer.from(n)
    if (raw.length !== 12) throw new RangeError('Nonce AES-GCM harus 12 byte')
    return raw
  }
  const b = Buffer.alloc(12)
  const low = BigInt(n)
  b.writeUInt32BE(Number((low >> 32n) & 0xffffffffn), 4)
  b.writeUInt32BE(Number(low & 0xffffffffn), 8)
  return b
}

export function aeadEncrypt(key, nonce, plaintext, aad = EMPTY) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonceBuffer(nonce))
  cipher.setAAD(Buffer.from(aad))
  return Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final(), cipher.getAuthTag()])
}

export function aeadDecrypt(key, nonce, ciphertext, aad = EMPTY) {
  if (ciphertext.length < 16) throw new Error('Noise ciphertext terlalu pendek')
  const body = ciphertext.subarray(0, -16)
  const tag = ciphertext.subarray(-16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonceBuffer(nonce))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

export class NoiseXXHandshake {
  constructor(prologue = EMPTY) {
    const protocol = Buffer.from(NOISE_PROTOCOL, 'ascii')
    const h = protocol.length <= 32 ? Buffer.concat([protocol, Buffer.alloc(32 - protocol.length)]) : sha256(protocol)
    this.h = h
    this.ck = h
    this.k = null
    this.nonce = 0n
    this.prologue = Buffer.from(prologue)
    if (this.prologue.length) this.mixHash(this.prologue)
  }

  authenticate(data) { this.mixHash(Buffer.from(data)); return this }
  mixHash(data) { this.h = sha256(Buffer.concat([this.h, Buffer.from(data)])); return this }

  mixKey(ikm) {
    const prk = hkdfExtract(this.ck, Buffer.from(ikm))
    const out = hkdfExpand(prk, EMPTY, 64)
    this.ck = out.subarray(0, 32)
    this.k = out.subarray(32, 64)
    this.nonce = 0n
    return this
  }

  encrypt(plaintext) {
    if (!this.k) throw new Error('Noise cipher key belum tersedia')
    const out = aeadEncrypt(this.k, this.nonce, plaintext, this.h)
    this.nonce += 1n
    this.mixHash(out)
    return out
  }

  decrypt(ciphertext) {
    if (!this.k) throw new Error('Noise cipher key belum tersedia')
    const out = aeadDecrypt(this.k, this.nonce, Buffer.from(ciphertext), this.h)
    this.nonce += 1n
    this.mixHash(ciphertext)
    return out
  }

  mixDH(privateRaw, publicRaw) { return this.mixKey(x25519(privateRaw, publicRaw)) }

  split() {
    const prk = hkdfExtract(this.ck, EMPTY)
    const out = hkdfExpand(prk, EMPTY, 64)
    return { writeKey: out.subarray(0, 32), readKey: out.subarray(32, 64) }
  }

  finishTransport(serverSide = false) {
    const keys = this.split()
    return serverSide
      ? new NoiseTransportCipher(keys.readKey, keys.writeKey, this.h)
      : new NoiseTransportCipher(keys.writeKey, keys.readKey, this.h)
  }
}

export class NoiseTransportCipher {
  constructor(writeKey, readKey, associatedHash = EMPTY) {
    this.writeKey = Buffer.from(writeKey)
    this.readKey = Buffer.from(readKey)
    this.associatedHash = Buffer.from(associatedHash)
    this.writeNonce = 0n
    this.readNonce = 0n
  }
  encrypt(plaintext) { return aeadEncrypt(this.writeKey, this.writeNonce++, plaintext, EMPTY) }
  decrypt(ciphertext) { return aeadDecrypt(this.readKey, this.readNonce++, ciphertext, EMPTY) }
}
