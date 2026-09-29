import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeWASocket } from '../src/index.js'
import { backoffDelay, shouldReconnect, ReconnectController } from '../src/core/reconnect.js'

function mockEngine() {
  let id = 0
  return {
    async useMultiFileAuthState(dir) {
      await fs.mkdir(dir, { recursive: true })
      return {
        state: { creds: { registered: true } },
        async saveCreds() {}
      }
    },
    makeWASocket() {
      const ev = new EventEmitter()
      const socketId = ++id
      return {
        id: socketId,
        ev,
        sent: [],
        async sendMessage(jid, content) { this.sent.push({ jid, content }); return { key: { id: `m${socketId}` } } },
        async relayMessage(jid, content) { this.sent.push({ jid, content, relay: true }); return { ok: true } },
        async newsletterFollow(jid) { this.followed = jid; return { jid } },
        async requestPairingCode(number, custom) { return custom ?? `${number.slice(-4)}1234` },
        end() { this.ended = true }
      }
    }
  }
}

test('auto-follow channels are opt-in and default to empty', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-auto-follow-default-'))
  let followed = 0
  const engine = {
    async useMultiFileAuthState() {
      return { state: { creds: { registered: true } }, async saveCreds() {} }
    },
    makeWASocket() {
      const ev = new EventEmitter()
      return {
        ev,
        protocolState: 'authenticated',
        async newsletterFollow() { followed += 1 },
        end() {}
      }
    }
  }
  try {
    const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(followed, 0)
    await sock.close()
  } finally {
    await fs.rm(authDir, { recursive: true, force: true })
  }
})

test('pure reconnect policy', () => {
  assert.equal(shouldReconnect({ output: { statusCode: 401 }}), false)
  assert.equal(shouldReconnect({ output: { statusCode: 408 }}), true)
  assert.equal(shouldReconnect({ output: { statusCode: 405 }}), true)
  assert.equal(shouldReconnect({ output: { statusCode: 406 }}), true)
  assert.equal(shouldReconnect({ output: { statusCode: 409 }}), true)
  assert.equal(shouldReconnect({ output: { statusCode: 503 }}), true)
  assert.equal(shouldReconnect({ output: { statusCode: 500 }}), false)
  assert.equal(shouldReconnect({ output: { statusCode: 500 }}, { retryBadSession: true }), true)
  assert.equal(backoffDelay(2, { baseReconnectDelay: 100, reconnectJitter: 0 }), 200)
})

test('pairing number is supplied per request and is optional at socket creation', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-pairing-number-'))
  const calls = []
  const engine = {
    makeWASocket() {
      const ev = new EventEmitter()
      return {
        ev,
        async requestPairingCode(number, custom) { calls.push({ number, custom }); return custom ?? `${number.slice(-4)}1234` },
        end() {}
      }
    }
  }
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [] })
  assert.equal(await sock.requestPairingCode('6281234567890'), '78901234')
  assert.equal(await sock.requestPairingCode('6281234567890', 'REPAN777'), 'REPAN777')
  await assert.rejects(() => sock.requestPairingCodeCustom('REPAN888'), /Nomor pairing tidak valid/)
  assert.equal(await sock.requestPairingCodeCustom('6281111111111', 'REPAN999'), 'REPAN999')
  assert.deepEqual(calls.slice(-1), [{ number: '6281111111111', custom: 'REPAN999' }])
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('facade reconciles a socket that is already secure before listeners attach', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-lifecycle-sync-'))
  const engine = {
    makeWASocket() {
      const ev = new EventEmitter()
      return {
        ev,
        protocolState: 'secure',
        end() {}
      }
    }
  }
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [] })
  assert.equal(sock.connectionState, 'secure')
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('stable facade, pairing, send queue and reconnect are preserved', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-'))
  const engine = mockEngine()
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [] })
  let socketEvents = 0
  sock.ev.on('connection.update', () => { socketEvents++ })
  const first = sock.__baileys.generation
  assert.equal(await sock.requestPairingCode('628123456789', 'REPAN777'), 'REPAN777')
  await sock.sendMessage('123@s.whatsapp.net', { text: 'hello' })

  await sock.reconnectNow('test')
  assert.ok(sock.__baileys.generation > first)
  sock.ev.emit('connection.update', { connection: 'open' })
  assert.equal(socketEvents, 1, 'engine event listeners survive socket replacement')
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('reconnect controller retries a failed install without creating parallel runs', async () => {
  const { ReconnectController } = await import('../src/core/reconnect.js')
  const controller = new ReconnectController()
  let calls = 0
  const promiseA = controller.run(async () => {
    calls += 1
    if (calls < 3) throw new Error('temporary')
    return 'ok'
  }, { baseReconnectDelay: 1, maxReconnectDelay: 1, reconnectJitter: 0, maxReconnectAttempts: 3 })
  const promiseB = controller.run(async () => 'wrong', { baseReconnectDelay: 1, reconnectJitter: 0 })
  assert.equal(promiseA, promiseB)
  assert.equal(await promiseA, 'ok')
  assert.equal(calls, 3)
})

