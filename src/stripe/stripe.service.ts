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

  // --- Prepaid subscription / one-time payment (current money flow) --------

  // Ensure a Stripe Product exists for the plan (so subscription invoices and
  // reporting are clean) and persist its id on the plan row. Returns the id.
  async upsertProduct(plan: {
    id: string;
    name: string;
    stripeProductId: string | null;
  }): Promise<string> {
    if (plan.stripeProductId) {
      // Keep the product name in sync; ignore failures (reporting nicety only).
      try {
        await this.stripe.products.update(plan.stripeProductId, {
          name: plan.name,
        });
      } catch {
        // non-fatal
      }
      return plan.stripeProductId;
    }
    const product = await this.stripe.products.create({
      name: plan.name,
      metadata: { planId: plan.id },
    });
    await this.prisma.plan.update({
      where: { id: plan.id },
      data: { stripeProductId: product.id },
    });
    return product.id;
  }

  // weekly → every 1 week, biweekly → every 2 weeks, monthly → every 1 month.
  private intervalToStripe(interval: 'weekly' | 'biweekly' | 'monthly'): {
    interval: 'week' | 'month';
    interval_count: number;
  } {
    switch (interval) {
      case 'weekly':
        return { interval: 'week', interval_count: 1 };
      case 'biweekly':
        return { interval: 'week', interval_count: 2 };
      case 'monthly':
        return { interval: 'month', interval_count: 1 };
    }
  }

  // Recurring plan: create a Subscription with inline price_data (so the exact
  // base+surcharge amount is charged without a fixed Stripe Price), restricted to
  // card + Link. `default_incomplete` yields a first invoice whose
  // confirmation_secret drives the embedded Payment Element on the client.
  async createSubscription(params: {
    customerId: string;
    productId: string;
    unitAmount: number; // cents (base + surcharge)
    interval: 'weekly' | 'biweekly' | 'monthly';
    metadata?: Record<string, string>;
  }): Promise<{ subscriptionId: string; clientSecret: string }> {
    const subscription = await this.stripe.subscriptions.create({
      customer: params.customerId,
      items: [
        {
          price_data: {
            currency: 'usd',
            product: params.productId,
            unit_amount: params.unitAmount,
            recurring: this.intervalToStripe(params.interval),
          },
          quantity: 1,
        },
      ],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        payment_method_types: ['card', 'link'],
        save_default_payment_method: 'on_subscription',
      },
      // This API version exposes the first-payment client secret on the invoice's
      // confirmation_secret (the legacy latest_invoice.payment_intent is gone).
      expand: ['latest_invoice.confirmation_secret'],
      metadata: params.metadata,
    });

    const invoice = subscription.latest_invoice;
    const clientSecret =
      invoice && typeof invoice !== 'string'
        ? invoice.confirmation_secret?.client_secret
        : null;
    if (!clientSecret) {
      throw new Error(
        'Stripe did not return a confirmation secret for the subscription invoice.',
      );
    }
    return { subscriptionId: subscription.id, clientSecret };
  }

  // One-time plan: a PaymentIntent charged now via the embedded Payment Element,
  // restricted to card + Link (no automatic_payment_methods, which would surface
  // other wallets).
  async createPaymentIntent(params: {
    customerId: string;
    amount: number; // cents
    metadata?: Record<string, string>;
  }): Promise<{ paymentIntentId: string; clientSecret: string }> {
    const intent = await this.stripe.paymentIntents.create({
      amount: params.amount,
      currency: 'usd',
      customer: params.customerId,
      payment_method_types: ['card', 'link'],
      metadata: params.metadata,
    });
    if (!intent.client_secret) {
      throw new Error('Stripe did not return a PaymentIntent client secret.');
    }
    return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
  }

  async cancelSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  // Verify + parse a webhook payload. Requires STRIPE_WEBHOOK_SECRET to be set.
  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    const secret = this.config.stripeWebhookSecret;
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
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
