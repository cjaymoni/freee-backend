import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ALLOWED_IMAGE_MIME_TYPES } from '../item/item-image-upload.options';

/** Cloudinary rejects images above this on the current plan. */
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/**
 * Rejects oversized and non-image avatars before they reach Cloudinary, which
 * would otherwise fail the upload and surface as a 500.
 */
export const avatarUploadOptions: MulterOptions = {
  limits: {
    fileSize: MAX_AVATAR_BYTES,
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
