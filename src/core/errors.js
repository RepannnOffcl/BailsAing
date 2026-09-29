export class BaileysError extends Error {
  constructor(message, code = 'BAILEYS_ERROR', options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'BaileysError'
    this.code = code
    if (options.statusCode != null) this.statusCode = options.statusCode
    if (options.details !== undefined) this.details = options.details
  }
}
export class BaileysConnectionError extends BaileysError {
  constructor(message, options = {}) { super(message, 'CONNECTION_ERROR', options); this.name = 'BaileysConnectionError' }
}
export class BaileysSessionError extends BaileysError {
  constructor(message, options = {}) { super(message, 'SESSION_ERROR', options); this.name = 'BaileysSessionError' }
}
export class BaileysPairingError extends BaileysError {
  constructor(message, options = {}) { super(message, 'PAIRING_ERROR', options); this.name = 'BaileysPairingError' }
}
export class BaileysProtocolError extends BaileysError {
  constructor(message, options = {}) { super(message, 'PROTOCOL_ERROR', options); this.name = 'BaileysProtocolError' }
}
export class BaileysDecryptError extends BaileysError {
  constructor(message, options = {}) { super(message, 'DECRYPT_ERROR', options); this.name = 'BaileysDecryptError' }
}
export class BaileysRateLimitError extends BaileysError {
  constructor(message, options = {}) { super(message, 'RATE_LIMIT_ERROR', options); this.name = 'BaileysRateLimitError' }
}
export class BaileysLoggedOutError extends BaileysError {
  constructor(message, options = {}) { super(message, 'LOGGED_OUT', options); this.name = 'BaileysLoggedOutError' }
}
