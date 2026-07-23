import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PayoutService } from '../payout/payout.service';
import { CreateReviewDto } from './dto/create-review.dto';

// Customer-facing view of a Job (their side of the escrow flow): see photos,
// rate the work, approve early, or dispute.
@Injectable()
export class BookingJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly payout: PayoutService,
  ) {}

  // All of the customer's jobs (across their bookings), newest first, for the
  // dashboard list.
  async listMyJobs(userId: string) {
    return this.prisma.job.findMany({
      where: { booking: { userId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        visitNumber: true,
        completedAt: true,
        reviewDeadline: true,
        review: { select: { rating: true } },
        booking: {
          select: {
            address: true,
            scheduleDate: true,
            timeSlot: true,
            totalPerVisit: true,
          },
        },
      },
    });
  }

  private async loadOwnedJob(jobId: string, userId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { booking: true, photos: true, review: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (job.booking.userId !== userId) {
      throw new ForbiddenException('This job does not belong to you.');
    }
    return job;
  }

  async getJob(jobId: string, userId: string) {
    const job = await this.loadOwnedJob(jobId, userId);

    // Presign each photo for viewing from the private bucket.
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
      scheduledDate: job.scheduledDate,
      visitNumber: job.visitNumber,
      completedAt: job.completedAt,
      reviewDeadline: job.reviewDeadline,
      amount: job.amount,
      booking: {
        address: job.booking.address,
        scheduleDate: job.booking.scheduleDate,
        timeSlot: job.booking.timeSlot,
        totalPerVisit: job.booking.totalPerVisit,
      },
      photos: {
        before: photos.filter((p) => p.type === 'before'),
        after: photos.filter((p) => p.type === 'after'),
      },
      review: job.review
        ? { rating: job.review.rating, comment: job.review.comment }
        : null,
    };
  }

  async submitReview(jobId: string, userId: string, dto: CreateReviewDto) {
    const job = await this.loadOwnedJob(jobId, userId);
    if (!job.completedAt) {
      throw new BadRequestException('You can only review a completed service.');
    }
    if (job.review) {
      throw new BadRequestException('You have already reviewed this service.');
    }
    return this.prisma.review.create({
      data: { jobId, rating: dto.rating, comment: dto.comment ?? null },
      select: { id: true, rating: true, comment: true, createdAt: true },
    });
  }

  async approve(jobId: string, userId: string) {
    const job = await this.loadOwnedJob(jobId, userId);
    if (job.status !== 'in_review') {
      throw new BadRequestException(
        `Only a job awaiting review can be approved (status "${job.status}").`,
      );
    }
    return this.payout.releaseJob(jobId);
  }

  async dispute(jobId: string, userId: string) {
    const job = await this.loadOwnedJob(jobId, userId);
    if (job.status !== 'in_review') {
      throw new BadRequestException(
        `Only a job awaiting review can be disputed (status "${job.status}").`,
      );
    }
    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'disputed' },
      select: { id: true, status: true },
    });
    return updated;
  }
}
