import { EventEmitter } from 'node:events'
import { createNodeId, encodeBinaryNode, decodeBinaryNode } from './wire/binary-node.js'
import { BaileysProtocolError } from '../core/errors.js'

export class NodeClient extends EventEmitter {
  constructor(socket) {
    super()
    this.socket = socket
    this.pending = new Map()
    this.closed = false
    this._onFrame = frame => this.#handle(frame)
    socket.ev?.on?.('frame', this._onFrame)
    // EventEmitter treats 'error' specially; keep malformed wire data from crashing the process
    // when callers have not installed their own error listener yet.
    this.on('error', error => {
      socket.ev?.emit?.('protocol.error', error)
      socket.emit?.('protocolError', error)
    })
  }

  send(node) {
    if (this.closed) throw new Error('NodeClient closed')
    return this.socket.sendEncryptedFrame(encodeBinaryNode(node))
  }

  request(node, { timeoutMs = 15_000, id = createNodeId('iq') } = {}) {
    if (this.closed) return Promise.reject(new Error('NodeClient closed'))
    const prepared = { ...node, attrs: { ...(node.attrs ?? {}), id } }
    if (Array.isArray(node.content)) prepared.content = node.content.map(child => ({ ...child, attrs: { ...(child.attrs ?? {}) } }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Node request timeout: ${id}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send(prepared) } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  close(error) {
    if (this.closed) return
    this.closed = true
    this.socket.ev?.off?.('frame', this._onFrame)
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error ?? new Error('NodeClient closed'))
      this.pending.delete(id)
    }
  }

  #handle(frame) {
    try {
      const node = decodeBinaryNode(frame)
      const id = node?.attrs?.id
      if (id && this.pending.has(id)) {
        const pending = this.pending.get(id)
        this.pending.delete(id)
        clearTimeout(pending.timer)
        if (node?.tag === 'iq' && node?.attrs?.type === 'error') {
          const errorNode = Array.isArray(node.content) ? node.content.find(child => child?.tag === 'error') : null
          const statusCode = Number(errorNode?.attrs?.code ?? node?.attrs?.code ?? 0) || undefined
          const text = errorNode?.attrs?.text ?? node?.attrs?.text ?? 'protocol error'
          pending.reject(new BaileysProtocolError(`WhatsApp IQ error: ${text}`, { statusCode, details: node }))
        } else {
          pending.resolve(node)
        }
      }
      this.emit('node', node)
    } catch (error) {
      this.emit('error', error)
    }
  }
}
