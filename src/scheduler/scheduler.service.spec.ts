/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
// The in-memory Prisma fake below is intentionally dynamically-typed (Record<
// string, any>) so it can stand in for many query shapes; the strict
// type-checked lint rules that assume real Prisma types don't apply to it.
import { Prisma } from '../../generated/prisma/client';
import { SchedulerService } from './scheduler.service';
import { addUtcDays, startOfUtcDay } from './scheduling.util';

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the subset of PrismaService the scheduler uses.
// It models `job`, `employee`, `user`, `booking` with just enough query
// semantics (equality, { in }, { not }, { gte/lt }, groupBy on employeeId, and
// the @@unique([bookingId, visitNumber]) constraint) to exercise the real
// assignment/generation logic without a database.
// ---------------------------------------------------------------------------

type Rec = Record<string, any>;

function matches(record: Rec, where: Rec = {}): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const val = record[key];
    if (cond === null) {
      if (val !== null && val !== undefined) return false;
    } else if (cond instanceof Date) {
      if (!(val instanceof Date) || val.getTime() !== cond.getTime()) {
        return false;
      }
    } else if (typeof cond === 'object') {
      if ('in' in cond && !cond.in.includes(val)) return false;
      if ('notIn' in cond && cond.notIn.includes(val)) return false;
      if ('not' in cond && val === cond.not) return false;
      if (
        'gte' in cond &&
        !(val instanceof Date && val.getTime() >= cond.gte.getTime())
      ) {
        return false;
      }
      if (
        'lt' in cond &&
        !(val instanceof Date && val.getTime() < cond.lt.getTime())
      ) {
        return false;
      }
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function sortByKey(rows: Rec[], orderBy?: Rec): Rec[] {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0];
  return [...rows].sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });
}

class FakePrisma {
  jobs: Rec[] = [];
  employees: Rec[] = [];
  users: Rec[] = [];
  bookings: Rec[] = [];
  private seq = 0;
  private clock = 0; // monotonically-increasing stand-in for createdAt ordering

  private resolveBooking(job: Rec, select?: Rec): Rec {
    const clone = { ...job };
    if (select?.booking) {
      clone.booking = this.bookings.find((b) => b.id === job.bookingId) ?? null;
    }
    return clone;
  }

  job = {
    findUnique: async ({ where, select }: Rec) => {
      const j = this.jobs.find((x) => x.id === where.id);
      return j ? this.resolveBooking(j, select) : null;
    },
    findFirst: async ({ where, orderBy, select }: Rec) => {
      const rows = sortByKey(
        this.jobs.filter((j) => matches(j, where)),
        orderBy,
      );
      return rows[0] ? this.resolveBooking(rows[0], select) : null;
    },
    findMany: async ({ where, orderBy, select }: Rec) => {
      const rows = sortByKey(
        this.jobs.filter((j) => matches(j, where)),
        orderBy,
      );
      return rows.map((r) => this.resolveBooking(r, select));
    },
    groupBy: async ({ where, _count, _max }: Rec) => {
      const rows = this.jobs.filter((j) => matches(j, where));
      const groups = new Map<any, Rec[]>();
      for (const r of rows) {
        const key = r.employeeId ?? null;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      const out: Rec[] = [];
      for (const [employeeId, items] of groups) {
        const g: Rec = { employeeId };
        if (_count?._all) g._count = { _all: items.length };
        if (_max?.createdAt) {
          g._max = {
            createdAt: items.reduce<Date | null>(
              (m, x) => (!m || x.createdAt > m ? x.createdAt : m),
              null,
            ),
          };
        }
        out.push(g);
      }
      return out;
    },
    create: async ({ data, select }: Rec) => {
      if (
        this.jobs.some(
          (j) =>
            j.bookingId === data.bookingId &&
            j.visitNumber === data.visitNumber,
        )
      ) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      const rec: Rec = {
        id: `job_${++this.seq}`,
        employeeId: null,
        agentId: null,
        status: 'assigned',
        scheduledDate: null,
        createdAt: new Date(2026, 0, 1, 0, 0, 0, this.clock++),
        ...data,
      };
      this.jobs.push(rec);
      return this.resolveBooking(rec, select);
    },
    update: async ({ where, data, select }: Rec) => {
      const j = this.jobs.find((x) => x.id === where.id)!;
      Object.assign(j, data);
      return this.resolveBooking(j, select);
    },
  };

  employee = {
    findMany: async ({ where }: Rec) =>
      this.employees.filter((e) => matches(e, where)).map((e) => ({ ...e })),
  };

  user = {
    findFirst: async ({ where, orderBy }: Rec) => {
      const rows = sortByKey(
        this.users.filter((u) => matches(u, where)),
        orderBy,
      );
      return rows[0] ? { ...rows[0] } : null;
    },
  };

  booking = {
    findMany: async ({ where }: Rec) =>
      this.bookings.filter((b) => matches(b, where)).map((b) => ({ ...b })),
  };

  // ---- test builders -------------------------------------------------------
  addAgent(id: string): void {
    this.users.push({ id, role: 'agent', createdAt: new Date(2026, 0, 1) });
  }
  addEmployee(id: string, agentId: string, dailyCap = 5, active = true): void {
    this.employees.push({ id, agentId, dailyCap, active });
  }
  addBooking(
    id: string,
    scheduleDate: Date,
    frequency = 'weekly',
    status = 'active',
  ): void {
    this.bookings.push({ id, scheduleDate, frequency, status });
  }
  addJob(job: Rec): Rec {
    const rec: Rec = {
      id: job.id ?? `job_${++this.seq}`,
      employeeId: null,
      agentId: null,
      status: 'assigned',
      scheduledDate: null,
      visitNumber: 1,
      createdAt: new Date(2026, 0, 1, 0, 0, 0, this.clock++),
      ...job,
    };
    this.jobs.push(rec);
    return rec;
  }
  jobById(id: string): Rec {
    return this.jobs.find((j) => j.id === id)!;
  }
}

const AGENT = 'agent_1';
const day = (iso: string) => startOfUtcDay(new Date(iso));

function makeService(): { db: FakePrisma; svc: SchedulerService } {
  const db = new FakePrisma();
  const svc = new SchedulerService(db as any);
  return { db, svc };
}

describe('SchedulerService.assignVisit', () => {
  it('assigns the only active employee and stamps the agent', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT);
    const d = day('2026-08-01');
    db.addBooking('bk_1', d);
    const job = db.addJob({ bookingId: 'bk_1', scheduledDate: d });

    const result = await svc.assignVisit(job.id);

    expect(result?.employeeId).toBe('emp_1');
    expect(db.jobById(job.id).agentId).toBe(AGENT);
    expect(db.jobById(job.id).scheduledDate).toEqual(d);
  });

