export function normalizeJid(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('JID harus berupa string')
  return value.trim()
}

export function normalizePhone(value) {
  const number = String(value ?? '').replace(/\D/g, '')
  if (!number || number.length < 7) throw new TypeError('Nomor pairing tidak valid')
  return number
}

export function normalizeNewsletterJids(value) {
  if (value == null) return []
  const list = Array.isArray(value) ? value : [value]
  const unique = [...new Set(list.map(v => String(v).trim()).filter(Boolean))]
  for (const jid of unique) if (!/^\d+@newsletter$/.test(jid)) throw new TypeError(`Newsletter JID tidak valid: ${jid}`)
  return unique
}
