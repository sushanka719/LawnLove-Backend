import { IsEnum, IsIn, IsString } from 'class-validator';
import { PhotoType } from '../../../generated/prisma/client';

// Only JPEG/PNG/WebP — the presigned PUT is bound to this exact content type.
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class PhotoUploadUrlDto {
  @IsEnum(PhotoType)
  type: PhotoType;

  @IsString()
  @IsIn(ALLOWED_CONTENT_TYPES, {
    message: `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
  })
  contentType: string;
}
