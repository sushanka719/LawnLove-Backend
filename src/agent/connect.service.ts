import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

@Injectable()
export class ConnectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  // Load the fields the Stripe helpers need — the better-auth session doesn't
  // carry custom columns like stripeConnectAccountId.
  private async loadAgent(userId: string) {
    const agent = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, stripeConnectAccountId: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found.');
    }
    return agent;
  }

  async startOnboarding(user: SessionUser): Promise<{ url: string }> {
    const agent = await this.loadAgent(user.id);
    const accountId = await this.stripe.createConnectedAccount(agent);
    const url = await this.stripe.createAccountLink(accountId);
    return { url };
  }

  async getStatus(user: SessionUser) {
    const agent = await this.loadAgent(user.id);
    return this.stripe.refreshPayoutStatus(agent);
  }
}
