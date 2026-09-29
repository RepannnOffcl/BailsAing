import { makeWASocket } from '@repanxtenka/baileys'

const sock = makeWASocket({ authDir: './auth/qr', printQRInTerminal: true })
sock.ev.on('pairing.qr', ({ qr, ref }) => console.log('QR REF:', ref, '\nQR STRING:', qr))
sock.ev.on('baileys.pairing', data => { if (data.qr) console.log('QR STRING:', data.qr) })
sock.ev.on('baileys.ready', () => console.log('CONNECTED'))
sock.ev.on('baileys.close', data => console.log('CLOSED:', data.code))
await sock
