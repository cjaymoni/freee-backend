import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Cloudinary rejects images above 10 MB on the current plan, so larger files
 * are refused here with a 413 instead of failing at upload time. Documented
 * for mobile clients in docs/ANDROID_INTEGRATION.md.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Cloudinary folder the server uploads item images into. */
export const ITEM_IMAGE_FOLDER = 'items';

/**
 * Whether a public id is one of our item uploads. Item-image deletes only ever
 * destroy these, so a row pointing at another asset (an avatar, a chat image)
 * can never make the server delete it.
 */
export const isItemImagePublicId = (
  publicId: string | null | undefined,
): publicId is string => !!publicId?.startsWith(`${ITEM_IMAGE_FOLDER}/`);

/** Files accepted in a single create or update request. */
export const MAX_IMAGES_PER_REQUEST = 10;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];

/**
 * Rejects oversized and non-image uploads at the edge, before the buffer is
 * held in memory and shipped to Cloudinary. Multer maps the size limit to a
 * 413; the filter below raises its own 400.
 */
export const itemImageUploadOptions: MulterOptions = {
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_IMAGES_PER_REQUEST,
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
