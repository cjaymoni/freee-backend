import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ALLOWED_IMAGE_MIME_TYPES } from '../item/item-image-upload.options';

/** Socket.io namespace the gateway is mounted on. */
export const CHAT_NAMESPACE = '/chat';

/** Cloudinary folder chat attachments are uploaded to. */
export const CHAT_IMAGE_FOLDER = 'chat';

/** Longest text message accepted, matching the DTO validator. */
export const MAX_MESSAGE_LENGTH = 4000;

/** How much of a message is copied into conversations.last_message_preview. */
export const MESSAGE_PREVIEW_LENGTH = 200;

/**
 * Chat attachments share the 10 MB ceiling Cloudinary enforces on the current
 * plan (see MAX_IMAGE_BYTES).
 */
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * How long a typing indicator stays live if the sender never sends the
 * matching stop - a dropped connection must not leave "typing..." on screen
 * forever. Advertised to clients so they can expire it locally too.
 */
export const TYPING_TIMEOUT_MS = 8000;

/** Events the server emits to clients. */
export const ChatEvents = {
  MESSAGE_NEW: 'message:new',
  MESSAGE_READ: 'message:read',
  MESSAGE_DELETED: 'message:deleted',
  CONVERSATION_UPDATED: 'conversation:updated',
  TYPING: 'typing',
  PRESENCE: 'presence',
  UNREAD_COUNT: 'unread:count',
  ERROR: 'error',
} as const;

/** Events clients send to the server. */
export const ChatClientEvents = {
  SEND_MESSAGE: 'message:send',
  MARK_READ: 'message:read',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
} as const;

/** Rejects oversized and non-image attachments before they reach Cloudinary. */
export const chatImageUploadOptions: MulterOptions = {
  limits: {
    fileSize: MAX_CHAT_IMAGE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      callback(
        new BadRequestException(
          `Unsupported image type "${file.mimetype}". Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}.`,
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
};
