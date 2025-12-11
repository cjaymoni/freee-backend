import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { UploadImageResponseDto } from './dto/upload-image-response.dto';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
  /**
   * Upload an image from a buffer (e.g., from multipart form data)
   * @param file - Express.Multer.File object
   * @param folder - Cloudinary folder to organize uploads (default: 'uploads')
   * @returns Upload response with public ID and secure URL
   */
  async uploadImage(
    file: Express.Multer.File,
    folder: string = 'uploads',
  ): Promise<UploadImageResponseDto> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
        },
        (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
          if (error) {
            reject(new InternalServerErrorException('Failed to upload image to Cloudinary'));
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
          }
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
    file: Express.Multer.File,
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
        (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
          if (error) {
            reject(new InternalServerErrorException('Failed to upload avatar to Cloudinary'));
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
          }
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  /**
   * Delete an image from Cloudinary by public ID
   * @param publicId - The public ID of the image to delete
   * @returns Deletion result
   */
  async deleteImage(publicId: string): Promise<{ result: string }> {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      return result;
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete image from Cloudinary');
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
    const transformation: any = {
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
