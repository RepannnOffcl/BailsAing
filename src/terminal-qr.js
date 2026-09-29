import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let qrcode = null
try { qrcode = require('qrcode-terminal') } catch {}

let lastRendered = null
let renderTimer = null

export function renderTerminalQR(value, options = {}) {
  const text = String(value ?? '')
  if (!text) return false
  if (options.force !== true && !process.stdout?.isTTY) return false
  if (lastRendered === text) return false
  lastRendered = text
  if (renderTimer) clearTimeout(renderTimer)
  if (options.clear !== false) process.stdout.write('\x1b[2J\x1b[H')
  process.stdout.write('\n=== BAILEYS QR LOGIN ===\n')
  try {
    if (!qrcode?.generate) {
      process.stdout.write(`QR payload (renderer unavailable): ${text}\n`)
      return false
    }
    qrcode.generate(text, { small: options.small !== false }, rendered => {
      process.stdout.write(`${rendered}\n`)
      if (options.footer !== false) process.stdout.write('Scan QR ini dari WhatsApp → Perangkat tertaut → Tautkan perangkat.\n\n')
    })
  } catch (error) {
    process.stderr.write(`[Baileys] QR renderer gagal: ${error?.message ?? error}\n`)
    return false
  }
  const ttl = Math.max(0, Number(options.clearAfterMs ?? 0))
  if (ttl > 0) renderTimer = setTimeout(() => { lastRendered = null; renderTimer = null }, ttl).unref?.()
  return true
}

export function resetTerminalQR() {
  lastRendered = null
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = null
}
