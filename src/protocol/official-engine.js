let officialPromise = null

export const OFFICIAL_BAILEYS_VERSION = '7.0.0-rc14'
export const OFFICIAL_BAILEYS_PACKAGE = '@whiskeysockets/baileys'

export async function loadOfficialBaileys() {
  if (!officialPromise) {
    officialPromise = import(OFFICIAL_BAILEYS_PACKAGE).catch(error => {
      officialPromise = null
      const wrapped = new Error(
        `Official Baileys engine tidak tersedia. Pastikan ${OFFICIAL_BAILEYS_PACKAGE}@${OFFICIAL_BAILEYS_VERSION} terpasang.`,
        { cause: error }
      )
      wrapped.code = 'BAILEYS_OFFICIAL_ENGINE_MISSING'
      throw wrapped
    })
  }
  return officialPromise
}

export function officialEngineInfo() {
  return Object.freeze({
    kind: 'official',
    package: OFFICIAL_BAILEYS_PACKAGE,
    version: OFFICIAL_BAILEYS_VERSION,
    scope: 'transport-auth-pairing',
    note: 'Official WhiskeySockets Baileys is used only as the WhatsApp connection/auth/pairing engine; this package facade, lifecycle, rate limiting and higher-level helpers remain custom.'
  })
}

export async function createOfficialEngineSocket(config, authState) {
  const baileys = await loadOfficialBaileys()
  const makeSocket = baileys.default ?? baileys.makeWASocket
  if (typeof makeSocket !== 'function') {
    throw Object.assign(new Error('Official Baileys export makeWASocket tidak ditemukan.'), { code: 'BAILEYS_OFFICIAL_ENGINE_INVALID' })
  }

  let version = config.version
  if (config.useLatestWaWebVersion !== false && typeof baileys.fetchLatestBaileysVersion === 'function') {
    try {
      const latest = await baileys.fetchLatestBaileysVersion()
      if (Array.isArray(latest?.version) && latest.version.length === 3) version = latest.version
    } catch {
      // Keep a validated caller-supplied version if the live version probe is unavailable.
    }
  }

  const socketConfig = {
    ...config,
    version,
    auth: authState,
    // QR is surfaced through connection.update and rendered by our facade.
    printQRInTerminal: false
  }

  delete socketConfig.engine
  delete socketConfig.signalDir
  delete socketConfig.botName
  delete socketConfig.pairingNumber
  delete socketConfig.pairingCode
  delete socketConfig.customPairingCode
  delete socketConfig.autoFollowChannels
  delete socketConfig.autoFollowOnce
  delete socketConfig.maxReconnectAttempts
  delete socketConfig.baseReconnectDelay
  delete socketConfig.maxReconnectDelay
  delete socketConfig.reconnectJitter
  delete socketConfig.watchdog
  delete socketConfig.watchdogIntervalMs
  delete socketConfig.watchdogDeadMs
  delete socketConfig.keepaliveFailureThreshold
  delete socketConfig.reconnectOnKeepaliveFailure
  delete socketConfig.operationTimeoutMs
  delete socketConfig.pairingReadyTimeoutMs
  delete socketConfig.maxPairingAttempts
  delete socketConfig.maxPairingRenewals
  delete socketConfig.pairingRetryDelayMs
  delete socketConfig.pairingRenewalDelayMs
  delete socketConfig.logger
  delete socketConfig.onReconnect
  delete socketConfig.onReady
  delete socketConfig.onClose
  delete socketConfig.retryBadSession
  delete socketConfig.retryMultideviceMismatch
  delete socketConfig.allowUnknownDisconnectRetry
  delete socketConfig.connectionEngine

  return makeSocket(socketConfig)
}
