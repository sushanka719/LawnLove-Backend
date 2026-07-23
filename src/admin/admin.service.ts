import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { StorageService } from '../storage/storage.service';
import { AppConfigService } from '../config/config.service';
import {
  bookingReference,
  bookingServiceLabel,
} from '../booking/booking-format';
import { auth, pendingAgentInviteIdentifier } from '../auth/auth';
import { sendAgentPromotedEmail } from '../mail/mail.service';
import type { AssignableRole } from './dto/set-role.dto';
import type { ListUsersDto } from './dto/list-users.dto';
import type { ListJobsDto } from './dto/list-jobs.dto';
import type { ListBookingsAdminDto } from './dto/list-bookings-admin.dto';
import type { BanUserDto } from './dto/ban-user.dto';
import type { InviteAgentDto } from './dto/invite-agent.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

// The pending agent-invite verification row outlives the magic-link token so it
// is still there to consume when the invitee clicks through. It's deleted the
// moment the link is used (user.create.before), so this is just a safety cap.
const AGENT_INVITE_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  // ---- Overview / KPIs -----------------------------------------------------

  async getStats() {
    const [
      totalUsers,
      totalAgents,
      totalCustomers,
      jobsByStatus,
      bookingsByStatus,
      moneyByStatus,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'agent' } }),
      this.prisma.user.count({ where: { role: 'user' } }),
      this.prisma.job.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.booking.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { status: 'asc' },
      }),
      // Charged/paid jobs carry the escrow money fields (cents).
      this.prisma.job.groupBy({
        by: ['status'],
        _sum: { amount: true, platformFee: true },
        orderBy: { status: 'asc' },
      }),
    ]);

    // `_count: true` returns the group count as a number at runtime; this
    // Prisma version types it broadly, so coerce with Number().
    const jobStatusCounts: Record<string, number> = {};
    for (const row of jobsByStatus) {
      jobStatusCounts[row.status] = Number(row._count);
    }
    const bookingStatusCounts: Record<string, number> = {};
    for (const row of bookingsByStatus) {
      bookingStatusCounts[row.status] = Number(row._count);
    }

    // GMV = everything ever charged; platform fees = our cut on the same set.
    let grossVolumeCents = 0;
    let platformFeesCents = 0;
    let pendingPayoutCents = 0;
    for (const row of moneyByStatus) {
      grossVolumeCents += row._sum?.amount ?? 0;
      platformFeesCents += row._sum?.platformFee ?? 0;
      // Funds held on-platform awaiting release (charged but not yet paid out).
      if (row.status === 'in_review' || row.status === 'completed') {
        pendingPayoutCents += row._sum?.amount ?? 0;
      }
    }

    return {
      users: {
        total: totalUsers,
        agents: totalAgents,
        customers: totalCustomers,
      },
      jobs: {
        byStatus: jobStatusCounts,
        active:
          (jobStatusCounts.assigned ?? 0) +
          (jobStatusCounts.started ?? 0) +
          (jobStatusCounts.in_review ?? 0),
        disputed: jobStatusCounts.disputed ?? 0,
      },
      bookings: { byStatus: bookingStatusCounts },
      money: { grossVolumeCents, platformFeesCents, pendingPayoutCents },
    };
  }

  // ---- Users ---------------------------------------------------------------

  async listUsers({ query, role, page, pageSize }: ListUsersDto) {
    const skip = (page - 1) * pageSize;
    const where = {
      ...(role ? { role } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          banned: true,
          deletionScheduledAt: true,
          payoutsEnabled: true,
          createdAt: true,
          _count: { select: { bookings: true, jobs: true } },
          // The user's default saved address (their "home" location). Ordering
          // mirrors AddressesService.list so row 0 is the flagged default, or
          // the most recent address if none is explicitly flagged.
          savedAddresses: {
            orderBy: [
              { isDefault: 'desc' as const },
              { createdAt: 'desc' as const },
            ],
            take: 1,
            select: { address: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const items = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      banned: u.banned,
      deletionScheduledAt: u.deletionScheduledAt,
      payoutsEnabled: u.payoutsEnabled,
      createdAt: u.createdAt,
      bookingsCount: u._count.bookings,
      jobsCount: u._count.jobs,
      location: u.savedAddresses[0]?.address ?? null,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        banReason: true,
        banExpires: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
        stripeConnectAccountId: true,
        payoutsEnabled: true,
        createdAt: true,
        bookings: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            address: true,
            frequency: true,
            status: true,
            scheduleDate: true,
            totalPerVisit: true,
            createdAt: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      ...user,
      bookings: user.bookings.map((b) => ({
        id: b.id,
        reference: bookingReference(b.id),
        title: bookingServiceLabel(b.frequency),
        address: b.address,
        status: b.status,
        scheduleDate: b.scheduleDate,
        totalPerVisit: b.totalPerVisit,
        createdAt: b.createdAt,
      })),
    };
  }

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

  async banUser(userId: string, dto: BanUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.role === 'admin') {
      throw new BadRequestException('Admins cannot be banned.');
    }
    const banExpires = dto.durationDays
      ? new Date(Date.now() + dto.durationDays * DAY_MS)
      : null;
    return this.prisma.user.update({
      where: { id: userId },
      data: { banned: true, banReason: dto.reason ?? null, banExpires },
      select: { id: true, email: true, banned: true, banExpires: true },
    });
  }

  async unbanUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { banned: false, banReason: null, banExpires: null },
      select: { id: true, email: true, banned: true },
    });
  }

  // ---- Agents --------------------------------------------------------------

  async listAgents() {
    const agents = await this.prisma.user.findMany({
      where: { role: 'agent' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        payoutsEnabled: true,
        stripeConnectAccountId: true,
        createdAt: true,
        jobs: { select: { status: true } },
      },
    });

    return agents.map((a) => {
      const activeJobs = a.jobs.filter((j) =>
        ['assigned', 'started', 'in_review'].includes(j.status),
      ).length;
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        payoutsEnabled: a.payoutsEnabled,
        onboarded: Boolean(a.stripeConnectAccountId),
        createdAt: a.createdAt,
        totalJobs: a.jobs.length,
        activeJobs,
      };
    });
  }

  // Invite an agent by email. Two paths:
  //  - the email already has an account → promote it to agent in place (no
  //    magic link — they already have credentials) and email a heads-up;
  //  - brand-new email → stash a pending-invite row and trigger the magic-link
  //    signup flow, which lands them on set-password and (via
  //    user.create.before in auth.ts) creates the user with role:'agent'.
  async inviteAgent({ email, businessName }: InviteAgentDto) {
    // Emails are stored/normalized lowercase by better-auth, and the pending
    // row is keyed by email and later looked up with the created user's stored
    // email — so key everything off the same lowercased value.
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedBusinessName = businessName?.trim() || undefined;

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, role: true },
    });

    if (existing) {
      if (existing.role === 'admin') {
        throw new BadRequestException(
          'This email belongs to an admin and cannot be invited as an agent.',
        );
      }
      // Already an agent — idempotent success, no email, no duplicate.
      if (existing.role === 'agent') {
        return { status: true, outcome: 'already_agent' as const };
      }
      // Existing customer → promote in place.
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { role: 'agent' },
      });
      await sendAgentPromotedEmail(
        normalizedEmail,
        `${this.config.appUrl}/login`,
      );
      return { status: true, outcome: 'promoted' as const };
    }

    // New agent: (re)write the pending-invite row, then fire the magic link.
    // deleteMany first so repeat invites for the same email don't accumulate
    // orphaned rows.
    const identifier = pendingAgentInviteIdentifier(normalizedEmail);
    await this.prisma.verification.deleteMany({ where: { identifier } });
    await this.prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier,
        value: JSON.stringify({ businessName: trimmedBusinessName }),
        expiresAt: new Date(Date.now() + AGENT_INVITE_TTL_MS),
      },
    });

    const callbackURL = `${this.config.appUrl}/set-password?email=${encodeURIComponent(
      normalizedEmail,
    )}`;
    // Server-initiated call (no inbound request), so pass empty headers — the
    // endpoint's type requires the property, and there's no browser origin/CSRF
    // context to forward here.
    await auth.api.signInMagicLink({
      body: { email: normalizedEmail, callbackURL },
      headers: {},
    });

    return { status: true, outcome: 'invited' as const };
  }

  // ---- Bookings ------------------------------------------------------------

  async listBookings({ status, page, pageSize }: ListBookingsAdminDto) {
    const skip = (page - 1) * pageSize;
    const where = status ? { status } : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          address: true,
          frequency: true,
          scheduleDate: true,
          timeSlot: true,
          totalPerVisit: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          _count: { select: { jobs: true } },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const items = rows.map((b) => ({
      id: b.id,
      reference: bookingReference(b.id),
      title: bookingServiceLabel(b.frequency),
      address: b.address,
      frequency: b.frequency,
      scheduleDate: b.scheduleDate,
      timeSlot: b.timeSlot,
      totalPerVisit: b.totalPerVisit,
      status: b.status,
      createdAt: b.createdAt,
      customer: b.user,
      visitsCount: b._count.jobs,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        jobs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            agentId: true,
            completedAt: true,
            amount: true,
          },
        },
      },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    return {
      ...booking,
      reference: bookingReference(booking.id),
      title: bookingServiceLabel(booking.frequency),
    };
  }

  async cancelBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    if (booking.status === 'cancelled') {
      throw new BadRequestException('Booking is already cancelled.');
    }
    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'cancelled' },
      select: { id: true, status: true },
    });
    // Drop still-scheduled visits so the scheduler stops maintaining them and
    // they vanish from dashboards. Only not-yet-started ('assigned') visits are
    // removed — started/completed/charged visits keep their record.
    await this.prisma.job.deleteMany({
      where: { bookingId, status: 'assigned' },
    });
    return updated;
  }

  // ---- Jobs (dispatch) -----------------------------------------------------

  async listJobs({ status, agentId, page, pageSize }: ListJobsDto) {
    const skip = (page - 1) * pageSize;
    const where = {
      ...(status ? { status } : {}),
      ...(agentId ? { agentId } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          scheduledDate: true,
          visitNumber: true,
          createdAt: true,
          completedAt: true,
          amount: true,
          agent: { select: { id: true, name: true, email: true } },
          employee: { select: { id: true, name: true } },
          booking: {
            select: {
              address: true,
              scheduleDate: true,
              timeSlot: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    const items = rows.map((j) => ({
      id: j.id,
      status: j.status,
      scheduledDate: j.scheduledDate,
      visitNumber: j.visitNumber,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
      amount: j.amount,
      agent: j.agent,
      employee: j.employee,
      address: j.booking.address,
      scheduleDate: j.booking.scheduleDate,
      timeSlot: j.booking.timeSlot,
      customer: j.booking.user,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getJob(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        employee: { select: { id: true, name: true } },
        booking: {
          select: {
            id: true,
            address: true,
            scheduleDate: true,
            timeSlot: true,
            estimatedAreaSqFt: true,
            totalPerVisit: true,
            frequency: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        photos: true,
        review: { select: { rating: true, comment: true, createdAt: true } },
      },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }

    // Presign each photo for viewing from the private bucket.
    const photos = await Promise.all(
      job.photos
        .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
        .map(async (photo) => ({
          id: photo.id,
          type: photo.type,
          lat: photo.lat,
          lng: photo.lng,
          takenAt: photo.takenAt,
          url: await this.storage.presignDownload(photo.storageKey),
        })),
    );

    return {
      id: job.id,
      status: job.status,
      scheduledDate: job.scheduledDate,
      visitNumber: job.visitNumber,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      reviewDeadline: job.reviewDeadline,
      startLat: job.startLat,
      startLng: job.startLng,
      amount: job.amount,
      platformFee: job.platformFee,
      chargedAt: job.chargedAt,
      releasedAt: job.releasedAt,
      stripePaymentIntentId: job.stripePaymentIntentId,
      stripeTransferId: job.stripeTransferId,
      reference: bookingReference(job.bookingId),
      agent: job.agent,
      employee: job.employee,
      booking: {
        id: job.booking.id,
        title: bookingServiceLabel(job.booking.frequency),
        address: job.booking.address,
        scheduleDate: job.booking.scheduleDate,
        timeSlot: job.booking.timeSlot,
        estimatedAreaSqFt: job.booking.estimatedAreaSqFt,
        totalPerVisit: job.booking.totalPerVisit,
        customer: job.booking.user,
      },
      photos: {
        before: photos.filter((p) => p.type === 'before'),
        after: photos.filter((p) => p.type === 'after'),
      },
      review: job.review,
    };
  }

  async assignJob(jobId: string, agentId: string) {
    const [job, agent] = await Promise.all([
      this.prisma.job.findUnique({ where: { id: jobId } }),
      this.prisma.user.findUnique({ where: { id: agentId } }),
    ]);
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (!agent) {
      throw new NotFoundException('Agent not found.');
    }
    if (agent.role !== 'agent') {
      throw new BadRequestException('Target user is not an agent.');
    }
    // Only reassign a job that hasn't been completed/charged yet — after that
    // the money flow is in progress and reassignment would be unsafe.
    if (!['assigned', 'started'].includes(job.status)) {
      throw new BadRequestException(
        `Cannot assign a job with status "${job.status}".`,
      );
    }
    return this.prisma.job.update({
      where: { id: jobId },
      data: { agentId, status: 'assigned' },
      select: { id: true, status: true, agentId: true },
    });
  }

  // ---- Disputes ------------------------------------------------------------

  // Jobs currently disputed by the customer, awaiting an admin decision.
  async listDisputes() {
    const jobs = await this.prisma.job.findMany({
      where: { status: 'disputed' },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        completedAt: true,
        amount: true,
        stripePaymentIntentId: true,
        agent: { select: { id: true, name: true, email: true } },
        booking: {
          select: {
            address: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        review: { select: { rating: true, comment: true } },
      },
    });
    return jobs.map((j) => ({
      id: j.id,
      completedAt: j.completedAt,
      amount: j.amount,
      canRefund: Boolean(j.stripePaymentIntentId),
      agent: j.agent,
      address: j.booking.address,
      customer: j.booking.user,
      review: j.review,
    }));
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
