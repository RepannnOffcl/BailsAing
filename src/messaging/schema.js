// Wire schema for the public WhatsApp Message union.  The top-level field map is
// kept explicit so newly encountered message wrappers are never silently dropped.
// Nested schemas cover the common interoperable message families; unknown nested
// payloads retain their raw protobuf bytes for lossless forwarding.

export const MESSAGE_FIELD_MAP = Object.freeze({
  conversation: 1,
  senderKeyDistributionMessage: 2,
  imageMessage: 3,
  contactMessage: 4,
  locationMessage: 5,
  extendedTextMessage: 6,
  documentMessage: 7,
  audioMessage: 8,
  videoMessage: 9,
  call: 10,
  chat: 11,
  protocolMessage: 12,
  contactsArrayMessage: 13,
  highlyStructuredMessage: 14,
  fastRatchetKeySenderKeyDistributionMessage: 15,
  sendPaymentMessage: 16,
  liveLocationMessage: 18,
  requestPaymentMessage: 22,
  declinePaymentRequestMessage: 23,
  cancelPaymentRequestMessage: 24,
  templateMessage: 25,
  stickerMessage: 26,
  groupInviteMessage: 28,
  templateButtonReplyMessage: 29,
  productMessage: 30,
  deviceSentMessage: 31,
  messageContextInfo: 35,
  listMessage: 36,
  viewOnceMessage: 37,
  orderMessage: 38,
  listResponseMessage: 39,
  ephemeralMessage: 40,
  invoiceMessage: 41,
  buttonsMessage: 42,
  buttonsResponseMessage: 43,
  paymentInviteMessage: 44,
  interactiveMessage: 45,
  reactionMessage: 46,
  stickerSyncRmrMessage: 47,
  interactiveResponseMessage: 48,
  pollCreationMessage: 49,
  pollUpdateMessage: 50,
  keepInChatMessage: 51,
  documentWithCaptionMessage: 53,
  requestPhoneNumberMessage: 54,
  viewOnceMessageV2: 55,
  encReactionMessage: 56,
  editedMessage: 58,
  viewOnceMessageV2Extension: 59,
  pollCreationMessageV2: 60,
  scheduledCallCreationMessage: 61,
  groupMentionedMessage: 62,
  pinInChatMessage: 63,
  pollCreationMessageV3: 64,
  scheduledCallEditMessage: 65,
  ptvMessage: 66,
  botInvokeMessage: 67,
  callLogMesssage: 69,
  messageHistoryBundle: 70,
  encCommentMessage: 71,
  bcallMessage: 72,
  lottieStickerMessage: 74,
  eventMessage: 75,
  encEventResponseMessage: 76,
  commentMessage: 77,
  newsletterAdminInviteMessage: 78,
  placeholderMessage: 80,
  secretEncryptedMessage: 82,
  albumMessage: 83,
  eventCoverImage: 85,
  stickerPackMessage: 86,
  statusMentionMessage: 87,
  pollResultSnapshotMessage: 88,
  pollCreationOptionImageMessage: 90,
  associatedChildMessage: 91,
  groupStatusMentionMessage: 92,
  pollCreationMessageV4: 93,
  statusAddYours: 95,
  groupStatusMessage: 96,
  richResponseMessage: 97,
  statusNotificationMessage: 98,
  limitSharingMessage: 99,
  botTaskMessage: 100,
  questionMessage: 101,
  messageHistoryNotice: 102,
  groupStatusMessageV2: 103,
  botForwardedMessage: 104,
  statusQuestionAnswerMessage: 105,
  questionReplyMessage: 106,
  questionResponseMessage: 107,
  statusQuotedMessage: 109,
  statusStickerInteractionMessage: 110,
  pollCreationMessageV5: 111,
  newsletterFollowerInviteMessageV2: 113,
  pollResultSnapshotMessageV3: 114
})

export const SUPPORTED_MESSAGE_TYPES = Object.freeze(Object.keys(MESSAGE_FIELD_MAP))

const s = (field, type, extra = {}) => ({ field, type, ...extra })
const message = schema => s(0, 'message', { schema })