test('reconnect controller keeps retrying when maxReconnectAttempts is omitted', async () => {
  const controller = new ReconnectController()
  let calls = 0
  const result = await controller.run(async () => {
    calls += 1
    if (calls < 5) throw new Error('temporary')
    return 'recovered'
  }, { baseReconnectDelay: 100, maxReconnectDelay: 100, reconnectJitter: 0 })
  assert.equal(result, 'recovered')
  assert.equal(calls, 5)
})

test('shutdown racing an in-flight engine creation cannot resurrect a closed socket', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-shutdown-race-'))
  let resolveEngine
  const engineStarted = new Promise(resolve => { resolveEngine = resolve })
  const created = []
  const engine = {
    async makeWASocket() {
      await engineStarted
      const ev = new EventEmitter()
      const socket = { ev, protocolState: 'secure', end() { this.ended = true } }
      created.push(socket)
      return socket
    }
  }
  const sock = makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [] })
  await new Promise(resolve => setImmediate(resolve))
  const closing = sock.close()
  resolveEngine()
  await closing
  const resolved = await sock
  assert.equal(resolved, sock)
  assert.equal(created.length, 0)
  assert.equal(sock.connectionState, 'closed')
  await fs.rm(authDir, { recursive: true, force: true })
})

test('send queue shutdown drains the active send before stop continues', async () => {
  const { SendRateLimiter } = await import('../src/utils/rate-limit.js')
  const limiter = new SendRateLimiter({ minDelayMs: 0, jitterMs: 0 })
  const order = []
  let startedResolve
  const started = new Promise(resolve => { startedResolve = resolve })
  let release
  const gate = new Promise(resolve => { release = resolve })
  const task = limiter.schedule(async () => {
    order.push('start')
    startedResolve()
    await gate
    order.push('done')
  })
  await started
  const closing = limiter.close()
  release()
  await closing
  await task
  assert.deepEqual(order, ['start', 'done'])
  await assert.rejects(() => limiter.schedule(async () => {}), /Send queue ditutup/)
})

test('rate limiter never schedules a negative timeout on its first task', async () => {
  const { SendRateLimiter } = await import('../src/utils/rate-limit.js')
  const warnings = []
  const onWarning = warning => {
    if (warning?.name === 'TimeoutNegativeWarning') warnings.push(warning)
  }
  process.on('warning', onWarning)
  try {
    const limiter = new SendRateLimiter({ minDelayMs: 0, jitterMs: 0 })
    assert.equal(await limiter.schedule(async () => 'ok'), 'ok')
    assert.deepEqual(warnings, [])
    limiter.close()
  } finally {
    process.off('warning', onWarning)
  }
})

