let esm
try {
  esm = require('./index.js')
} catch {
  esm = null
}
const load = () => esm ??= import('./index.js')
const call = (name, args) => esm ? esm[name](...args) : load().then(m => m[name](...args))

for (const name of [
  'makeWASocket', 'renderTerminalQR', 'resetTerminalQR', 'createRebelsSocket', 'createBaileysSocket', 'loadEngineExports', 'loadProtocolInfo', 'doctor',
  'fetchLatestWaWebVersion', 'resolveWaWebVersion', 'getFallbackWaWebVersion', 'getCompanionPlatformId',
  'getCompanionPlatformDisplay', 'getCapabilities', 'getCapabilityStatus', 'nativeEngineInfo', 'createNativeEngineSocket',
  'useMultiFileAuthState', 'makeCacheableSignalKeyStore', 'fetchLatestBaileysVersion', 'resolveLatestBaileysVersion',
  'delay', 'normalizeMessageContent', 'encodeMessageContent', 'decodeMessageContent', 'getContentType', 'extractMessageContent', 'generateWAMessageContent', 'generateWAMessageFromContent', 'generateWAMessage', 'getDisconnectCode', 'shouldReconnect', 'backoffDelay', 'ReconnectController', 'SessionHealth', 'Watchdog', 'getDevice', 'DEFAULT_CONNECTION_CONFIG', 'jidEncode', 'jidDecode', 'jidNormalizedUser', 'transferDevice', 'areJidsSameUser', 'isJid', 'isJidUser', 'isPnUser', 'isLidUser', 'isHostedPnUser', 'isHostedLidUser', 'isJidGroup', 'isJidBroadcast', 'isJidNewsletter', 'isJidStatusBroadcast', 'isJidMetaAI', 'isJidBot', 'generateMessageID', 'generateMessageIDV2', 'encryptMedia', 'decryptMedia', 'deriveMediaKeys', 'generateMediaKey', 'downloadAndDecryptMedia', 'mediaUploadDescriptor', 'normalizeMediaType'
]) {
  exports[name] = (...args) => call(name, args)
}

exports.default = (...args) => call('makeWASocket', args)

const classExports = ['BaileysError', 'BaileysConnectionError', 'BaileysPairingError', 'BaileysSessionError', 'BaileysProtocolError', 'BaileysDecryptError', 'BaileysRateLimitError', 'BaileysLoggedOutError']
if (esm) {
  for (const name of classExports) exports[name] = esm[name]
}

const constants = {
  CompanionWebClientType: { UNKNOWN: 0, CHROME: 1, EDGE: 2, FIREFOX: 3, IE: 4, OPERA: 5, SAFARI: 6, ELECTRON: 7, UWP: 8, OTHER_WEB_CLIENT: 9 },
  DisconnectCode: { badSession: 500, connectionClosed: 428, connectionLost: 408, connectionReplaced: 440, loggedOut: 401, forbidden: 403, multideviceMismatch: 411, timedOut: 504, restartRequired: 515, rateLimited: 429, connectionIdle: 405, badAck: 406, temporary: 409, unavailableService: 503 }
}
exports.CompanionWebClientType = Object.freeze(constants.CompanionWebClientType)
exports.DisconnectCode = Object.freeze(constants.DisconnectCode)
exports.DEFAULT_CONNECTION_CONFIG = Object.freeze({ version: [2, 3000, 1043857760], browser: ['RepanXTEnka', 'Chrome', '1.0.0'], waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat', connectTimeoutMs: 20000, keepAliveIntervalMs: 30000, markOnlineOnConnect: false, syncFullHistory: false, defaultQueryTimeoutMs: 60000, emitOwnEvents: true })
exports.Browsers = Object.freeze({
  ubuntu: name => [String(name ?? 'RepanXTEnka'), 'Chrome', '1.0.0'],
  macOS: name => [String(name ?? 'RepanXTEnka'), 'Chrome', '1.0.0'],
  windows: name => [String(name ?? 'RepanXTEnka'), 'Chrome', '1.0.0'],
  baileys: name => [String(name ?? 'RepanXTEnka'), 'Chrome', '1.0.0'],
  android: name => [String(name ?? 'RepanXTEnka'), 'Chrome', '1.0.0'],
  appropriate: name => [String(name ?? 'RepanXTEnka'), 'Chrome', '1.0.0']
})
exports.DisconnectReason = Object.freeze({ connectionClosed: 428, connectionLost: 408, connectionReplaced: 440, timedOut: 408, loggedOut: 401, badSession: 500, restartRequired: 515, multideviceMismatch: 411, forbidden: 403, unavailableService: 503, connectionIdle: 405, temporary: 409, badAck: 406, clientOffline: 500, rateLimited: 429 })
exports.MESSAGE_FIELD_MAP = esm?.MESSAGE_FIELD_MAP ?? Object.freeze({})
exports.SUPPORTED_MESSAGE_TYPES = esm?.SUPPORTED_MESSAGE_TYPES ?? Object.freeze([])
exports.BufferJSON = esm?.BufferJSON ?? Object.freeze({ replacer: (_key, value) => value, reviver: (_key, value) => value })
