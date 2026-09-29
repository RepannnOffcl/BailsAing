import { EventEmitter } from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'
import { URL } from 'node:url'

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3
const MAX_HANDSHAKE_BYTES = 64 * 1024

function header(name, value) {
  return `${name}: ${value}\r\n`
}

function acceptFor(key) {
  return createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
}

function makeFrame(data, opcode = 2) {
  const payload = Buffer.from(data ?? '')
  const mask = randomBytes(4)
  let head
  if (payload.length < 126) {
    head = Buffer.from([0x80 | opcode, 0x80 | payload.length])
  } else if (payload.length <= 0xffff) {
    head = Buffer.allocUnsafe(4)
    head[0] = 0x80 | opcode
    head[1] = 0x80 | 126
    head.writeUInt16BE(payload.length, 2)
  } else {
    head = Buffer.allocUnsafe(10)
    head[0] = 0x80 | opcode
    head[1] = 0x80 | 127
    head.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  const masked = Buffer.allocUnsafe(payload.length)
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i & 3]
  return Buffer.concat([head, mask, masked])
}

export class NativeWebSocket extends EventEmitter {
  static CONNECTING = CONNECTING
  static OPEN = OPEN
  static CLOSING = CLOSING
  static CLOSED = CLOSED

  constructor(address, options = {}) {
    super()
    this.url = String(address)
    this.readyState = CONNECTING
    this.binaryType = 'nodebuffer'
    this._options = options
    this._socket = null
    this._rx = Buffer.alloc(0)
    this._fragments = []
    this._fragmentOpcode = null
    this._closeSent = false
    this._opened = false
    this._maxPayload = Math.max(1024, Number(options.maxPayload ?? (1 << 24)))
    this._connectPromise = this.#connect()
    this._connectPromise.catch(error => this.#fail(error))
  }

  #fail(error) {
    if (this.readyState === CLOSED) return
    this.emit('error', error)
    this.#finalClose(1006, Buffer.from(String(error?.message ?? 'websocket error')))
  }

