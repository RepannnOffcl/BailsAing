import test from 'node:test'
import assert from 'node:assert/strict'
import { generateX25519KeyPair } from '../src/protocol/crypto/noise.js'
import { NativeSignalSession } from '../src/protocol/signal/session.js'
import { decodeSignalMessage, encodeSignalMessage, encodePreKeySignalMessage, decodePreKeySignalMessage } from '../src/protocol/signal/envelope.js'
import { createCompanionKeys } from '../src/auth/companion.js'
import { SignalSessionStore } from '../src/protocol/signal/store.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function bundle(creds) {
  return {
    registrationId: creds.registrationId,
    identityKey: creds.identityKey,
    signedPreKey: creds.signedPreKey,
    preKeys: creds.preKeys
  }
}

test('native Signal pre-key session encrypts/decrypts bidirectionally', () => {
  const aliceIdentity = generateX25519KeyPair()
  const bobIdentity = createCompanionKeys({}, { preKeyCount: 4 })
  const b = bundle(bobIdentity)
  const { session: alice, baseKey } = NativeSignalSession.initiatorFromPreKeyBundle({
    initiatorIdentityPrivate: aliceIdentity.privateKey,
    responderBundle: b,
    transcript: Buffer.from('test-transcript')
  })
  const bob = NativeSignalSession.responderFromPreKey({
    responderBundle: b,
    initiatorIdentityPublic: aliceIdentity.publicKey,
    initiatorEphemeralPublic: baseKey.publicKey,
    transcript: Buffer.from('test-transcript')
  }).session

  const first = alice.encrypt(Buffer.from('hello bob'))
  assert.deepEqual(bob.decrypt(first.wire), Buffer.from('hello bob'))
  const reply = bob.encrypt(Buffer.from('hello alice'))
  assert.deepEqual(alice.decrypt(reply.wire), Buffer.from('hello alice'))

  const a2 = alice.encrypt(Buffer.from('second'))
  const a3 = alice.encrypt(Buffer.from('third'))
  assert.deepEqual(bob.decrypt(a3.wire), Buffer.from('third'))
  assert.deepEqual(bob.decrypt(a2.wire), Buffer.from('second'))
})

test('native Signal ratchet changes keys and remains decryptable', () => {
  const aliceIdentity = generateX25519KeyPair()
  const bobIdentity = createCompanionKeys({}, { preKeyCount: 2 })
  const b = bundle(bobIdentity)
  const { session: alice, baseKey } = NativeSignalSession.initiatorFromPreKeyBundle({ initiatorIdentityPrivate: aliceIdentity.privateKey, responderBundle: b })
  const bob = NativeSignalSession.responderFromPreKey({ responderBundle: b, initiatorIdentityPublic: aliceIdentity.publicKey, initiatorEphemeralPublic: baseKey.publicKey }).session

  assert.deepEqual(bob.decrypt(alice.encrypt(Buffer.from('before ratchet')).wire), Buffer.from('before ratchet'))
  const old = alice.DHs?.publicKey
  const next = alice.ratchetSend()
  assert.notDeepEqual(next, old)
  const after = alice.encrypt(Buffer.from('after ratchet'))
  assert.deepEqual(bob.decrypt(after.wire), Buffer.from('after ratchet'))
  const response = bob.encrypt(Buffer.from('ratchet response'))
  assert.deepEqual(alice.decrypt(response.wire), Buffer.from('ratchet response'))
})

test('Signal envelope roundtrip and pre-key envelope roundtrip', () => {
  const envelope = { ratchetKey: Buffer.alloc(32, 1), counter: 9, previousCounter: 2, ciphertext: Buffer.from('cipher'), mac: Buffer.alloc(32, 7) }
  assert.deepEqual(decodeSignalMessage(encodeSignalMessage(envelope)), envelope)
  const pk = { registrationId: 12, preKeyId: 55, signedPreKeyId: 9, baseKey: Buffer.alloc(32, 2), identityKey: Buffer.alloc(32, 3), message: Buffer.from('message') }
  assert.deepEqual(decodePreKeySignalMessage(encodePreKeySignalMessage(pk)), pk)
})

test('Signal session store persists and reloads exact ratchet state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-signal-'))
  try {
    const identity = generateX25519KeyPair()
    const bob = createCompanionKeys({}, { preKeyCount: 2 })
    const { session: alice } = NativeSignalSession.initiatorFromPreKeyBundle({ initiatorIdentityPrivate: identity.privateKey, responderBundle: bundle(bob) })
    const store = new SignalSessionStore(path.join(dir, 'sessions'))
    await store.set('628123@s.whatsapp.net', alice)
    const restored = await store.get('628123@s.whatsapp.net')
    assert.ok(restored)
    assert.deepEqual(restored.exportState(), alice.exportState())
    await store.delete('628123@s.whatsapp.net')
    assert.equal(await store.get('628123@s.whatsapp.net'), null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})


test('signal session store serializes concurrent ratchet updates', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { SignalSessionStore } = await import('../src/protocol/signal/store.js')
  const { NativeSignalSession } = await import('../src/protocol/signal/session.js')
  const dir = await mkdtemp(join(process.cwd(), '.tmp-signal-concurrency-'))
  const store = new SignalSessionStore(dir)
  const aliceIdentity = generateX25519KeyPair()
  const bobIdentity = createCompanionKeys({}, { preKeyCount: 2 })
  const { session: a } = NativeSignalSession.initiatorFromPreKeyBundle({
    initiatorIdentityPrivate: aliceIdentity.privateKey,
    responderBundle: bundle(bobIdentity)
  })
  await store.set('628123@s.whatsapp.net', a)
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update('628123@s.whatsapp.net', async session => {
    assert.ok(session)
    session.encrypt(Buffer.from(`concurrent-${i}`))
    await new Promise(resolve => setTimeout(resolve, i % 3))
    return { session, value: i }
  })))
  const final = await store.get('628123@s.whatsapp.net')
  assert.ok(final)
  assert.equal(final.Ns >= 20, true)
  await rm(dir, { recursive: true, force: true })
})
