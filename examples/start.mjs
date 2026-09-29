import makeWASocket from '@repanxtenka/baileys'

const sock = makeWASocket({
  authDir: process.env.BAILEYS_AUTH_DIR ?? './auth/baileys',
  printQRInTerminal: true,
  requestPairingOnStart: false,
  pairingReadyTimeoutMs: 30_000,
  pairingCodeTimeoutMs: 30_000,
  autoFollowChannels: [],
  botName: process.env.BOT_NAME ?? 'MyBot',
  browser: ['Ubuntu', 'Chrome', '1.0'],
  safePairingIdentity: true,
})

sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
  if (qr) console.log('[Baileys] QR baru tersedia.')
  if (connection) console.log(`[Baileys] connection=${connection}`)
  if (lastDisconnect?.error) console.error('[Baileys] disconnect:', lastDisconnect.error.message ?? lastDisconnect.error)
})
sock.ev.on('baileys.ready', () => console.log('[Baileys] READY — session tersimpan dan bot aktif.'))
sock.ev.on('baileys.error', error => console.error('[Baileys] ERROR:', error?.stack ?? error))
sock.ev.on('pairing.error', error => console.error('[Baileys] PAIRING ERROR:', error?.stack ?? error))
sock.ev.on('baileys.pairing', ({ code, phone }) => {
  if (!code) return
  console.log(`[Baileys] Pairing code: ${code} (phone ${phone})`)
  console.log('[Baileys] WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number')
})

await sock
if (!sock.authState?.creds?.registered && process.env.BAILEYS_PAIRING_NUMBER) {
  try {
    const custom = String(process.env.BOT_CUSTOM_PAIRING_CODE ?? '').trim() || undefined
    const code = custom
      ? await sock.requestPairingCode(process.env.BAILEYS_PAIRING_NUMBER, custom)
      : await sock.requestPairingCode(process.env.BAILEYS_PAIRING_NUMBER)
    console.log(`[Baileys] Pairing code${custom ? ' (BOT CUSTOM)' : ''}: ${code}`)
  } catch (error) {
    console.error('[Baileys] Pairing gagal:', error?.stack ?? error)
  }
}

const shutdown = async signal => {
  console.log(`[Baileys] ${signal} → shutdown aman...`)
  await sock.close()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
