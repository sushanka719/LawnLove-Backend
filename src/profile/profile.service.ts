import { BadRequestException, Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';

// Profile Picture — JPG/JPEG/PNG/WEBP up to 5 MB (form-field standards §10).
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_ERROR_MESSAGE = 'Only JPG/PNG images up to 5 MB are allowed.';

// Detects the real image type from the file's magic bytes (signature) rather
// than trusting the client-declared MIME type or extension — this is what
// rejects a renamed executable dressed up as `.jpg` (standards §10).
function detectImageContentType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: "RIFF" (52 49 46 46) .... "WEBP" (57 45 42 50)
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class ProfileService {
  constructor(private readonly storage: StorageService) {}

  // Validates the uploaded avatar server-side (real type via magic bytes, size),
  // stores it in R2, and returns the public URL to persist on `user.image`. Size
  // is also capped by the FileInterceptor limit; this is defense in depth.
  async uploadAvatar(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<string> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image file was provided.');
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new BadRequestException(AVATAR_ERROR_MESSAGE);
    }
    const contentType = detectImageContentType(file.buffer);
    if (!contentType) {
      throw new BadRequestException(AVATAR_ERROR_MESSAGE);
    }
    const key = this.storage.buildAvatarKey(userId, contentType);
    // Resolve the public URL first so a missing R2_PUBLIC_URL fails before we
    // write an object whose URL we couldn't hand back anyway.
    const publicUrl = this.storage.publicUrl(key);
    await this.storage.putObject(key, file.buffer, contentType);
    return publicUrl;
  }
}