  async #connect() {
    const url = new URL(this.url)
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new TypeError(`Unsupported WebSocket protocol: ${url.protocol}`)
    const port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80))
    const host = url.hostname
    const transportOptions = {
      host,
      port,
      servername: host,
      rejectUnauthorized: this._options.rejectUnauthorized !== false,
    }
    const socket = url.protocol === 'wss:' ? tls.connect(transportOptions) : net.connect({ host, port })
    this._socket = socket
    socket.setNoDelay?.(true)
    socket.on('error', error => {
      if (this.readyState !== CLOSED) this.emit('error', error)
    })
    socket.on('close', () => {
      if (this.readyState !== CLOSED) this.#finalClose(1006, Buffer.alloc(0))
    })
    socket.on('data', chunk => this.#consume(chunk))
    await new Promise((resolve, reject) => {
      const onConnect = () => { cleanup(); resolve() }
      const onError = error => { cleanup(); reject(error) }
      const cleanup = () => {
        socket.off?.('connect', onConnect)
        socket.off?.('secureConnect', onConnect)
        socket.off?.('error', onError)
      }
      socket.once(url.protocol === 'wss:' ? 'secureConnect' : 'connect', onConnect)
      socket.once('error', onError)
    })

    const key = randomBytes(16).toString('base64')
    this._lastKey = key
    const path = `${url.pathname || '/'}${url.search || ''}`
    const headers = this._options.headers ?? {}
    let request = `GET ${path} HTTP/1.1\r\n`
    request += header('Host', url.port ? `${host}:${url.port}` : host)
    request += header('Upgrade', 'websocket')
    request += header('Connection', 'Upgrade')
    request += header('Sec-WebSocket-Key', key)
    request += header('Sec-WebSocket-Version', '13')
    for (const [name, value] of Object.entries(headers)) {
      if (value == null) continue
      request += header(name, value)
    }
    request += '\r\n'
    socket.write(request)

    await new Promise((resolve, reject) => {
      const timeoutMs = Math.max(1000, Number(this._options.handshakeTimeoutMs ?? 20000))
      const timer = setTimeout(() => reject(Object.assign(new Error(`WebSocket handshake timeout setelah ${timeoutMs} ms`), { code: 'BAILEYS_WS_HANDSHAKE_TIMEOUT' })), timeoutMs)
      const onOpen = () => { clearTimeout(timer); resolve() }
      const onError = error => { clearTimeout(timer); reject(error) }
      this.once('open', onOpen)
      this.once('error', onError)
    })
  }

  #consume(chunk) {
    this._rx = Buffer.concat([this._rx, Buffer.from(chunk)])
    if (!this._opened) {
      if (this._rx.length > MAX_HANDSHAKE_BYTES) return this.#fail(new Error('WebSocket handshake response terlalu besar'))
      const marker = this._rx.indexOf('\r\n\r\n')
      if (marker < 0) return
      const headerBlock = this._rx.subarray(0, marker).toString('latin1')
      this._rx = this._rx.subarray(marker + 4)
      const lines = headerBlock.split('\r\n')
      const status = lines.shift() ?? ''
      const match = /^HTTP\/\d\.\d\s+(\d{3})/.exec(status)
      if (!match || Number(match[1]) !== 101) return this.#fail(new Error(`WebSocket handshake rejected: ${status}`))
      const responseHeaders = new Map()
      for (const line of lines) {
        const index = line.indexOf(':')
        if (index > 0) responseHeaders.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
      }
      const accept = responseHeaders.get('sec-websocket-accept')
      const expected = acceptFor(this._lastKey ?? '')
      if (!accept) return this.#fail(new Error('WebSocket handshake missing Sec-WebSocket-Accept'))
      if (!this._lastKey || accept !== expected) return this.#fail(new Error('WebSocket Sec-WebSocket-Accept tidak valid'))
      this._opened = true
      this.readyState = OPEN
      this.emit('open')
    }
    this.#consumeFrames()
  }

  #consumeFrames() {
    while (this._rx.length >= 2) {
      const first = this._rx[0]
      const second = this._rx[1]
      const fin = Boolean(first & 0x80)
      const opcode = first & 0x0f
      const masked = Boolean(second & 0x80)
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (this._rx.length < 4) return
        length = this._rx.readUInt16BE(2); offset = 4
      } else if (length === 127) {
        if (this._rx.length < 10) return
        const big = this._rx.readBigUInt64BE(2)
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return this.#fail(new Error('WebSocket payload terlalu besar'))
        length = Number(big); offset = 10
      }
      if (length > this._maxPayload) return this.#fail(new RangeError(`WebSocket payload melebihi ${this._maxPayload} byte`))
      const maskLength = masked ? 4 : 0
      if (this._rx.length < offset + maskLength + length) return
      const mask = masked ? this._rx.subarray(offset, offset + 4) : null
      offset += maskLength
      const payload = Buffer.from(this._rx.subarray(offset, offset + length))
      this._rx = this._rx.subarray(offset + length)
      if (masked && mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3]

      const isControl = opcode >= 8
      if (isControl) {
        if (!fin || payload.length > 125) return this.#fail(new Error('WebSocket control frame invalid'))
        if (opcode === 8) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000
          const reason = payload.length > 2 ? payload.subarray(2) : Buffer.alloc(0)
          if (!this._closeSent) this.#sendClose(code)
          this.#finalClose(code, reason)
        } else if (opcode === 9) {
          this.#sendControl(10, payload)
          this.emit('ping', payload)
        } else if (opcode === 10) {
          this.emit('pong', payload)
        }
        continue
      }

      if (opcode === 0) {
        if (this._fragmentOpcode == null) return this.#fail(new Error('WebSocket continuation tanpa fragment'))
        this._fragments.push(payload)
        if (fin) {
          const data = Buffer.concat(this._fragments)
          const fragmentOpcode = this._fragmentOpcode
          this._fragments = []
          this._fragmentOpcode = null
          this.emit('message', fragmentOpcode === 1 ? Buffer.from(data.toString()) : data)
        }
        continue
      }

      if (opcode !== 1 && opcode !== 2) return this.#fail(new Error(`WebSocket opcode ${opcode} tidak didukung`))
      if (this._fragmentOpcode != null) return this.#fail(new Error('WebSocket new data frame saat fragment aktif'))
      if (fin) this.emit('message', opcode === 1 ? Buffer.from(payload.toString()) : payload)
      else {
        this._fragmentOpcode = opcode
        this._fragments = [payload]
      }
    }
  }

  #sendControl(opcode, data) {
    if (this.readyState !== OPEN && this.readyState !== CLOSING) return
    try { this._socket?.write(makeFrame(data, opcode)) } catch (error) { this.emit('error', error) }
  }

  #sendClose(code = 1000, reason = '') {
    if (this._closeSent) return
    this._closeSent = true
    this.readyState = CLOSING
    const reasonBuf = Buffer.from(String(reason)).subarray(0, 123)
    const body = Buffer.allocUnsafe(2 + reasonBuf.length)
    body.writeUInt16BE(Number(code) || 1000, 0)
    reasonBuf.copy(body, 2)
    this.#sendControl(8, body)
  }

  #finalClose(code, reason) {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    this._opened = false
    const socket = this._socket
    this._socket = null
    try { socket?.destroy?.() } catch {}
    this.emit('close', code, Buffer.from(reason ?? ''))
  }

  send(data) {
    if (this.readyState !== OPEN) throw new Error('WebSocket belum terbuka')
    const payload = Buffer.from(data ?? '')
    if (payload.length > this._maxPayload) throw new RangeError(`WebSocket payload melebihi ${this._maxPayload} byte`)
    this._socket.write(makeFrame(payload, 2))
  }

  close(code = 1000, reason = '') {
    if (this.readyState === CLOSED) return
    if (this.readyState === CONNECTING) {
      this.readyState = CLOSING
      try { this._socket?.destroy?.() } catch {}
      return this.#finalClose(code, reason)
    }
    this.#sendClose(code, reason)
    setTimeout(() => { if (this.readyState !== CLOSED) this.#finalClose(code, Buffer.from(reason)) }, 1000).unref?.()
  }

  terminate() {
    if (this.readyState === CLOSED) return
    try { this._socket?.destroy?.() } catch {}
    this.#finalClose(1006, Buffer.alloc(0))
  }
}

export default NativeWebSocket
