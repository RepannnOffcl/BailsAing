import { jidDecode, jidNormalizedUser, isLidUser, isHostedLidUser } from '../compat/baileys.js'
import { findNodeChild } from '../pairing/qr.js'
import { generateMessageId } from '../messaging/codec.js'

export function buildPresenceNode(type, meJid, toJid, id = generateMessageId()) {
  if (!['available', 'unavailable', 'composing', 'recording', 'paused'].includes(type)) {
    throw new TypeError(`Presence type tidak didukung: ${type}`)
  }
  if (type === 'available' || type === 'unavailable') {
    const me = jidDecode(meJid)
    return { tag: 'presence', attrs: { name: me?.user ?? String(meJid).replace(/@.*$/, ''), type } }
  }
  if (!toJid) throw new TypeError('toJid wajib untuk chat presence')
  const me = jidDecode(meJid)
  if (!me) throw new TypeError('meJid tidak valid')
  const contentTag = type === 'recording' ? 'composing' : type
  return {
    tag: 'chatstate',
    attrs: { from: (isLidUser(toJid) || isHostedLidUser(toJid)) ? meJid : meJid, to: toJid, id },
    content: [{ tag: contentTag, attrs: type === 'recording' ? { media: 'audio' } : {} }]
  }
}

export function buildPresenceSubscribeNode(jid, id = generateMessageId()) {
  const target = jidNormalizedUser(jid)
  if (!target) throw new TypeError('Presence target tidak valid')
  return { tag: 'presence', attrs: { to: target, id, type: 'subscribe' } }
}

export function buildReceiptNode(key, type = 'read') {
  const remoteJid = jidNormalizedUser(key?.remoteJid ?? '') || String(key?.remoteJid ?? '')
  const id = String(key?.id ?? '')
  if (!remoteJid || !id) throw new TypeError('Receipt membutuhkan remoteJid dan id')
  const attrs = { id, to: remoteJid, type }
  if (type === 'read' || type === 'read-self') attrs.t = String(Math.floor(Date.now() / 1000))
  if (key?.participant) attrs.participant = jidNormalizedUser(key.participant)
  return { tag: 'receipt', attrs }
}

export function buildBulkReceiptNodes(keys, type = 'read') {
  const groups = new Map()
  for (const key of keys ?? []) {
    if (!key || key.fromMe) continue
    const remoteJid = key.remoteJid ?? ''
    const participant = key.participant ? jidNormalizedUser(key.participant) : ''
    const groupKey = `${remoteJid}|${participant}`
    const list = groups.get(groupKey) ?? { remoteJid, participant, ids: [] }
    list.ids.push(String(key.id ?? ''))
    groups.set(groupKey, list)
  }
  const nodes = []
  for (const group of groups.values()) {
    if (!group.ids.length || group.ids.some(id => !id)) continue
    const node = buildReceiptNode({ remoteJid: group.remoteJid, participant: group.participant || undefined, id: group.ids[0] }, type)
    if (group.ids.length > 1) {
      node.content = [{ tag: 'list', attrs: {}, content: group.ids.slice(1).map(id => ({ tag: 'item', attrs: { id } })) }]
    }
    nodes.push(node)
  }
  return nodes
}

export function buildGroupQuery(jid, type, content = []) {
  if (!jid || !String(jid).includes('@')) throw new TypeError('Group JID tidak valid')
  if (type !== 'get' && type !== 'set') throw new TypeError('Group query type harus get/set')
  return { tag: 'iq', attrs: { type, xmlns: 'w:g2', to: jid }, content }
}

function children(node, tag) {
  if (!Array.isArray(node?.content)) return []
  return node.content.filter(item => item?.tag === tag)
}

export function extractGroupMetadata(result) {
  const group = findNodeChild(result, 'group')
  if (!group) {
    const error = findNodeChild(result, 'error')
    const code = Number(error?.attrs?.code ?? 500)
    const err = new Error(error?.attrs?.text ?? 'Group metadata query gagal')
    err.statusCode = Number.isFinite(code) ? code : 500
    err.data = result
    throw err
  }
  const id = group.attrs?.id?.includes('@') ? group.attrs.id : `${group.attrs?.id ?? ''}@g.us`
  if (!id || id === '@g.us') throw new Error('Response group tidak memiliki id')
  const description = findNodeChild(group, 'description')
  const body = findNodeChild(description, 'body')
  const participants = children(group, 'participant').map(node => ({
    id: node.attrs?.jid ?? node.attrs?.id,
    admin: node.attrs?.type ?? node.attrs?.admin ?? undefined,
    lid: node.attrs?.lid ?? undefined
  })).filter(participant => participant.id)
  return {
    id,
    subject: group.attrs?.subject,
    subjectOwner: group.attrs?.s_o,
    subjectTime: group.attrs?.s_t ? Number(group.attrs.s_t) : undefined,
    desc: body?.content != null ? Buffer.from(body.content).toString('utf8') : undefined,
    descId: description?.attrs?.id,
    descOwner: description?.attrs?.participant,
    announce: group.attrs?.announce === 'true',
    restrict: group.attrs?.restrict === 'true',
    addressingMode: group.attrs?.addressing_mode ?? 'pn',
    size: participants.length,
    participants
  }
}

export function buildGroupActionNodes(participants, action) {
  if (!Array.isArray(participants) || participants.length === 0) throw new TypeError('Participants wajib berupa array tidak kosong')
  if (!['add', 'remove', 'promote', 'demote'].includes(action)) throw new TypeError('Group participant action tidak valid')
  return [{
    tag: action,
    attrs: {},
    content: participants.map(jid => ({ tag: 'participant', attrs: { jid: jidNormalizedUser(jid) || String(jid) } }))
  }]
}
