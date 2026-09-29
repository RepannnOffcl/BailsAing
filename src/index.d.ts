export interface BaileysOptions {
  /** WhatsApp transport engine. Official WhiskeySockets Baileys is the default. */
  connectionEngine?: 'official' | 'native'

  authDir?: string
  auth?: { state: any; saveCreds: (patch?: Record<string, any>) => Promise<void> }
  pairingNumber?: string
  pairingCode?: string
  customPairingCode?: string
  requestPairingOnStart?: boolean
  printQRInTerminal?: boolean
  terminalQR?: boolean
  qrSmall?: boolean
  qrClearAfterMs?: number
  bannerDurationMs?: number
  pairingDelayMs?: number
  pairingReadyTimeoutMs?: number
  pairingCodeTimeoutMs?: number
  botName?: string
  serverStaticPublicKey?: string | Uint8Array
  serverStaticPin?: string | Uint8Array
  verifyNoiseCertificate?: (input: { certificate: Uint8Array; serverStatic: Uint8Array }) => boolean | void
  verifyPairSuccess?: (input: { node: any; auth: any }) => boolean | void
  signedPreKeyMaxAgeMs?: number
  preKeyCount?: number
  autoFollowChannels?: string[] | string
  autoFollowOnce?: boolean
  autoRepairBadSession?: boolean
  retryBadSession?: boolean
  retryMultideviceMismatch?: boolean
  allowUnknownDisconnectRetry?: boolean
  maxReconnectAttempts?: number // 0/omitted = retry terus selama session masih valid
  baseReconnectDelay?: number
  maxReconnectDelay?: number
  reconnectJitter?: number
  watchdogIntervalMs?: number
  watchdogDeadMs?: number
  keepaliveFailureThreshold?: number
  rateLimitBackoffMs?: number
  transientSendBackoffMs?: number
  groupQueryTimeoutMs?: number
  readReceiptType?: 'read' | 'read-self'
  keepaliveTimeoutMs?: number
  reconnectOnKeepaliveFailure?: boolean
  sendMinDelayMs?: number
  sendJitterMs?: number
  maxSendQueue?: number
  maxEventListeners?: number
  logLevel?: string
  logger?: any
  engine?: any
  version?: [number, number, number]
  webVersion?: [number, number, number]
  fetchLatestVersion?: boolean
  requireLatestVersion?: boolean
  fetchImpl?: typeof fetch
  browser?: [string, string, string]
  safePairingIdentity?: boolean
  signalDir?: string
  signalStore?: any
  emitOwnEvents?: boolean
  noSelfSync?: boolean
  companionPlatformId?: string
  companionPlatformDisplay?: string
  [key: string]: any
}

export class BaileysError extends Error { code: string; statusCode?: number; details?: unknown }
export class BaileysConnectionError extends BaileysError {}
export class BaileysPairingError extends BaileysError {}
export class BaileysSessionError extends BaileysError {}
export class BaileysProtocolError extends BaileysError {}
export class BaileysDecryptError extends BaileysError {}
export class BaileysRateLimitError extends BaileysError {}
export class BaileysLoggedOutError extends BaileysError {}

export const DisconnectCode: Readonly<Record<string, number>>
export function getDisconnectCode(error: unknown): number | null
export function shouldReconnect(error: unknown, options?: Record<string, unknown>): boolean
export function backoffDelay(attempt: number, options?: Record<string, number>): number
export class ReconnectController { readonly attempt: number; readonly pending: boolean; cancel(): void; complete<T>(value: T): boolean; run<T>(task: (attempt: number, delay: number) => Promise<T>, options?: BaileysOptions): Promise<T> }
export class SessionHealth { snapshot(): Record<string, number | null>; markOpen(): void; markFrame(): void; markMessage(): void; markDecryptError(): void; markSendError(): void; markReconnect(): void }
export class Watchdog { constructor(options?: BaileysOptions); start(health: SessionHealth, onDead: (error: Error) => void): void; stop(): void }

export function buildCompanionFinishRequest(input: Record<string, any>): { request: any; advSecretKey: Uint8Array; refBuffer: Uint8Array; wrappedBundle: Uint8Array }
export function fetchLatestWaWebVersion(options?: { fetchImpl?: typeof fetch; headers?: Record<string,string>; url?: string }): Promise<{ version: [number, number, number]; isLatest: boolean; source: string; error?: unknown }>
export function resolveWaWebVersion(options?: BaileysOptions & { fetchImpl?: typeof fetch }): Promise<{ version: [number, number, number]; isLatest: boolean; source: string; error?: unknown }>
export function getFallbackWaWebVersion(): [number, number, number]
export function getCapabilities(): Record<string, boolean>
export function getCapabilityStatus(): { implemented: Record<string, boolean>; liveVerified: Record<string, boolean>; notes: Record<string, string> }
export function getCompanionPlatformId(browser?: [string, string, string]): string
export function getCompanionPlatformDisplay(browser?: [string, string, string], fallback?: string): string
export const CompanionWebClientType: Readonly<Record<string, number>>

