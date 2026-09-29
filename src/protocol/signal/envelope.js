import { fieldBytes, fieldVarint, readFields, firstBytes, firstVarint } from '../wire/protobuf.js'

export function encodeSignalMessage({ ratchetKey, counter = 0, previousCounter = 0, ciphertext, mac }) {
  return Buffer.concat([
    fieldBytes(1, ratchetKey),
    fieldVarint(2, counter),
    fieldVarint(3, previousCounter),
    fieldBytes(4, ciphertext),
    fieldBytes(5, mac)
  ])
}

export function decodeSignalMessage(payload) {
  const fields = readFields(payload)
  const ratchetKey = firstBytes(fields, 1)
  const counter = firstVarint(fields, 2)
  const previousCounter = firstVarint(fields, 3)
  const ciphertext = firstBytes(fields, 4)
  const mac = firstBytes(fields, 5)
  if (!ratchetKey || ratchetKey.length !== 32 || ciphertext == null || mac == null || mac.length !== 32) throw new Error('Signal message envelope tidak lengkap')
  return { ratchetKey, counter: Number(counter ?? 0n), previousCounter: Number(previousCounter ?? 0n), ciphertext, mac }
}

export function encodePreKeySignalMessage({ registrationId, preKeyId, signedPreKeyId, baseKey, identityKey, message }) {
  const parts = [
    fieldVarint(1, registrationId),
    fieldVarint(2, preKeyId),
    fieldVarint(3, signedPreKeyId),
    fieldBytes(4, baseKey),
    fieldBytes(5, identityKey),
    fieldBytes(6, message)
  ]
  return Buffer.concat(parts)
}

export function decodePreKeySignalMessage(payload) {
  const fields = readFields(payload)
  const registrationId = firstVarint(fields, 1)
  const preKeyId = firstVarint(fields, 2)
  const signedPreKeyId = firstVarint(fields, 3)
  const baseKey = firstBytes(fields, 4)
  const identityKey = firstBytes(fields, 5)
  const message = firstBytes(fields, 6)
  if (!baseKey || baseKey.length !== 32 || !identityKey || identityKey.length !== 32 || !message) throw new Error('PreKeySignalMessage envelope tidak lengkap')
  return {
    registrationId: Number(registrationId ?? 0n),
    preKeyId: preKeyId == null ? null : Number(preKeyId),
    signedPreKeyId: Number(signedPreKeyId ?? 0n),
    baseKey,
    identityKey,
    message
  }
}
