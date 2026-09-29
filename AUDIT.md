# Baileys deep audit

## Fixed in this pass

1. Package/npm identity normalized to `@repanxtenka/baileys`; GitHub identity normalized to `RepannnOffcl/BailsAing`.
2. All visible old package branding removed from package-facing docs/errors. A legacy `.bailss.lock` filename is retained only for auth migration compatibility.
3. Current top-level WA message union is registered for 95 distinct fields.
4. Message codec accepts named schema objects, raw protobuf bytes, numeric protobuf fields, and preserves unknown fields for re-encoding.
5. Common image/video/audio/document/location/reaction/poll/event/newsletter schemas hardened; current Video and Reaction mappings corrected.
6. Media cryptographic primitives added: key derivation, AES-256-CBC, HMAC verification, plaintext/encrypted SHA-256, generic download/decrypt.
7. CJS exports expanded to include message codec and media primitives.
8. Canonical JID device/agent ordering corrected; legacy `user_agent:device` parsing remains readable.
9. Auth locking/heartbeat, atomic persistence, legacy credential migration, reconnect race handling, send serialization, and shutdown race protections retained from prior hardening.
10. Restored the missing `src/auth/state.js`, `src/auth/file-store.js`, and `src/auth/companion.js` subsystem required by the published test suite.
11. Made Signal encrypt/decrypt state changes transactional so failed MAC/decrypt operations do not advance ratchet state or consume skipped keys.
12. Added same-process auth-lock conflict detection, heartbeat ownership checks, and write-time lock-loss protection.
13. Reconnect/send lifecycle now detaches the closing generation before rebuild and waits for the replacement socket instead of sending into a stale generation.
14. All registered wrapper message types now use the recursive `Message` union codec, and compatibility unwrapping covers the full current wrapper registry.

## Remaining protocol-level gaps

These are not falsely marked complete because they require real WhatsApp server/device verification or substantial server-specific protocol work:

- Live WhatsApp interoperability of Noise/companion registration is not verified in this environment.
- Signal sessions are internally tested but not proven interoperable with live WhatsApp Signal sessions and real device/session bootstrap.
- Group message sender-key distribution/fan-out, LID/device discovery parity, and complete group E2EE behavior are incomplete.
- Status/broadcast/newsletter outbound encrypted messaging is not implemented as a complete server-compatible path.
- Media upload, media re-upload, CDN negotiation and live authenticated media endpoints are not implemented end-to-end; only local media crypto/download primitives are present.
- Full newsletter discovery, metadata synchronization, message/history protocol, and admin/follower event parity are incomplete.
- App-state sync (patches, snapshots, LTHash/generation handling, collection recovery) is incomplete.
- History sync and gap recovery are incomplete.
- Baileys event/API parity is partial beyond the tested surface.
- Multi-device concurrency, proxy/network abstraction, protocol feature negotiation and long-running server soak tests remain incomplete.
- External security audit and large-scale fuzz/soak testing have not been performed.

## Verification performed

- `npm test`: 108/108 passing.
- JavaScript syntax check: passing.
- Current package/repository identity checks: `@repanxtenka/baileys` / `RepannnOffcl/BailsAing`.
- Message registry uniqueness: 95/95 distinct top-level fields; wrapper regression coverage added across the full wrapper registry. Total regression suite is now 104 tests.


## Latest hardening pass

- Sequential regression: 106/106 PASS.
- Parallel regression (`--test-concurrency=4`): 106/106 PASS.
- `npm run check`: PASS.
- `npm run audit`: PASS.
- `npm run release:check`: PASS.
- `npm run pack:check`: PASS.
- Added pairing timing regression and same-process auth lease regression.
- Startup banner is isolated on alternate terminal screen and fitted to the current terminal size.
- Package version remains `1.5.2`; no major/minor/patch version bump was made.

## Current 1.5.2 regression pass

- `npm test`: 108/108 PASS.
- `npm run test:parallel`: 108/108 PASS at concurrency 4.
- `npm run check`: PASS.
- `npm run audit`: PASS.
- `npm run pack:check`: PASS.
- `npm run release:check`: PASS.
- Packaging explicitly verified that `src/auth/state.js`, `src/auth/file-store.js`, and `src/auth/companion.js` are included.
- `useMultiFileAuthState()` now coalesces concurrent same-process initialization before the first auth lease is ready, eliminating the lock race that produced `BAILEYS_AUTH_LOCKED`.
- Auth lock accepts legacy option names (`staleMs`, `waitMs`, `pollMs`) and recovers genuinely stale locks even when the stale record contains the current PID.
- Pairing hello now persists the server pairing reference for primary-hello matching.
