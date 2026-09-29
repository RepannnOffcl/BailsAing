export class SendRateLimiter {
  #last = 0
  #queue = Promise.resolve()
  #minDelay
  #jitter
  #pending = 0
  #maxQueue
  #closed = false
  #cooldownUntil = 0

  constructor(options = {}) {
    this.#minDelay = Math.max(0, Number(options.minDelayMs ?? 300))
    this.#jitter = Math.max(0, Number(options.jitterMs ?? 75))
    this.#maxQueue = Math.max(1, Number(options.maxQueue ?? 1000))
  }

  get pending() { return this.#pending }

  backoff(ms = 1000) {
    const delay = Math.max(0, Number(ms) || 0)
    this.#cooldownUntil = Math.max(this.#cooldownUntil, Date.now() + delay)
  }

  schedule(task) {
    if (this.#closed) return Promise.reject(new Error('Send queue ditutup'))
    if (this.#pending >= this.#maxQueue) return Promise.reject(new Error('Send queue penuh'))
    this.#pending += 1
    const run = async () => {
      try {
        if (this.#closed) throw new Error('Send queue ditutup')
        const jitter = this.#jitter ? Math.floor(Math.random() * (this.#jitter + 1)) : 0
        const deadline = Math.max(this.#last + this.#minDelay + jitter, this.#cooldownUntil)
        const wait = Math.max(0, deadline - Date.now())
        if (wait) await new Promise(r => setTimeout(r, wait))
        this.#last = Date.now()
        return await task()
      } finally {
        this.#pending -= 1
      }
    }
    const next = this.#queue.then(run, run)
    this.#queue = next.catch(() => {})
    return next
  }

  close(error = new Error('Send queue ditutup')) {
    this.#closed = true
    return this.#queue.catch(() => error)
  }
}
