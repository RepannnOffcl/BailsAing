import test from 'node:test'
import assert from 'node:assert/strict'
import { generateX25519KeyPair } from '../src/protocol/crypto/noise.js'
import { x25519PrivateToMontgomeryPublic, x25519PrivateToEdwardsPublic, xeddsaSign, xeddsaVerify, convertX25519PublicToEdwards } from '../src/protocol/crypto/xed25519.js'

test('X25519 raw private conversion matches Node-generated public key', () => {
  const pair = generateX25519KeyPair()
  assert.deepEqual(x25519PrivateToMontgomeryPublic(pair.privateKey), pair.publicKey)
})

test('XEdDSA-style signature primitives are internally self-consistent', () => {
  const pair = generateX25519KeyPair()
  const msg = Buffer.from('baileys-signature-test')
  const edPub = x25519PrivateToEdwardsPublic(pair.privateKey)
  const sig = xeddsaSign(pair.privateKey, msg)
  assert.equal(sig.length, 64)
  assert.equal(xeddsaVerify(edPub, msg, sig), true)
  assert.equal(xeddsaVerify(edPub, Buffer.from('tampered'), sig), false)
  assert.equal(convertX25519PublicToEdwards(pair.publicKey)[1] > 0n, true)
})

test('companion registration material persists and reloads', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { createPersistentAuthState } = await import('../src/auth/state.js')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-companion-'))
  const first = await createPersistentAuthState(null, dir)
  const identity = first.creds.companion.identityKey.publicKey
  const signed = first.creds.companion.signedPreKey.publicKey
  const registrationId = first.creds.companion.registrationId
  await first.release()
  const second = await createPersistentAuthState(null, dir)
  try {
    assert.equal(second.creds.companion.identityKey.publicKey, identity)
    assert.equal(second.creds.companion.signedPreKey.publicKey, signed)
    assert.equal(second.creds.companion.registrationId, registrationId)
    assert.equal(Buffer.from(second.creds.companion.signedPreKey.signature, 'base64').length, 64)
  } finally {
    await second.release()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('companion keeps identity, rotates expired signed prekey, and replenishes prekeys', async () => {
  const { createCompanionKeys } = await import('../src/auth/companion.js')
  const now = Date.now()
  const first = createCompanionKeys({}, { now, preKeyCount: 8 })
  const rotated = createCompanionKeys(first, { now: now + 8 * 24 * 60 * 60 * 1000, preKeyCount: 8 })
  assert.equal(rotated.identityKey.publicKey, first.identityKey.publicKey)
  assert.notEqual(rotated.signedPreKey.publicKey, first.signedPreKey.publicKey)
  assert.equal(rotated.preKeys.length, 8)
  assert.equal(Buffer.from(rotated.preKeys[0].privateKey, 'base64').length, 32)
})

test('pre-key can be consumed once and pool replenished', async () => {
  const { createCompanionKeys, takePreKey, replenishPreKeys } = await import('../src/auth/companion.js')
  const creds = createCompanionKeys({}, { preKeyCount: 4 })
  const wanted = creds.preKeys[1].id
  const first = takePreKey(creds, wanted)
  assert.equal(first.id, wanted)
  assert.equal(takePreKey(creds, wanted), null)
  assert.equal(creds.preKeys.length, 3)
  replenishPreKeys(creds, 4)
  assert.equal(creds.preKeys.length, 4)
})
