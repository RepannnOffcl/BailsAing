import test from 'node:test'
import assert from 'node:assert/strict'
import { createIq, decodeBinaryNode, encodeBinaryNode } from '../src/protocol/wire/binary-node.js'
import { NodeClient } from '../src/protocol/node-client.js'
import { EventEmitter } from 'node:events'

test('binary node roundtrip preserves common IQ structure', () => {
  const node = createIq({
    id: 'abc123',
    type: 'set',
    content: [{ tag: 'pair-device', attrs: { jid: '628123@s.whatsapp.net' }, content: Buffer.from('ref') }]
  })
  const decoded = decodeBinaryNode(encodeBinaryNode(node))
  assert.deepEqual(decoded, node)
})

test('NodeClient resolves correlated responses and rejects timeout', async () => {
  const ev = new EventEmitter()
  const socket = {
    ev,
    sent: [],
    sendEncryptedFrame(frame) { this.sent.push(frame) }
  }
  const client = new NodeClient(socket)
  const request = client.request(createIq({ type: 'set', content: [] }), { timeoutMs: 1000, id: 'r1' })
  const sent = decodeBinaryNode(socket.sent[0])
  ev.emit('frame', encodeBinaryNode({ tag: 'iq', attrs: { id: sent.attrs.id, type: 'result' } }))
  assert.equal((await request).attrs.type, 'result')
  await assert.rejects(() => client.request(createIq({}), { timeoutMs: 10, id: 'r2' }), /timeout/)
  client.close()
})
