import { createPersistentAuthState } from '../src/auth/state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildPresenceNode,
  buildPresenceSubscribeNode,
  buildReceiptNode,
  buildBulkReceiptNodes,
  buildGroupQuery,
  extractGroupMetadata,
  buildGroupActionNodes
} from '../src/protocol/chat.js'
import { useMultiFileAuthState } from '../src/compat/baileys.js'
import { NativeWASocket } from '../src/protocol/native-engine.js'

const tmpDir = async name => fs.mkdtemp(path.join(os.tmpdir(), `baileys-${name}-`))

test('chat compatibility builders create Baileys-style presence and receipt nodes', () => {
  assert.deepEqual(buildPresenceNode('available', '628111@s.whatsapp.net'), {
    tag: 'presence', attrs: { name: '628111', type: 'available' }
  })
  assert.equal(buildPresenceNode('composing', '628111@s.whatsapp.net', '628222@s.whatsapp.net').tag, 'chatstate')
  assert.equal(buildPresenceSubscribeNode('628222@s.whatsapp.net').attrs.type, 'subscribe')
  assert.equal(buildReceiptNode({ remoteJid: '628222@s.whatsapp.net', id: 'ABC' }).attrs.type, 'read')
  const nodes = buildBulkReceiptNodes([
    { remoteJid: '628222@s.whatsapp.net', id: 'A', fromMe: false },
    { remoteJid: '628222@s.whatsapp.net', id: 'B', fromMe: false },
    { remoteJid: '628222@s.whatsapp.net', id: 'C', fromMe: true }
  ])
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].content[0].content.length, 1)
})

test('group compatibility builders parse metadata and participant actions', () => {
  const query = buildGroupQuery('123@g.us', 'get', [{ tag: 'query', attrs: { request: 'interactive' } }])
  assert.equal(query.attrs.xmlns, 'w:g2')
  const metadata = extractGroupMetadata({
    tag: 'result', attrs: {}, content: [{
      tag: 'group', attrs: { id: '123', subject: 'Test', s_o: '6281@s.whatsapp.net', s_t: '1700000000' },
      content: [
        { tag: 'description', attrs: { id: 'D1', participant: '6281@s.whatsapp.net' }, content: [{ tag: 'body', attrs: {}, content: Buffer.from('desc') }] },
        { tag: 'participant', attrs: { jid: '6281@s.whatsapp.net', type: 'admin' } },
        { tag: 'participant', attrs: { jid: '6282@s.whatsapp.net' } }
      ]
    }]
  })
  assert.equal(metadata.id, '123@g.us')
  assert.equal(metadata.desc, 'desc')
  assert.equal(metadata.participants.length, 2)
  const [action] = buildGroupActionNodes(['6281@s.whatsapp.net'], 'promote')
  assert.equal(action.tag, 'promote')
  assert.equal(action.content[0].attrs.jid, '6281@s.whatsapp.net')
})

test('NativeWASocket exposes presence, read and group methods without needing a live WebSocket', async () => {
  const socket = new NativeWASocket({}, { jid: 'self@s.whatsapp.net', registered: true })
  const sent = []
  socket.protocolState = 'authenticated'
  socket.nodes = {
    send(node) { sent.push(node) },
    async request(node) {
      if (node.attrs.xmlns === 'w:g2' && node.attrs.type === 'get') {
        return { tag: 'result', attrs: {}, content: [{ tag: 'group', attrs: { id: '123', subject: 'Test' }, content: [] }] }
      }
      return { tag: 'result', attrs: {}, content: [{ tag: 'group', attrs: { id: '123', subject: 'Test' }, content: [] }] }
    }
  }
  await socket.sendPresenceUpdate('available')
  await socket.presenceSubscribe('628222@s.whatsapp.net')
  await socket.readMessages([{ remoteJid: '628222@s.whatsapp.net', id: 'A', fromMe: false }])
  assert.equal(sent.length, 3)
  assert.equal((await socket.groupMetadata('123@g.us')).id, '123@g.us')
})

test('useMultiFileAuthState imports legacy Baileys creds/key files and keeps transaction API', async () => {
  const dir = await tmpDir('legacy')
  try {
    const creds = { registered: true, me: { id: '628111@s.whatsapp.net', name: 'bot' }, jid: '628111@s.whatsapp.net', noiseKey: { privateKey: Buffer.alloc(32, 1).toString('base64'), publicKey: Buffer.alloc(32, 2).toString('base64') } }
    await fs.writeFile(path.join(dir, 'creds.json'), JSON.stringify({ ...creds, noiseKey: { privateKey: { type: 'Buffer', data: Array.from(Buffer.alloc(32, 1)) }, publicKey: { type: 'Buffer', data: Array.from(Buffer.alloc(32, 2)) } } }))
    await fs.writeFile(path.join(dir, 'session-abc.json'), JSON.stringify({ type: 'Buffer', data: [1, 2, 3] }))
    const { state, saveCreds, release } = await useMultiFileAuthState(dir)
    assert.equal(state.creds.registered, true)
    const loaded = await state.keys.get('session', ['abc'])
    assert.deepEqual(Buffer.from(loaded.abc), Buffer.from([1, 2, 3]))
    let serial = 0
    await state.keys.transaction(async keys => {
      serial += 1
      await keys.set({ 'session': { abc: Buffer.from([4, 5]) } })
      assert.equal(serial, 1)
    })
    await saveCreds({ pushName: 'new' })
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'creds.json'), 'utf8')).pushName, 'new')
    await release()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})


test('compat auth fallback mirrors legacy creds into native credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-legacy-fallback-'))
  try {
    await fs.writeFile(path.join(dir, 'creds.json'), JSON.stringify({ registered: true, jid: '628000000000@s.whatsapp.net', me: { id: '628000000000@s.whatsapp.net' } }))
    const state = await createPersistentAuthState(null, dir, {})
    assert.equal(state.creds.registered, true)
    assert.equal(state.creds.jid, '628000000000@s.whatsapp.net')
    await state.release()
    const native = JSON.parse(await fs.readFile(path.join(dir, 'credentials.json'), 'utf8'))
    assert.equal(native.jid, '628000000000@s.whatsapp.net')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
