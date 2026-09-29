import { randomBytes } from 'node:crypto'
import { encodeVarint, fieldBytes, fieldString, fieldVarint, fieldFixed32, fieldDouble, readFields, firstBytes, firstVarint } from '../protocol/wire/protobuf.js'
import { MESSAGE_FIELD_MAP, SUPPORTED_MESSAGE_TYPES, COMMON_SCHEMAS, WRAPPER_MESSAGE_TYPES, schemaForType } from './schema.js'

export { MESSAGE_FIELD_MAP, SUPPORTED_MESSAGE_TYPES }

const REVERSE_MESSAGE_FIELDS = Object.freeze(Object.fromEntries(Object.entries(MESSAGE_FIELD_MAP).map(([name, field]) => [field, name])))
const SCHEMA_LOOKUP = COMMON_SCHEMAS

function boolField(field, value) { return fieldVarint(field, value ? 1 : 0) }
function asBuffer(value) { return Buffer.isBuffer(value) ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : null }
function isBytesLike(value) { return Boolean(asBuffer(value)) }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key) }
function schemaNameForMessageType(type) {
  return WRAPPER_MESSAGE_TYPES.has(type) ? type : type.charAt(0).toUpperCase() + type.slice(1)
}

function scalarEncode(field, type, value) {
  if (type === 'string') return fieldString(field, value)
  if (type === 'bytes') {
    const bytes = asBuffer(value)
    if (!bytes) throw new TypeError(`Field ${field} membutuhkan bytes`)
    return fieldBytes(field, bytes)
  }
  if (type === 'bool') return boolField(field, value)
  if (type === 'fixed32') return fieldFixed32(field, Number(value))
  if (type === 'double') return fieldDouble(field, Number(value))
  if (type === 'float') return fieldFixed32(field, Buffer.from(new Float32Array([Number(value)]).buffer).readInt32LE(0))
  return fieldVarint(field, BigInt(typeof value === 'bigint' ? value : Number(value ?? 0)))
}

function decodeScalar(field, type, value, wire) {
  if (type === 'string') return wire === 2 ? Buffer.from(value).toString('utf8') : undefined
  if (type === 'bytes') return wire === 2 ? Buffer.from(value) : undefined
  if (type === 'bool') return wire === 0 ? value === 1n : undefined
  if (type === 'double') return wire === 1 ? Buffer.from(value).readDoubleLE(0) : undefined
  if (type === 'float') return wire === 5 ? Buffer.from(value).readFloatLE(0) : undefined
  if (type === 'fixed32') return wire === 5 ? Buffer.from(value).readUInt32LE(0) : undefined
  if (wire !== 0) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value
}


function encodeGenericFields(fields) {
  if (!fields || typeof fields !== 'object') throw new TypeError('fields protobuf harus object')
  const parts = []
  for (const [key, value] of Object.entries(fields)) {
    const field = Number(key)
    if (!Number.isInteger(field) || field < 1) throw new TypeError(`Nomor protobuf field tidak valid: ${key}`)
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item && typeof item === 'object' && Number.isInteger(item.wire)) {
        parts.push(rawField(item))
      } else if (isBytesLike(item)) {
        parts.push(fieldBytes(field, asBuffer(item)))
      } else if (typeof item === 'string') {
        parts.push(fieldString(field, item))
      } else if (typeof item === 'boolean') {
        parts.push(fieldVarint(field, item ? 1 : 0))
      } else if (typeof item === 'bigint' || Number.isInteger(item)) {
        parts.push(fieldVarint(field, BigInt(item)))
      } else if (typeof item === 'number' && Number.isFinite(item)) {
        parts.push(fieldDouble(field, item))
      } else {
        throw new TypeError(`Protobuf field ${field} memiliki nilai tidak didukung`)
      }
    }
  }
  return Buffer.concat(parts)
}

function decodeGenericFields(bytes) {
  const fields = readFields(bytes)
  return fields.map(entry => ({ field: entry.field, wire: entry.wire, value: entry.wire === 0 ? entry.value : Buffer.from(entry.value) }))
}

