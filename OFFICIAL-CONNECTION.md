# Official WhatsApp Connection Layer

Repan Baileys 1.5.2 uses `@whiskeysockets/baileys@7.0.0-rc14` as an isolated engine for the WhatsApp transport, authentication state, Noise/WebSocket handshake, QR/pairing-code flow, and protocol connection lifecycle.

The public package facade, reconnect controller, rate limiter, diagnostics, message helpers, media helpers, exports, and higher-level bot-facing API remain maintained in this repository.

The dependency is intentionally pinned so a future upstream breaking release cannot silently change the 1.5.2 public surface. The official dependency is pinned to a specific 7.0.0 release candidate so an unrelated upstream publish cannot silently change the 1.5.2 API.

## Opt out

For development/debugging of the custom engine only:

```bash
REPAN_BAILEYS_CONNECTION_ENGINE=native
```

or:

```js
makeWASocket({ connectionEngine: 'native' })
```

## Why

Pairing and transport are the most upstream-sensitive part of a WhatsApp Web client. Keeping that layer on the maintained WhiskeySockets implementation reduces protocol drift while the rest of the package can retain its own public API and reliability tooling.

The project is not affiliated with WhatsApp or Meta. The upstream Baileys dependency is MIT-licensed; see its license and preserve the applicable copyright notice when redistributing.
