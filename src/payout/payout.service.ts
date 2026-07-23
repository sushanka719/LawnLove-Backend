import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { sendPayoutReleasedEmail } from '../mail/mail.service';

export type ReleaseResult = {
  status: string;
  paid: boolean;
  reason?: string;
};

export type DisburseResult = {
  jobId: string;
  paid: boolean;
  amount: number; // cents
};

// Shared "release held funds to the agent" logic — used by both the customer
// "approve now" endpoint and the auto-payout cron, so there is one source of
// truth for the money movement.
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async releaseJob(jobId: string): Promise<ReleaseResult> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        agent: {
          select: {
            email: true,
            stripeConnectAccountId: true,
            payoutsEnabled: true,
          },
        },
      },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (job.status === 'paid') {
      return { status: 'paid', paid: true };
    }
    if (job.status !== 'in_review' && job.status !== 'released') {
      throw new BadRequestException(
        `Cannot release a job in status "${job.status}".`,
      );
    }
    if (job.amount == null || job.platformFee == null) {
      throw new BadRequestException('Job has no captured charge to release.');
    }

    const releasedAt = job.releasedAt ?? new Date();

    // Cleared for payout, but the agent must be onboarded to actually receive
    // the transfer. Park it as "released" and let the cron retry once they are.
    if (!job.agent?.payoutsEnabled || !job.agent.stripeConnectAccountId) {
      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'released', releasedAt },
      });
      return {
        status: 'released',
        paid: false,
        reason: 'Agent payouts not enabled yet.',
      };
    }

    const transferAmount = job.amount - job.platformFee;
    const transfer = await this.stripe.transferToAgent({
      amount: transferAmount,
      destination: job.agent.stripeConnectAccountId,
      metadata: { jobId, bookingId: job.bookingId },
    });

    await this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'paid', stripeTransferId: transfer.id, releasedAt },
    });

    this.logger.log(
      `Released ${transferAmount}¢ to agent ${job.agentId} for job ${jobId}.`,
    );

    // Best-effort notification — a mail failure must not undo a completed payout.
    if (job.agent.email) {
      try {
        await sendPayoutReleasedEmail(
          job.agent.email,
          `$${(transferAmount / 100).toFixed(2)}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send payout email for job ${jobId}`,
          err as Error,
        );
      }
    }

    return { status: 'paid', paid: true };
  }

  // Deferred per-visit payout for the prepaid model. Admins mark an owed visit
  // as paid out-of-band (bank transfer, etc.); there is no real Stripe transfer
  // yet — this only records that the payout happened (agentPaidAt + a reference).
  // Idempotent: marking an already-paid visit is a no-op that returns paid.
  async disburse(jobId: string, ref?: string): Promise<DisburseResult> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, agentPayoutAmount: true, agentPaidAt: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (job.agentPayoutAmount == null) {
      throw new BadRequestException(
        'This visit has no recorded payout amount to disburse.',
      );
    }
    if (job.agentPaidAt) {
      return { jobId, paid: true, amount: job.agentPayoutAmount };
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        agentPaidAt: new Date(),
        agentPayoutRef: ref?.trim() || `manual-${randomUUID().slice(0, 8)}`,
      },
    });

    this.logger.log(
      `Marked payout paid for job ${jobId} (${job.agentPayoutAmount}¢).`,
    );

    return { jobId, paid: true, amount: job.agentPayoutAmount };
  }
}
