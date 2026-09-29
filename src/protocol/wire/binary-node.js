import crypto from 'node:crypto'

export const TOKEN = Object.freeze({
  LIST_EMPTY: 0,
  STREAM_END: 2,
  DICTIONARY_0: 236,
  LIST_8: 248,
  LIST_16: 249,
  JID_PAIR: 250,
  HEX_8: 251,
  BINARY_8: 252,
  BINARY_20: 253,
  BINARY_32: 254,
  NIBBLE_8: 255
})

// Stable prefix used by the WhatsApp Web token dictionary. The decoder also
// preserves unknown token indexes instead of silently dropping them.
const TOKEN_DICTIONARY = [
  '200','400','404','500','501','action','add','after','archive','author','available','battery','before','body','broadcast','chat','clear','code','composing','contacts','count','create','debug','delete','demote','duplicate','encoding','error','false','filehash','from','g.us','group','groups_v2','height','id','image','in','index','invis','item','jid','kind','last','leave','live','log','media','message','mimetype','missing','modify','name','notification','notify','out','owner','participant','paused','picture','played','presence','preview','promote','query','raw','read','receipt','received','recipient','recording','relay','remove','response','resume','retry','s16','seconds','set','size','status','subject','subscribe','t','text','to','type','unarchive','unavailable','url','user','value','web','width','mute','read_only','admin','creator','short','update','powersave','checksum','epoch','block','previous','409','replaced','reason','spam','message_info','delivery','emoji','title','description','canonical','matched','version'
]
const TOKEN_LOOKUP = new Map(TOKEN_DICTIONARY.map((value, index) => [index, value]))

const MAX_LIST = 0xffff
const MAX_BINARY = 0xffffff

function writeListStart(length) {
  if (!Number.isInteger(length) || length < 0 || length > MAX_LIST) throw new RangeError('list length invalid')
  if (length === 0) return Buffer.from([TOKEN.LIST_EMPTY])
  if (length < 256) return Buffer.from([TOKEN.LIST_8, length])
  const b = Buffer.allocUnsafe(3)
  b[0] = TOKEN.LIST_16
  b.writeUInt16BE(length, 1)
  return b
}

function writeBinary(value) {
  const data = Buffer.from(value)
  if (data.length > MAX_BINARY) throw new RangeError('binary payload terlalu besar')
  if (data.length < 256) return Buffer.concat([Buffer.from([TOKEN.BINARY_8, data.length]), data])
  if (data.length < 1 << 20) {
    const h = Buffer.allocUnsafe(4)
    h[0] = TOKEN.BINARY_20
    h[1] = (data.length >>> 16) & 0xff
    h[2] = (data.length >>> 8) & 0xff
    h[3] = data.length & 0xff
    return Buffer.concat([h, data])
  }
  const h = Buffer.allocUnsafe(5)
  h[0] = TOKEN.BINARY_32
  h.writeUInt32BE(data.length, 1)
  return Buffer.concat([h, data])
}

function writeString(value) {
  const data = Buffer.from(String(value), 'utf8')
  return writeBinary(data)
}

function normalizeContent(content) {
  if (content == null) return null
  if (Buffer.isBuffer(content) || content instanceof Uint8Array || typeof content === 'string') return content
  if (Array.isArray(content)) return content
  throw new TypeError(`Unsupported node content: ${typeof content}`)
}

export function encodeBinaryNode(node) {
  if (!node || typeof node !== 'object' || typeof node.tag !== 'string') throw new TypeError('node.tag wajib string')
  const attrs = node.attrs ?? {}
  const content = normalizeContent(node.content)
  const entries = Object.entries(attrs).filter(([, value]) => value != null)
  const listLength = 1 + entries.length * 2 + (content == null ? 0 : 1)
  const parts = [writeListStart(listLength), writeString(node.tag)]
  for (const [key, value] of entries) parts.push(writeString(key), writeString(value))
  if (content != null) {
    if (Array.isArray(content)) {
      parts.push(writeListStart(content.length))
      for (const child of content) parts.push(encodeBinaryNode(child))
    } else {
      parts.push(Buffer.isBuffer(content) || content instanceof Uint8Array ? writeBinary(content) : writeString(content))
    }
  }
  return Buffer.concat(parts)
}

