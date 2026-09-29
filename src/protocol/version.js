const FALLBACK_WA_WEB_VERSION = Object.freeze([2, 3000, 1043857760])
const WA_SW_URL = 'https://web.whatsapp.com/sw.js'
const DEFAULT_HEADERS = Object.freeze({
  'sec-fetch-site': 'none',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
})

function cloneVersion(version) {
  const value = Array.from(version ?? [], Number)
  if (value.length !== 3 || value.some(x => !Number.isInteger(x) || x < 0)) throw new TypeError('WA version harus [major, minor, revision]')
  return value
}

export function getFallbackWaWebVersion() {
  return cloneVersion(FALLBACK_WA_WEB_VERSION)
}

export async function fetchLatestWaWebVersion(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { version: getFallbackWaWebVersion(), isLatest: false, source: 'fallback', error: new Error('fetch() tidak tersedia di runtime') }
  }
  try {
    const headers = { ...DEFAULT_HEADERS, ...(options.headers ?? {}) }
    const request = { ...options, method: 'GET', headers }
    delete request.fetchImpl
    const response = await fetchImpl(options.url ?? WA_SW_URL, request)
    if (!response?.ok) throw new Error(`Gagal mengambil WhatsApp Web sw.js: HTTP ${response?.status ?? 'unknown'}`)
    const text = await response.text()
    const match = text.match(/\"client_revision\"\s*:\s*(\d+)/) || text.match(/\\\"client_revision\\\"\s*:\s*(\d+)/)
    if (!match?.[1]) throw new Error('client_revision tidak ditemukan di sw.js')
    return { version: [2, 3000, Number(match[1])], isLatest: true, source: 'web' }
  } catch (error) {
    return { version: getFallbackWaWebVersion(), isLatest: false, source: 'fallback', error }
  }
}

export async function resolveWaWebVersion(options = {}) {
  if (options.version != null) return { version: cloneVersion(options.version), source: 'explicit', isLatest: false }
  if (options.webVersion != null) return { version: cloneVersion(options.webVersion), source: 'explicit', isLatest: false }
  if (options.fetchLatestVersion === false) return { version: getFallbackWaWebVersion(), source: 'fallback', isLatest: false }
  return fetchLatestWaWebVersion(options)
}

export const WA_WEB_VERSION_FALLBACK = FALLBACK_WA_WEB_VERSION
