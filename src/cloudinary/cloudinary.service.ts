import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';
import { UploadImageResponseDto } from './dto/upload-image-response.dto';
import {
  UploadOptions,
  DeleteOptions,
} from './interfaces/cloudinary.interfaces';
import * as streamifier from 'streamifier';

type CloudinaryUploadFile = {
  buffer: Buffer;
  [key: string]: unknown;
};

@Injectable()
export class CloudinaryService {
  /**
   * Upload an image from a buffer (e.g., from multipart form data)
   * @param file - Express.Multer.File object
   * @param options - Optional upload configuration (folder, publicId, tags, context, overwrite)
   * @returns Upload response with public ID and secure URL
   */
  async uploadImage(
    file: CloudinaryUploadFile,
    options?: UploadOptions,
  ): Promise<UploadImageResponseDto> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options?.folder || 'uploads',
          resource_type: 'image',
          public_id: options?.publicId,
          tags: options?.tags,
          context: options?.context,
          overwrite: options?.overwrite,
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) {
            reject(
              new InternalServerErrorException(
                `Failed to upload image to Cloudinary: ${error.message}`,
              ),
            );
            return;
          }
          if (result) {
            resolve({
              publicId: result.public_id,
              secureUrl: result.secure_url,
              width: result.width,
              height: result.height,
              format: result.format,
              bytes: result.bytes,
            });
            return;
          }
          // Handle edge case where neither error nor result is provided
          reject(
            new InternalServerErrorException(
              'Upload failed with no result from Cloudinary',
            ),
          );
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  /**
   * Upload a user avatar with automatic transformations
   * @param file - Express.Multer.File object
   * @param userId - User ID for organizing avatars
   * @returns Upload response with public ID and secure URL
   */
  async uploadAvatar(
    file: CloudinaryUploadFile,
    userId: string,
  ): Promise<UploadImageResponseDto> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'avatars',
          public_id: `user_${userId}`,
          overwrite: true,
          transformation: [
            { width: 500, height: 500, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) {
            reject(
              new InternalServerErrorException(
                `Failed to upload avatar to Cloudinary: ${error.message}`,
              ),
            );
            return;
          }
          if (result) {
            resolve({
              publicId: result.public_id,
              secureUrl: result.secure_url,
              width: result.width,
              height: result.height,
              format: result.format,
              bytes: result.bytes,
            });
            return;
          }
          // Handle edge case where neither error nor result is provided
          reject(
            new InternalServerErrorException(
              'Avatar upload failed with no result from Cloudinary',
            ),
          );
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  /**
   * Delete an asset from Cloudinary by public ID
   * @param publicId - The public ID of the asset to delete
   * @param options - Optional delete options (resource type, invalidate CDN)
   * @returns Deletion result
   */
  async deleteImage(
    publicId: string,
    options?: DeleteOptions,
  ): Promise<{ result: string }> {
    try {
      const result = (await cloudinary.uploader.destroy(publicId, {
        resource_type: options?.resourceType || 'image',
        invalidate: options?.invalidate || false,
      })) as {
        result: string;
      };
      return result;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new InternalServerErrorException(
        `Failed to delete asset from Cloudinary: ${errorMessage}`,
      );
    }
  }

  /**
   * Get an optimized image URL with transformations
   * @param publicId - The public ID of the image
   * @param width - Desired width (optional)
   * @param height - Desired height (optional)
   * @returns Transformed image URL
   */
  getImageUrl(publicId: string, width?: number, height?: number): string {
    const transformation: {
      quality: string;
      fetch_format: string;
      width?: number;
      height?: number;
      crop?: string;
    } = {
      quality: 'auto',
      fetch_format: 'auto',
    };

    if (width) transformation.width = width;
    if (height) transformation.height = height;
    if (width && height) transformation.crop = 'fill';

    return cloudinary.url(publicId, transformation);
  }

  /**
   * Get avatar URL with specific size
   * @param publicId - The public ID of the avatar
   * @param size - Size in pixels (default: 200)
   * @returns Avatar URL
   */
  getAvatarUrl(publicId: string, size: number = 200): string {
    return cloudinary.url(publicId, {
      width: size,
      height: size,
      crop: 'fill',
      gravity: 'face',
      quality: 'auto',
      fetch_format: 'auto',
    });
  }
}
