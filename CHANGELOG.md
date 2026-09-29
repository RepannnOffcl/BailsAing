
## 1.5.2 — auth-lock race and pairing reference hardening

- Fixed the real same-process race where multiple near-simultaneous `useMultiFileAuthState()` calls could both reach the filesystem lock before the first auth lease finished initializing.
- Added a pending auth-state promise so reconnect-style code shares one owner instead of throwing `BAILEYS_AUTH_LOCKED`.
- Fixed stale lock recovery when an old lock file happens to contain a reused/current PID.
- Kept legacy lock option names compatible.
- Persisted the `companion_hello` pairing reference so later `primary_hello` notifications are matched against the expected server reference.
- Repacked all three persistent-auth source files into the NPM/GitHub distributions.
- Version remains `1.5.2`.
# Changelog

## 1.5.2 — pairing/session/banner hardening

- Perbaiki race `requestPairingCode()` ketika facade sudah awaitable tetapi native transport masih `connecting`; facade sekarang menunggu fase `secure`.
- `useMultiFileAuthState()` memakai auth lease bersama untuk pemanggilan berulang dalam proses Node yang sama, mencegah `BAILEYS_AUTH_LOCKED` saat reconnect-style code menginisialisasi ulang state.
- Startup banner memakai alternate terminal screen, fit-to-terminal rendering, cursor/wrap restoration, dan warna Chalk dengan fallback ANSI.
- Tetap mempertahankan nomor package `1.5.2`.

## 1.5.2 - Terminal UX, pairing, and dependency hardening

- Kept the package version at `1.5.2`; no version bump.
- Added automatic 5-second terminal ASCII banner from `assets/banner.txt` before socket initialization.
- Added automatic terminal QR rendering through `qrcode-terminal` with safe non-TTY fallback.
- Hardened `requestPairingCode()` to wait for secure transport, use fire-and-notify semantics, serialize concurrent requests, and clear transient pairing credentials if transport submission fails.
- Added QR lifecycle forwarding, pairing-state inspection, and cleanup across socket replacement/shutdown.
- Added atomic Signal-session updates with a backward-compatible fallback for legacy custom stores.
- Removed runtime WebSocket/native-addon installation requirements; no `ws`, `bufferutil`, `utf-8-validate`, `sharp`, or `node-gyp` dependency is required.
- Added release audit checks and packaging regression coverage.
- Regression suite now passes 104/104 tests sequentially and in parallel QA.

## 1.5.2 - Final native protocol/message hardening

- Corrected package identity to `@repanxtenka/baileys` with GitHub repository `RepannnOffcl/BailsAing`.
- Added registration/codec coverage for 95 top-level WhatsApp `Message` union types with raw/numeric-field fallback and unknown-field retention.
- Added media key derivation, AES-256-CBC/HMAC encryption/decryption, hash verification and generic download helpers.
- Hardened canonical JID device/agent encoding while keeping legacy ordering readable.
- Expanded CJS parity for message codec and media primitives.
- Re-audited naming, auth persistence, reconnect lifecycle, message serialization and regression tests.
- Restored the missing persistent-auth subsystem (`state.js`, `file-store.js`, `companion.js`) required by the package test suite.
- Made native Signal encrypt/decrypt transactional on failure so bad ciphertext does not advance ratchet state or consume skipped keys.
- Hardened same-process auth locking, heartbeat ownership checks, atomic credential writes, and lost-lock detection.
- Reconnect sends now wait for the replacement socket instead of targeting the closing generation.
- Expanded wrapper-message codec/compatibility coverage to every registered wrapper type; regression suite now passes 98/98 tests.


## 1.5.2 - Pairing lifecycle hardening

