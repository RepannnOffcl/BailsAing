import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { NativeWebSocket } from './websocket.js'

export const WA_MAGIC = 6
export const WA_DICT_VERSION = 3
export const WA_HEADER = Buffer.from(['W'.charCodeAt(0), 'A'.charCodeAt(0), WA_MAGIC, WA_DICT_VERSION])
export const FRAME_MAX_SIZE = 1 << 24

function framePayload(data) {
  const payload = Buffer.from(data)
  if (payload.length > FRAME_MAX_SIZE) throw new RangeError('WhatsApp frame terlalu besar')
  const length = Buffer.alloc(3)
  length.writeUIntBE(payload.length, 0, 3)
  return Buffer.concat([length, payload])
}

export class WAFrameTransport extends EventEmitter {
  constructor(options = {}) {
    super()
    this.url = options.url ?? 'wss://web.whatsapp.com/ws/chat'
    this.origin = options.origin ?? 'https://web.whatsapp.com'
    this.ws = null
    this.opened = false
    this.closed = false
    this._sentIntro = false
    this.maxFrameSize = options.maxFrameSize ?? FRAME_MAX_SIZE
    this.WebSocket = options.WebSocketImpl
    this.connectTimeoutMs = options.connectTimeoutMs ?? 20_000
  }

  async open() {
    if (this.opened) return this
    const WS = this.WebSocket ?? NativeWebSocket
    this.ws = new WS(this.url, {
      headers: { Origin: this.origin },
      perMessageDeflate: false,
      maxPayload: this.maxFrameSize
    })
    const timeoutMs = Math.max(1_000, Number(this.connectTimeoutMs ?? 20_000))
    await new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        cleanup()
        const error = new Error(`WA websocket open timeout setelah ${timeoutMs} ms`)
        error.code = 'BAILEYS_WS_CONNECT_TIMEOUT'
        try { this.ws?.terminate?.() } catch {}
        try { this.ws?.close?.() } catch {}
        reject(error)
      }, timeoutMs)
      const finish = (fn, value) => {
        cleanup()
        fn(value)
      }
      const onOpen = () => { this.opened = true; finish(resolve) }
      const onError = err => finish(reject, err)
      const onClose = (code, reason) => finish(reject, new Error(`WA websocket closed before open: ${code} ${Buffer.from(reason ?? '').toString('utf8')}`))
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        timer = null
        this.ws.off?.('open', onOpen)
        this.ws.off?.('error', onError)
        this.ws.off?.('close', onClose)
      }
      this.ws.once('open', onOpen)
      this.ws.once('error', onError)
      this.ws.once('close', onClose)
    })
    this.ws.on('message', data => this.#handleMessage(data))
    this.ws.on('close', (code, reason) => {
      this.opened = false
      this.emit('close', { code, reason: Buffer.from(reason ?? '') })
    })
    this.ws.on('error', err => this.emit('error', err))
    return this
  }

  sendFrame(data) {
    if (!this.ws || !this.opened) throw new Error('WA websocket belum terbuka')
    const framed = framePayload(data)
    if (!this._sentIntro) {
      this._sentIntro = true
      this.ws.send(Buffer.concat([WA_HEADER, framed]))
      return
    }
    this.ws.send(framed)
  }

  sendRaw(data) {
    if (!this.ws || !this.opened) throw new Error('WA websocket belum terbuka')
    const payload = Buffer.from(data)
    if (payload.length > this.maxFrameSize) throw new RangeError('Raw WA payload terlalu besar')
    this.ws.send(payload)
  }

  close(code = 1000, reason = 'Baileys closed') {
    this.closed = true
    try { this.ws?.close(code, reason) } catch {}
    this.opened = false
  }

  #handleMessage(data) {
    try {
      const raw = data?.data ?? data
      const buf = Buffer.from(raw)
      let offset = 0
      while (offset < buf.length) {
        if (buf.length - offset < 3) throw new Error('WA frame length header truncated')
        const len = buf.readUIntBE(offset, 3)
        offset += 3
        if (len > this.maxFrameSize || offset + len > buf.length) throw new Error('WA frame length invalid')
        this.emit('frame', buf.subarray(offset, offset + len))
        offset += len
      }
    } catch (error) {
      this.emit('error', error)
    }
  }

  static randomTag(prefix = 'baileys') { return `${prefix}-${Date.now()}-${randomBytes(3).toString('hex')}` }
}