function encodeWithSchema(value, schemaName, fallbackRaw = null) {
  if (isBytesLike(value)) return asBuffer(value)
  if (!value || typeof value !== 'object') throw new TypeError(`${schemaName} payload harus object atau bytes`)
  if (schemaName === 'Message') return encodeMessageContent(value)
  if (isBytesLike(value.raw)) return asBuffer(value.raw)
  const schema = SCHEMA_LOOKUP[schemaName] ?? schemaForType(schemaName)
  if (!schema) {
    if (isBytesLike(fallbackRaw)) return asBuffer(fallbackRaw)
    if (isBytesLike(value._raw)) return asBuffer(value._raw)
    if (isBytesLike(value.raw)) return asBuffer(value.raw)
    if (value.fields) return encodeGenericFields(value.fields)
    throw new TypeError(`${schemaName} tidak memiliki nested schema; gunakan raw/_raw atau numeric fields`)
  }
  const known = encodeSchemaObject(value, schema)
  return value.fields ? Buffer.concat([known, encodeGenericFields(value.fields)]) : known
}

function encodeSchemaObject(value, schema) {
  const parts = []
  for (const descriptor of schema) {
    if (!descriptor.name || !own(value, descriptor.name) || value[descriptor.name] == null) continue
    const rawValues = descriptor.repeated ? (Array.isArray(value[descriptor.name]) ? value[descriptor.name] : [value[descriptor.name]]) : [value[descriptor.name]]
    for (const item of rawValues) {
      if (descriptor.type === 'message') {
        const nested = encodeWithSchema(item, descriptor.schemaName)
        parts.push(fieldBytes(descriptor.field, nested))
      } else parts.push(scalarEncode(descriptor.field, descriptor.type, item))
    }
  }
  if (isBytesLike(value._raw)) parts.push(asBuffer(value._raw))
  if (Array.isArray(value._unknownFields)) for (const raw of value._unknownFields) if (isBytesLike(raw)) parts.push(asBuffer(raw))
  return Buffer.concat(parts)
}

function decodeSchemaObject(bytes, schemaName) {
  if (schemaName === 'Message') return decodeMessageContent(bytes)
  const fields = readFields(bytes)
  const schema = SCHEMA_LOOKUP[schemaName] ?? schemaForType(schemaName)
  if (!schema) return { raw: Buffer.from(bytes), _fields: decodeGenericFields(bytes) }
  const byField = new Map(schema.map(item => [item.field, item]))
  const out = {}
  const unknown = []
  for (const entry of fields) {
    const descriptor = byField.get(entry.field)
    if (!descriptor || (descriptor.type !== 'message' && entry.wire !== (descriptor.type === 'string' || descriptor.type === 'bytes' ? 2 : descriptor.type === 'double' ? 1 : descriptor.type === 'float' || descriptor.type === 'fixed32' ? 5 : 0))) {
      unknown.push(rawField(entry))
      continue
    }
    let decoded
    try {
      decoded = descriptor.type === 'message'
        ? decodeSchemaObject(entry.value, descriptor.schemaName)
        : decodeScalar(entry.field, descriptor.type, entry.value, entry.wire)
    } catch {
      unknown.push(rawField(entry))
      continue
    }
    if (decoded === undefined) { unknown.push(rawField(entry)); continue }
    if (descriptor.repeated) (out[descriptor.name] ??= []).push(decoded)
    else out[descriptor.name] = decoded
  }
  if (unknown.length) out._unknownFields = unknown
  return out
}

function rawField(entry) {
  const key = encodeVarint((entry.field << 3) | entry.wire)
  if (entry.wire === 0) return Buffer.concat([key, encodeVarint(entry.value)])
  if (entry.wire === 2) return Buffer.concat([key, encodeVarint(entry.value.length), Buffer.from(entry.value)])
  if (entry.wire === 5) return Buffer.concat([key, Buffer.from(entry.value)])
  if (entry.wire === 1) return Buffer.concat([key, Buffer.from(entry.value)])
  return Buffer.alloc(0)
}

export function normalizeMessageContent(content) {
  if (typeof content === 'string') return { text: content, conversation: content }
  if (!content || typeof content !== 'object') throw new TypeError('Message content harus string atau object')
  if (typeof content.text === 'string' && Object.keys(content).every(key => ['text', 'conversation', 'messageContextInfo'].includes(key))) return { text: content.text, conversation: content.conversation ?? content.text }
  if (typeof content.conversation === 'string') return { text: content.conversation, conversation: content.conversation, ...content }
  const types = Object.keys(content).filter(key => MESSAGE_FIELD_MAP[key] !== undefined)
  if (!types.length) {
    if (isBytesLike(content.raw) || isBytesLike(content._raw)) return { raw: asBuffer(content.raw ?? content._raw) }
    throw new TypeError(`Unsupported WhatsApp message content. Supported message types: ${SUPPORTED_MESSAGE_TYPES.join(', ')}`)
  }
  if (types.length > 1) return { ...content }
  return { ...content }
}

