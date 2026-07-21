import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

// Job statuses that still need the saved card: the escrow charge fires when a
// job is completed (from `started`), reading Booking.stripePaymentMethodId.
// Anything past the charge no longer depends on the card.
const PRE_CHARGE_JOB_STATUSES = ['assigned', 'started'] as const;

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly stripe: StripeService,
    private readonly prisma: PrismaService,
  ) {}

  // List every card the signed-in user has saved on their Stripe customer.
  async list(user: SessionUser) {
    const customerId = await this.stripe.getOrCreateCustomer(user);
    return this.stripe.listPaymentMethods(customerId);
  }

  // Start a SetupIntent so the frontend can mount Stripe's PaymentElement and
  // save a new card (usage: off_session → chargeable later without the user).
  async createSetupIntent(user: SessionUser) {
    const customerId = await this.stripe.getOrCreateCustomer(user);
    const { clientSecret } = await this.stripe.createSetupIntent(customerId);
    return { clientSecret };
  }

  async setDefault(user: SessionUser, paymentMethodId: string) {
    const customerId = await this.assertOwned(user, paymentMethodId);
    await this.stripe.setDefaultPaymentMethod(customerId, paymentMethodId);
    return { success: true };
  }

  async remove(user: SessionUser, paymentMethodId: string) {
    const customerId = await this.assertOwned(user, paymentMethodId);

    // Don't strand an upcoming visit: a scheduled job charges this exact card
    // off-session at completion, so block removal while one is still pending.
    const pendingVisits = await this.prisma.job.count({
      where: {
        status: { in: [...PRE_CHARGE_JOB_STATUSES] },
        booking: { userId: user.id, stripePaymentMethodId: paymentMethodId },
      },
    });
    if (pendingVisits > 0) {
      throw new ConflictException(
        "This card is tied to an upcoming visit and can't be removed. Add another card, then reschedule or cancel that visit first.",
      );
    }

    // Snapshot the wallet before detaching so we know whether this was the
    // default: Stripe clears the customer's default on detach and never
    // promotes a replacement, so we do it ourselves.
    const cardsBefore = await this.stripe.listPaymentMethods(customerId);
    const wasDefault =
      cardsBefore.find((card) => card.id === paymentMethodId)?.isDefault ??
      false;

    await this.stripe.detachPaymentMethod(paymentMethodId);

    if (wasDefault) {
      // Stripe lists cards newest-first; promote the most recent survivor.
      const remaining = cardsBefore.filter(
        (card) => card.id !== paymentMethodId,
      );
      if (remaining.length > 0) {
        await this.stripe.setDefaultPaymentMethod(customerId, remaining[0].id);
      }
    }

    return { success: true };
  }

  // Guard: never let a caller mutate a card that isn't attached to their own
  // customer, even though the route is already session-protected.
  private async assertOwned(
    user: SessionUser,
    paymentMethodId: string,
  ): Promise<string> {
    const customerId = await this.stripe.getOrCreateCustomer(user);
    const owned = await this.stripe.assertPaymentMethodOwnedByCustomer(
      paymentMethodId,
      customerId,
    );
    if (!owned) {
      throw new BadRequestException(
        'This payment method is not associated with your account.',
      );
    }
    return customerId;
  }
}