export const COMMON_SCHEMAS = Object.freeze({
  MessageKey: [s(1, 'string', { name: 'remoteJid' }), s(2, 'bool', { name: 'fromMe' }), s(3, 'string', { name: 'id' }), s(4, 'string', { name: 'participant' })],
  ContextInfo: [
    s(1, 'string', { name: 'stanzaId' }), s(2, 'string', { name: 'participant' }),
    s(3, 'message', { name: 'quotedMessage', schemaName: 'Message' }), s(4, 'string', { name: 'remoteJid' }),
    s(15, 'string', { name: 'mentionedJid', repeated: true }), s(18, 'string', { name: 'conversionSource' }),
    s(19, 'bytes', { name: 'conversionData' }), s(20, 'uint', { name: 'conversionDelaySeconds' }),
    s(21, 'uint', { name: 'forwardingScore' }), s(22, 'bool', { name: 'isForwarded' }),
    s(24, 'message', { name: 'placeholderKey', schemaName: 'MessageKey' }), s(25, 'uint', { name: 'expiration' }),
    s(26, 'int', { name: 'ephemeralSettingTimestamp' }), s(27, 'bytes', { name: 'ephemeralSharedSecret' }),
    s(34, 'string', { name: 'groupSubject' }), s(35, 'string', { name: 'parentGroupJid' })
  ],
  SenderKeyDistributionMessage: [s(1, 'uint', { name: 'id' }), s(2, 'uint', { name: 'iteration' }), s(3, 'bytes', { name: 'chainKey' }), s(4, 'bytes', { name: 'signingKey' })],
  ImageMessage: [
    s(1, 'string', { name: 'url' }), s(2, 'string', { name: 'mimetype' }), s(3, 'bytes', { name: 'fileSha256' }),
    s(4, 'uint64', { name: 'fileLength' }), s(5, 'uint', { name: 'height' }), s(6, 'uint', { name: 'width' }),
    s(7, 'bytes', { name: 'mediaKey' }), s(8, 'bytes', { name: 'fileEncSha256' }), s(9, 'string', { name: 'directPath' }),
    s(10, 'int', { name: 'mediaKeyTimestamp' }), s(16, 'bytes', { name: 'jpegThumbnail' }),
    s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(20, 'string', { name: 'caption' }),
    s(21, 'string', { name: 'accessibilityLabel' })
  ],
  ContactMessage: [s(1, 'string', { name: 'displayName' }), s(16, 'string', { name: 'vcard' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  ContactsArrayMessage: [s(1, 'string', { name: 'displayName' }), s(2, 'message', { name: 'contacts', schemaName: 'ContactMessage', repeated: true }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  LocationMessage: [
    s(1, 'double', { name: 'degreesLatitude' }), s(2, 'double', { name: 'degreesLongitude' }), s(3, 'string', { name: 'name' }),
    s(4, 'string', { name: 'address' }), s(5, 'string', { name: 'url' }), s(6, 'bool', { name: 'isLive' }),
    s(7, 'uint', { name: 'accuracyInMeters' }), s(8, 'float', { name: 'speedInMps' }), s(9, 'uint', { name: 'degreesClockwiseFromMagneticNorth' }),
    s(11, 'string', { name: 'comment' }), s(16, 'bytes', { name: 'jpegThumbnail' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })
  ],
  LiveLocationMessage: [
    s(1, 'double', { name: 'degreesLatitude' }), s(2, 'double', { name: 'degreesLongitude' }), s(3, 'uint', { name: 'accuracyInMeters' }),
    s(4, 'float', { name: 'speedInMps' }), s(5, 'uint', { name: 'degreesClockwiseFromMagneticNorth' }), s(6, 'string', { name: 'caption' }),
    s(7, 'int', { name: 'sequenceNumber' }), s(8, 'uint', { name: 'timeOffset' }), s(16, 'bytes', { name: 'jpegThumbnail' }),
    s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })
  ],
  ExtendedTextMessage: [
    s(1, 'string', { name: 'text' }), s(2, 'string', { name: 'matchedText' }), s(5, 'string', { name: 'description' }), s(6, 'string', { name: 'title' }),
    s(7, 'fixed32', { name: 'textArgb' }), s(8, 'fixed32', { name: 'backgroundArgb' }), s(9, 'uint', { name: 'font' }),
    s(10, 'uint', { name: 'previewType' }), s(16, 'bytes', { name: 'jpegThumbnail' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }),
    s(18, 'bool', { name: 'doNotPlayInline' }), s(19, 'string', { name: 'thumbnailDirectPath' }), s(20, 'bytes', { name: 'thumbnailSha256' }),
    s(21, 'bytes', { name: 'thumbnailEncSha256' }), s(22, 'bytes', { name: 'mediaKey' }), s(23, 'int', { name: 'mediaKeyTimestamp' }),
    s(24, 'uint', { name: 'thumbnailHeight' }), s(25, 'uint', { name: 'thumbnailWidth' }), s(30, 'bool', { name: 'viewOnce' })
  ],
  DocumentMessage: [
    s(1, 'string', { name: 'url' }), s(2, 'string', { name: 'mimetype' }), s(3, 'string', { name: 'title' }), s(4, 'bytes', { name: 'fileSha256' }),
    s(5, 'uint64', { name: 'fileLength' }), s(6, 'uint', { name: 'pageCount' }), s(7, 'bytes', { name: 'mediaKey' }), s(8, 'string', { name: 'fileName' }),
    s(9, 'bytes', { name: 'fileEncSha256' }), s(10, 'string', { name: 'directPath' }), s(11, 'int', { name: 'mediaKeyTimestamp' }), s(12, 'bool', { name: 'contactVcard' }),
    s(13, 'string', { name: 'thumbnailDirectPath' }), s(14, 'bytes', { name: 'thumbnailSha256' }), s(15, 'bytes', { name: 'thumbnailEncSha256' }),
    s(16, 'bytes', { name: 'jpegThumbnail' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(18, 'uint', { name: 'thumbnailHeight' }),
    s(19, 'uint', { name: 'thumbnailWidth' }), s(20, 'string', { name: 'caption' }), s(21, 'string', { name: 'accessibilityLabel' })
  ],
  AudioMessage: [
    s(1, 'string', { name: 'url' }), s(2, 'string', { name: 'mimetype' }), s(3, 'bytes', { name: 'fileSha256' }), s(4, 'uint64', { name: 'fileLength' }),
    s(5, 'uint', { name: 'seconds' }), s(6, 'bool', { name: 'ptt' }), s(7, 'bytes', { name: 'mediaKey' }), s(8, 'bytes', { name: 'fileEncSha256' }),
    s(9, 'string', { name: 'directPath' }), s(10, 'int', { name: 'mediaKeyTimestamp' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }),
    s(18, 'bytes', { name: 'streamingSidecar' }), s(19, 'bytes', { name: 'waveform' }), s(21, 'bool', { name: 'viewOnce' }), s(22, 'string', { name: 'accessibilityLabel' })
  ],
  VideoMessage: [
    s(1, 'string', { name: 'url' }), s(2, 'string', { name: 'mimetype' }), s(3, 'bytes', { name: 'fileSha256' }), s(4, 'uint64', { name: 'fileLength' }),
    s(5, 'uint', { name: 'seconds' }), s(6, 'bytes', { name: 'mediaKey' }), s(7, 'string', { name: 'caption' }), s(8, 'bool', { name: 'gifPlayback' }),
    s(9, 'uint', { name: 'height' }), s(10, 'uint', { name: 'width' }), s(11, 'bytes', { name: 'fileEncSha256' }), s(13, 'string', { name: 'directPath' }),
    s(14, 'int', { name: 'mediaKeyTimestamp' }), s(16, 'bytes', { name: 'jpegThumbnail' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }),
    s(18, 'bytes', { name: 'streamingSidecar' }), s(19, 'int', { name: 'gifAttribution' }), s(20, 'bool', { name: 'viewOnce' }),
    s(21, 'string', { name: 'thumbnailDirectPath' }), s(22, 'bytes', { name: 'thumbnailSha256' }), s(23, 'bytes', { name: 'thumbnailEncSha256' }),
    s(24, 'string', { name: 'staticUrl' }), s(25, 'message', { name: 'annotations', schemaName: 'Message', repeated: true }),
    s(26, 'string', { name: 'accessibilityLabel' }), s(27, 'message', { name: 'processedVideos', schemaName: 'Message', repeated: true }),
    s(28, 'uint', { name: 'externalShareFullVideoDurationInSeconds' }), s(29, 'uint64', { name: 'motionPhotoPresentationOffsetMs' }),
    s(30, 'string', { name: 'metadataUrl' }), s(31, 'uint', { name: 'videoSourceType' }), s(32, 'string', { name: 'mediaKeyDomain' })
  ],
  GroupInviteMessage: [s(1, 'string', { name: 'groupJid' }), s(2, 'string', { name: 'inviteCode' }), s(3, 'int', { name: 'inviteExpiration' }), s(4, 'string', { name: 'groupName' }), s(5, 'bytes', { name: 'jpegThumbnail' }), s(6, 'string', { name: 'caption' }), s(7, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(8, 'uint', { name: 'groupType' })],
  ButtonsResponseMessage: [s(1, 'string', { name: 'selectedButtonId' }), s(2, 'string', { name: 'selectedDisplayText' }), s(3, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(4, 'uint', { name: 'type' })],
  RequestPhoneNumberMessage: [s(1, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  ReactionMessage: [s(1, 'message', { name: 'key', schemaName: 'MessageKey' }), s(2, 'string', { name: 'text' }), s(3, 'string', { name: 'groupingKey' }), s(4, 'int', { name: 'senderTimestampMs' }), s(5, 'bool', { name: 'unread' })],
  EncReactionMessage: [s(1, 'message', { name: 'targetMessageKey', schemaName: 'MessageKey' }), s(2, 'bytes', { name: 'encPayload' }), s(3, 'bytes', { name: 'encIv' })],
  EncCommentMessage: [s(1, 'message', { name: 'targetMessageKey', schemaName: 'MessageKey' }), s(2, 'bytes', { name: 'encPayload' }), s(3, 'bytes', { name: 'encIv' })],
  EncEventResponseMessage: [s(1, 'message', { name: 'eventCreationMessageKey', schemaName: 'MessageKey' }), s(2, 'bytes', { name: 'encPayload' }), s(3, 'bytes', { name: 'encIv' })],
  EventMessage: [s(1, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(2, 'bool', { name: 'isCanceled' }), s(3, 'string', { name: 'name' }), s(4, 'string', { name: 'description' }), s(5, 'message', { name: 'location', schemaName: 'LocationMessage' }), s(6, 'string', { name: 'joinLink' }), s(7, 'int', { name: 'startTime' }), s(8, 'int', { name: 'endTime' }), s(9, 'bool', { name: 'extraGuestsAllowed' }), s(10, 'bool', { name: 'isScheduleCall' }), s(11, 'bool', { name: 'hasReminder' }), s(12, 'int', { name: 'reminderOffsetSec' })],
  AlbumMessage: [s(2, 'uint', { name: 'expectedImageCount' }), s(3, 'uint', { name: 'expectedVideoCount' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  MessageHistoryBundle: [s(1, 'string', { name: 'mimetype' }), s(2, 'bytes', { name: 'fileSha256' }), s(3, 'bytes', { name: 'mediaKey' }), s(4, 'bytes', { name: 'fileEncSha256' }), s(5, 'string', { name: 'directPath' }), s(6, 'int', { name: 'mediaKeyTimestamp' }), s(7, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  MessageHistoryNotice: [s(1, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(2, 'message', { name: 'messageHistoryMetadata', schemaName: 'MessageHistoryMetadata' })],
  MessageHistoryMetadata: [s(1, 'string', { name: 'historyReceivers', repeated: true }), s(2, 'int', { name: 'oldestMessageTimestamp' }), s(3, 'int', { name: 'messageCount' })],
  NewsletterAdminInviteMessage: [s(1, 'string', { name: 'newsletterJid' }), s(2, 'string', { name: 'newsletterName' }), s(3, 'bytes', { name: 'jpegThumbnail' }), s(4, 'string', { name: 'caption' }), s(5, 'int', { name: 'inviteExpiration' }), s(6, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  NewsletterFollowerInviteMessage: [s(1, 'string', { name: 'newsletterJid' }), s(2, 'string', { name: 'newsletterName' }), s(3, 'bytes', { name: 'jpegThumbnail' }), s(4, 'string', { name: 'caption' }), s(5, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  OrderMessage: [s(1, 'string', { name: 'orderId' }), s(2, 'bytes', { name: 'thumbnail' }), s(3, 'int', { name: 'itemCount' }), s(4, 'uint', { name: 'status' }), s(5, 'uint', { name: 'surface' }), s(6, 'string', { name: 'message' }), s(7, 'string', { name: 'orderTitle' }), s(8, 'string', { name: 'sellerJid' }), s(9, 'string', { name: 'token' }), s(10, 'int', { name: 'totalAmount1000' }), s(11, 'string', { name: 'totalCurrencyCode' }), s(12, 'int', { name: 'messageVersion' }), s(13, 'message', { name: 'orderRequestMessageId', schemaName: 'MessageKey' }), s(15, 'string', { name: 'catalogType' }), s(17, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' })],
  PaymentInviteMessage: [s(1, 'uint', { name: 'serviceType' }), s(2, 'int', { name: 'expiryTimestamp' })],
  PollCreationMessage: [s(1, 'bytes', { name: 'encKey' }), s(2, 'string', { name: 'name' }), s(3, 'message', { name: 'options', schemaName: 'PollOption', repeated: true }), s(4, 'uint', { name: 'selectableOptionsCount' }), s(5, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(6, 'uint', { name: 'pollContentType' }), s(7, 'uint', { name: 'pollType' }), s(8, 'message', { name: 'correctAnswer', schemaName: 'PollOption' })],
  PollOption: [s(1, 'string', { name: 'optionName' }), s(2, 'string', { name: 'optionHash' })],
  PollUpdateMessage: [s(1, 'message', { name: 'pollCreationMessageKey', schemaName: 'MessageKey' }), s(2, 'message', { name: 'vote', schemaName: 'PollEncValue' }), s(3, 'message', { name: 'metadata', schemaName: 'Empty' }), s(4, 'int', { name: 'senderTimestampMs' })],
  PollEncValue: [s(1, 'bytes', { name: 'encPayload' }), s(2, 'bytes', { name: 'encIv' })],
  PollResultSnapshotMessage: [s(1, 'string', { name: 'name' }), s(2, 'message', { name: 'pollVotes', schemaName: 'PollVote', repeated: true }), s(3, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(4, 'uint', { name: 'pollType' })],
  PollVote: [s(1, 'string', { name: 'optionName' }), s(2, 'int', { name: 'optionVoteCount' })],
  PlaceholderMessage: [s(1, 'uint', { name: 'type' })],
  PinInChatMessage: [s(1, 'message', { name: 'key', schemaName: 'MessageKey' }), s(2, 'uint', { name: 'type' }), s(3, 'int', { name: 'senderTimestampMs' })],
  Call: [s(1, 'bytes', { name: 'callKey' }), s(2, 'string', { name: 'conversionSource' }), s(3, 'bytes', { name: 'conversionData' }), s(4, 'uint', { name: 'conversionDelaySeconds' }), s(5, 'string', { name: 'ctwaSignals' }), s(6, 'bytes', { name: 'ctwaPayload' }), s(7, 'message', { name: 'contextInfo', schemaName: 'ContextInfo' }), s(8, 'string', { name: 'nativeFlowCallButtonPayload' }), s(9, 'string', { name: 'deeplinkPayload' })],
  Chat: [s(1, 'string', { name: 'displayName' }), s(2, 'string', { name: 'id' })],
  DeviceSentMessage: [s(1, 'string', { name: 'destinationJid' }), s(2, 'message', { name: 'message', schemaName: 'Message' }), s(3, 'string', { name: 'phash' })],
  CommentMessage: [s(1, 'message', { name: 'message', schemaName: 'Message' }), s(2, 'message', { name: 'targetMessageKey', schemaName: 'MessageKey' })]
})

export const WRAPPER_MESSAGE_TYPES = Object.freeze(new Set([
  'viewOnceMessage', 'ephemeralMessage', 'documentWithCaptionMessage', 'viewOnceMessageV2', 'editedMessage',
  'viewOnceMessageV2Extension', 'groupMentionedMessage', 'botInvokeMessage', 'eventCoverImage', 'statusMentionMessage',
  'pollCreationOptionImageMessage', 'associatedChildMessage', 'groupStatusMentionMessage', 'pollCreationMessageV4',
  'statusAddYours', 'groupStatusMessage', 'limitSharingMessage', 'botTaskMessage', 'questionMessage',
  'groupStatusMessageV2', 'botForwardedMessage', 'questionReplyMessage'
]))

export function schemaForType(type) {
  if (type === 'Message') return null
  if (COMMON_SCHEMAS[type]) return COMMON_SCHEMAS[type]
  if (WRAPPER_MESSAGE_TYPES.has(type)) return [s(1, 'message', { name: 'message', schemaName: 'Message' })]
  return null
}
