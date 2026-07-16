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

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket?: string;

  constructor(private readonly config: AppConfigService) {
    this.bucket = config.r2Bucket;
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