export interface BaileysSocket {
  ev: any
  user?: { id: string }
  authState: any
  health: Record<string, unknown>
  connectionState: string
  isAuthenticated: boolean
  capabilities: Record<string, boolean>
  sendMessage(jid: string, content: any, options?: Record<string, any>): Promise<any>
  relayMessage(jid: string, content: any, options?: Record<string, any>): Promise<any>
  requestPairingCode(phone?: string, customCode?: string): Promise<string>
  requestPairingCodeCustom(phone?: string, customCode?: string): Promise<string>
  reconnectNow(): Promise<any>
  waitForSocketOpen(timeoutMs?: number): Promise<void>
  sendPresenceUpdate(type: string, jid?: string): Promise<any>
  presenceSubscribe(jid: string): Promise<any>
  readMessages(keys: any[]): Promise<any>
  sendReadReceipt(jid: string, participant?: string, messageIds?: string | string[]): Promise<any>
  groupMetadata(jid: string): Promise<any>
  groupCreate(subject: string, participants?: string[]): Promise<any>
  groupLeave(jid: string): Promise<void>
  groupUpdateSubject(jid: string, subject: string): Promise<void>
  groupUpdateDescription(jid: string, description?: string): Promise<void>
  groupParticipantsUpdate(jid: string, participants: string[], action: string): Promise<any>
  groupInviteCode(jid: string): Promise<string | undefined>
  groupRevokeInvite(jid: string): Promise<string | undefined>
  groupAcceptInvite(code: string): Promise<string | undefined>
  groupGetInviteInfo(code: string): Promise<any>
  groupSettingUpdate(jid: string, setting: string): Promise<void>
  newsletterFollow(jid: string): Promise<any>
  newsletterUnfollow(jid: string): Promise<any>
  logout(reason?: string): Promise<void>
  close(): Promise<void>
  end(): Promise<void>
  getHealth(): Record<string, unknown>
  getPairingCode(): string | null
  getPairingState(): { active: boolean; phone: string | null; code: string | null }
  getCapabilityStatus(): any
}

export function makeWASocket(options?: BaileysOptions): BaileysSocket
export function renderTerminalQR(qr: string, options?: { small?: boolean; clear?: boolean; clearAfterMs?: number; force?: boolean }): boolean
export function resetTerminalQR(): void
export default makeWASocket
export const createRebelsSocket: typeof makeWASocket
export const createBaileysSocket: typeof makeWASocket
export function loadEngineExports(): Promise<Record<string, any>>
export function doctor(options?: { authDir?: string }): Promise<any>
export interface SignalSessionState { role: string; rootKey: string; DHs: { privateKey: string; publicKey: string }; DHr: string | null; CKs: string | null; CKr: string | null; Ns: number; Nr: number; PN: number; skipped: Record<string, string> }
export class NativeSignalSession { constructor(state: SignalSessionState); static initiator(options: any): NativeSignalSession; static responder(options: any): NativeSignalSession; static initiatorFromPreKeyBundle(options: any): { session: NativeSignalSession; baseKey: { privateKey: Uint8Array; publicKey: Uint8Array }; material: Uint8Array }; static responderFromPreKey(options: any): { session: NativeSignalSession; material: Uint8Array }; ratchetSend(): Uint8Array; encrypt(plaintext: Uint8Array | string, associatedData?: Uint8Array): { envelope: any; wire: Uint8Array }; decrypt(input: any, associatedData?: Uint8Array): Uint8Array; exportState(): SignalSessionState }
export class SignalSessionStore { constructor(dir: string); get(jid: string): Promise<NativeSignalSession | null>; set(jid: string, session: NativeSignalSession): Promise<void>; delete(jid: string): Promise<void> }
export function encodeSignalMessage(input: any): Uint8Array
export function decodeSignalMessage(input: Uint8Array): any
export function encodePreKeySignalMessage(input: any): Uint8Array
export function decodePreKeySignalMessage(input: Uint8Array): any