class Reader {
  constructor(buffer) { this.buf = Buffer.from(buffer); this.offset = 0 }
  take(size) {
    if (this.offset + size > this.buf.length) throw new Error('binary node truncated')
    const out = this.buf.subarray(this.offset, this.offset + size)
    this.offset += size
    return out
  }
  u8() { return this.take(1)[0] }
  u16() { return this.take(2).readUInt16BE(0) }
  u24() { return (this.u8() << 16) | (this.u8() << 8) | this.u8() }
  u32() { return this.take(4).readUInt32BE(0) }
}

function readRaw(reader) {
  const token = reader.u8()
  if (token === TOKEN.LIST_EMPTY) return { kind: 'list', value: [] }
  if (token === TOKEN.LIST_8) return { kind: 'listHeader', length: reader.u8() }
  if (token === TOKEN.LIST_16) return { kind: 'listHeader', length: reader.u16() }
  if (token === TOKEN.BINARY_8) return { kind: 'bytes', value: reader.take(reader.u8()) }
  if (token === TOKEN.BINARY_20) return { kind: 'bytes', value: reader.take(reader.u24()) }
  if (token === TOKEN.BINARY_32) {
    const len = reader.u32()
    if (len > MAX_BINARY) throw new RangeError('binary payload terlalu besar')
    return { kind: 'bytes', value: reader.take(len) }
  }
  if (token <= 235) return { kind: 'token', value: token, text: TOKEN_LOOKUP.get(token) }
  if (token === TOKEN.DICTIONARY_0) {
    const low = reader.u8()
    const index = 236 + low
    return { kind: 'token', value: index, text: TOKEN_LOOKUP.get(index) }
  }
  if (token === TOKEN.JID_PAIR) {
    return { kind: 'jidPair', user: readString(reader), server: readString(reader) }
  }
  throw new Error(`unsupported WABinary token ${token}`)
}

function tokenText(token) {
  return `<token:${token}>`
}

function readString(reader) {
  const item = readRaw(reader)
  if (item.kind === 'bytes') return item.value.toString('utf8')
  if (item.kind === 'token') return item.text ?? tokenText(item.value)
  if (item.kind === 'jidPair') return `${item.user}@${item.server}`
  throw new Error('expected string/binary token')
}

function readNode(reader) {
  const header = readRaw(reader)
  let length
  if (header.kind === 'list') length = 0
  else if (header.kind === 'listHeader') length = header.length
  else throw new Error('binary node does not start with list')
  if (length < 1) throw new Error('binary node list kosong')
  const tag = readString(reader)
  const attrs = {}
  const attrPairs = Math.floor((length - 1) / 2)
  for (let i = 0; i < attrPairs; i++) attrs[readString(reader)] = readString(reader)
  let remaining = length - 1 - attrPairs * 2
  let content
  if (remaining > 0) {
    const peek = reader.buf[reader.offset]
    if (peek === TOKEN.LIST_EMPTY || peek === TOKEN.LIST_8 || peek === TOKEN.LIST_16) {
      const listHeader = readRaw(reader)
      const n = listHeader.kind === 'list' ? 0 : listHeader.length
      content = []
      for (let i = 0; i < n; i++) content.push(readNode(reader))
    } else {
      const raw = readRaw(reader)
      if (raw.kind !== 'bytes') throw new Error('node content unsupported')
      content = raw.value
    }
  }
  return { tag, attrs, ...(content === undefined ? {} : { content }) }
}

export function decodeBinaryNode(buffer) {
  const reader = new Reader(buffer)
  const node = readNode(reader)
  if (reader.offset !== reader.buf.length) throw new Error('trailing bytes after binary node')
  return node
}

export function createIq({ id, to = 's.whatsapp.net', type = 'get', xmlns = 'md', content = [] }) {
  return { tag: 'iq', attrs: { to, type, id: id ?? crypto.randomBytes(8).toString('hex'), xmlns }, content }
}

export function createNodeId(prefix = 'baileys') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`
}
