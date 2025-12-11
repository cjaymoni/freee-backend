import { ApiProperty } from '@nestjs/swagger';

export class UploadImageResponseDto {
  @ApiProperty({
    description: 'Public ID of the uploaded image',
    example: 'avatars/user_123456789',
  })
  publicId: string;

  @ApiProperty({
    description: 'Secure URL of the uploaded image',
    example:
      'https://res.cloudinary.com/demo/image/upload/v1234567890/avatars/user_123456789.jpg',
  })
  secureUrl: string;

  @ApiProperty({
    description: 'Width of the uploaded image in pixels',
    example: 500,
  })
  width: number;

  @ApiProperty({
    description: 'Height of the uploaded image in pixels',
    example: 500,
  })
  height: number;

  @ApiProperty({
    description: 'Format of the uploaded image',
    example: 'jpg',
  })
  format: string;

  @ApiProperty({
    description: 'Size of the uploaded image in bytes',
    example: 45678,
  })
  bytes: number;
}
