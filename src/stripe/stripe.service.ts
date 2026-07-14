import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { AppConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;

  constructor(
    config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(config.stripeSecretKey);
  }

  // Reuse the user's Stripe customer across bookings / saved cards. The id is
  // persisted on the user row so a returning customer keeps a single customer
  // record (and therefore their saved payment methods).
  async getOrCreateCustomer(user: SessionUser): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { stripeCustomerId: true },
    });
    if (existing?.stripeCustomerId) {
      return existing.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: user.id },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  async createSetupIntent(customerId: string) {
    const setupIntent = await this.stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
    });
    return { clientSecret: setupIntent.client_secret, customerId };
  }

  // Confirm the payment method belongs to this customer before we trust it on a
  // booking. confirmSetup already attaches it client-side; this is a guard
  // against a caller passing an arbitrary payment_method id.
  async assertPaymentMethodOwnedByCustomer(
    paymentMethodId: string,
    customerId: string,
  ): Promise<boolean> {
    const paymentMethod =
      await this.stripe.paymentMethods.retrieve(paymentMethodId);
    return paymentMethod.customer === customerId;
  }
}
