import { EventEmitter } from 'node:events'

export class StableEventBus {
  #emitter = new EventEmitter()
  #subscriptions = new Map()
  #forward = new WeakMap()
  #once = new Map()
  #current = null
  #closed = false

  setMaxListeners(value) { this.#emitter.setMaxListeners(value); return this }

  on(event, listener) {
    this.#ensureOpen()
    if (typeof listener !== 'function') throw new TypeError('listener harus function')
    if (!this.#subscriptions.has(event)) this.#subscriptions.set(event, new Set())
    if (this.#subscriptions.get(event).has(listener)) return this
    this.#subscriptions.get(event).add(listener)
    this.#emitter.on(event, listener)
    this.#attach(event, listener)
    return this
  }

  once(event, listener) {
    this.#ensureOpen()
    if (typeof listener !== 'function') throw new TypeError('listener harus function')
    if (!this.#once.has(event)) this.#once.set(event, new WeakSet())
    this.#once.get(event).add(listener)
    return this.on(event, listener)
  }

  off(event, listener) {
    const listeners = this.#subscriptions.get(event)
    if (!listeners?.has(listener)) return this
    listeners.delete(listener)
    this.#detach(event, listener)
    this.#emitter.off(event, listener)
    this.#once.get(event)?.delete?.(listener)
    if (listeners.size === 0) {
      this.#subscriptions.delete(event)
      this.#once.delete(event)
    }
    return this
  }

  addListener(event, listener) { return this.on(event, listener) }
  removeListener(event, listener) { return this.off(event, listener) }

  removeAllListeners(event) {
    const names = event ? [event] : [...this.#subscriptions.keys()]
    for (const name of names) {
      for (const listener of [...(this.#subscriptions.get(name) ?? [])]) this.off(name, listener)
    }
    return this
  }

  listenerCount(event) { return this.#subscriptions.get(event)?.size ?? 0 }
  listeners(event) { return [...(this.#subscriptions.get(event) ?? [])] }
  emit(event, ...args) { return this.#emitter.emit(event, ...args) }

  attachSocket(socket) {
    if (this.#closed) return this
    if (this.#current && this.#current !== socket) this.detachSocket(this.#current)
    this.#current = socket
    for (const [event, listeners] of this.#subscriptions) for (const listener of listeners) this.#attach(event, listener, socket)
    return this
  }

  detachSocket(socket = this.#current) {
    if (!socket?.ev) return this
    for (const [event, listeners] of this.#subscriptions) for (const listener of listeners) this.#detach(event, listener, socket)
    if (socket === this.#current) this.#current = null
    return this
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.detachSocket()
    this.removeAllListeners()
    this.#emitter.removeAllListeners()
  }

  #ensureOpen() { if (this.#closed) throw new Error('Event bus is closed') }

  #attach(event, listener, socket = this.#current) {
    if (!socket?.ev || event.includes('.baileys.')) return
    let bySocket = this.#forward.get(listener)
    if (!bySocket) this.#forward.set(listener, bySocket = new Map())
    if (bySocket.has(socket)) return
    const target = (...args) => {
      const once = this.#once.get(event)?.has(listener) ?? false
      if (once) this.off(event, listener)
      return listener(...args)
    }
    bySocket.set(socket, { event, target })
    socket.ev.on?.(event, target)
  }

  #detach(event, listener, socket = this.#current) {
    if (!socket?.ev) return
    const bySocket = this.#forward.get(listener)
    const entry = bySocket?.get(socket)
    if (!entry || entry.event !== event) return
    socket.ev.off?.(event, entry.target)
    bySocket.delete(socket)
    if (!bySocket.size) this.#forward.delete(listener)
  }
}