test('rate limiter rejects work after queue limit and closes cleanly', async () => {
  const { SendRateLimiter } = await import('../src/utils/rate-limit.js')
  const limiter = new SendRateLimiter({ minDelayMs: 1, maxQueue: 1 })
  let release
  const first = limiter.schedule(async () => new Promise(resolve => { release = resolve }))
  while (typeof release !== 'function') await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(() => limiter.schedule(async () => 'overflow'), /penuh/)
  release('ok')
  assert.equal(await first, 'ok')
  limiter.close()
  await assert.rejects(() => limiter.schedule(async () => 'closed'), /ditutup/)
})


test('automatic pairing waits for secure transport and retries transient failures', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-auto-pair-'))
  let attempts = 0
  const engine = {
    makeWASocket() {
      const ev = new EventEmitter()
      const socket = {
        ev,
        async requestPairingCode() {
          attempts += 1
          if (attempts < 2) throw new Error('transient pairing')
          return 'AUTO1234'
        },
        end() {}
      }
      setTimeout(() => ev.emit('connection.update', { connection: 'secure', authenticated: false }), 15)
      return socket
    }
  }
  const sock = await makeWASocket({ engine, authDir, pairingNumber: '6281234567890', pairingDelayMs: 0, pairingRetryDelayMs: 5, maxPairingAttempts: 3, autoFollowChannels: [] })
  const codePromise = new Promise(resolve => sock.ev.on('baileys.pairing', data => data.code && resolve(data.code)))
  assert.equal(await codePromise, 'AUTO1234')
  assert.equal(attempts, 2)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('external Baileys-style auth state is passed through to native engine', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-external-auth-'))
  const captured = {}
  const state = { creds: { registered: true, jid: '628123@s.whatsapp.net' }, keys: {} }
  const engine = {
    makeWASocket(config, creds) {
      captured.auth = config.auth
      captured.creds = creds
      const ev = new EventEmitter()
      return { ev, protocolState: 'authenticated', end() {} }
    }
  }
  const sock = await makeWASocket({ engine, authDir, auth: { state, saveCreds: async () => {} }, requestPairingOnStart: false, autoFollowChannels: [] })
  assert.equal(captured.auth, state.creds)
  assert.equal(captured.creds, state.creds)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})


test('reconnect completion resolves pending run without false cancellation', async () => {
  const controller = new ReconnectController()
  let started = false
  const pending = controller.run(async () => {
    started = true
    await new Promise((_, reject) => setTimeout(() => reject(new Error('late task failure')), 25))
  }, { baseReconnectDelay: 1, maxReconnectAttempts: 2, reconnectJitter: 0 })
  while (!started) await new Promise(resolve => setImmediate(resolve))
  assert.equal(controller.complete('facade'), true)
  assert.equal(await pending, 'facade')
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(controller.pending, false)
})

test('logged-out session is never auto-repaired or retried', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-logout-no-repair-'))
  await fs.writeFile(path.join(authDir, 'credentials.json'), JSON.stringify({ registered: true, jid: '123@s.whatsapp.net', sentinel: 'keep' }))
  let activeSocket
  const engine = {
    makeWASocket() {
      const ev = new EventEmitter()
      const socket = { ev, protocolState: 'authenticated', end() {} }
      activeSocket = socket
      setImmediate(() => ev.emit('connection.update', { connection: 'open' }))
      return socket
    }
  }
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoRepairBadSession: true, autoFollowChannels: [] })
  const stopped = []
  sock.ev.on('baileys.stopped', data => stopped.push(data))
  activeSocket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: Object.assign(new Error('logout'), { statusCode: 401 }) } })
  await new Promise(resolve => setTimeout(resolve, 10))
  const creds = JSON.parse(await fs.readFile(path.join(authDir, 'credentials.json'), 'utf8'))
  assert.equal(creds.sentinel, 'keep')
  assert.equal(stopped.length, 1)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})


