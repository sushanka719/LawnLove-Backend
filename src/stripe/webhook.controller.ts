import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

// Stripe webhook — the authoritative source of booking payment state. Verifies
// the signature against the raw request body (captured by nestjs-better-auth's
// `bodyParser.rawBody` option), then applies idempotent status transitions.
@Controller('stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header.');
    }
    const raw = req.rawBody;
    if (!raw) {
      // rawBody missing means bodyParser.rawBody isn't enabled on AuthModule.
      throw new BadRequestException('Raw request body unavailable.');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.constructWebhookEvent(raw, signature);
    } catch (err) {
      this.logger.warn(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Invalid webhook signature.');
    }

    // Handlers are idempotent (status transitions are guarded), so replaying a
    // duplicate event id is a no-op — no separate dedupe store needed.
    await this.process(event);
    return { received: true };
  }

  private async process(event: Stripe.Event) {
    switch (event.type) {
      // One-time bookings: the PaymentIntent carries our booking metadata.
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const bookingId = pi.metadata?.bookingId;
        if (!bookingId) return; // subscription-invoice PIs → handled by invoice.paid
        await this.activateById(bookingId, pi.amount_received ?? pi.amount);
        return;
      }
      // Recurring bookings: match the invoice's subscription to the booking.
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = this.subscriptionIdFromInvoice(invoice);
        if (!subscriptionId) return;
        await this.activateBySubscription(subscriptionId, invoice.amount_paid);
        return;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = this.subscriptionIdFromInvoice(invoice);
        if (!subscriptionId) return;
        await this.prisma.booking.updateMany({
          where: {
            stripeSubscriptionId: subscriptionId,
            status: { notIn: ['cancelled', 'completed'] },
          },
          data: { status: 'pastDue' },
        });
        return;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await this.prisma.booking.updateMany({
          where: {
            stripeSubscriptionId: sub.id,
            status: { notIn: ['cancelled', 'completed'] },
          },
          data: { status: 'cancelled' },
        });
        return;
      }
      default:
        // Unhandled event types are acknowledged (200) and ignored.
        return;
    }
  }

  // Locate the subscription an invoice belongs to, tolerant of the API version
  // the webhook destination is on: 2025+ nests it under
  // invoice.parent.subscription_details.subscription; older versions
  // (e.g. 2024-11-20.acacia) expose invoice.subscription directly.
  private subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
    const legacy = invoice as unknown as {
      subscription?: string | { id: string } | null;
    };
    const sub =
      invoice.parent?.subscription_details?.subscription ?? legacy.subscription;
    if (!sub) return null;
    return typeof sub === 'string' ? sub : sub.id;
  }

  private async activateById(bookingId: string, amountCharged: number) {
    await this.prisma.booking.updateMany({
      where: { id: bookingId, status: { in: ['pendingPayment', 'pastDue'] } },
      data: { status: 'active', amountCharged },
    });
  }

  private async activateBySubscription(
    subscriptionId: string,
    amountCharged: number,
  ) {
    await this.prisma.booking.updateMany({
      where: {
        stripeSubscriptionId: subscriptionId,
        status: { in: ['pendingPayment', 'pastDue'] },
      },
      data: { status: 'active', amountCharged },
    });
  }
}
