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
import { PayoutService } from '../payout/payout.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SettingsService } from '../settings/settings.service';
import {
  bookingReference,
  bookingServiceLabel,
} from '../booking/booking-format';
import { addUtcDays, startOfUtcDay } from '../scheduler/scheduling.util';
import { auth, pendingAgentInviteIdentifier } from '../auth/auth';
import { sendAgentPromotedEmail } from '../mail/mail.service';
import type { AssignableRole } from './dto/set-role.dto';
import type { ListUsersDto } from './dto/list-users.dto';
import type { ListJobsDto } from './dto/list-jobs.dto';
import type { ListBookingsAdminDto } from './dto/list-bookings-admin.dto';
import type { ReassignJobDto } from './dto/reassign-job.dto';
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
    private readonly payout: PayoutService,
    private readonly scheduler: SchedulerService,
    private readonly settings: SettingsService,
  ) {}

  // ---- Overview / KPIs -----------------------------------------------------

  async getStats() {
    const [
      totalUsers,
      totalAgents,
      totalCustomers,
      jobsByStatus,
      bookingsByStatus,
      grossAgg,
      owedAgg,
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
      // Prepaid model: GMV is sourced from Booking.amountCharged (set by the
      // Stripe webhook), NOT the escrow Job fields, which prepaid never fills.
      this.prisma.booking.aggregate({
        _sum: { amountCharged: true },
        where: { status: { in: ['active', 'pastDue', 'completed'] } },
      }),
      // What we still owe agents: recorded per-visit payouts not yet marked paid.
      this.prisma.job.aggregate({
        _sum: { agentPayoutAmount: true },
        where: { agentPayoutAmount: { not: null }, agentPaidAt: null },
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

    // GMV = charged across paid bookings; platform fees = our configured cut of
    // it (there is no Booking.platformFee column); pending payout = owed to
    // agents but not yet disbursed. The fee % is the admin-editable AppSettings
    // value (seeded from PLATFORM_FEE_PCT).
    const feePct = await this.settings.getEffectiveFeePct();
    const grossVolumeCents = grossAgg._sum.amountCharged ?? 0;
    const platformFeesCents = Math.round(grossVolumeCents * feePct);
    const pendingPayoutCents = owedAgg._sum.agentPayoutAmount ?? 0;

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
          amountCharged: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          plan: { select: { name: true } },
          // The servicing agent = the agent on the earliest visit.
          jobs: {
            take: 1,
            orderBy: { visitNumber: 'asc' },
            select: { agent: { select: { id: true, name: true, email: true } } },
          },
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
      amountCharged: b.amountCharged,
      status: b.status,
      createdAt: b.createdAt,
      customer: b.user,
      planName: b.plan?.name ?? null,
      agent: b.jobs[0]?.agent ?? null,
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

    // The agent's active crew — options for the admin reassign (field-worker)
    // dropdown on the job-detail screen.
    const agentEmployees = job.agentId
      ? await this.prisma.employee.findMany({
          where: { agentId: job.agentId, active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : [];

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
      agentPayoutAmount: job.agentPayoutAmount,
      agentPaidAt: job.agentPaidAt,
      agentPayoutRef: job.agentPayoutRef,
      stripePaymentIntentId: job.stripePaymentIntentId,
      stripeTransferId: job.stripeTransferId,
      reference: bookingReference(job.bookingId),
      agent: job.agent,
      employee: job.employee,
      agentEmployees,
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

  // ---- Payouts (deferred manual model) -------------------------------------

  // Every visit that recorded a per-visit payout, owed-first. Includes the
  // agent, address, and paid/unpaid state, plus owed/paid totals and a per-agent
  // owed breakdown for the admin Payout screen.
  async listPayouts() {
    const jobs = await this.prisma.job.findMany({
      where: { agentPayoutAmount: { not: null } },
      orderBy: [
        { agentPaidAt: { sort: 'asc', nulls: 'first' } },
        { completedAt: 'desc' },
      ],
      select: {
        id: true,
        visitNumber: true,
        scheduledDate: true,
        completedAt: true,
        agentPayoutAmount: true,
        agentPaidAt: true,
        agentPayoutRef: true,
        agent: { select: { id: true, name: true, email: true } },
        booking: { select: { address: true, frequency: true } },
      },
    });

    const items = jobs.map((j) => ({
      jobId: j.id,
      reference: `PO-${j.id.slice(-6).toUpperCase()}`,
      visitNumber: j.visitNumber,
      serviceLabel: bookingServiceLabel(j.booking.frequency),
      address: j.booking.address,
      servicedOn: j.completedAt ?? j.scheduledDate,
      amount: j.agentPayoutAmount ?? 0,
      paid: j.agentPaidAt != null,
      paidAt: j.agentPaidAt,
      payoutRef: j.agentPayoutRef,
      agent: j.agent,
    }));

    let owedCents = 0;
    let paidCents = 0;
    const byAgent = new Map<
      string,
      {
        agentId: string | null;
        name: string | null;
        email: string | null;
        owedCents: number;
        owedCount: number;
      }
    >();
    for (const it of items) {
      if (it.paid) {
        paidCents += it.amount;
        continue;
      }
      owedCents += it.amount;
      const key = it.agent?.id ?? 'unassigned';
      const row = byAgent.get(key) ?? {
        agentId: it.agent?.id ?? null,
        name: it.agent?.name ?? null,
        email: it.agent?.email ?? null,
        owedCents: 0,
        owedCount: 0,
      };
      row.owedCents += it.amount;
      row.owedCount += 1;
      byAgent.set(key, row);
    }

    return {
      items,
      totals: { owedCents, paidCents },
      byAgent: Array.from(byAgent.values()),
    };
  }

  // Mark a visit's payout as paid (manual/out-of-band — no real Stripe transfer
  // yet). See PayoutService.disburse.
  payoutJob(jobId: string, ref?: string) {
    return this.payout.disburse(jobId, ref);
  }

  // ---- Reassign (field-worker override) ------------------------------------

  // Set/clear a job's employee directly, or `auto` to re-run the scheduler's
  // least-loaded picker. Distinct from assignJob, which sets the agent.
  async reassignJob(jobId: string, dto: ReassignJobDto) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, agentId: true, status: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (!['assigned', 'started'].includes(job.status)) {
      throw new BadRequestException(
        `Cannot reassign a job with status "${job.status}".`,
      );
    }

    if (dto.auto) {
      const result = await this.scheduler.assignVisit(jobId);
      const refreshed = await this.jobAssignment(jobId);
      return { ...refreshed, autoResult: result };
    }

    if (dto.employeeId) {
      if (!job.agentId) {
        throw new BadRequestException(
          'Assign an agent before choosing an employee.',
        );
      }
      const emp = await this.prisma.employee.findFirst({
        where: { id: dto.employeeId, agentId: job.agentId },
        select: { id: true },
      });
      if (!emp) {
        throw new BadRequestException("Employee not found for this job's agent.");
      }
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: { employeeId: dto.employeeId ?? null },
    });
    return this.jobAssignment(jobId);
  }

  private jobAssignment(jobId: string) {
    return this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        agentId: true,
        employeeId: true,
        scheduledDate: true,
        employee: { select: { id: true, name: true } },
      },
    });
  }

  // ---- Revenue time series -------------------------------------------------

  // Gross volume bucketed by day (7d/30d) or month (12m) for the dashboard
  // chart, sourced from charged bookings' amountCharged. Oldest bucket first.
  async getRevenue(range?: string) {
    const today = startOfUtcDay(new Date());
    const isMonthly = range === '12m';
    const points: { date: string; revenueCents: number }[] = [];
    let start: Date;

    if (isMonthly) {
      const startMonth = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1),
      );
      start = startMonth;
      for (let i = 0; i < 12; i++) {
        const d = new Date(
          Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1),
        );
        points.push({
          date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
          revenueCents: 0,
        });
      }
    } else {
      const days = range === '7d' ? 7 : 30;
      start = addUtcDays(today, -(days - 1));
      for (let i = 0; i < days; i++) {
        points.push({
          date: addUtcDays(start, i).toISOString().slice(0, 10),
          revenueCents: 0,
        });
      }
    }

    const rows = await this.prisma.booking.findMany({
      where: { amountCharged: { not: null }, createdAt: { gte: start } },
      select: { createdAt: true, amountCharged: true },
    });

    const index = new Map(points.map((p, i) => [p.date, i]));
    for (const r of rows) {
      const key = isMonthly
        ? `${r.createdAt.getUTCFullYear()}-${String(r.createdAt.getUTCMonth() + 1).padStart(2, '0')}`
        : r.createdAt.toISOString().slice(0, 10);
      const i = index.get(key);
      if (i != null) points[i].revenueCents += r.amountCharged ?? 0;
    }

    return {
      range: isMonthly ? '12m' : range === '7d' ? '7d' : '30d',
      granularity: isMonthly ? 'month' : 'day',
      points,
    };
  }
}
