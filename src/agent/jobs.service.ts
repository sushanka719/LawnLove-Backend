import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { StorageService } from '../storage/storage.service';
import { sendInvoiceEmail } from '../mail/mail.service';
import {
  bookingReference,
  bookingServiceLabel,
} from '../booking/booking-format';
import { distanceMeters } from '../booking/geo';
import type { StartJobDto } from './dto/start-job.dto';
import type { PhotoUploadUrlDto } from './dto/photo-upload-url.dto';
import type { RegisterPhotoDto } from './dto/register-photo.dto';

// Beyond this distance from the property we flag the start as suspicious (soft).
const PROXIMITY_WARN_METERS = 500;
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  // All jobs assigned to this agent, grouped by status for the dashboard.
  async listMyJobs(agentId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        reviewDeadline: true,
        createdAt: true,
        booking: {
          select: {
            address: true,
            scheduleDate: true,
            timeSlot: true,
            estimatedAreaSqFt: true,
            totalPerVisit: true,
          },
        },
      },
    });
    return jobs;
  }

  // Full detail for one of the agent's jobs, including presigned URLs for any
  // photos already uploaded (so the workflow survives a page refresh).
  async getJobDetail(jobId: string, agentId: string) {
    const job = await this.loadOwnedJob(jobId, agentId);
    const photos = await Promise.all(
      job.photos
        .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
        .map(async (photo) => ({
          id: photo.id,
          type: photo.type,
          takenAt: photo.takenAt,
          url: await this.storage.presignDownload(photo.storageKey),
        })),
    );
    return {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      reviewDeadline: job.reviewDeadline,
      booking: {
        address: job.booking.address,
        scheduleDate: job.booking.scheduleDate,
        timeSlot: job.booking.timeSlot,
        estimatedAreaSqFt: job.booking.estimatedAreaSqFt,
        totalPerVisit: job.booking.totalPerVisit,
      },
      photos: {
        before: photos.filter((p) => p.type === 'before'),
        after: photos.filter((p) => p.type === 'after'),
      },
    };
  }

  // Load a job and assert it belongs to this agent.
  private async loadOwnedJob(jobId: string, agentId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { booking: true, photos: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (job.agentId !== agentId) {
      throw new ForbiddenException('This job is not assigned to you.');
    }
    return job;
  }

  async startJob(jobId: string, agentId: string, dto: StartJobDto) {
    const job = await this.loadOwnedJob(jobId, agentId);
    if (job.status !== 'assigned') {
      throw new BadRequestException(
        `Job cannot be started from status "${job.status}".`,
      );
    }

    // Soft proximity check — we record but don't block a far-away start.
    let farFromProperty = false;
    if (job.booking.lat != null && job.booking.lng != null) {
      const meters = distanceMeters(
        { lat: dto.lat, lng: dto.lng },
        { lat: job.booking.lat, lng: job.booking.lng },
      );
      farFromProperty = meters > PROXIMITY_WARN_METERS;
      if (farFromProperty) {
        this.logger.warn(
          `Job ${jobId} started ${Math.round(meters)}m from property.`,
        );
      }
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'started',
        startedAt: new Date(),
        startLat: dto.lat,
        startLng: dto.lng,
      },
      select: { id: true, status: true, startedAt: true },
    });
    return { ...updated, farFromProperty };
  }

  async createUploadUrl(
    jobId: string,
    agentId: string,
    dto: PhotoUploadUrlDto,
  ) {
    const job = await this.loadOwnedJob(jobId, agentId);
    if (job.status !== 'started') {
      throw new BadRequestException('Start the job before uploading photos.');
    }
    const key = this.storage.buildKey(jobId, dto.type);
    const uploadUrl = await this.storage.presignUpload(key, dto.contentType);
    return { uploadUrl, key };
  }

  async registerPhoto(jobId: string, agentId: string, dto: RegisterPhotoDto) {
    const job = await this.loadOwnedJob(jobId, agentId);
    if (job.status !== 'started') {
      throw new BadRequestException('Start the job before uploading photos.');
    }
    // Key must be within this job + type namespace (guards against a caller
    // registering someone else's object key).
    if (!this.storage.isKeyForJob(dto.key, jobId, dto.type)) {
      throw new BadRequestException('Photo key does not match this job.');
    }
    const takenAt = new Date(dto.takenAt);
    if (Number.isNaN(takenAt.getTime())) {
      throw new BadRequestException('Invalid takenAt timestamp.');
    }

    const photo = await this.prisma.jobPhoto.create({
      data: {
        jobId,
        type: dto.type,
        storageKey: dto.key,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        takenAt,
      },
      select: { id: true, type: true, createdAt: true },
    });
    return photo;
  }

  async completeJob(jobId: string, agentId: string) {
    const job = await this.loadOwnedJob(jobId, agentId);
    if (job.status !== 'started') {
      throw new BadRequestException(
        `Job cannot be completed from status "${job.status}".`,
      );
    }

    const hasBefore = job.photos.some((p) => p.type === 'before');
    const hasAfter = job.photos.some((p) => p.type === 'after');
    if (!hasBefore || !hasAfter) {
      throw new BadRequestException(
        'At least one before photo and one after photo are required.',
      );
    }

    // Escrow charge: bill the saved card off-session. Booking totals are stored
    // in whole dollars; Stripe wants cents.
    const amount = job.booking.totalPerVisit * 100;
    const platformFee = Math.round(amount * this.config.platformFeePct);

    let paymentIntentId: string;
    try {
      const intent = await this.stripe.chargeSavedCard({
        amount,
        customerId: job.booking.stripeCustomerId,
        paymentMethodId: job.booking.stripePaymentMethodId,
        metadata: { jobId, bookingId: job.bookingId },
      });
      paymentIntentId = intent.id;
    } catch (err) {
      // Saved cards rarely need SCA, but if they do we can't finish the charge
      // off-session. Mark the visit done-but-unpaid so it isn't lost, and ask
      // the customer to re-confirm on-session.
      const code = (err as { code?: string }).code;
      if (code === 'authentication_required') {
        await this.prisma.job.update({
          where: { id: jobId },
          data: { status: 'completed', completedAt: new Date() },
        });
        throw new BadRequestException(
          'Payment needs customer authentication. The customer must re-confirm their card.',
        );
      }
      throw err;
    }

    const completedAt = new Date();
    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'in_review',
        completedAt,
        reviewDeadline: new Date(completedAt.getTime() + REVIEW_WINDOW_MS),
        amount,
        platformFee,
        stripePaymentIntentId: paymentIntentId,
        chargedAt: completedAt,
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
        reviewDeadline: true,
        amount: true,
      },
    });

    // Email the paid receipt — never let a mail failure roll back a paid,
    // completed job.
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: job.booking.userId },
        select: { email: true },
      });
      if (customer?.email) {
        await sendInvoiceEmail(customer.email, {
          invoiceNumber: `INV-${jobId.slice(-6).toUpperCase()}`,
          reference: bookingReference(job.bookingId),
          serviceLabel: bookingServiceLabel(job.booking.frequency),
          address: job.booking.address,
          servicedOn: completedAt,
          areaSqFt: job.booking.estimatedAreaSqFt,
          amountCents: amount,
          dashboardUrl: `${this.config.appUrl}/dashboard/jobs/${jobId}`,
        });
      }
    } catch (mailErr) {
      this.logger.error(
        `Failed to send invoice email for job ${jobId}`,
        mailErr as Error,
      );
    }

    return updated;
  }
}
