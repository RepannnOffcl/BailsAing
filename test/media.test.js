import test from 'node:test'
import assert from 'node:assert/strict'
import { decryptMedia, deriveMediaKeys, encryptMedia, generateMediaKey, mediaUploadDescriptor, normalizeMediaType } from '../src/media/crypto.js'

test('media key derivation is deterministic and typed', () => {
  const key = Buffer.alloc(32, 7)
  const a = deriveMediaKeys(key, 'image')
  const b = deriveMediaKeys(key, 'image')
  assert.deepEqual(a.iv, b.iv)
  assert.deepEqual(a.cipherKey, b.cipherKey)
  assert.equal(a.cipherKey.length, 32)
  assert.equal(a.macKey.length, 32)
  assert.equal(a.refKey.length, 32)
  assert.equal(normalizeMediaType('sticker'), 'sticker')
})

test('media encrypt/decrypt roundtrip verifies hashes and MAC', () => {
  const plaintext = Buffer.from('RepanOffcl Baileys media test'.repeat(50))
  const mediaKey = generateMediaKey(() => Buffer.alloc(32, 9))
  const encrypted = encryptMedia(plaintext, { mediaType: 'video', mediaKey })
  assert.equal(encrypted.fileLength, plaintext.length)
  assert.notDeepEqual(encrypted.encrypted, plaintext)
  const decoded = decryptMedia(encrypted.encrypted, { mediaType: 'video', mediaKey, expectedFileSha256: encrypted.fileSha256 })
  assert.deepEqual(decoded.plaintext, plaintext)
  assert.deepEqual(mediaUploadDescriptor(encrypted, { url: 'https://example.invalid/media' }).url, 'https://example.invalid/media')
})

test('media MAC tampering is rejected', () => {
  const encrypted = encryptMedia(Buffer.from('x'), { mediaType: 'image', mediaKey: Buffer.alloc(32, 1) })
  const tampered = Buffer.from(encrypted.encrypted)
  tampered[tampered.length - 1] ^= 0xff
  assert.throws(() => decryptMedia(tampered, { mediaType: 'image', mediaKey: encrypted.mediaKey }), /MAC tidak valid/)
})
