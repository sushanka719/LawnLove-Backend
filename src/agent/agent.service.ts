import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  bookingReference,
  bookingServiceLabel,
} from '../booking/booking-format';
import { addUtcDays, startOfUtcDay } from '../scheduler/scheduling.util';

// Read-only dashboard aggregations for the signed-in agent. Every query is
// scoped to `agentId` (the caller's own id), so an agent only ever sees the
// visits/bookings/earnings tied to jobs assigned to them.
@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDay(value: string): Date {
    const d = startOfUtcDay(new Date(`${value}T00:00:00.000Z`));
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date: ${value}`);
    }
    return d;
  }

  // This agent's visits in a date range (default today..+30d), oldest first.
  // Backs the dashboard "schedule" grouped-day list and the /agent/jobs board.
  async getSchedule(agentId: string, fromStr?: string, toStr?: string) {
    const today = startOfUtcDay(new Date());
    const from = fromStr ? this.parseDay(fromStr) : today;
    const to = toStr ? this.parseDay(toStr) : addUtcDays(today, 30);

    const jobs = await this.prisma.job.findMany({
      where: {
        agentId,
        // Inclusive of the whole `to` day (scheduledDate is date-level midnight).
        scheduledDate: { gte: from, lt: addUtcDays(to, 1) },
      },
      orderBy: [{ scheduledDate: 'asc' }, { visitNumber: 'asc' }],
      select: {
        id: true,
        visitNumber: true,
        scheduledDate: true,
        status: true,
        employee: { select: { id: true, name: true } },
        booking: {
          select: {
            address: true,
            timeSlot: true,
            estimatedAreaSqFt: true,
            totalPerVisit: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    return jobs.map((j) => ({
      id: j.id,
      visitNumber: j.visitNumber,
      scheduledDate: j.scheduledDate,
      status: j.status,
      employee: j.employee,
      booking: {
        address: j.booking.address,
        timeSlot: j.booking.timeSlot,
        estimatedAreaSqFt: j.booking.estimatedAreaSqFt,
        totalPerVisit: j.booking.totalPerVisit,
        customerName: j.booking.user?.name ?? null,
      },
    }));
  }

  // Headline counts for the dashboard stat cards.
  async getStats(agentId: string) {
    const today = startOfUtcDay(new Date());
    const tomorrow = addUtcDays(today, 1);
    const weekAgo = addUtcDays(today, -7);

    const [todayVisits, unassigned, weekCompleted, activeCrew] =
      await this.prisma.$transaction([
        this.prisma.job.count({
          where: { agentId, scheduledDate: { gte: today, lt: tomorrow } },
        }),
        this.prisma.job.count({
          where: {
            agentId,
            status: 'assigned',
            employeeId: null,
            scheduledDate: { gte: today },
          },
        }),
        this.prisma.job.count({
          where: {
            agentId,
            status: 'completed',
            completedAt: { gte: weekAgo },
          },
        }),
        this.prisma.employee.count({ where: { agentId, active: true } }),
      ]);

    return { todayVisits, unassigned, weekCompleted, activeCrew };
  }

  // Distinct bookings this agent services (derived from their Jobs), newest
  // first, with the next upcoming visit date for each.
  async getBookings(agentId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const where = { jobs: { some: { agentId } } };

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
          timeSlot: true,
          totalPerVisit: true,
          status: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          // Only this agent's visits for the booking (for count + next visit).
          jobs: {
            where: { agentId },
            orderBy: { scheduledDate: 'asc' },
            select: { scheduledDate: true, status: true },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const now = startOfUtcDay(new Date());
    const items = rows.map((b) => {
      const upcoming = b.jobs.find(
        (j) =>
          j.scheduledDate != null &&
          j.scheduledDate >= now &&
          (j.status === 'assigned' || j.status === 'started'),
      );
      return {
        id: b.id,
        reference: bookingReference(b.id),
        title: bookingServiceLabel(b.frequency),
        address: b.address,
        frequency: b.frequency,
        timeSlot: b.timeSlot,
        totalPerVisit: b.totalPerVisit,
        status: b.status,
        customer: b.user,
        visitsCount: b.jobs.length,
        nextVisit: upcoming?.scheduledDate ?? null,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // Per-visit payout ledger for the agent: owed vs. paid totals plus a paginated
  // list of recorded payouts (deferred-payout model — see PayoutService.disburse).
  async getEarnings(agentId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const where = { agentId, agentPayoutAmount: { not: null } };

    const [owedAgg, paidAgg, rows, total] = await this.prisma.$transaction([
      this.prisma.job.aggregate({
        _sum: { agentPayoutAmount: true },
        where: { agentId, agentPayoutAmount: { not: null }, agentPaidAt: null },
      }),
      this.prisma.job.aggregate({
        _sum: { agentPayoutAmount: true },
        where: { agentId, agentPaidAt: { not: null } },
      }),
      this.prisma.job.findMany({
        where,
        orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          visitNumber: true,
          scheduledDate: true,
          completedAt: true,
          agentPayoutAmount: true,
          agentPaidAt: true,
          agentPayoutRef: true,
          booking: { select: { address: true, frequency: true } },
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    const items = rows.map((j) => ({
      id: j.id,
      reference: `PO-${j.id.slice(-6).toUpperCase()}`,
      visitNumber: j.visitNumber,
      serviceLabel: bookingServiceLabel(j.booking.frequency),
      address: j.booking.address,
      servicedOn: j.completedAt ?? j.scheduledDate,
      amount: j.agentPayoutAmount ?? 0,
      paid: j.agentPaidAt != null,
      paidAt: j.agentPaidAt,
      payoutRef: j.agentPayoutRef,
    }));

    return {
      totals: {
        owedCents: owedAgg._sum.agentPayoutAmount ?? 0,
        paidCents: paidAgg._sum.agentPayoutAmount ?? 0,
      },
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
