# Contributing

1. Run `npm install`.
2. Run `npm test`.
3. Run `npm pack --dry-run`.
4. Do not commit `auth/` or any credential/session material.
5. Keep protocol-engine specific code behind the engine boundary so the public Baileys API stays stable.
