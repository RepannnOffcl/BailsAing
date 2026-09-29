import crypto from 'node:crypto'
import { generateX25519KeyPair, x25519 } from '../crypto/noise.js'
import { deriveDirectionalChains, deriveInitialRoot, kdfChain, kdfRoot, deriveX3DHMaterial, deriveX3DHResponderMaterial, decryptMessageKey, encryptMessageKey } from './crypto.js'
import { decodeSignalMessage, encodeSignalMessage } from './envelope.js'

const MAX_SKIP = 2000

function keyId(key) { return Buffer.from(key).toString('base64') }
function bytes(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'base64')
  throw new TypeError('Signal key material harus bytes/base64')
}
function cloneKeyPair(pair) { return { privateKey: bytes(pair.privateKey), publicKey: bytes(pair.publicKey) } }

export class NativeSignalSession {
  constructor(state) {
    this.role = state.role
    this.rootKey = bytes(state.rootKey)
    this.DHs = { privateKey: bytes(state.DHs.privateKey), publicKey: bytes(state.DHs.publicKey) }
    this.DHr = state.DHr ? bytes(state.DHr) : null
    this.CKs = state.CKs ? bytes(state.CKs) : null
    this.CKr = state.CKr ? bytes(state.CKr) : null
    this.Ns = Number(state.Ns ?? 0)
    this.Nr = Number(state.Nr ?? 0)
    this.PN = Number(state.PN ?? 0)
    this.skipped = new Map(Object.entries(state.skipped ?? {}).map(([k, v]) => [k, Buffer.from(v, 'base64')]))
    this._responderSendSeed = state.responderSendSeed ? bytes(state.responderSendSeed) : null
  }