test('repeated keepalive failures trigger single-flight recovery without losing auth', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-keepalive-recovery-'))
  await fs.writeFile(path.join(authDir, 'credentials.json'), JSON.stringify({ registered: true, jid: '628123@s.whatsapp.net', sentinel: 'keep' }))
  let created = 0
  const sockets = []
  const engine = {
    makeWASocket(config) {
      created += 1
      if (config?.auth) config.auth.registered = true
      const ev = new EventEmitter()
      const socket = { ev, protocolState: 'authenticated', end() { socket.ended = true } }
      sockets.push(socket)
      return socket
    }
  }
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [], baseReconnectDelay: 100, maxReconnectDelay: 100, reconnectJitter: 0, keepaliveFailureThreshold: 3 })
  sockets[0].ev.emit('connection.update', { connection: 'open' })
  for (let i = 0; i < 3; i++) sockets[0].ev.emit('keepalive.error', { error: new Error('ping timeout'), count: i + 1, threshold: 3 })
  while (sock.__baileys.generation < 2) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(created, 2)
  assert.equal(sock.authState.creds.registered, true)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('transient disconnect reconnects without rebuilding session credentials', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-transient-reconnect-'))
  await fs.writeFile(path.join(authDir, 'credentials.json'), JSON.stringify({
    registered: true,
    jid: '628123@s.whatsapp.net',
    sentinel: 'keep-session',
    noiseKey: { privateKey: Buffer.alloc(32, 7).toString('base64'), publicKey: Buffer.alloc(32, 8).toString('base64') }
  }))
  let created = 0
  let ended = 0
  let parallel = 0
  let active = 0
  const engine = {
    makeWASocket() {
      created += 1
      active += 1
      parallel = Math.max(parallel, active)
      const ev = new EventEmitter()
      const socket = {
        ev,
        protocolState: 'authenticated',
        end() { if (!socket.ended) { socket.ended = true; ended += 1; active -= 1 } }
      }
      if (created === 1) {
        setTimeout(() => ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: Object.assign(new Error('temporary'), { statusCode: 409 }) } }), 15)
      }
      return socket
    }
  }
  const sock = await makeWASocket({
    engine,
    authDir,
    requestPairingOnStart: false,
    autoFollowChannels: [],
    baseReconnectDelay: 1,
    reconnectJitter: 0,
    maxReconnectAttempts: 3
  })
  const reconnects = []
  sock.ev.on('baileys.reconnect', data => reconnects.push(data))
  await new Promise(resolve => {
    const timer = setInterval(() => {
      if (sock.__baileys.generation >= 2) { clearInterval(timer); resolve() }
    }, 5)
  })
  const creds = JSON.parse(await fs.readFile(path.join(authDir, 'credentials.json'), 'utf8'))
  assert.equal(creds.sentinel, 'keep-session')
  assert.equal(created, 2)
  assert.equal(ended, 1)
  assert.equal(parallel, 1)
  assert.ok(reconnects.length >= 1)
  const backupFiles = await fs.readdir(path.join(authDir, 'backups'))
  assert.ok(backupFiles.some(name => name.includes('disconnect-409')))
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})


test('pairing restart-required 515 reconnects with persisted registered auth', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-pairing-515-'))
  let created = 0
  const sockets = []
  const engine = {
    makeWASocket() {
      created += 1
      const ev = new EventEmitter()
      const socket = {
        ev,
        protocolState: 'authenticated',
        end() { socket.ended = true }
      }
      sockets.push(socket)
      if (created === 1) {
        setTimeout(() => {
          sockets[0].authMarked = true
          ev.emit('connection.update', { connection: 'open', authenticated: true })
          ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: Object.assign(new Error('restart required after pairing'), { statusCode: 515 }) } })
        }, 5)
      }
      return socket
    }
  }
  try {
    const sock = await makeWASocket({
      engine, authDir, requestPairingOnStart: false, autoFollowChannels: [],
      baseReconnectDelay: 1, reconnectJitter: 0, maxReconnectAttempts: 3
    })
    sock.authState.creds.registered = true
    await sock.__baileys && Promise.resolve()
    await new Promise(resolve => {
      const timer = setInterval(() => {
        if (sock.__baileys.generation >= 2) { clearInterval(timer); resolve() }
      }, 5)
    })
    assert.equal(created, 2)
    assert.equal(sock.authState.creds.registered, true)
    await sock.close()
  } finally {
    await fs.rm(authDir, { recursive: true, force: true })
  }
})

