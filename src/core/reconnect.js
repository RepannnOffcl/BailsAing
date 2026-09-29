export const DisconnectCode = Object.freeze({
  badSession: 500,
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  loggedOut: 401,
  forbidden: 403,
  multideviceMismatch: 411,
  timedOut: 504,
  restartRequired: 515,
  rateLimited: 429,
  connectionIdle: 405,
  badAck: 406,
  temporary: 409,
  unavailableService: 503
})

const DEFAULT_RETRYABLE = new Set([
  DisconnectCode.connectionClosed,
  DisconnectCode.connectionLost,
  DisconnectCode.connectionIdle,
  DisconnectCode.badAck,
  DisconnectCode.temporary,
  DisconnectCode.unavailableService,
  DisconnectCode.timedOut,
  DisconnectCode.restartRequired,
])

export function getDisconnectCode(error) {
  const raw = error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode ?? error?.status ?? error?.wsCode ?? error?.code ?? null
  const code = Number(raw)
  if (code === 1006) return DisconnectCode.connectionLost
  if (code === 1008) return DisconnectCode.forbidden
  if (code === 1011) return DisconnectCode.unavailableService
  return raw == null || raw === '' ? null : (Number.isFinite(code) ? code : raw)
}

export function shouldReconnect(error, options = {}) {
  const code = getDisconnectCode(error)
  if (code == null) return options.unknownIsRetryable !== false
  if (code === DisconnectCode.loggedOut || code === DisconnectCode.connectionReplaced || code === DisconnectCode.forbidden) return false
  if (code === DisconnectCode.badSession) return options.retryBadSession === true
  if (code === DisconnectCode.multideviceMismatch) return options.retryMultideviceMismatch === true
  return DEFAULT_RETRYABLE.has(code)
}

export function backoffDelay(attempt, options = {}) {
  const base = Math.max(100, Number(options.baseReconnectDelay ?? 2000))
  const max = Math.max(base, Number(options.maxReconnectDelay ?? 60_000))
  const jitter = Math.max(0, Number(options.reconnectJitter ?? 350))
  const exponent = Math.min(10, Math.max(0, Number(attempt) - 1))
  const delay = Math.min(max, base * (2 ** exponent))
  return Math.round(delay + (jitter ? Math.random() * jitter : 0))
}

export class ReconnectController {
  #running = null
  #timer = null
  #attempt = 0
  #cancelled = false
  #reject = null
  #resolve = null

  get attempt() { return this.#attempt }
  get pending() { return Boolean(this.#running || this.#timer) }

  cancel(reason = new Error('Reconnect dibatalkan')) {
    this.#cancelled = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#reject?.(reason)
    this.#reject = null
    this.#resolve = null
    this.#running = null
    this.#attempt = 0
  }

  complete(value = undefined) {
    if (!this.#running) return false
    this.#cancelled = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    const resolve = this.#resolve
    this.#resolve = null
    this.#reject = null
    this.#attempt = 0
    this.#running = null
    resolve?.(value)
    return true
  }

  run(task, options = {}) {
    if (this.#running) return this.#running
    const configuredMax = Number(options.maxReconnectAttempts ?? 0)
    const maxAttempts = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.max(1, Math.floor(configuredMax)) : Infinity
    this.#cancelled = false
    this.#running = new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      const schedule = () => {
        if (this.#cancelled) return
        this.#attempt += 1
        if (this.#attempt > maxAttempts) {
          this.#running = null
          this.#reject = null
          this.#resolve = null
          this.#attempt = 0
          reject(new Error('Maximum reconnect attempts reached'))
          return
        }
        const attempt = this.#attempt
        const delay = backoffDelay(attempt, options)
        this.#timer = setTimeout(async () => {
          this.#timer = null
          if (this.#cancelled) return
          try {
            const value = await task(attempt, delay)
            if (this.#cancelled) return
            this.#attempt = 0
            this.#running = null
            this.#reject = null
            resolve(value)
          } catch (error) {
            if (this.#cancelled) return
            if (this.#attempt >= maxAttempts) {
              this.#running = null
              this.#reject = null
              this.#resolve = null
              this.#attempt = 0
              reject(error)
              return
            }
            schedule()
          }
        }, delay)
      }
      schedule()
    })
    return this.#running
  }
}
