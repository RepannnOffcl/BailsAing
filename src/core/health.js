export class SessionHealth {
  decryptErrors = 0
  sendErrors = 0
  protocolErrors = 0
  reconnects = 0
  framesRx = 0
  framesTx = 0
  lastOpenAt = null
  lastFrameAt = null
  lastMessageAt = null
  lastErrorAt = null
  lastDisconnectAt = null
  lastDisconnectCode = null
  consecutiveKeepaliveErrors = 0

  markOpen() {
    this.lastOpenAt = Date.now()
    this.lastFrameAt = Date.now()
    this.consecutiveKeepaliveErrors = 0
  }
  markFrame() { this.framesRx += 1; this.lastFrameAt = Date.now() }
  markTx() { this.framesTx += 1 }
  markMessage() { this.lastMessageAt = Date.now(); this.markFrame() }
  markDecryptError() { this.decryptErrors += 1; this.lastErrorAt = Date.now(); this.markFrame() }
  markProtocolError() { this.protocolErrors += 1; this.lastErrorAt = Date.now(); this.markFrame() }
  markSendError() { this.sendErrors += 1; this.lastErrorAt = Date.now() }
  markReconnect() { this.reconnects += 1 }
  markDisconnect(code = null) {
    this.lastDisconnectAt = Date.now()
    this.lastDisconnectCode = code ?? null
  }
  markKeepaliveSuccess() { this.consecutiveKeepaliveErrors = 0 }
  markKeepaliveError() { this.consecutiveKeepaliveErrors += 1; this.lastErrorAt = Date.now() }

  snapshot() {
    return {
      decryptErrors: this.decryptErrors,
      sendErrors: this.sendErrors,
      protocolErrors: this.protocolErrors,
      reconnects: this.reconnects,
      framesRx: this.framesRx,
      framesTx: this.framesTx,
      lastOpenAt: this.lastOpenAt,
      lastFrameAt: this.lastFrameAt,
      lastMessageAt: this.lastMessageAt,
      lastErrorAt: this.lastErrorAt,
      lastDisconnectAt: this.lastDisconnectAt,
      lastDisconnectCode: this.lastDisconnectCode,
      consecutiveKeepaliveErrors: this.consecutiveKeepaliveErrors,
      ageMs: this.lastOpenAt == null ? null : Math.max(0, Date.now() - this.lastOpenAt)
    }
  }
}

export class Watchdog {
  #timer = null
  #fired = false
  constructor(options = {}) {
    this.intervalMs = Math.max(5_000, Number(options.intervalMs ?? 15_000))
    this.deadMs = Math.max(this.intervalMs * 2, Number(options.deadMs ?? 45_000))
  }
  start(health, onDead) {
    this.stop()
    this.#fired = false
    this.#timer = setInterval(() => {
      const last = health.lastFrameAt ?? health.lastOpenAt
      if (!this.#fired && last && Date.now() - last > this.deadMs) {
        this.#fired = true
        try { onDead(new Error('Baileys socket watchdog timeout')) } catch {}
      }
    }, this.intervalMs)
    this.#timer.unref?.()
  }
  stop() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; this.#fired = false }
}
