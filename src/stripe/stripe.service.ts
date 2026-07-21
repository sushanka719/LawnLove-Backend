import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { AppConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

type ConnectAgent = {
  id: string;
  email: string;
  stripeConnectAccountId?: string | null;
};

export type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
};

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;

  constructor(
    private readonly config: AppConfigService,
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
      // Card-only: `automatic_payment_methods` enables Stripe Link, which then
      // saves the method as a `link` PaymentMethod. Our wallet lists (and the
      // escrow charge reads) `type: 'card'` only, so a Link method would attach
      // to the customer but never show up in the list. Restrict to card.
      payment_method_types: ['card'],
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

  // --- Saved cards (customer wallet) --------------------------------------

  // List the customer's saved cards, flagging which one is their Stripe default
  // (customer.invoice_settings.default_payment_method). A customer can hold many
  // cards — the escrow charge / booking flow picks one by id.
  async listPaymentMethods(customerId: string): Promise<SavedCard[]> {
    const [methods, customer] = await Promise.all([
      this.stripe.paymentMethods.list({ customer: customerId, type: 'card' }),
      this.stripe.customers.retrieve(customerId),
    ]);

    // `retrieve` returns Customer | DeletedCustomer; a deleted customer has no
    // invoice_settings. `default_payment_method` may be an id or expanded object.
    let defaultPaymentMethodId: string | null = null;
    if ('invoice_settings' in customer) {
      const dpm = customer.invoice_settings?.default_payment_method;
      defaultPaymentMethodId = typeof dpm === 'string' ? dpm : (dpm?.id ?? null);
    }

    return methods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'unknown',
      last4: pm.card?.last4 ?? '••••',
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
      isDefault: pm.id === defaultPaymentMethodId,
    }));
  }

  // Mark a card as the customer's default for future off-session charges.
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  // Detach a saved card from the customer. It can no longer be charged after
  // this; existing bookings that reference it will fail their next charge.
  async detachPaymentMethod(paymentMethodId: string) {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  // --- Stripe Connect (Express) — agent payout accounts -------------------

  // Reuse an existing connected account if the agent already started onboarding;
  // otherwise create an Express account and persist its id on the user.
  async createConnectedAccount(agent: ConnectAgent): Promise<string> {
    if (agent.stripeConnectAccountId) {
      return agent.stripeConnectAccountId;
    }

    const account = await this.stripe.accounts.create({
      type: 'express',
      email: agent.email,
      metadata: { userId: agent.id },
    });

    await this.prisma.user.update({
      where: { id: agent.id },
      data: { stripeConnectAccountId: account.id },
    });

    return account.id;
  }

  // One-time onboarding URL. Stripe sends the agent to `return_url` when done and
  // `refresh_url` if the link expires; both re-poll status on the frontend.
  async createAccountLink(accountId: string): Promise<string> {
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${this.config.appUrl}/agent/connect/refresh`,
      return_url: `${this.config.appUrl}/agent/connect/return`,
    });
    return link.url;
  }

  // Poll the connected account and persist whether it can receive payouts. Used
  // when the agent returns from onboarding (no webhook needed for the MVP).
  async refreshPayoutStatus(agent: ConnectAgent): Promise<{
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  }> {
    if (!agent.stripeConnectAccountId) {
      return { payoutsEnabled: false, detailsSubmitted: false };
    }

    const account = await this.stripe.accounts.retrieve(
      agent.stripeConnectAccountId,
    );
    const payoutsEnabled = Boolean(
      account.charges_enabled && account.payouts_enabled,
    );

    await this.prisma.user.update({
      where: { id: agent.id },
      data: { payoutsEnabled },
    });

    return {
      payoutsEnabled,
      detailsSubmitted: Boolean(account.details_submitted),
    };
  }

  // --- Escrow money movement (used in Phases 3 & 4) -----------------------

  // Charge the customer's saved card off-session at job completion. Funds land
  // in the platform balance (held) until the review window releases them via a
  // Transfer to the agent's connected account (separate charges & transfers).
  async chargeSavedCard(params: {
    amount: number; // cents
    customerId: string;
    paymentMethodId: string;
    metadata?: Record<string, string>;
  }) {
    return this.stripe.paymentIntents.create({
      amount: params.amount,
      currency: 'usd',
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: params.metadata,
    });
  }

  // Move held funds (amount − fee) to the agent's connected account.
  async transferToAgent(params: {
    amount: number; // cents
    destination: string; // connected account id
    metadata?: Record<string, string>;
  }) {
    return this.stripe.transfers.create({
      amount: params.amount,
      currency: 'usd',
      destination: params.destination,
      metadata: params.metadata,
    });
  }

  async refundPaymentIntent(paymentIntentId: string) {
    return this.stripe.refunds.create({ payment_intent: paymentIntentId });
  }
}
