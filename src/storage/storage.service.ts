import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import type { PhotoType } from '../../generated/prisma/client';

const PRESIGN_TTL_SECONDS = 300;

// Bucket folder (key prefix) for agent before/after job photos.
const PHOTO_PREFIX = 'serviceConfirm';

// Bucket folder for user profile avatars. Served via the public R2 URL, so this
// prefix must sit under a publicly-readable path/bucket.
const AVATAR_PREFIX = 'avatars';

// Maps an allowed image content type to a file extension for the object key.
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket?: string;
  private readonly publicUrlBase?: string;

  constructor(private readonly config: AppConfigService) {
    this.bucket = config.r2Bucket;
    this.publicUrlBase = config.r2PublicUrl;
    const endpoint = config.r2Endpoint;
    const accessKeyId = config.r2AccessKeyId;
    const secretAccessKey = config.r2SecretAccessKey;

    // R2 env is optional so the app boots before storage is configured; presign
    // calls throw a clear error until it is.
    if (endpoint && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // AWS SDK v3 defaults to "WHEN_SUPPORTED", which bakes an
        // x-amz-checksum-crc32 (computed over an empty body at presign time)
        // into presigned PUT URLs. A browser then uploads the real file body,
        // R2 recomputes the CRC32, and the mismatch is rejected — so direct
        // browser → R2 presigned uploads must not force a checksum.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    } else {
      this.client = null;
    }
  }

  private ensureConfigured(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new InternalServerErrorException(
        'Photo storage is not configured (missing R2_* environment variables).',
      );
    }
    return { client: this.client, bucket: this.bucket };
  }

  // Object keys are namespaced by job + photo type under the serviceConfirm/
  // folder, so a compromised/looped agent can't overwrite another job's photos.
  buildKey(jobId: string, type: PhotoType): string {
    return `${PHOTO_PREFIX}/${jobId}/${type}/${randomUUID()}.jpg`;
  }

  // Validates a client-supplied key really belongs to this job + photo type
  // before we trust it on a JobPhoto row. Single source of truth for the key
  // namespace (keep in sync with buildKey — that's why it lives here).
  isKeyForJob(key: string, jobId: string, type: PhotoType): boolean {
    return key.startsWith(`${PHOTO_PREFIX}/${jobId}/${type}/`);
  }

  // Object key for a user's profile avatar. Namespaced by user id so one user
  // can never overwrite another's avatar; the random suffix busts CDN/browser
  // caches when the same user replaces their photo. `contentType` is assumed to
  // already be validated against EXTENSION_BY_CONTENT_TYPE by the caller.
  buildAvatarKey(userId: string, contentType: string): string {
    const ext = EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'jpg';
    return `${AVATAR_PREFIX}/${userId}/${randomUUID()}.${ext}`;
  }

  // Directly-viewable URL for a public object. Used for avatars, which are
  // stored on the session and rendered by the browser without presigning.
  publicUrl(key: string): string {
    if (!this.publicUrlBase) {
      throw new InternalServerErrorException(
        'Public storage URL is not configured (missing R2_PUBLIC_URL environment variable).',
      );
    }
    return `${this.publicUrlBase.replace(/\/+$/, '')}/${key}`;
  }

  // Server-side upload of an in-memory buffer (used for avatars, which are
  // proxied through the backend so their bytes can be validated before storage,
  // and to avoid needing browser → R2 CORS for the upload).
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const { client, bucket } = this.ensureConfigured();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  // Short-lived PUT URL for a direct browser → R2 upload. The signature is bound
  // to `contentType`, so the client MUST send the exact same Content-Type.
  async presignUpload(key: string, contentType: string): Promise<string> {
    const { client, bucket } = this.ensureConfigured();
    return getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
  }

  // Short-lived GET URL so the customer can view a photo from the private bucket.
  async presignDownload(key: string): Promise<string> {
    const { client, bucket } = this.ensureConfigured();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
  }
}
