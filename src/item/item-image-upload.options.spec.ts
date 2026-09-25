import { BadRequestException } from '@nestjs/common';
import {
  itemImageUploadOptions,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_REQUEST,
} from './item-image-upload.options';

const filterFile = (mimetype: string) => {
  const callback = jest.fn();
  itemImageUploadOptions.fileFilter!(
    {} as never,
    { mimetype } as Express.Multer.File,
    callback,
  );
  return callback;
};

describe('itemImageUploadOptions', () => {
  it('caps file size and file count', () => {
    expect(itemImageUploadOptions.limits?.fileSize).toBe(MAX_IMAGE_BYTES);
    expect(itemImageUploadOptions.limits?.files).toBe(MAX_IMAGES_PER_REQUEST);
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])(
    'accepts %s',
    (mimetype) => {
      expect(filterFile(mimetype)).toHaveBeenCalledWith(null, true);
    },
  );

  it.each(['application/pdf', 'video/mp4', 'text/html', 'application/zip'])(
    'rejects %s with a 400',
    (mimetype) => {
      const callback = filterFile(mimetype);
      const [error, accepted] = callback.mock.calls[0] as [Error, boolean];

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain(mimetype);
      expect(accepted).toBe(false);
    },
  );
});
