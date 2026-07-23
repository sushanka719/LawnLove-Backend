import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  addInterval,
  addUtcDays,
  startOfUtcDay,
  type RecurringInterval,
} from './scheduling.util';

// How far ahead the rolling window keeps visits populated.
const WINDOW_DAYS = 14;

// When the target day is full, how many days forward we'll probe for capacity
// before giving up and leaving the visit Unassigned (retried next cron pass).
const MAX_BUMP_DAYS = 60;

// Per-booking safety cap on visits generated in a single run — guards against a
// runaway loop if a booking's dates are ever misconfigured. Far above the
// handful a 14-day window ever needs.
const MAX_VISITS_PER_RUN = 12;

// Result of an assignment attempt (returned mainly for tests / callers that
// want to react; the webhook path ignores it).
export type AssignResult = {
  jobId: string;
  employeeId: string | null;
  scheduledDate: Date | null;
};

// The scheduler assigns service visits to an agent's employees and keeps
// recurring bookings supplied with future visits.
//
//  - Assignment is event-driven (called from the Stripe webhook on activation)
//    and by the cron; there is one shared picker, `assignVisit`.
//  - Recurring visit generation is timer-driven — see the cron in
//    scheduler.cron.ts calling `generateDueVisits`.
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Pick the least-loaded active employee for a job's date (ties broken by
  // least-recently-assigned, i.e. round-robin). If the customer's day is full,
  // bump the visit to the next day with capacity. If no employee can take it
  // (none active, or all at cap through the horizon), the visit keeps its date
  // and is left Unassigned — never blocking on staffing.
  async assignVisit(jobId: string): Promise<AssignResult | null> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        agentId: true,
        status: true,
        scheduledDate: true,
        employeeId: true,
        booking: { select: { scheduleDate: true } },
      },
    });
    if (!job) return null;
    // Only visits still awaiting service are (re)assignable — once started or
    // charged, the crew is locked in.
    if (job.status !== 'assigned') {
      return {
        jobId,
        employeeId: job.employeeId,
        scheduledDate: job.scheduledDate,
      };
    }

    // Resolve the owning agent (single-agent MVP): use the Job's agentId if set,
    // else fall back to the one configured agent, and persist it below.
    const agentId = job.agentId ?? (await this.resolveAgentId());
    if (!agentId) {
      this.logger.warn(`No agent configured — job ${jobId} left unassigned.`);
      return { jobId, employeeId: null, scheduledDate: job.scheduledDate };
    }

    const targetDate = startOfUtcDay(
      job.scheduledDate ?? job.booking.scheduleDate,
    );

    const crew = await this.prisma.employee.findMany({
      where: { agentId, active: true },
      select: { id: true, dailyCap: true },
    });

    const pick =
      crew.length > 0 ? await this.pickEmployee(jobId, crew, targetDate) : null;

    // Persist the outcome. Always set agentId + a concrete date so the visit is
    // visible even when it lands Unassigned.
    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        agentId,
        scheduledDate: pick?.date ?? targetDate,
        employeeId: pick?.employeeId ?? null,
      },
      select: { id: true, employeeId: true, scheduledDate: true },
    });

    if (!pick) {
      this.logger.log(
        `Job ${jobId} left Unassigned (no capacity) for ${targetDate.toISOString().slice(0, 10)}.`,
      );
    }

    return {
      jobId: updated.id,
      employeeId: updated.employeeId,
      scheduledDate: updated.scheduledDate,
    };
  }

  // Rolling-window generator (called daily by the cron). For every active
  // recurring booking, top up assigned visits so the next WINDOW_DAYS are
  // covered, then self-heal any still-Unassigned future visits.
  async generateDueVisits(): Promise<{
    created: number;
    assigned: number;
    reassigned: number;
  }> {
    const horizon = addUtcDays(startOfUtcDay(new Date()), WINDOW_DAYS);
    const agentId = await this.resolveAgentId();

    const bookings = await this.prisma.booking.findMany({
      where: { status: 'active', frequency: { not: 'oneTime' } },
      select: { id: true, frequency: true, scheduleDate: true },
    });

    let created = 0;
    let assigned = 0;

    for (const booking of bookings) {
      // frequency is guaranteed non-oneTime by the query filter above.
      const interval = booking.frequency as RecurringInterval;

      // Continue from the latest existing visit (§5.2). In steady daily
      // operation the last visit sits near the window's leading edge, so this
      // adds 0–1 visits per run.
      const last = await this.prisma.job.findFirst({
        where: { bookingId: booking.id },
        orderBy: { visitNumber: 'desc' },
        select: { visitNumber: true, scheduledDate: true },
      });

      let visitNumber = last?.visitNumber ?? 0;
      let lastDate = last?.scheduledDate ?? booking.scheduleDate;
      let madeThisBooking = 0;

      while (madeThisBooking < MAX_VISITS_PER_RUN) {
        const nextDate = addInterval(lastDate, interval);
        if (nextDate.getTime() > horizon.getTime()) break;

        const job = await this.createVisit(
          booking.id,
          visitNumber + 1,
          agentId,
          nextDate,
        );
        // Advance regardless of whether we created (a concurrent run may have
        // already made this visit number — the unique constraint deduped it).
        visitNumber += 1;
        lastDate = nextDate;
        madeThisBooking += 1;

        if (job) {
          created += 1;
          const result = await this.assignVisit(job.id);
          if (result?.employeeId) assigned += 1;
        }
      }
    }

    const reassigned = await this.reassignUnassignedFuture();

    if (created > 0 || reassigned > 0) {
      this.logger.log(
        `Rolling window: created ${created} visit(s), assigned ${assigned}, re-assigned ${reassigned}.`,
      );
    }
    return { created, assigned, reassigned };
  }

  // Create one visit idempotently. The @@unique([bookingId, visitNumber])
  // constraint makes a duplicate a no-op (returns null), so re-runs and
  // concurrent passes are safe.
  private async createVisit(
    bookingId: string,
    visitNumber: number,
    agentId: string | null,
    scheduledDate: Date,
  ) {
    try {
      return await this.prisma.job.create({
        data: {
          bookingId,
          visitNumber,
          agentId,
          scheduledDate,
          status: 'assigned',
        },
        select: { id: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return null; // visit already exists — idempotent skip
      }
      throw err;
    }
  }

  // Re-run assignment for every future visit still Unassigned — self-heals once
  // an employee is added or reactivated. Isolated per-job so one failure
  // doesn't stall the batch.
  private async reassignUnassignedFuture(): Promise<number> {
    const today = startOfUtcDay(new Date());
    const pending = await this.prisma.job.findMany({
      where: {
        employeeId: null,
        status: 'assigned',
        scheduledDate: { gte: today },
      },
      select: { id: true },
    });

    let reassigned = 0;
    for (const job of pending) {
      try {
        const result = await this.assignVisit(job.id);
        if (result?.employeeId) reassigned += 1;
      } catch (err) {
        this.logger.error(`Failed to re-assign job ${job.id}`, err as Error);
      }
    }
    return reassigned;
  }

  // Least-loaded pick for `startDate`, bumping forward day-by-day until a day
  // has capacity (or MAX_BUMP_DAYS is exhausted → null). Ties on load are broken
  // by least-recently-assigned so work rotates evenly across the crew.
  private async pickEmployee(
    jobId: string,
    crew: { id: string; dailyCap: number }[],
    startDate: Date,
  ): Promise<{ employeeId: string; date: Date } | null> {
    const crewIds = crew.map((c) => c.id);

    for (let offset = 0; offset < MAX_BUMP_DAYS; offset++) {
      const day = addUtcDays(startDate, offset);
      const nextDay = addUtcDays(day, 1);

      // Count each employee's existing visits that day (excluding this job, so a
      // re-assignment never counts itself).
      const grouped = await this.prisma.job.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: crewIds },
          scheduledDate: { gte: day, lt: nextDay },
          id: { not: jobId },
        },
        _count: { _all: true },
      });
      const loadById = new Map<string, number>();
      for (const row of grouped) {
        if (row.employeeId) loadById.set(row.employeeId, row._count._all);
      }

      const candidates = crew
        .map((c) => ({
          id: c.id,
          load: loadById.get(c.id) ?? 0,
          cap: c.dailyCap,
        }))
        .filter((c) => c.load < c.cap);

      if (candidates.length === 0) continue; // day full → bump

      const minLoad = Math.min(...candidates.map((c) => c.load));
      const tied = candidates.filter((c) => c.load === minLoad);

      const employeeId =
        tied.length === 1
          ? tied[0].id
          : await this.breakTieByRoundRobin(tied.map((c) => c.id));

      return { employeeId, date: day };
    }

    return null;
  }

  // Among equally-loaded employees, prefer the one assigned longest ago (a
  // never-assigned employee wins outright). Deterministic id tiebreak last.
  private async breakTieByRoundRobin(employeeIds: string[]): Promise<string> {
    const recents = await this.prisma.job.groupBy({
      by: ['employeeId'],
      where: { employeeId: { in: employeeIds } },
      _max: { createdAt: true },
    });
    const lastAssignedById = new Map<string, number>();
    for (const row of recents) {
      if (row.employeeId) {
        lastAssignedById.set(
          row.employeeId,
          row._max.createdAt?.getTime() ?? 0,
        );
      }
    }

    return [...employeeIds].sort((a, b) => {
      const la = lastAssignedById.get(a) ?? 0;
      const lb = lastAssignedById.get(b) ?? 0;
      if (la !== lb) return la - lb; // oldest (or never) first
      return a < b ? -1 : 1;
    })[0];
  }

  // The single MVP agent (oldest role=agent). Every schedulable Job belongs to
  // this agent; kept as a lookup so multi-agent works later without a rewrite.
  private async resolveAgentId(): Promise<string | null> {
    const agent = await this.prisma.user.findFirst({
      where: { role: 'agent' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return agent?.id ?? null;
  }
}
