import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createIq, decodeBinaryNode, encodeBinaryNode } from '../src/protocol/wire/binary-node.js'
import { NodeClient } from '../src/protocol/node-client.js'

test('NodeClient rejects correlated IQ error instead of resolving a bogus result', async () => {
  const ev = new EventEmitter()
  const socket = {
    ev,
    sent: [],
    sendEncryptedFrame(frame) { this.sent.push(frame) }
  }
  const client = new NodeClient(socket)
  const request = client.request(createIq({ type: 'set', content: [] }), { timeoutMs: 1000, id: 'err1' })
  const sent = decodeBinaryNode(socket.sent[0])
  assert.equal(sent.attrs.id, 'err1')
  ev.emit('frame', encodeBinaryNode({
    tag: 'iq',
    attrs: { id: 'err1', type: 'error' },
    content: [{ tag: 'error', attrs: { code: '400', text: 'bad-request' } }]
  }))
  await assert.rejects(request, error => error.code === 'PROTOCOL_ERROR' && error.statusCode === 400)
  client.close()
})


test('NodeClient still resolves successful correlated IQ', async () => {
  const ev = new EventEmitter()
  const socket = {
    ev,
    sent: [],
    sendEncryptedFrame(frame) { this.sent.push(frame) }
  }
  const client = new NodeClient(socket)
  const request = client.request(createIq({ type: 'get' }), { timeoutMs: 1000, id: 'ok1' })
  ev.emit('frame', encodeBinaryNode({ tag: 'iq', attrs: { id: 'ok1', type: 'result' } }))
  assert.equal((await request).attrs.type, 'result')
  client.close()
})
