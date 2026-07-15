import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutService } from './payout.service';

// Auto-payout sweep: releases held funds once the 24h review window has elapsed
// (or immediately for jobs already approved/parked as "released"). Disputed
// jobs have status "disputed" and are excluded by the status filter.
@Injectable()
export class PayoutCron {
  private readonly logger = new Logger(PayoutCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payout: PayoutService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async releaseDueJobs() {
    const now = new Date();
    const due = await this.prisma.job.findMany({
      where: {
        OR: [
          { status: 'in_review', reviewDeadline: { lt: now } },
          { status: 'released' },
        ],
      },
      select: { id: true },
    });

    if (due.length === 0) return;
    this.logger.log(`Auto-payout: ${due.length} job(s) due for release.`);

    // Isolate failures so one bad transfer doesn't stall the batch — the job
    // stays eligible and is retried next tick.
    for (const job of due) {
      try {
        await this.payout.releaseJob(job.id);
      } catch (err) {
        this.logger.error(`Auto-payout failed for job ${job.id}`, err as Error);
      }
    }
  }
}