- Fixed a real-world race where `requestPairingCode()` could be called immediately after `makeWASocket()` before the native Noise transport reached `secure`. The native socket now waits for secure/authenticated readiness before sending pairing registration.
- Added lifecycle reconciliation after socket creation so fast/mock engines that reach `secure` or `authenticated` before facade listeners attach are not left in a stale `connecting` state.
- Added a two-argument `requestPairingCodeCustom(number, customCode)` form while preserving the legacy one-argument form when `pairingNumber` is configured.
- Synchronized package, native engine, README, TypeScript, and repository metadata to `1.5.2`.
- Added regression coverage reproducing early pairing invocation and lifecycle-state reconciliation.

## 1.5.1 - Per-user pairing input

- Made pairing number optional at socket creation; users can provide their own number when calling `requestPairingCode(number, customCode)`.
- Removed the hardcoded placeholder number from the pairing example.
- Added interactive pairing example input plus the RepanXTEnka CLI banner.
- Added regression coverage for per-request pairing numbers.


## 1.5.0 - Public-release hardening

- Added conservative capability reporting plus a separate implementation/live-verification status API so downstream users can distinguish native code paths from protocol interoperability that has not been live verified.
- Added companion registration refresh handling with fresh ADV secret rotation, atomic credential persistence, QR regeneration using the current pairing reference, and support for the QR-rotation notification child.
- Pair-success persistence now completes before the automatic 515 restart is requested.
- Added `noSelfSync` as an explicit local own-message-event suppression option while the server-side multi-device self-sync protocol remains unverified.
- Added runtime WA Web revision discovery from `web.whatsapp.com/sw.js` with an explicit fallback/override path.
- Hardened CJS public constants and expanded public-surface regression coverage.
- Made pairing references lossless opaque bytes and added a reusable `companion_finish` builder covering the native HKDF/AES-GCM/ADV-secret flow.

## 1.4.0 - Native Signal foundation

- Added native Signal-session foundation with X3DH-style pre-key derivation, directional chains, DH ratchet rotation, skipped-message handling, persistent session store, and protobuf message envelopes.
- Fixed PKCS#7 full-block padding handling in the native message cipher.
- Hardened server Noise identity verification test coverage and linked-device QR key validation.
- Updated package metadata and documentation to accurately distinguish offline protocol foundations from live WhatsApp interoperability.
- Expanded syntax checking to every JS/MJS/CJS source, test, and example file.

## 1.3.0 - Native protocol hardening

- Removed remaining wrapper-era assumptions; runtime has no Baileys or external WhatsApp engine dependency.
- Added companion identity material persistence, signed-prekey rotation, and persistent one-time pre-key pool.
- Added linked-device QR payload construction/parsing and `pairing.qr` event handling for incoming pair-device references.
- Added explicit `secure` versus `authenticated` connection state.
- Added optional Noise server-static-key pinning and certificate verification hook.
- Added companion registration payload encoding and auth persistence tests.
- Hardened auto-follow marker persistence with atomic writes.
- Expanded native socket, protocol, auth, QR, and crypto regression coverage to 20 tests.

1.2.0

- Removed the previous external WhatsApp protocol engine from runtime dependencies.
- Added native WebSocket transport and WA frame codec.
- Added native Noise XX handshake implementation with X25519/AES-GCM/HKDF/SHA-256 primitives.
- Added protobuf wire helpers and native client payload encoding.
- Added native binary-node encoder/decoder and correlated node request layer.
- Added native mock-WebSocket integration coverage.
- Fixed CJS entrypoint behavior.
- Fixed auth X25519 key persistence and atomic credential writes.
- Fixed auth-lock ownership/release races and backup lock-file handling.
- Fixed stable event rebinding and `once/off` behavior.
- Fixed reconnect single-flight to retry failed rebuilds instead of stopping after one failure.
- Added bounded send queue and enhanced health/protocol telemetry.
- Added capability reporting so unsupported protocol layers are explicit.

## 1.0.0 / 1.1.0

Earlier releases contained wrapper/lifecycle experiments. They are not used by the current native runtime architecture.
