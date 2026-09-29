import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const LOCAL_LOCKS = new Map()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160) || 'backup'
}

async function withLocalLock(key, work) {
  const previous = LOCAL_LOCKS.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(work)
  LOCAL_LOCKS.set(key, current)
  try {
    return await current
  } finally {
    if (LOCAL_LOCKS.get(key) === current) LOCAL_LOCKS.delete(key)
  }
}

export async function ensureAuthDir(dir) {
  const resolved = path.resolve(dir)
  await fs.mkdir(resolved, { recursive: true, mode: 0o700 })
  try { await fs.chmod(resolved, 0o700) } catch {}
  return resolved
}

export async function atomicWrite(file, data, options = {}) {
  const target = path.resolve(file)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const temp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  const mode = options.mode ?? 0o600
  const text = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
  let handle
  try {
    handle = await fs.open(temp, 'w', mode)
    await handle.writeFile(text)
    if (options.fsync !== false) {
      try { await handle.sync() } catch {}
    }
    await handle.close()
    handle = null
    try { await fs.chmod(temp, mode) } catch {}
    await fs.rename(temp, target)
    try { await fs.chmod(target, mode) } catch {}
    return target
  } finally {
    try { await handle?.close() } catch {}
    try { await fs.unlink(temp) } catch {}
  }
}

export async function writeMeta(dir, meta = {}) {
  const root = await ensureAuthDir(dir)
  return atomicWrite(
    path.join(root, 'meta.json'),
    JSON.stringify({
      ...meta,
      updatedAt: new Date().toISOString(),
      pid: process.pid
    }, null, 2),
    { mode: 0o600 }
  )
}

export async function clearAuthContents(dir, options = {}) {
  const root = await ensureAuthDir(dir)
  const preserve = new Set(options.preserve ?? ['backups', '.baileys.lock'])
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (preserve.has(entry.name)) continue
    try {
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true })
    } catch {}
  }
  return root
}

export async function backupAuthDir(dir, label = 'backup', options = {}) {
  const root = await ensureAuthDir(dir)
  const backupRoot = path.join(root, 'backups')
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupRoot, `${stamp}-${safeName(label)}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
  await fs.mkdir(target, { recursive: true, mode: 0o700 })
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'backups' || entry.name === '.baileys.lock' || entry.name.startsWith('.tmp-')) continue
    const source = path.join(root, entry.name)
    const destination = path.join(target, entry.name)
    try {
      await fs.cp(source, destination, { recursive: true, force: true, preserveTimestamps: true })
    } catch {}
  }
  const retention = Math.max(1, Number(options.retention ?? 5))
  const backups = (await fs.readdir(backupRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
  const stale = backups.slice(0, Math.max(0, backups.length - retention))
  await Promise.all(stale.map(entry => fs.rm(path.join(backupRoot, entry.name), { recursive: true, force: true }).catch(() => {})))
  return target
}

export async function acquireAuthLock(dir, options = {}) {
  const root = await ensureAuthDir(dir)
  const lockPath = path.join(root, '.baileys.lock')
  const staleMs = Math.max(5_000, Number(options.lockStaleMs ?? options.staleMs ?? 120_000))
  const waitMs = Math.max(0, Number(options.lockWaitMs ?? options.waitMs ?? 30_000))
  const pollMs = Math.max(50, Number(options.lockPollMs ?? options.pollMs ?? 250))
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(12).toString('hex')}`
  const started = Date.now()

  return withLocalLock(lockPath, async () => {
    while (true) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600)
        const payload = JSON.stringify({
          pid: process.pid,
          token,
          createdAt: Date.now(),
          heartbeatAt: Date.now()
        })
        await handle.writeFile(payload)
        await handle.close()

        let released = false
        const heartbeatMs = Math.max(100, Number(options.heartbeatMs ?? Math.floor(staleMs / 3)))
        let timer = setInterval(async () => {
          if (released) return
          try {
            const raw = await fs.readFile(lockPath, 'utf8')
            const current = JSON.parse(raw)
            if (current.token !== token) return
            await atomicWrite(lockPath, JSON.stringify({ ...current, heartbeatAt: Date.now() }), { mode: 0o600, fsync: false })
          } catch {}
        }, heartbeatMs)
        timer.unref?.()

        return {
          path: lockPath,
          token,
          async assertOwnership() {
            if (released) throw Object.assign(new Error('Auth lock sudah dilepas'), { code: 'BAILEYS_AUTH_LOCK_LOST' })
            try {
              const current = JSON.parse(await fs.readFile(lockPath, 'utf8'))
              if (current?.token !== token) {
                throw Object.assign(new Error('Auth lock ownership hilang; proses lain mengambil alih lock.'), {
                  code: 'BAILEYS_AUTH_LOCK_LOST',
                  authDir: root
                })
              }
            } catch (error) {
              if (error?.code === 'BAILEYS_AUTH_LOCK_LOST') throw error
              throw Object.assign(new Error('Auth lock tidak lagi tersedia.'), {
                code: 'BAILEYS_AUTH_LOCK_LOST',
                authDir: root,
                cause: error
              })
            }
            return true
          },
          async release() {
            if (released) return
            released = true
            clearInterval(timer)
            timer = null
            await withLocalLock(lockPath, async () => {
              try {
                const raw = await fs.readFile(lockPath, 'utf8')
                const current = JSON.parse(raw)
                if (current.token === token) await fs.unlink(lockPath)
              } catch (error) {
                if (error?.code !== 'ENOENT') throw error
              }
            })
          }
        }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        let stale = false
        try {
          const raw = JSON.parse(await fs.readFile(lockPath, 'utf8'))
          const heartbeat = Number(raw?.heartbeatAt ?? raw?.createdAt ?? 0)
          stale = heartbeat > 0 && Date.now() - heartbeat > staleMs
          if (Number(raw?.pid) === process.pid && !stale) {
            throw Object.assign(new Error(`Auth directory sedang dipakai proses yang sama: ${root}`), {
              code: 'BAILEYS_AUTH_LOCKED',
              authDir: root
            })
          }
        } catch (readError) {
          if (readError?.code === 'BAILEYS_AUTH_LOCKED') throw readError
          try {
            const stat = await fs.stat(lockPath)
            stale = Date.now() - stat.mtimeMs > staleMs
          } catch (readError) {
            if (readError?.code === 'ENOENT') continue
          }
        }
        if (stale) {
          try {
            await fs.unlink(lockPath)
            continue
          } catch {}
        }
        if (waitMs === 0 || Date.now() - started >= waitMs) {
          throw Object.assign(new Error(`Auth directory sedang dipakai proses lain: ${root}`), {
            code: 'BAILEYS_AUTH_LOCKED',
            authDir: root
          })
        }
        await sleep(pollMs)
      }
    }
  })
}
