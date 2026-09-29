import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeMessageContent, decodeMessageContent, normalizeMessageContent, SUPPORTED_MESSAGE_TYPES, MESSAGE_FIELD_MAP } from '../src/messaging/codec.js'

test('every current WA Message union type has a distinct protobuf field and can carry an opaque nested payload', () => {
  assert.ok(SUPPORTED_MESSAGE_TYPES.length >= 90)
  assert.equal(new Set(SUPPORTED_MESSAGE_TYPES).size, SUPPORTED_MESSAGE_TYPES.length)
  const fields = new Set(Object.values(MESSAGE_FIELD_MAP))
  assert.equal(fields.size, SUPPORTED_MESSAGE_TYPES.length)
  for (const type of SUPPORTED_MESSAGE_TYPES) {
    const raw = Buffer.from([0xfa, 0x07, 0x00])
    const wire = encodeMessageContent({ [type]: { _raw: raw } })
    assert.ok(wire.length >= 2, type)
    const decoded = decodeMessageContent(wire)
    assert.ok(decoded[type], type)
  }
})

test('common text/media/location/reaction/poll messages use protobuf field schemas', () => {
  const image = decodeMessageContent(encodeMessageContent({ imageMessage: { mimetype: 'image/jpeg', fileLength: 3, height: 10, width: 20, jpegThumbnail: Buffer.from([1, 2, 3]), caption: 'cap' } }))
  assert.equal(image.imageMessage.mimetype, 'image/jpeg')
  assert.equal(image.imageMessage.fileLength, 3)
  assert.equal(image.imageMessage.height, 10)
  assert.deepEqual(image.imageMessage.jpegThumbnail, Buffer.from([1, 2, 3]))
  assert.equal(image.imageMessage.caption, 'cap')

  const loc = decodeMessageContent(encodeMessageContent({ locationMessage: { degreesLatitude: 1.5, degreesLongitude: 2.5, name: 'x' } }))
  assert.equal(loc.locationMessage.degreesLatitude, 1.5)
  assert.equal(loc.locationMessage.name, 'x')

  const reaction = decodeMessageContent(encodeMessageContent({ reactionMessage: { key: { remoteJid: '1@s.whatsapp.net', fromMe: true, id: 'X' }, text: '👍', groupingKey: 'g', senderTimestampMs: 9 } }))
  assert.equal(reaction.reactionMessage.text, '👍')
  assert.equal(reaction.reactionMessage.groupingKey, 'g')
  assert.equal(reaction.reactionMessage.senderTimestampMs, 9)

  const poll = decodeMessageContent(encodeMessageContent({ pollCreationMessage: { name: 'Pick', options: [{ optionName: 'A' }, { optionName: 'B' }], selectableOptionsCount: 1 } }))
  assert.equal(poll.pollCreationMessage.name, 'Pick')
  assert.equal(poll.pollCreationMessage.options.length, 2)
})

test('message normalization retains Baileys-shaped type objects', () => {
  assert.deepEqual(normalizeMessageContent('hello'), { text: 'hello', conversation: 'hello' })
  assert.deepEqual(normalizeMessageContent({ extendedTextMessage: { text: 'hi' } }), { extendedTextMessage: { text: 'hi' } })
})

test('unknown high-number protobuf fields survive decode/re-encode without header corruption', () => {
  const rawHighField = Buffer.concat([Buffer.from([0x98, 0x06]), Buffer.from([0x01])]) // field 99, varint 1
  const encoded = encodeMessageContent({ imageMessage: { mimetype: 'image/jpeg', _unknownFields: [rawHighField] } })
  const decoded = decodeMessageContent(encoded)
  assert.ok(decoded.imageMessage._unknownFields?.length === 1)
  const reencoded = encodeMessageContent(decoded)
  assert.deepEqual(decodeMessageContent(reencoded).imageMessage._unknownFields, [rawHighField])
})

test('schema-backed and schema-less message types accept numeric protobuf field fallback', () => {
  const unknown = encodeMessageContent({ richResponseMessage: { fields: { 1: 'opaque', 2: Buffer.from([1, 2]), 3: 7 } } })
  const decodedUnknown = decodeMessageContent(unknown)
  assert.ok(decodedUnknown.richResponseMessage)
  assert.ok(Array.isArray(decodedUnknown.richResponseMessage._fields))

  const known = encodeMessageContent({ imageMessage: { mimetype: 'image/jpeg', fields: { 99: Buffer.from([9]) } } })
  const decodedKnown = decodeMessageContent(known)
  assert.equal(decodedKnown.imageMessage.mimetype, 'image/jpeg')
  assert.ok(Array.isArray(decodedKnown.imageMessage._unknownFields))
})


test('all wrapper message types encode as Message wrappers and compat helpers unwrap them', async () => {
  const { WRAPPER_MESSAGE_TYPES } = await import('../src/messaging/schema.js')
  const { getContentType, extractMessageContent } = await import('../src/compat/baileys.js')
  assert.ok(WRAPPER_MESSAGE_TYPES.size >= 20)
  for (const type of WRAPPER_MESSAGE_TYPES) {
    const wire = encodeMessageContent({ [type]: { message: { conversation: `inside-${type}` } } })
    const decoded = decodeMessageContent(wire)
    assert.equal(decoded[type].message.conversation, `inside-${type}`, type)
    assert.equal(getContentType({ [type]: { message: { conversation: 'hello' } } }), 'conversation', type)
    assert.deepEqual(extractMessageContent({ [type]: { message: { conversation: 'hello' } } }), { conversation: 'hello' }, type)
  }
})
