import crypto from 'node:crypto'

const MEDIA_INFO = Object.freeze({
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
  sticker: 'WhatsApp Image Keys'
})

function asBuffer(value, name = 'value') {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'base64')
  throw new TypeError(`${name} harus Buffer, Uint8Array, atau base64`)
}

export function normalizeMediaType(type) {
  const value = String(type ?? '').toLowerCase()
  if (!MEDIA_INFO[value]) throw new TypeError(`Media type tidak didukung: ${value}`)
  return value
}

export function generateMediaKey(randomBytes = crypto.randomBytes) {
  const key = Buffer.from(randomBytes(32))
  if (key.length !== 32) throw new Error('Media key generator harus menghasilkan 32 byte')
  return key
}

export function deriveMediaKeys(mediaKey, mediaType = 'image', options = {}) {
  const key = asBuffer(mediaKey, 'mediaKey')
  if (key.length !== 32) throw new TypeError('mediaKey harus tepat 32 byte')
  const type = normalizeMediaType(mediaType)
  const salt = options.salt == null ? Buffer.alloc(32) : asBuffer(options.salt, 'salt')
  const info = Buffer.from(options.info ?? MEDIA_INFO[type], 'utf8')
  const expanded = Buffer.from(crypto.hkdfSync('sha256', key, salt, info, 112))
  return {
    mediaType: type,
    mediaKey: key,
    iv: expanded.subarray(0, 16),
    cipherKey: expanded.subarray(16, 48),
    macKey: expanded.subarray(48, 80),
    refKey: expanded.subarray(80, 112)
  }
}

export function encryptMedia(plaintext, options = {}) {
  const input = asBuffer(plaintext, 'plaintext')
  const mediaType = normalizeMediaType(options.mediaType ?? 'image')
  const mediaKey = options.mediaKey ? asBuffer(options.mediaKey, 'mediaKey') : generateMediaKey()
  const keys = deriveMediaKeys(mediaKey, mediaType, options)
  const cipher = crypto.createCipheriv('aes-256-cbc', keys.cipherKey, keys.iv)
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()])
  const mac = crypto.createHmac('sha256', keys.macKey).update(keys.iv).update(ciphertext).digest()
  const encrypted = Buffer.concat([ciphertext, mac])
  return {
    mediaType,
    mediaKey,
    iv: keys.iv,
    encrypted,
    fileSha256: crypto.createHash('sha256').update(input).digest(),
    fileEncSha256: crypto.createHash('sha256').update(encrypted).digest(),
    fileLength: input.length,
    encryptedLength: encrypted.length,
    refKey: keys.refKey
  }
}

export function decryptMedia(encrypted, options = {}) {
  const payload = asBuffer(encrypted, 'encrypted')
  if (payload.length < 32) throw new Error('Encrypted media terlalu pendek untuk MAC')
  const mediaType = normalizeMediaType(options.mediaType ?? 'image')
  const mediaKey = asBuffer(options.mediaKey, 'mediaKey')
  const keys = deriveMediaKeys(mediaKey, mediaType, options)
  const ciphertext = payload.subarray(0, -32)
  const receivedMac = payload.subarray(-32)
  const expectedMac = crypto.createHmac('sha256', keys.macKey).update(keys.iv).update(ciphertext).digest()
  if (receivedMac.length !== expectedMac.length || !crypto.timingSafeEqual(receivedMac, expectedMac)) {
    throw new Error('Media MAC tidak valid')
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', keys.cipherKey, keys.iv)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const result = { plaintext, fileSha256: crypto.createHash('sha256').update(plaintext).digest(), fileLength: plaintext.length }
  if (options.expectedFileSha256) {
    const expected = asBuffer(options.expectedFileSha256, 'expectedFileSha256')
    if (expected.length !== result.fileSha256.length || !crypto.timingSafeEqual(expected, result.fileSha256)) throw new Error('Media plaintext SHA-256 tidak cocok')
  }
  return result
}

export async function downloadAndDecryptMedia(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl tidak tersedia')
  const response = await fetchImpl(url, { headers: options.headers })
  if (!response.ok) throw new Error(`Media download gagal: HTTP ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  return decryptMedia(body, options)
}

export function mediaUploadDescriptor(encryptedResult, uploadResult = {}) {
  if (!encryptedResult?.mediaKey || !encryptedResult?.fileSha256 || !encryptedResult?.fileEncSha256) throw new TypeError('encryptMedia result tidak lengkap')
  return {
    mediaKey: Buffer.from(encryptedResult.mediaKey),
    fileSha256: Buffer.from(encryptedResult.fileSha256),
    fileEncSha256: Buffer.from(encryptedResult.fileEncSha256),
    fileLength: encryptedResult.fileLength,
    ...uploadResult
  }
}

export const MEDIA_KEY_INFO = MEDIA_INFO
