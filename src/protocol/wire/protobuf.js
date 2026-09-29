export function encodeVarint(value) {
  let n = typeof value === 'bigint' ? value : BigInt(Number.isInteger(value) ? value : Math.trunc(value))
  if (n < 0n) throw new RangeError('varint tidak boleh negatif')
  const out = []
  do {
    let b = Number(n & 0x7fn)
    n >>= 7n
    if (n) b |= 0x80
    out.push(b)
  } while (n)
  return Buffer.from(out)
}

export function readVarint(buf, offset = 0) {
  let value = 0n
  let shift = 0n
  let pos = offset
  for (; pos < buf.length && shift <= 63n; pos++) {
    const b = buf[pos]
    value |= BigInt(b & 0x7f) << shift
    if (!(b & 0x80)) return { value, offset: pos + 1 }
    shift += 7n
  }
  throw new Error('protobuf varint tidak valid')
}

export function fieldBytes(field, value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new TypeError('fieldBytes membutuhkan bytes')
  const payload = Buffer.from(value)
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(payload.length), payload])
}

export function fieldString(field, value) { return fieldBytes(field, Buffer.from(String(value), 'utf8')) }
export function fieldVarint(field, value) { return Buffer.concat([encodeVarint(field << 3), encodeVarint(value)]) }

export function fieldFixed32(field, value) {
  const b = Buffer.allocUnsafe(4)
  b.writeInt32LE(Number(value), 0)
  return Buffer.concat([encodeVarint((field << 3) | 5), b])
}

export function fieldFixed64(field, value) {
  const b = Buffer.allocUnsafe(8)
  if (typeof value === 'bigint') b.writeBigInt64LE(value, 0)
  else b.writeDoubleLE(Number(value), 0)
  return Buffer.concat([encodeVarint((field << 3) | 1), b])
}

export function fieldDouble(field, value) {
  const b = Buffer.allocUnsafe(8)
  b.writeDoubleLE(Number(value), 0)
  return Buffer.concat([encodeVarint((field << 3) | 1), b])
}

export function readFields(buf) {
  const fields = []
  let offset = 0
  while (offset < buf.length) {
    const key = readVarint(buf, offset)
    offset = key.offset
    const field = Number(key.value >> 3n)
    const wire = Number(key.value & 7n)
    if (field <= 0) throw new Error('protobuf field number invalid')
    if (wire === 0) {
      const v = readVarint(buf, offset)
      offset = v.offset
      fields.push({ field, wire, value: v.value })
    } else if (wire === 2) {
      const len = readVarint(buf, offset)
      offset = len.offset
      const n = Number(len.value)
      if (!Number.isSafeInteger(n) || n < 0 || offset + n > buf.length) throw new Error('protobuf length invalid')
      fields.push({ field, wire, value: buf.subarray(offset, offset + n) })
      offset += n
    } else if (wire === 5) {
      if (offset + 4 > buf.length) throw new Error('protobuf fixed32 truncated')
      fields.push({ field, wire, value: buf.subarray(offset, offset + 4) })
      offset += 4
    } else if (wire === 1) {
      if (offset + 8 > buf.length) throw new Error('protobuf fixed64 truncated')
      fields.push({ field, wire, value: buf.subarray(offset, offset + 8) })
      offset += 8
    } else {
      throw new Error(`protobuf wire type ${wire} unsupported`)
    }
  }
  return fields
}

export function firstBytes(fields, field) { return fields.find(x => x.field === field && x.wire === 2)?.value }
export function firstVarint(fields, field) { return fields.find(x => x.field === field && x.wire === 0)?.value }