  it('leaves the visit Unassigned (but dated + agent-stamped) when there is no crew', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    const d = day('2026-08-01');
    db.addBooking('bk_1', d);
    const job = db.addJob({ bookingId: 'bk_1', scheduledDate: d });

    const result = await svc.assignVisit(job.id);

    expect(result?.employeeId).toBeNull();
    expect(db.jobById(job.id).agentId).toBe(AGENT);
    expect(db.jobById(job.id).scheduledDate).toEqual(d);
  });

  it('picks the least-loaded employee for the day', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('busy', AGENT);
    db.addEmployee('free', AGENT);
    const d = day('2026-08-01');
    db.addBooking('bk_1', d);
    // `busy` already has two visits that day; `free` has none.
    db.addJob({
      bookingId: 'bk_x',
      visitNumber: 1,
      employeeId: 'busy',
      scheduledDate: d,
    });
    db.addJob({
      bookingId: 'bk_x',
      visitNumber: 2,
      employeeId: 'busy',
      scheduledDate: d,
    });
    const job = db.addJob({ bookingId: 'bk_1', scheduledDate: d });

    const result = await svc.assignVisit(job.id);

    expect(result?.employeeId).toBe('free');
  });

  it('bumps to the next day when the target day is at capacity', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT, 2); // cap 2/day
    const d = day('2026-08-01');
    const next = addUtcDays(d, 1);
    db.addBooking('bk_1', d);
    db.addJob({
      bookingId: 'bk_a',
      visitNumber: 1,
      employeeId: 'emp_1',
      scheduledDate: d,
    });
    db.addJob({
      bookingId: 'bk_b',
      visitNumber: 1,
      employeeId: 'emp_1',
      scheduledDate: d,
    });
    const job = db.addJob({ bookingId: 'bk_1', scheduledDate: d });

    const result = await svc.assignVisit(job.id);

    expect(result?.employeeId).toBe('emp_1');
    expect(result?.scheduledDate).toEqual(next);
  });

  it('leaves Unassigned when every employee is over capacity through the horizon', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT, 0); // cap 0 → never has capacity
    const d = day('2026-08-01');
    db.addBooking('bk_1', d);
    const job = db.addJob({ bookingId: 'bk_1', scheduledDate: d });

    const result = await svc.assignVisit(job.id);

    expect(result?.employeeId).toBeNull();
    expect(db.jobById(job.id).scheduledDate).toEqual(d); // date preserved
  });

  it('breaks a load tie by least-recently-assigned (round-robin)', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('recent', AGENT);
    db.addEmployee('stale', AGENT);
    const d = day('2026-08-01');
    const elsewhere = day('2026-09-01'); // outside the target day's window
    db.addBooking('bk_1', d);
    // Both have zero load on `d`, but `recent` was assigned more recently.
    db.addJob({
      bookingId: 'bk_s',
      visitNumber: 1,
      employeeId: 'stale',
      scheduledDate: elsewhere,
    });
    db.addJob({
      bookingId: 'bk_r',
      visitNumber: 1,
      employeeId: 'recent',
      scheduledDate: elsewhere,
    });
    const job = db.addJob({ bookingId: 'bk_1', scheduledDate: d });

    const result = await svc.assignVisit(job.id);

    expect(result?.employeeId).toBe('stale');
  });

  it('is a no-op for a job already past "assigned"', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT);
    const d = day('2026-08-01');
    db.addBooking('bk_1', d);
    const job = db.addJob({
      bookingId: 'bk_1',
      scheduledDate: d,
      status: 'started',
    });

    const result = await svc.assignVisit(job.id);

    expect(result?.employeeId).toBeNull();
    expect(db.jobById(job.id).status).toBe('started');
  });
});

