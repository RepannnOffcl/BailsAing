export const BAILEYS_CAPABILITIES = Object.freeze({
  websocketTransport: true,
  waFrameCodec: true,
  noiseXX: true,
  protobufWire: true,
  binaryNodeCodec: true,
  nodeRequestCorrelation: true,
  persistentAuth: true,
  reconnectController: true,
  watchdog: true,
  pairingCode: true,
  qrPairing: true,
  companionRegistration: false,
  signalSessions: true,
  signalSessionPersistence: true,
  messageSend: false,
  messageReceive: false,
  media: false,
  newsletters: false,
  newsletterFollow: false,
  appStateSync: false,
  historySync: false
})

// `getCapabilities()` intentionally stays conservative: a `true` value means
// the feature is implemented and has an interoperability path, not merely that
// a public helper exists. This prevents downstream projects from assuming a
// mock/incomplete protocol layer is production-compatible.
export function getCapabilities() { return { ...BAILEYS_CAPABILITIES } }

const IMPLEMENTED = Object.freeze({
  websocketTransport: true,
  waFrameCodec: true,
  noiseXX: true,
  protobufWire: true,
  binaryNodeCodec: true,
  nodeRequestCorrelation: true,
  persistentAuth: true,
  reconnectController: true,
  watchdog: true,
  pairingCode: true,
  qrPairing: true,
  companionRegistration: true,
  signalSessions: true,
  signalSessionPersistence: true,
  messageSend: true,
  messageReceive: true,
  presence: true,
  receipts: true,
  groups: true,
  newsletterFollow: true,
  media: false,
  newsletters: false,
  appStateSync: false,
  historySync: false
})

const LIVE_VERIFIED = Object.freeze({
  websocketTransport: false,
  waFrameCodec: false,
  noiseXX: false,
  protobufWire: false,
  binaryNodeCodec: false,
  nodeRequestCorrelation: false,
  persistentAuth: false,
  reconnectController: false,
  watchdog: false,
  pairingCode: false,
  qrPairing: false,
  companionRegistration: false,
  signalSessions: false,
  signalSessionPersistence: false,
  messageSend: false,
  messageReceive: false,
  presence: false,
  receipts: false,
  groups: false,
  newsletterFollow: false,
  media: false,
  newsletters: false,
  appStateSync: false,
  historySync: false
})

const NOTES = Object.freeze({
  companionRegistration: 'Native companion-registration flow is implemented and mock/in-process tested; real WhatsApp account interoperability is not verified in this environment.',
  signalSessions: 'Native persistent ratchet/session foundation is implemented and self-tested; compatibility with WhatsApp Signal sessions is not verified.',
  messageSend: 'Direct text message stanza plumbing exists, but full WhatsApp protobuf/Signal/device-discovery interoperability is not verified.',
  messageReceive: 'Direct encrypted-message decode plumbing exists when a compatible session is already present; live interoperability is not verified.',
  presence: 'Presence/chatstate node plumbing is implemented; server interoperability is not verified.',
  receipts: 'Read/delivery receipt batching is implemented; privacy and LID parity are not verified.',
  groups: 'Group metadata and participant/action node plumbing is implemented; full LID/app-state interoperability is not verified.',
  newsletterFollow: 'Native newsletter subscribe IQ builder exists; server acceptance is not verified.',
  media: 'No production media upload/download/encryption pipeline yet.',
  newsletters: 'Full newsletter discovery/metadata/message protocol is not implemented yet.',
  appStateSync: 'App-state patches/snapshots are not implemented yet.',
  historySync: 'History sync and gap recovery are not implemented yet.'
})

export function getCapabilityStatus() {
  return {
    implemented: { ...IMPLEMENTED },
    liveVerified: { ...LIVE_VERIFIED },
    notes: { ...NOTES }
  }
}