export function encodeMessageContent(content) {
  const normalized = normalizeMessageContent(content)
  if (isBytesLike(normalized.raw)) return asBuffer(normalized.raw)
  const parts = []
  for (const [type, field] of Object.entries(MESSAGE_FIELD_MAP)) {
    if (!own(normalized, type) || normalized[type] == null) continue
    if (type === 'conversation') { parts.push(fieldString(field, normalized[type])); continue }
    const payload = normalized[type]
    const rawPayload = isBytesLike(payload) ? asBuffer(payload) : payload && typeof payload === 'object' ? asBuffer(payload.raw ?? payload._raw) : null
    if (rawPayload) { parts.push(fieldBytes(field, rawPayload)); continue }
    const schemaName = schemaNameForMessageType(type)
    const nested = encodeWithSchema(payload, schemaName)
    parts.push(fieldBytes(field, nested))
  }
  if (!parts.length && typeof normalized.text === 'string') return fieldString(1, normalized.text)
  return Buffer.concat(parts)
}

export function decodeMessageContent(bytes) {
  const fields = readFields(bytes)
  const out = {}
  const unknown = []
  for (const entry of fields) {
    const type = REVERSE_MESSAGE_FIELDS[entry.field]
    if (!type) { unknown.push(rawField(entry)); continue }
    if (type === 'conversation') {
      if (entry.wire === 2) { out.conversation = Buffer.from(entry.value).toString('utf8'); out.text = out.conversation }
      else unknown.push(rawField(entry))
      continue
    }
    if (entry.wire !== 2) { unknown.push(rawField(entry)); continue }
    const schemaName = schemaNameForMessageType(type)
    const payload = decodeSchemaObject(entry.value, schemaName)
    out[type] = payload
    if ((type === 'extendedTextMessage') && typeof payload?.text === 'string') out.text = payload.text
  }
  if (unknown.length) out._unknownFields = unknown
  if (Object.keys(out).length === 0) return { raw: Buffer.from(bytes) }
  return out
}

export function encodeMessageKey({ remoteJid, fromMe = true, id, participant = null } = {}) {
  if (!remoteJid || !id) throw new TypeError('Message key membutuhkan remoteJid dan id')
  const parts = [fieldString(1, remoteJid), boolField(2, fromMe), fieldString(3, id)]
  if (participant) parts.push(fieldString(4, participant))
  return Buffer.concat(parts)
}

export function encodeWebMessageInfo({ key, message, messageTimestamp = Math.floor(Date.now() / 1000), pushName, participant } = {}) {
  const parts = [
    fieldBytes(1, encodeMessageKey(key)),
    fieldBytes(2, encodeMessageContent(message)),
    fieldVarint(3, BigInt(messageTimestamp))
  ]
  if (participant) parts.push(fieldString(5, participant))
  if (pushName) parts.push(fieldString(10, pushName))
  return Buffer.concat(parts)
}

export function decodeMessageKey(bytes) {
  const fields = readFields(bytes)
  const remoteJid = firstBytes(fields, 1)?.toString('utf8')
  const fromMe = firstVarint(fields, 2) === 1n
  const id = firstBytes(fields, 3)?.toString('utf8')
  const participant = firstBytes(fields, 4)?.toString('utf8') ?? undefined
  if (!remoteJid || !id) throw new Error('Decoded message key tidak lengkap')
  return { remoteJid, fromMe, id, ...(participant ? { participant } : {}) }
}

export function decodeWebMessageInfo(bytes) {
  const fields = readFields(bytes)
  const keyBytes = firstBytes(fields, 1)
  const messageBytes = firstBytes(fields, 2)
  if (!keyBytes || !messageBytes) throw new Error('Decoded WebMessageInfo tidak lengkap')
  const timestamp = firstVarint(fields, 3)
  const participant = firstBytes(fields, 5)?.toString('utf8')
  const pushName = firstBytes(fields, 10)?.toString('utf8')
  return {
    key: decodeMessageKey(keyBytes),
    message: decodeMessageContent(messageBytes),
    messageTimestamp: Number(timestamp ?? 0n),
    ...(participant ? { participant } : {}),
    ...(pushName ? { pushName } : {})
  }
}

export function generateMessageId(randomBytesFn = null) {
  const crypto = randomBytesFn ?? randomBytes
  return `3EB0${Buffer.from(crypto(18)).toString('hex').toUpperCase()}`
}