export function buildLinkedDeviceQR(input: Record<string, any>): string
export function parseLinkedDeviceQR(input: string): { ref: string; noisePublicKey: Uint8Array; identityPublicKey: Uint8Array; advSecretKey: Uint8Array; clientType: string }
export function createQRReference(bytes?: number): string
export function parsePairDeviceNode(node: any): Array<{ ref: string; node: any }>

export const MESSAGE_FIELD_MAP: Readonly<Record<string, number>>
export const SUPPORTED_MESSAGE_TYPES: readonly string[]
export function encodeMessageContent(content: any): Uint8Array
export function decodeMessageContent(input: Uint8Array): any
export function normalizeMessageContent(content: any): any
export function encodeWebMessageInfo(input: any): Uint8Array
export function decodeWebMessageInfo(input: Uint8Array): any

export const MEDIA_KEY_INFO: Readonly<Record<string, string>>
export function normalizeMediaType(type: string): string
export function generateMediaKey(randomBytes?: (size: number) => Uint8Array): Uint8Array
export function deriveMediaKeys(mediaKey: Uint8Array | string, mediaType?: string, options?: Record<string, any>): { mediaType: string; mediaKey: Uint8Array; iv: Uint8Array; cipherKey: Uint8Array; macKey: Uint8Array; refKey: Uint8Array }
export function encryptMedia(input: Uint8Array | string, options?: Record<string, any>): Record<string, any>
export function decryptMedia(input: Uint8Array, options: Record<string, any>): { plaintext: Uint8Array; fileSha256: Uint8Array; fileLength: number }
export function downloadAndDecryptMedia(url: string, options?: Record<string, any>): Promise<{ plaintext: Uint8Array; fileSha256: Uint8Array; fileLength: number }>
export function mediaUploadDescriptor(result: Record<string, any>, uploadResult?: Record<string, any>): Record<string, any>

export const Browsers: Readonly<Record<string, (name?: string) => [string, string, string]>>
export const DEFAULT_CONNECTION_CONFIG: Readonly<Record<string, unknown>>
export const DisconnectReason: Readonly<Record<string, number>>
export const BufferJSON: Readonly<{ replacer: (key: string, value: any) => any; reviver: (key: string, value: any) => any }>
export function useMultiFileAuthState(authDir: string): Promise<{ state: { creds: any; keys: { get(type: string, ids: string[]): Promise<Record<string, any>>; set(data: Record<string, Record<string, any>>): Promise<void>; clear(): Promise<void>; transaction<T>(work: (keys: any) => Promise<T> | T, key?: string): Promise<T> } }; saveCreds(patch?: Record<string, any>): Promise<any>; release(): Promise<void>; backup(label?: string): Promise<string> }>
export function makeCacheableSignalKeyStore(keys: any, logger?: any, cache?: any): any
export function fetchLatestBaileysVersion(options?: { fetchImpl?: typeof fetch; headers?: Record<string,string>; url?: string }): Promise<{ version: [number, number, number]; isLatest: boolean; source: string; error?: unknown }>
export function resolveLatestBaileysVersion(options?: BaileysOptions & { fetchImpl?: typeof fetch }): Promise<{ version: [number, number, number]; isLatest: boolean; source: string; error?: unknown }>
export function delay(ms: number): Promise<void>
export function jidEncode(user: string | number | null, server: string, device?: number, agent?: number): string
export function jidDecode(jid: string): { user: string; server: string; device?: number; domainType?: number } | undefined
export function jidNormalizedUser(jid: string): string
export function transferDevice(fromJid: string, toJid: string): string
export function areJidsSameUser(a: string, b: string): boolean
export function isJid(jid: string): boolean
export function isJidUser(jid: string): boolean
export function isPnUser(jid: string): boolean
export function isLidUser(jid: string): boolean
export function isHostedPnUser(jid: string): boolean
export function isHostedLidUser(jid: string): boolean
export function isJidGroup(jid: string): boolean
export function isJidBroadcast(jid: string): boolean
export function isJidNewsletter(jid: string): boolean
export function isJidStatusBroadcast(jid: string): boolean
export function isJidMetaAI(jid: string): boolean
export function isJidBot(jid: string): boolean
export function generateMessageID(): string
export function generateMessageIDV2(): string
export function getContentType(content: unknown): string | undefined
export function normalizeMessageContent(content: any): any
export function getDevice(message: unknown): number
export function extractMessageContent(message: unknown): any
export function generateWAMessageContent(content: any, options?: Record<string, any>): any
export function generateWAMessageFromContent(jid: string, message: any, options?: Record<string, any>): any
export function generateWAMessage(jid: string, content: any, options?: Record<string, any>): any
