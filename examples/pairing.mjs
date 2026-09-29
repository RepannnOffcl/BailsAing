import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { makeWASocket } from '@repanxtenka/baileys'
const rl = readline.createInterface({ input, output })
const argNumber = process.argv[2] ?? process.env.BAILEYS_PAIRING_NUMBER ?? ''
const number = argNumber || await rl.question('Masukkan nomor WhatsApp (internasional, contoh 62812...): ')
rl.close()

const sock = makeWASocket({
  authDir: './auth/repan',
  autoFollowChannels: [],
  botName: process.env.BOT_NAME ?? 'MyBot',
  browser: ['Ubuntu', 'Chrome', '1.0'],
  safePairingIdentity: true,
  requestPairingOnStart: false
})

sock.ev.on('pairing.qr', ({ qr }) => console.log('QR:', qr))
sock.ev.on('baileys.pairing', data => {
  console.log('PAIRING:', data)
  if (data?.code) {
    console.log('\nWhatsApp → Settings → Linked Devices → Link a Device → Link with phone number')
    console.log(`Masukkan kode: ${data.code}\n`)
  }
})
sock.ev.on('baileys.error', error => console.error('BAILSS ERROR:', error))
sock.ev.on('baileys.ready', () => console.log('CONNECTED'))
sock.ev.on('baileys.close', data => console.log('CLOSED:', data.code))

await sock
try {
  const custom = String(process.env.BOT_CUSTOM_PAIRING_CODE ?? '').trim() || undefined
  const code = custom
    ? await sock.requestPairingCode(number, custom)
    : await sock.requestPairingCode(number)
  console.log(`PAIRING CODE${custom ? ' (BOT CUSTOM)' : ''}:`, code)
} catch (error) {
  console.error('PAIRING FAILED:', error)
  await sock.close()
  process.exitCode = 1
}
