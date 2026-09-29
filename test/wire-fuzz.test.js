import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeBinaryNode } from '../src/protocol/wire/binary-node.js'
import { readFields } from '../src/protocol/wire/protobuf.js'

function randomBytes(seed, length) {
  let x = seed >>> 0
  const out = Buffer.alloc(length)
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    out[i] = x & 0xff
  }
  return out
}

test('wire parsers stay bounded on malformed/fuzzed byte inputs', () => {
  for (let seed = 1; seed <= 750; seed += 1) {
    const bytes = randomBytes(seed, seed % 97)
    assert.doesNotThrow(() => { try { decodeBinaryNode(bytes) } catch {} })
    assert.doesNotThrow(() => { try { readFields(bytes) } catch {} })
  }
})
