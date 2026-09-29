import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from '../../auth/file-store.js'
import { NativeSignalSession } from './session.js'

export class SignalSessionStore {
  constructor(dir) {
    this.dir = path.resolve(dir)
    this.locks = new Map()
  }
  async #file(jid) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 })
    const safe = encodeURIComponent(String(jid))
    return path.join(this.dir, `${safe}.json`)
  }
  async #withLock(jid, work) {
    const key = String(jid)
    const previous = this.locks.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    this.locks.set(key, current)
    try { return await current }
    finally { if (this.locks.get(key) === current) this.locks.delete(key) }
  }
  async get(jid) {
    return this.#withLock(jid, async () => {
      try {
        const raw = JSON.parse(await fs.readFile(await this.#file(jid), 'utf8'))
        return new NativeSignalSession(raw)
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        const structuralCorruption = error?.name === 'SyntaxError' || error?.name === 'TypeError' || error?.name === 'RangeError' || (!error?.code && /Signal|Buffer|key|counter|ratchet/i.test(String(error?.message ?? '')))
        if (!structuralCorruption) throw error
        const file = await this.#file(jid)
        try {
          const quarantine = `${file}.corrupt-${Date.now()}`
          await fs.rename(file, quarantine)
          try { await fs.chmod(quarantine, 0o600) } catch {}
        } catch {}
        return null
      }
    })
  }

  async update(jid, worker) {
    return this.#withLock(jid, async () => {
      let session = null
      try {
        const raw = JSON.parse(await fs.readFile(await this.#file(jid), 'utf8'))
        session = new NativeSignalSession(raw)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const result = await worker(session)
      if (result?.delete === true) {
        try { await fs.unlink(await this.#file(jid)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
        return result.value
      }
      const next = result?.session ?? result
      if (!(next instanceof NativeSignalSession)) throw new TypeError('Signal session update harus mengembalikan NativeSignalSession')
      const file = await this.#file(jid)
      await atomicWrite(file, JSON.stringify(next.exportState()), { mode: 0o600 })
      return result?.value ?? next
    })
  }

  async set(jid, session) {
    return this.#withLock(jid, async () => {
      const file = await this.#file(jid)
      await atomicWrite(file, JSON.stringify(session.exportState()), { mode: 0o600 })
    })
  }
  async delete(jid) {
    return this.#withLock(jid, async () => {
      try { await fs.unlink(await this.#file(jid)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    })
  }
}
