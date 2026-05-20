const Message = require('../models/Message');
const { User } = require('../models/User');

const MESSAGE_SELECT_FIELDS =
  'roomId senderId messageText image fileUrl fileType fileUrls fileTypes audioUrl audioDuration videoUrl videoDuration videoThumbnail videoUrls videoDurations videoThumbnails messageType seen seenAt seenBy reactions replyTo createdAt';

const REPLY_SNIPPET_MAX = 120;

const REPLY_TYPE_LABELS = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  file: 'File',
  multiple: 'Attachments',
};

function getReplySnippet(parent) {
  if (parent.messageText && parent.messageText.trim()) {
    const text = parent.messageText.trim();
    return text.length > REPLY_SNIPPET_MAX
      ? `${text.slice(0, REPLY_SNIPPET_MAX - 3)}...`
      : text;
  }
  return REPLY_TYPE_LABELS[parent.messageType] || 'Message';
}

function getReplyPreviewUrl(parent) {
  if (parent.messageType === 'image') {
    return parent.fileUrl || parent.image || undefined;
  }
  if (parent.messageType === 'video') {
    return parent.videoThumbnail || parent.videoUrl || undefined;
  }
  if (parent.fileUrl && parent.fileType && parent.fileType.startsWith('image/')) {
    return parent.fileUrl;
  }
  if (parent.fileUrls && parent.fileUrls.length > 0 && parent.fileTypes?.[0]?.startsWith('image/')) {
    return parent.fileUrls[0];
  }
  return undefined;
}

async function buildReplyToSnapshot(replyToMessageId, roomId) {
  if (!replyToMessageId) return null;

  const parent = await Message.findById(replyToMessageId);
  if (!parent || parent.roomId !== roomId) return null;

  const parentUser = await User.findById(parent.senderId).select('username');
  const senderName = parentUser?.username || 'Unknown';

  return {
    messageId: parent._id.toString(),
    senderId: parent.senderId,
    senderName,
    messageText: getReplySnippet(parent),
    messageType: parent.messageType,
    previewUrl: getReplyPreviewUrl(parent),
  };
}

async function attachReplyTo(messageData, replyToMessageId, roomId) {
  const replyTo = await buildReplyToSnapshot(replyToMessageId, roomId);
  if (replyTo) {
    messageData.replyTo = replyTo;
  }
  return messageData;
}

function buildMessagePreview(msg) {
  return getReplySnippet(msg);
}

async function getLatestMessageByRoomIds(roomIds) {
  if (!roomIds.length) return {};

  const latestByRoom = await Message.aggregate([
    { $match: { roomId: { $in: roomIds.map(String) } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$roomId',
        createdAt: { $first: '$createdAt' },
        messageText: { $first: '$messageText' },
        messageType: { $first: '$messageType' },
        audioUrl: { $first: '$audioUrl' },
        image: { $first: '$image' },
        fileUrl: { $first: '$fileUrl' },
      },
    },
  ]);

  return Object.fromEntries(latestByRoom.map((r) => [r._id, r]));
}

module.exports = {
  MESSAGE_SELECT_FIELDS,
  buildReplyToSnapshot,
  attachReplyTo,
  buildMessagePreview,
  getLatestMessageByRoomIds,
};
