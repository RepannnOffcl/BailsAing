import { fieldBytes, readFields, firstBytes } from './protobuf.js'

export function encodeHandshakeMessage(kind, data) {
  const inner = []
  if (kind === 'clientHello') inner.push(fieldBytes(1, data.ephemeral))
  else if (kind === 'serverHello') {
    inner.push(fieldBytes(1, data.ephemeral))
    inner.push(fieldBytes(2, data.static))
    inner.push(fieldBytes(3, data.payload))
  } else if (kind === 'clientFinish') {
    inner.push(fieldBytes(1, data.static))
    inner.push(fieldBytes(2, data.payload))
  } else throw new TypeError(`Handshake kind tidak dikenal: ${kind}`)
  const field = kind === 'clientHello' ? 2 : kind === 'serverHello' ? 3 : 4
  return fieldBytes(field, Buffer.concat(inner))
}

export function decodeHandshakeMessage(buf) {
  const outer = readFields(Buffer.from(buf))
  const client = firstBytes(outer, 2)
  const server = firstBytes(outer, 3)
  const finish = firstBytes(outer, 4)
  if (client) {
    const fields = readFields(client)
    return { kind: 'clientHello', ephemeral: firstBytes(fields, 1), static: firstBytes(fields, 2), payload: firstBytes(fields, 3) }
  }
  if (server) {
    const fields = readFields(server)
    return { kind: 'serverHello', ephemeral: firstBytes(fields, 1), static: firstBytes(fields, 2), payload: firstBytes(fields, 3) }
  }
  if (finish) {
    const fields = readFields(finish)
    return { kind: 'clientFinish', static: firstBytes(fields, 1), payload: firstBytes(fields, 2) }
  }
  throw new Error('HandshakeMessage kosong atau tidak dikenal')
}
