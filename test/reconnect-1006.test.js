import test from 'node:test'
import assert from 'node:assert/strict'
import { DisconnectCode, getDisconnectCode, shouldReconnect } from '../src/core/reconnect.js'

test('WebSocket abnormal closure 1006 is classified as transient connection loss', () => {
  const error = Object.assign(new Error('transport closed'), { code: 1006, wsCode: 1006 })
  assert.equal(getDisconnectCode(error), DisconnectCode.connectionLost)
  assert.equal(shouldReconnect(error, { unknownIsRetryable: false }), true)
})