test('stale socket close event cannot tear down a newer generation', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-stale-socket-'))
  const sockets = []
  const engine = {
    makeWASocket() {
      const ev = new EventEmitter()
      const socket = { ev, protocolState: 'authenticated', end() {}, async requestPairingCode() { return 'REPAN1234' } }
      sockets.push(socket)
      return socket
    }
  }
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [] })
  const first = sockets[0]
  await sock.reconnectNow('rotation')
  const generation = sock.__baileys.generation
  assert.ok(sockets.length >= 2)
  first.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: Object.assign(new Error('old socket'), { statusCode: 408 }) } })
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(sock.__baileys.generation, generation)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('auth lock heartbeat keeps a live session lock from going stale', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-lock-heartbeat-'))
  const { acquireAuthLock } = await import('../src/auth/file-store.js')
  const first = await acquireAuthLock(authDir, { staleMs: 1000, heartbeatMs: 200 })
  await new Promise(resolve => setTimeout(resolve, 1300))
  await assert.rejects(() => acquireAuthLock(authDir, { staleMs: 1000, heartbeatMs: 200 }), error => error?.code === 'BAILEYS_AUTH_LOCKED')
  await first.release()
  const second = await acquireAuthLock(authDir, { staleMs: 1000, heartbeatMs: 200 })
  await second.release()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('signal session store serializes concurrent writes and keeps valid state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-signal-lock-'))
  const identity = (await import('../src/protocol/crypto/noise.js')).generateX25519KeyPair()
  const { createCompanionKeys } = await import('../src/auth/companion.js')
  const { NativeSignalSession } = await import('../src/protocol/signal/session.js')
  const { SignalSessionStore } = await import('../src/protocol/signal/store.js')
  const companion = createCompanionKeys({}, { preKeyCount: 2 })
  const { session: a } = NativeSignalSession.initiatorFromPreKeyBundle({ initiatorIdentityPrivate: identity.privateKey, responderBundle: companion })
  const { session: b } = NativeSignalSession.initiatorFromPreKeyBundle({ initiatorIdentityPrivate: identity.privateKey, responderBundle: companion })
  const store = new SignalSessionStore(dir)
  const jid = '123@s.whatsapp.net'
  await Promise.all([store.set(jid, a), store.set(jid, b)])
  const loaded = await store.get(jid)
  assert.ok(loaded)
  assert.doesNotThrow(() => loaded.exportState())
  await fs.rm(dir, { recursive: true, force: true })
})


test('high-volume sends stay serialized instead of flooding the socket', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-send-stress-'))
  let active = 0
  let maxActive = 0
  let sent = 0
  const engine = {
    makeWASocket() {
      const ev = new EventEmitter()
      return {
        ev,
        protocolState: 'authenticated',
        async sendMessage() {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise(resolve => setImmediate(resolve))
          sent += 1
          active -= 1
          return { key: { id: `m${sent}` } }
        },
        end() {}
      }
    }
  }
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [], sendMinDelayMs: 0, sendJitterMs: 0, maxSendQueue: 1000 })
  const total = 250
  await Promise.all(Array.from({ length: total }, (_, i) => sock.sendMessage(`62${i}@s.whatsapp.net`, { text: `msg-${i}` })))
  assert.equal(sent, total)
  assert.equal(maxActive, 1)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})


