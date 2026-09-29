import crypto from 'node:crypto'

const P = (1n << 255n) - 19n
const L = (1n << 252n) + 27742317777372353535851937790883648493n
const D = mod(-121665n * modInv(121666n))
const BX = 15112221349535400772501151409588531511454012693041857206046113283949847762202n
const BY = 46316835694926478169428394003475163141307993866256225615783033603165251855960n
const ZERO = 0n
const ONE = 1n

function mod(a) { const r = a % P; return r < 0n ? r + P : r }
function modL(a) { const r = a % L; return r < 0n ? r + L : r }
function powMod(a, e, m = P) {
  let x = a % m
  let n = e
  let out = 1n
  while (n > 0n) { if (n & 1n) out = (out * x) % m; x = (x * x) % m; n >>= 1n }
  return out
}
function modInv(a) { return powMod(mod(a), P - 2n) }
function leToBigInt(bytes) { return BigInt(`0x${Buffer.from(bytes).reverse().toString('hex') || '00'}`) }
function bigIntToLE(value, size = 32) {
  let n = BigInt(value)
  const out = Buffer.alloc(size)
  for (let i = 0; i < size; i++) { out[i] = Number(n & 0xffn); n >>= 8n }
  if (n !== 0n) throw new RangeError('integer tidak muat')
  return out
}
function clampX25519(raw) {
  const k = Buffer.from(raw)
  if (k.length !== 32) throw new RangeError('X25519 private key harus 32 byte')
  k[0] &= 248
  k[31] &= 127
  k[31] |= 64
  return k
}

function pointAdd(a, b) {
  const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1]
  const x1x2y1y2 = mod(D * x1 * x2 * y1 * y2)
  const x = mod((x1 * y2 + y1 * x2) * modInv(mod(ONE + x1x2y1y2)))
  const y = mod((y1 * y2 + x1 * x2) * modInv(mod(ONE - x1x2y1y2)))
  return [x, y]
}

function scalarMult(scalar, point = [BX, BY]) {
  let n = BigInt(scalar)
  let result = [ZERO, ONE]
  let addend = point
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend)
    addend = pointAdd(addend, addend)
    n >>= 1n
  }
  return result
}

function encodePoint(point) {
  const [x, y] = point
  const out = bigIntToLE(y, 32)
  if (x & 1n) out[31] |= 0x80
  return out
}

function decodePoint(bytes) {
  const b = Buffer.from(bytes)
  if (b.length !== 32) throw new RangeError('Edwards point harus 32 byte')
  const sign = (b[31] & 0x80) !== 0
  b[31] &= 0x7f
  const y = leToBigInt(b)
  if (y >= P) throw new Error('Edwards y out of range')
  const y2 = mod(y * y)
  const xx = mod((y2 - 1n) * modInv(mod(D * y2 + 1n)))
  let x = powMod(xx, (P + 3n) / 8n)
  if (mod(x * x - xx) !== 0n) x = mod(x * powMod(2n, (P - 1n) / 4n))
  if (mod(x * x - xx) !== 0n) throw new Error('invalid Edwards point')
  if (Boolean(x & 1n) !== sign) x = P - x
  return [x, y]
}

function sha512(data) { return crypto.createHash('sha512').update(data).digest() }

export function x25519PrivateToEdwardsScalar(privateKey) {
  return modL(leToBigInt(clampX25519(privateKey)))
}

export function x25519PrivateToEdwardsPublic(privateKey) {
  return encodePoint(scalarMult(x25519PrivateToEdwardsScalar(privateKey)))
}

export function x25519PrivateToMontgomeryPublic(privateKey) {
  const point = scalarMult(x25519PrivateToEdwardsScalar(privateKey))
  const u = mod((ONE + point[1]) * modInv(mod(ONE - point[1])))
  return bigIntToLE(u, 32)
}

export function xeddsaSign(privateKey, message) {
  const raw = clampX25519(privateKey)
  const scalar = x25519PrivateToEdwardsScalar(raw)
  const publicKey = x25519PrivateToEdwardsPublic(raw)
  const prefix = sha512(raw).subarray(32)
  const r = modL(leToBigInt(sha512(Buffer.concat([prefix, Buffer.from(message)]))))
  const R = encodePoint(scalarMult(r))
  const h = modL(leToBigInt(sha512(Buffer.concat([R, publicKey, Buffer.from(message)]))))
  const S = modL(r + h * scalar)
  return Buffer.concat([R, bigIntToLE(S, 32)])
}

export function xeddsaVerify(publicKey, message, signature) {
  const sig = Buffer.from(signature)
  if (sig.length !== 64) return false
  try {
    const A = decodePoint(publicKey)
    const R = decodePoint(sig.subarray(0, 32))
    const S = leToBigInt(sig.subarray(32))
    if (S >= L) return false
    const h = modL(leToBigInt(sha512(Buffer.concat([sig.subarray(0, 32), Buffer.from(publicKey), Buffer.from(message)]))))
    const lhs = scalarMult(S)
    const rhs = pointAdd(R, scalarMult(h, A))
    return lhs[0] === rhs[0] && lhs[1] === rhs[1]
  } catch { return false }
}

export function convertX25519PublicToEdwards(x25519Public) {
  const u = leToBigInt(x25519Public)
  const y = mod((u - 1n) * modInv(mod(u + 1n)))
  const y2 = mod(y * y)
  const xx = mod((y2 - 1n) * modInv(mod(D * y2 + 1n)))
  let x = powMod(xx, (P + 3n) / 8n)
  if (mod(x * x - xx) !== 0n) x = mod(x * powMod(2n, (P - 1n) / 4n))
  if (mod(x * x - xx) !== 0n) throw new Error('X25519 public tidak valid')
  if (x & 1n) x = P - x
  return [x, y]
}
