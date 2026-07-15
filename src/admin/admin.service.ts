import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import type { AssignableRole } from './dto/set-role.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async setUserRole(userId: string, role: AssignableRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true },
    });
  }

  // Refund a disputed job. Only valid before the payout Transfer has fired —
  // since payout only happens after the 24h window, funds are still on-platform
  // at dispute time.
  async refundJob(jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (!job.stripePaymentIntentId) {
      throw new BadRequestException('This job has no charge to refund.');
    }
    if (job.status === 'paid' || job.stripeTransferId) {
      throw new BadRequestException(
        'Funds have already been paid out to the agent; cannot refund.',
      );
    }

    await this.stripe.refundPaymentIntent(job.stripePaymentIntentId);

    return this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'refunded' },
      select: { id: true, status: true },
    });
  }
}