test('auth lock recovers a genuinely stale lock even when pid is reused', async () => {
  const { acquireAuthLock } = await import('../src/auth/file-store.js')
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-reused-pid-lock-'))
  const first = await acquireAuthLock(authDir, { lockStaleMs: 1000, heartbeatMs: 10_000 })
  await first.release()
  const lockPath = path.join(authDir, '.baileys.lock')
  await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, token: 'dead-process-token', createdAt: Date.now() - 10_000, heartbeatAt: Date.now() - 10_000 }))
  const recovered = await acquireAuthLock(authDir, { lockStaleMs: 1000, heartbeatMs: 100 })
  assert.ok(recovered.token)
  await recovered.release()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('auth lock rejects a stale-looking lock from the same live process', async () => {
  const { acquireAuthLock } = await import('../src/auth/file-store.js')
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-same-pid-lock-'))
  const first = await acquireAuthLock(authDir, { staleMs: 10, heartbeatMs: 20 })
  try {
    await new Promise(resolve => setTimeout(resolve, 30))
    await assert.rejects(() => acquireAuthLock(authDir, { staleMs: 10, heartbeatMs: 20 }), error => error?.code === 'BAILEYS_AUTH_LOCKED')
  } finally {
    await first.release()
    await fs.rm(authDir, { recursive: true, force: true })
  }
})

test('legacy auth clear preserves unrelated root json while removing known key files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-clear-safety-'))
  try {
    const { useMultiFileAuthState } = await import('../src/index.js')
    const state = await useMultiFileAuthState(dir)
    await state.state.keys.set({ session: { abc: Buffer.from([1, 2, 3]) } })
    await fs.writeFile(path.join(dir, 'my-app-state.json'), '{"keep":true}')
    await fs.writeFile(path.join(dir, 'random-file.json'), '{"keep":true}')
    const before = await fs.readdir(dir)
    assert.ok(before.some(name => name.startsWith('session-')))
    await state.state.keys.clear()
    assert.equal(await fs.readFile(path.join(dir, 'my-app-state.json'), 'utf8'), '{"keep":true}')
    assert.equal(await fs.readFile(path.join(dir, 'random-file.json'), 'utf8'), '{"keep":true}')
    const after = await fs.readdir(dir)
    assert.equal(after.some(name => name.startsWith('session-')), false)
    await state.release()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('persistent auth key writes also reject a lost ownership lock', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-key-lock-loss-'))
  try {
    const { useMultiFileAuthState } = await import('../src/index.js')
    const state = await useMultiFileAuthState(dir)
    await fs.writeFile(path.join(dir, '.baileys.lock'), JSON.stringify({ token: 'stolen', pid: process.pid, createdAt: Date.now() }))
    await assert.rejects(() => state.state.keys.set({ session: { abc: Buffer.from([1]) } }), error => error?.code === 'BAILEYS_AUTH_LOCK_LOST')
    await state.release()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('persistent auth detects a lost ownership lock before writing credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-lock-loss-'))
  try {
    const { useMultiFileAuthState } = await import('../src/index.js')
    const state = await useMultiFileAuthState(dir)
    const lockFile = path.join(dir, '.baileys.lock')
    await fs.writeFile(lockFile, JSON.stringify({ token: 'stolen', pid: process.pid, createdAt: Date.now() }))
    await assert.rejects(() => state.saveCreds({ pushName: 'lost-lock' }), error => error?.code === 'BAILEYS_AUTH_LOCK_LOST')
    await state.release()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('NodeClient malformed frame is reported without unhandled error crash', async () => {
  const ev = new (await import('node:events')).EventEmitter()
  const socket = { ev, sendEncryptedFrame() {} }
  const { NodeClient } = await import('../src/protocol/node-client.js')
  const client = new NodeClient(socket)
  let protocolErrors = 0
  ev.on('protocol.error', () => { protocolErrors += 1 })
  ev.emit('frame', Buffer.from([0xff, 0xff, 0xff]))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(protocolErrors, 1)
  client.close()
})

test('corrupt Signal session is quarantined instead of crashing the store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-signal-corrupt-'))
  try {
    const { SignalSessionStore } = await import('../src/protocol/signal/store.js')
    const store = new SignalSessionStore(dir)
    const jid = '628000000000@s.whatsapp.net'
    const file = path.join(dir, `${encodeURIComponent(jid)}.json`)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    await fs.writeFile(file, '{broken json')
    const session = await store.get(jid)
    assert.equal(session, null)
    const files = await fs.readdir(dir)
    assert.ok(files.some(name => name.includes('.corrupt-')))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})


test('send requested during reconnect waits for the replacement socket instead of hitting the closing generation', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-send-during-reconnect-'))
  const sockets = []
  let reconnectRelease
  const reconnectStarted = new Promise(resolve => { reconnectRelease = resolve })
  const engine = {
    async makeWASocket() {
      const ev = new EventEmitter()
      const id = sockets.length + 1
      const socket = {
        ev,
        protocolState: 'authenticated',
        async sendMessage(jid, content) { return { id, jid, content } },
        end() { this.closed = true }
      }
      sockets.push(socket)
      if (id === 2) reconnectRelease()
      return socket
    }
  }
  const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [], sendMinDelayMs: 0, sendJitterMs: 0, baseReconnectDelay: 1, reconnectJitter: 0 })
  const first = sockets[0]
  const reconnecting = sock.reconnectNow('test')
  while (sockets.length < 2) await new Promise(resolve => setImmediate(resolve))
  const result = await sock.sendMessage('123@s.whatsapp.net', { text: 'after-reconnect' })
  await reconnecting
  assert.equal(result.id, 2)
  assert.equal(first.closed, true)
  await sock.close()
  await fs.rm(authDir, { recursive: true, force: true })
})

