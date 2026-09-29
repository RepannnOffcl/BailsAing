import crypto from 'node:crypto'

const DEFAULT_BASE = 'https://wa.me/settings/linked_devices#'

function asBase64(value) {
  const raw = Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(String(value), 'base64')
  return raw.toString('base64')
}

function decodeBase64UrlPart(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64')
}

export function buildLinkedDeviceQR({
  ref,
  noisePublicKey,
  identityPublicKey,
  advSecretKey,
  clientType = 'web',
  baseUrl = DEFAULT_BASE
} = {}) {
  if (!ref) throw new TypeError('QR ref wajib diisi')
  const noise = Buffer.isBuffer(noisePublicKey) || noisePublicKey instanceof Uint8Array
    ? Buffer.from(noisePublicKey) : Buffer.from(String(noisePublicKey ?? ''), 'base64')
  const identity = Buffer.isBuffer(identityPublicKey) || identityPublicKey instanceof Uint8Array
    ? Buffer.from(identityPublicKey) : Buffer.from(String(identityPublicKey ?? ''), 'base64')
  const adv = Buffer.isBuffer(advSecretKey) || advSecretKey instanceof Uint8Array
    ? Buffer.from(advSecretKey) : Buffer.from(String(advSecretKey ?? ''), 'base64')
  if (noise.length !== 32) throw new TypeError('QR noise public key harus 32 byte')
  if (identity.length !== 32) throw new TypeError('QR identity public key harus 32 byte')
  if (adv.length !== 32) throw new TypeError('QR adv secret harus 32 byte')
  const parts = [
    String(ref),
    asBase64(noise),
    asBase64(identity),
    asBase64(adv),
    String(clientType)
  ]
  return `${baseUrl}${parts.join(',')}`
}

export function parseLinkedDeviceQR(input, { baseUrl = DEFAULT_BASE } = {}) {
  const raw = String(input ?? '').trim()
  const fragment = raw.startsWith(baseUrl)
    ? raw.slice(baseUrl.length)
    : raw.includes('#')
      ? raw.slice(raw.indexOf('#') + 1)
      : raw
  const parts = fragment.split(',')
  if (parts.length < 4) throw new TypeError('Linked-device QR payload tidak lengkap')
  const [ref, noisePublicKey, identityPublicKey, advSecretKey, clientType = 'web'] = parts
  const decoded = {
    ref,
    noisePublicKey: decodeBase64UrlPart(noisePublicKey),
    identityPublicKey: decodeBase64UrlPart(identityPublicKey),
    advSecretKey: decodeBase64UrlPart(advSecretKey),
    clientType
  }
  if (decoded.noisePublicKey.length !== 32) throw new TypeError('QR noise public key harus 32 byte')
  if (decoded.identityPublicKey.length !== 32) throw new TypeError('QR identity public key harus 32 byte')
  if (decoded.advSecretKey.length !== 32) throw new TypeError('QR adv secret harus 32 byte')
  return decoded
}

export function createQRReference(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) throw new RangeError('QR reference length invalid')
  return crypto.randomBytes(bytes).toString('base64url')
}

export function parsePairDeviceNode(node) {
  if (!node || typeof node !== 'object') return []
  const out = []
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()
    if (current.tag === 'pair-device') {
      const ref = current.attrs?.ref ?? current.attrs?.reference
      if (ref) out.push({ ref, node: current })
    }
    if (Array.isArray(current.content)) for (const child of current.content) stack.push(child)
  }
  return out
}

export function findNodeChild(node, tag) {
  if (!node) return null
  if (node.tag === tag) return node
  if (!Array.isArray(node.content)) return null
  for (const child of node.content) {
    const found = findNodeChild(child, tag)
    if (found) return found
  }
  return null
}