describe('SchedulerService.generateDueVisits', () => {
  it('fills the rolling window for a weekly booking and assigns each visit', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT);
    // Anchor visit #1 at today so the +7/+14 visits fall inside the 14-day window.
    const anchor = startOfUtcDay(new Date());
    db.addBooking('bk_1', anchor, 'weekly');
    db.addJob({
      bookingId: 'bk_1',
      visitNumber: 1,
      scheduledDate: anchor,
      agentId: AGENT,
    });

    const res = await svc.generateDueVisits();

    expect(res.created).toBe(2); // visits #2 (+7) and #3 (+14)
    const visits = db.jobs
      .filter((j) => j.bookingId === 'bk_1')
      .sort((a, b) => a.visitNumber - b.visitNumber);
    expect(visits.map((v) => v.visitNumber)).toEqual([1, 2, 3]);
    expect(visits[1].scheduledDate).toEqual(addUtcDays(anchor, 7));
    expect(visits[2].scheduledDate).toEqual(addUtcDays(anchor, 14));
    // Generated visits were assigned to the crew.
    expect(visits[1].employeeId).toBe('emp_1');
    expect(visits[2].employeeId).toBe('emp_1');
  });

  it('is idempotent — a second pass creates no duplicates', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT);
    const anchor = startOfUtcDay(new Date());
    db.addBooking('bk_1', anchor, 'weekly');
    db.addJob({
      bookingId: 'bk_1',
      visitNumber: 1,
      scheduledDate: anchor,
      agentId: AGENT,
    });

    await svc.generateDueVisits();
    const countAfterFirst = db.jobs.filter(
      (j) => j.bookingId === 'bk_1',
    ).length;
    const res2 = await svc.generateDueVisits();

    expect(res2.created).toBe(0);
    expect(db.jobs.filter((j) => j.bookingId === 'bk_1').length).toBe(
      countAfterFirst,
    );
  });

  it('skips one-time bookings entirely', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT);
    const anchor = startOfUtcDay(new Date());
    db.addBooking('bk_1', anchor, 'oneTime');
    db.addJob({
      bookingId: 'bk_1',
      visitNumber: 1,
      scheduledDate: anchor,
      agentId: AGENT,
    });

    const res = await svc.generateDueVisits();

    expect(res.created).toBe(0);
    expect(db.jobs.filter((j) => j.bookingId === 'bk_1').length).toBe(1);
  });

  it('self-heals: re-assigns a future Unassigned visit once a crew exists', async () => {
    const { db, svc } = makeService();
    db.addAgent(AGENT);
    db.addEmployee('emp_1', AGENT);
    // A future visit that was left Unassigned earlier (employeeId null).
    const future = addUtcDays(startOfUtcDay(new Date()), 3);
    db.addBooking('bk_1', future, 'oneTime'); // oneTime → generation loop skips it
    const job = db.addJob({
      bookingId: 'bk_1',
      visitNumber: 1,
      scheduledDate: future,
      agentId: AGENT,
      employeeId: null,
    });

    const res = await svc.generateDueVisits();

    expect(res.reassigned).toBe(1);
    expect(db.jobById(job.id).employeeId).toBe('emp_1');
  });
});