  #snapshot() {
    return this.exportState()
  }

  #restore(snapshot) {
    const restored = new NativeSignalSession(snapshot)
    this.role = restored.role
    this.rootKey = restored.rootKey
    this.DHs = restored.DHs
    this.DHr = restored.DHr
    this.CKs = restored.CKs
    this.CKr = restored.CKr
    this.Ns = restored.Ns
    this.Nr = restored.Nr
    this.PN = restored.PN
    this.skipped = restored.skipped
    this._responderSendSeed = restored._responderSendSeed
  }

  static initiator({ x3dhMaterial, transcript = Buffer.alloc(0), remoteRatchetKey, localRatchetKey = null }) {
    const root = deriveInitialRoot(x3dhMaterial, transcript)
    const local = localRatchetKey ? cloneKeyPair(localRatchetKey) : generateX25519KeyPair()
    const first = x25519(local.privateKey, remoteRatchetKey)
    const directional = deriveDirectionalChains(root, first, 'initiator')
    return new NativeSignalSession({
      role: 'initiator', rootKey: directional.rootKey, DHs: local, DHr: remoteRatchetKey,
      CKs: directional.sendChainKey, CKr: directional.recvChainKey, Ns: 0, Nr: 0, PN: 0
    })
  }

  static responder({ x3dhMaterial, transcript = Buffer.alloc(0), localSignedPreKey }) {
    const root = deriveInitialRoot(x3dhMaterial, transcript)
    const local = cloneKeyPair(localSignedPreKey)
    return new NativeSignalSession({
      role: 'responder', rootKey: root, DHs: local, DHr: null,
      CKs: null, CKr: null, Ns: 0, Nr: 0, PN: 0
    })
  }

  static initiatorFromPreKeyBundle({ initiatorIdentityPrivate, responderBundle, transcript = Buffer.alloc(0) }) {
    const eph = generateX25519KeyPair()
    const material = deriveX3DHMaterial({
      initiatorIdentityPrivate,
      initiatorEphemeralPrivate: eph.privateKey,
      responderIdentityPublic: Buffer.from(responderBundle.identityKey.publicKey, 'base64'),
      responderSignedPreKeyPublic: Buffer.from(responderBundle.signedPreKey.publicKey, 'base64'),
      responderOneTimePreKeyPublic: responderBundle.oneTimePreKey?.publicKey ? Buffer.from(responderBundle.oneTimePreKey.publicKey, 'base64') : null
    })
    const session = NativeSignalSession.initiator({
      x3dhMaterial: material,
      transcript,
      remoteRatchetKey: Buffer.from(responderBundle.signedPreKey.publicKey, 'base64'),
      localRatchetKey: eph
    })
    return { session, baseKey: eph, material }
  }

  static responderFromPreKey({ responderBundle, initiatorIdentityPublic, initiatorEphemeralPublic, oneTimePreKeyId = null, signedPreKeyPrivate = null, transcript = Buffer.alloc(0) }) {
    const signed = signedPreKeyPrivate ?? Buffer.from(responderBundle.signedPreKey.privateKey, 'base64')
    const one = oneTimePreKeyId == null ? null : (() => {
      const found = responderBundle.preKeys?.find(item => Number(item.id) === Number(oneTimePreKeyId))
      return found ? Buffer.from(found.privateKey, 'base64') : null
    })()
    const material = deriveX3DHResponderMaterial({
      responderIdentityPrivate: Buffer.from(responderBundle.identityKey.privateKey, 'base64'),
      responderSignedPreKeyPrivate: signed,
      responderOneTimePreKeyPrivate: one,
      initiatorIdentityPublic,
      initiatorEphemeralPublic
    })
    const session = new NativeSignalSession({
      role: 'responder',
      rootKey: deriveInitialRoot(material, transcript),
      DHs: { privateKey: signed, publicKey: Buffer.from(responderBundle.signedPreKey.publicKey, 'base64') },
      DHr: Buffer.from(initiatorEphemeralPublic),
      CKs: null, CKr: null, Ns: 0, Nr: 0, PN: 0
    })
    const first = x25519(signed, initiatorEphemeralPublic)
    const directional = deriveDirectionalChains(session.rootKey, first, 'responder')
    session.rootKey = directional.rootKey
    session.CKs = null
    session.CKr = directional.recvChainKey
    session._responderSendSeed = directional.sendChainKey
    return { session, material }
  }

  #skipMessageKeys(until) {
    if (until - this.Nr > MAX_SKIP) throw new Error('Signal skipped-message limit exceeded')
    while (this.Nr < until) {
      const step = kdfChain(this.CKr)
      this.CKr = step.chainKey
      this.skipped.set(`${keyId(this.DHr)}:${this.Nr}`, step.messageKey)
      this.Nr++
    }
  }

  ratchetSend() {
    if (!this.DHr) throw new Error('Signal remote ratchet key belum tersedia')
    this.PN = this.Ns
    this.Ns = 0
    const next = generateX25519KeyPair()
    this.DHs = next
    const send = kdfRoot(this.rootKey, x25519(this.DHs.privateKey, this.DHr))
    this.rootKey = send.rootKey
    this.CKs = send.chainA
    return Buffer.from(this.DHs.publicKey)
  }

  encrypt(plaintext, associatedData = Buffer.alloc(0)) {
    const previous = this.#snapshot()
    try {
      let chain = this.CKs
      let responderSeed = this._responderSendSeed
      if (!chain) {
        if (!responderSeed) throw new Error('Signal sending chain belum diinisialisasi')
        chain = responderSeed
        responderSeed = null
      }
      const step = kdfChain(chain)
      const aad = Buffer.concat([Buffer.from(associatedData), Buffer.from(this.DHs.publicKey)])
      const cipher = encryptMessageKey(step.messageKey, Buffer.from(plaintext), aad)
      const envelope = {
        ratchetKey: Buffer.from(this.DHs.publicKey),
        counter: this.Ns,
        previousCounter: this.PN,
        ciphertext: cipher.ciphertext,
        mac: cipher.mac
      }
      const wire = encodeSignalMessage(envelope)
      this.CKs = step.chainKey
      this._responderSendSeed = responderSeed
      this.Ns += 1
      return { envelope, wire }
    } catch (error) {
      this.#restore(previous)
      throw error
    }
  }

  decrypt(input, associatedData = Buffer.alloc(0)) {
    const previous = this.#snapshot()
    try {
      const envelope = Buffer.isBuffer(input) || input instanceof Uint8Array ? decodeSignalMessage(input) : input
      if (!envelope || !envelope.ratchetKey) throw new TypeError('Signal envelope tidak lengkap')
      const counter = Number(envelope.counter)
      const previousCounter = Number(envelope.previousCounter ?? 0)
      if (!Number.isSafeInteger(counter) || counter < 0 || !Number.isSafeInteger(previousCounter) || previousCounter < 0) {
        throw new RangeError('Signal counter tidak valid')
      }
      const remoteKey = Buffer.from(envelope.ratchetKey)
      if (remoteKey.length !== 32) throw new RangeError('Signal ratchet key harus 32 byte')
      const skippedKey = this.skipped.get(`${keyId(remoteKey)}:${counter}`)
      if (skippedKey) {
        const plaintext = decryptMessageKey(skippedKey, envelope.ciphertext, envelope.mac, Buffer.concat([Buffer.from(associatedData), remoteKey]))
        this.skipped.delete(`${keyId(remoteKey)}:${counter}`)
        return plaintext
      }
      if (this.DHr && !this.DHr.equals(remoteKey)) {
        this.#skipMessageKeys(previousCounter)
        this.PN = this.Ns
        this.Ns = 0
        this.Nr = 0
        this.DHr = remoteKey
        const recv = kdfRoot(this.rootKey, x25519(this.DHs.privateKey, this.DHr))
        this.rootKey = recv.rootKey
        this.CKr = recv.chainA
        const next = generateX25519KeyPair()
        this.DHs = next
        const send = kdfRoot(this.rootKey, x25519(this.DHs.privateKey, this.DHr))
        this.rootKey = send.rootKey
        this.CKs = send.chainA
      } else if (!this.DHr) {
        this.DHr = remoteKey
        const recv = kdfRoot(this.rootKey, x25519(this.DHs.privateKey, this.DHr))
        this.rootKey = recv.rootKey
        this.CKr = recv.chainA
        if (!this.CKs) this.CKs = recv.chainB
      }
      if (counter - this.Nr > MAX_SKIP) throw new Error('Signal receive counter too far ahead')
      if (!this.CKr) throw new Error('Signal receive chain belum diinisialisasi')
      this.#skipMessageKeys(counter)
      const step = kdfChain(this.CKr)
      const aad = Buffer.concat([Buffer.from(associatedData), remoteKey])
      const plaintext = decryptMessageKey(step.messageKey, envelope.ciphertext, envelope.mac, aad)
      this.CKr = step.chainKey
      this.Nr++
      return plaintext
    } catch (error) {
      this.#restore(previous)
      throw error
    }
  }

  exportState() {
    const skipped = Object.fromEntries([...this.skipped.entries()].map(([k, v]) => [k, Buffer.from(v).toString('base64')]))
    return {
      role: this.role,
      rootKey: this.rootKey.toString('base64'),
      DHs: { privateKey: this.DHs.privateKey.toString('base64'), publicKey: this.DHs.publicKey.toString('base64') },
      DHr: this.DHr?.toString('base64') ?? null,
      CKs: this.CKs?.toString('base64') ?? null,
      CKr: this.CKr?.toString('base64') ?? null,
      Ns: this.Ns,
      Nr: this.Nr,
      PN: this.PN,
      skipped,
      ...(this._responderSendSeed ? { responderSendSeed: this._responderSendSeed.toString('base64') } : {})
    }
  }
}