test('requestPairingCode waits for native transport to become secure instead of failing after facade readiness', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-pairing-wait-'))
  let socket
  try {
    const engine = {
      makeWASocket() {
        const ev = new EventEmitter()
        socket = {
          ev,
          protocolState: 'connecting',
          closed: false,
          async waitForSecure() {
            await new Promise(resolve => setTimeout(resolve, 30))
            socket.protocolState = 'secure'
            return socket
          },
          async requestPairingCode(number, custom) {
            return custom ?? `${number.slice(-4)}1234`
          },
          end() { socket.closed = true; socket.protocolState = 'closed' }
        }
        return socket
      }
    }
    const sock = await makeWASocket({ engine, authDir, requestPairingOnStart: false, autoFollowChannels: [] })
    assert.equal(await sock.requestPairingCode('6281234567890', 'REPAN777'), 'REPAN777')
    assert.equal(socket.protocolState, 'secure')
    await sock.close()
  } finally {
    await fs.rm(authDir, { recursive: true, force: true })
  }
})

test('pairing reconnect keeps the original phone and silently renews the code', async () => {
  const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-pairing-reconnect-'))
  let socketId = 0
  const pairingCalls = []
  const sockets = []
  const engine = {
    async useMultiFileAuthState() {
      return { state: { creds: { registered: false, pairingActive: false } }, async saveCreds() {} }
    },
    makeWASocket() {
      const ev = new EventEmitter()
      const id = ++socketId
      const socket = {
        id,
        ev,
        protocolState: 'secure',
        async requestPairingCode(number, custom) {
          pairingCalls.push({ id, number, custom: custom ?? null })
          return custom ?? `CODE${String(id).padStart(4, '0')}`
        },
        end() { this.ended = true }
      }
      sockets.push(socket)
      return socket
    }
  }
  try {
    const sock = await makeWASocket({
      engine,
      authDir,
      pairingNumber: '6281234567890',
      requestPairingOnStart: true,
      pairingDelayMs: 0,
      pairingRenewalDelayMs: 0,
      autoFollowChannels: []
    })

    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(pairingCalls.length, 1)
    assert.equal(pairingCalls[0].number, '6281234567890')

    sockets[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: Object.assign(new Error('abnormal close'), { output: { statusCode: 408 } }) }
    })

    await new Promise(resolve => setTimeout(resolve, 3200))
    assert.equal(pairingCalls.length, 2)
    assert.equal(pairingCalls[1].number, '6281234567890')
    await sock.close()
  } finally {
    await fs.rm(authDir, { recursive: true, force: true })
  }
})
