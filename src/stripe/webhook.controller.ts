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
import { AddressesService } from '../addresses/addresses.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
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
    private readonly scheduler: SchedulerService,
    private readonly addresses: AddressesService,
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
        const pi = event.data.object;
        const bookingId = pi.metadata?.bookingId;
        if (!bookingId) return; // subscription-invoice PIs → handled by invoice.paid
        await this.activateById(bookingId, pi.amount_received ?? pi.amount);
        return;
      }
      // Recurring bookings: match the invoice's subscription to the booking.
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = this.subscriptionIdFromInvoice(invoice);
        if (!subscriptionId) return;
        await this.activateBySubscription(subscriptionId, invoice.amount_paid);
        return;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
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
        const sub = event.data.object;
        await this.prisma.booking.updateMany({
          where: {
            stripeSubscriptionId: sub.id,
            status: { notIn: ['cancelled', 'completed'] },
          },
          data: { status: 'cancelled' },
        });
        // Stop maintaining future visits for the cancelled subscription — drop
        // the not-yet-started ('assigned') ones; keep started/completed records.
        await this.prisma.job.deleteMany({
          where: {
            booking: { stripeSubscriptionId: sub.id },
            status: 'assigned',
          },
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
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: { in: ['pendingPayment', 'pastDue'] } },
      data: { status: 'active', amountCharged },
    });
    // Only assign on the actual transition to active (count > 0) — a replayed
    // webhook or a mid-cycle renewal invoice leaves the count at 0 and no-ops.
    if (result.count > 0) {
      await this.assignFirstVisit(bookingId);
      await this.saveBookingAddress(bookingId);
    }
  }

  private async activateBySubscription(
    subscriptionId: string,
    amountCharged: number,
  ) {
    // Capture which bookings are about to transition, so we know whose first
    // visit to assign after the update.
    const activating = await this.prisma.booking.findMany({
      where: {
        stripeSubscriptionId: subscriptionId,
        status: { in: ['pendingPayment', 'pastDue'] },
      },
      select: { id: true },
    });
    await this.prisma.booking.updateMany({
      where: {
        stripeSubscriptionId: subscriptionId,
        status: { in: ['pendingPayment', 'pastDue'] },
      },
      data: { status: 'active', amountCharged },
    });
    for (const booking of activating) {
      await this.assignFirstVisit(booking.id);
      await this.saveBookingAddress(booking.id);
    }
  }

  // Event-driven first-visit assignment: the customer already chose the date,
  // so we assign the moment payment lands. Best-effort — a scheduling hiccup
  // must never fail the webhook (the cron's self-heal pass retries), so we log
  // and swallow. Recurring visits #2+ are generated by the daily cron.
  private async assignFirstVisit(bookingId: string) {
    try {
      const job = await this.prisma.job.findFirst({
        where: { bookingId, visitNumber: 1 },
        select: { id: true },
      });
      if (job) {
        await this.scheduler.assignVisit(job.id);
      }
    } catch (err) {
      this.logger.error(
        `Failed to assign first visit for booking ${bookingId}`,
        err as Error,
      );
    }
  }

  // Save the paid booking's address into the customer's reusable address book,
  // so a completed booking (and only a completed one) makes that address
  // pickable next time. Runs only on the transition to active, so abandoned
  // pendingPayment bookings never leak an address. Deduped in
  // AddressesService.saveFromBooking, so re-booking the same place is a no-op.
  // Best-effort like assignFirstVisit — a hiccup here must never fail the
  // webhook (that would make Stripe retry an already-activated booking).
  private async saveBookingAddress(bookingId: string) {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: { userId: true, address: true, lat: true, lng: true },
      });
      if (!booking) return;
      await this.addresses.saveFromBooking(booking.userId, {
        address: booking.address,
        lat: booking.lat,
        lng: booking.lng,
      });
    } catch (err) {
      this.logger.error(
        `Failed to save booking address for booking ${bookingId}`,
        err as Error,
      );
    }
  }
}
