import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';

// How long an account lingers, fully usable, after the customer requests
// deletion before it is permanently removed. The window lets them change their
// mind (sign back in and cancel) and gives support time to intervene.
export const DELETION_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  // Notification prefs + deletion status for the Settings screen.
  async getSettings(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        emailReminders: true,
        smsOnTheWayAlerts: true,
        promotionalEmails: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
      },
    });
    return this.toSettings(user);
  }

  // Flip one or more notification toggles. Absent fields are left as-is.
  async updateNotifications(userId: string, dto: UpdateNotificationsDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.emailReminders !== undefined && {
          emailReminders: dto.emailReminders,
        }),
        ...(dto.smsOnTheWayAlerts !== undefined && {
          smsOnTheWayAlerts: dto.smsOnTheWayAlerts,
        }),
        ...(dto.promotionalEmails !== undefined && {
          promotionalEmails: dto.promotionalEmails,
        }),
      },
      select: {
        emailReminders: true,
        smsOnTheWayAlerts: true,
        promotionalEmails: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
      },
    });
    return this.toSettings(user);
  }

  // Schedule a soft delete. The account stays live until the grace period ends;
  // the purge cron does the irreversible removal. Idempotent-ish: re-requesting
  // is rejected so the countdown can't be silently reset by a double-click.
  async scheduleDeletion(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { deletionScheduledAt: true },
    });
    if (user.deletionScheduledAt) {
      throw new BadRequestException(
        'Your account is already scheduled for deletion.',
      );
    }
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: now, deletionScheduledAt: scheduledAt },
      select: { deletionRequestedAt: true, deletionScheduledAt: true },
    });
    return {
      requestedAt: updated.deletionRequestedAt,
      scheduledAt: updated.deletionScheduledAt,
      graceDays: DELETION_GRACE_DAYS,
    };
  }

  // Undo a scheduled deletion — restores the account to a normal state.
  async cancelDeletion(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: null, deletionScheduledAt: null },
      select: { id: true },
    });
    return {
      requestedAt: null,
      scheduledAt: null,
      graceDays: DELETION_GRACE_DAYS,
    };
  }

  private toSettings(user: {
    emailReminders: boolean;
    smsOnTheWayAlerts: boolean;
    promotionalEmails: boolean;
    deletionRequestedAt: Date | null;
    deletionScheduledAt: Date | null;
  }) {
    return {
      notifications: {
        emailReminders: user.emailReminders,
        smsOnTheWayAlerts: user.smsOnTheWayAlerts,
        promotionalEmails: user.promotionalEmails,
      },
      deletion: {
        requestedAt: user.deletionRequestedAt,
        scheduledAt: user.deletionScheduledAt,
        graceDays: DELETION_GRACE_DAYS,
      },
    };
  }

  // Permanently remove accounts whose grace period has elapsed. Runs daily.
  // Admins are never auto-purged (safety). Active Stripe subscriptions are
  // cancelled best-effort first so we don't leave dangling billing; the user
  // row is then deleted, which cascades to sessions, bookings, jobs, etc.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeScheduledDeletions() {
    const due = await this.prisma.user.findMany({
      where: {
        deletionScheduledAt: { lte: new Date() },
        role: { not: 'admin' },
      },
      select: {
        id: true,
        bookings: {
          where: { stripeSubscriptionId: { not: null } },
          select: { stripeSubscriptionId: true },
        },
      },
    });
    if (due.length === 0) return;

    this.logger.log(`Purging ${due.length} account(s) past deletion grace.`);
    for (const user of due) {
      try {
        for (const booking of user.bookings) {
          if (!booking.stripeSubscriptionId) continue;
          await this.stripe
            .cancelSubscription(booking.stripeSubscriptionId)
            .catch((err: unknown) => {
              // A subscription already cancelled on Stripe's side must not
              // block the account removal — log and carry on.
              this.logger.warn(
                `Could not cancel subscription ${booking.stripeSubscriptionId} for user ${user.id}: ${String(err)}`,
              );
            });
        }
        await this.prisma.user.delete({ where: { id: user.id } });
      } catch (err) {
        this.logger.error(`Failed to purge account ${user.id}: ${String(err)}`);
      }
    }
  }
}
