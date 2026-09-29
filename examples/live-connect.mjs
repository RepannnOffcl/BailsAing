import makeWASocket from '@repanxtenka/baileys'

const authDir = process.env.BAILEYS_AUTH_DIR ?? './auth/baileys'
const pairingNumber = process.env.BAILEYS_PAIRING_NUMBER?.trim() || null

console.log('[Baileys] Direct WhatsApp connectivity probe')
console.log(`[Baileys] authDir=${authDir}`)
console.log(`[Baileys] pairing=${pairingNumber ? 'enabled' : 'QR mode'}`)
console.log('[Baileys] latest WA Web version is required; stale fallback is disabled')

const sock = makeWASocket({
  authDir,
  printQRInTerminal: !pairingNumber,
  pairingNumber: pairingNumber ?? undefined,
  requestPairingOnStart: Boolean(pairingNumber),
  requireLatestVersion: true,
  autoFollowChannels: [],
  allowUnknownDisconnectRetry: false
})

sock.ev.on('web.version', info => {
  console.log(`[Baileys] WA Web version=${info.version.join('.')} source=${info.source}`)
})
sock.ev.on('web.version.error', error => {
  console.error('[Baileys] WA Web version error:', error?.stack ?? error)
})
sock.ev.on('connection.update', update => {
  if (update.connection) console.log(`[Baileys] connection=${update.connection}`)
  if (update.qr) console.log('[Baileys] QR received')
  if (update.lastDisconnect?.error) console.error('[Baileys] disconnect:', update.lastDisconnect.error)
})
sock.ev.on('transport.error', error => console.error('[Baileys] transport.error:', error?.stack ?? error))
sock.ev.on('protocol.error', error => console.error('[Baileys] protocol.error:', error?.stack ?? error))
sock.ev.on('baileys.close', ({ error, code }) => console.error(`[Baileys] close code=${code}:`, error?.stack ?? error))
sock.ev.on('baileys.ready', () => console.log('[Baileys] READY — direct WhatsApp connection is authenticated.'))
sock.ev.on('baileys.error', error => console.error('[Baileys] ERROR:', error?.stack ?? error))

try {
  await sock
  console.log('[Baileys] Initial lifecycle ready.')
} catch (error) {
  console.error('[Baileys] Initial connection failed:', error?.stack ?? error)
  process.exitCode = 1
}

const shutdown = async signal => {
  console.log(`[Baileys] ${signal} → closing cleanly...`)
  try { await sock.close() } catch (error) { console.error('[Baileys] shutdown error:', error?.stack ?? error) }
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
