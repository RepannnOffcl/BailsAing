# Baileys compatibility matrix

This project intentionally provides a Baileys-shaped JavaScript API without depending on `@whiskeysockets/baileys`. A green unit test means the behavior is internally verified; it does not mean WhatsApp server interoperability has been proven.

| Surface | Status | Notes |
|---|---|---|
| `makeWASocket` | implemented | Stable facade, reconnect lifecycle and CJS/ESM entrypoints |
| `useMultiFileAuthState` | implemented | Legacy `creds.json` and key-file names are read/written; transaction helper included |
| `makeCacheableSignalKeyStore` | implemented | TTL cache, delete/clear propagation, BufferJSON compatibility and missing-key behavior tested |
| JID helpers | implemented | User/group/newsletter/LID predicates |
| Pairing code / QR | implemented | Native builders and lifecycle handlers |
| `sendMessage` / `relayMessage` | partial | Native encrypted direct-message path exists; full WhatsApp device/session interoperability, group sender-key fanout and server-side media flow are not complete |
| `sendPresenceUpdate` | implemented | Native presence/chatstate node builders; live verification pending |
| `presenceSubscribe` | implemented | Native presence subscription node; live verification pending |
| `readMessages` | implemented | Native receipt batching; privacy parity is not complete |
| group APIs | partial | Metadata/action node plumbing exists; full participant/LID/app-state behavior needs live verification |
| media | partial | Media key derivation, AES-CBC/HMAC encryption, hash verification and decrypt/download helper exist; WhatsApp upload/re-upload endpoint negotiation is still pending |
| app-state sync | missing | Patch/snapshot/lthash pipeline not implemented |
| history sync | missing | No complete history restore/gap recovery |
| newsletters | partial | Follow/unfollow node plumbing exists; full discovery/message protocol pending |
| message codec | implemented | Current WA `Message` union is registered for 95 top-level types; all registered wrappers recurse through the `Message` union, while schema-backed common types plus raw/numeric protobuf fallback preserve newer/unknown fields |
| Signal interoperability | unverified | Native ratchet foundation is internally tested, not proven against live WhatsApp Signal sessions |
| live WhatsApp | unverified | This environment cannot perform a real linked-device/long-running account soak test |

## Durability guarantees and limits

The library protects against common client-side causes of session loss: reconnect races, stale socket events, reconnect storms, keepalive failure loops, auth-file races, partial credential writes, auth-lock collisions, concurrent key writes and send floods.

The library cannot guarantee that a WhatsApp server will never revoke, replace, rate-limit or terminate a device session. Those are server-side decisions.
