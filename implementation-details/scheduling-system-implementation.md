# Scheduling System — Implementation Plan

**Status:** Implemented (build order 1–6). Step 7 (day-before reminder email)
remains a stretch and is **not** built. Frontend Employees cards live in the
separate frontend repo; this backend exposes the `/agent/employees` API they
consume.
**Last updated:** 2026-07-22
**Scope:** Automatic assignment of service visits to an agent's employees, and
generation of recurring visit dates for the Lawn Love MVP.

---

## 1. Context & Goals

Lawn Love has three roles on `User.role`: `admin`, `agent` (the service
provider), and `user` (customer). For the MVP there is **one agent**. That agent
has several **employees** who do the actual mowing. Employees do **not** log in —
they are managed as cards in the agent dashboard's Employees menu.

After a booking is paid, the scheduler must:

1. Automatically assign each service visit to an employee.
2. Set the date of each visit according to the plan's frequency.
3. Keep generating future visits for open-ended recurring subscriptions.

### Decisions locked in

| Area | Decision |
| --- | --- |
| Recurring visit generation | **Rolling daily cron window** — a daily job ensures every active booking has assigned Jobs for the next ~14 days. |
| Assignment rule | **Least-loaded round-robin** among the agent's active employees for the target date. |
| Capacity model | **Simple daily cap** per employee (`dailyCap`). No shift hours / days-off calendar in MVP. |
| Date logic | **Fixed interval from the first (customer-chosen) date**; if a day is full, bump to the next available day. |
| No employees / all at cap | Job is still created with a date, left **Unassigned** (`employeeId = null`); retried on the next cron pass. Never block a booking on staffing. |
| Rolling window horizon | **14 days** ahead. |
| Visit date visibility | Stored on the Job, shown in customer + agent dashboards. Reminder email is a **stretch**. |

### Why cron *and* events (not one or the other)

Two different concerns, two different mechanisms:

- **Assignment is event-driven, no cron.** When the Stripe webhook flips a
  booking to `active`, we assign the first visit immediately. The customer
  already chose the date, so there is nothing to wait for.
- **Recurring visit generation needs a timer.** A subscription has no end date,
  so we can't pre-create infinite Jobs. A daily cron maintains a rolling window
  of upcoming visits. This is the only piece that genuinely needs a scheduler.

Infrastructure note: `@nestjs/schedule` is **already installed** and
`ScheduleModule.forRoot()` is already wired in `src/app.module.ts`. No Redis /
BullMQ / external cron is required for the MVP.

---

## 2. Current State (what exists today)

- **Stack:** NestJS + Prisma + PostgreSQL.
- **`Booking`** captures the scheduling inputs: a customer-chosen `scheduleDate`,
  a `timeSlot` (morning/midday/afternoon/evening), and a `frequency`
  (weekly/biweekly/monthly/oneTime, derived from the Plan).
- **`Job`** = one service visit under a booking. It has `agentId` (the
  agent-owner), `status`, and money/escrow fields.
- **`Plan`** has `billingType` (recurring/oneTime) and `interval`
  (weekly/biweekly/monthly).

### Gaps this plan fills

1. **No `Employee` model.** `Job.agentId` points at the agent-owner, not the
   person doing the work.
2. **A Job has no date of its own.** Only the booking has `scheduleDate`.
3. **Only ONE Job is ever created**, at booking time
   (`src/booking/booking.service.ts` — comment: *"auto-generation of future
   visits is out of scope"*). Nothing creates visit #2, #3, ...

---

## 3. Data Model Changes (Prisma)

### 3.1 New model: `Employee`

Belongs to an agent (`User`); no login.

```prisma
model Employee {
  id        String   @id @default(cuid())
  agentId   String
  agent     User     @relation("AgentEmployees", fields: [agentId], references: [id], onDelete: Cascade)
  name      String
  phone     String?
  email     String?
  dailyCap  Int      @default(5)   // max jobs/day — the only capacity constraint for MVP
  active    Boolean  @default(true)
  jobs      Job[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([agentId])
  @@map("employee")
}
```

Add the back-relation on `User`:

```prisma
employees Employee[] @relation("AgentEmployees")
```

### 3.2 Modify `Job`

The Job becomes the schedulable unit — it needs its own date and an employee.

```prisma
// add to model Job
scheduledDate DateTime?    // the visit date (date-level; timeSlot lives on booking)
employeeId    String?
employee      Employee?    @relation(fields: [employeeId], references: [id])
visitNumber   Int          @default(1)   // 1,2,3… within the booking, for display + dedupe

@@index([employeeId, scheduledDate])   // "who's busy that day" query
@@index([scheduledDate])               // cron window scan
@@unique([bookingId, visitNumber])     // idempotency: never create the same visit twice
```

`agentId` already exists on `Job` — in this single-agent MVP it is always the
one agent; `employeeId` is the new "who actually does it."

### 3.3 Migration & backfill

- The existing lone Job created in `booking.service.ts` becomes **visit #1**.
- Backfill `Job.scheduledDate` from `booking.scheduleDate` and set
  `visitNumber = 1` for existing rows.
- Run assignment for existing active bookings' visit-1 Jobs so they are not left
  unassigned after deploy.

---

## 4. Employee Management (Agent dashboard)

New module `src/employees/`:

- `POST   /agent/employees`     — create
- `GET    /agent/employees`     — list (scoped to `agentId = session.user.id`)
- `PATCH  /agent/employees/:id` — update (name, phone, email, dailyCap, active)
- `DELETE /agent/employees/:id` — soft-delete preferred (`active = false`) so
  historical Jobs keep their employee reference.

Guarded to `role = agent`. Frontend renders each employee as a card in the
existing Employees menu.

---

## 5. The Scheduler Core

New service `src/scheduler/scheduler.service.ts`. Two public methods and one
shared private assignment routine.

### 5.1 `assignVisit(jobId)` — least-loaded round-robin picker

1. Load the Job + its booking (need `agentId`, `scheduledDate`, `timeSlot`).
2. Fetch the agent's `active` employees.
3. For the target `scheduledDate`, count each employee's existing Jobs that day.
4. Filter out anyone at/over `dailyCap`.
5. Pick the employee with the **fewest** jobs that day; break ties by
   round-robin (least-recently-assigned).
6. If none available → leave `employeeId = null` (**Unassigned**); the date
   stays set. The next cron pass retries.
7. If the customer's day is full → bump `scheduledDate` to the next day that has
   capacity (the "fixed interval, bump if full" rule).

### 5.2 `generateDueVisits()` — rolling-window generator (called by cron)

For every `active` **recurring** booking:

1. Find the latest existing Job's `scheduledDate` and `visitNumber`.
2. While `nextDate = lastDate + interval` (weekly/biweekly/monthly) falls within
   **now + 14 days**:
   - Create Job `{ bookingId, visitNumber+1, agentId, scheduledDate: nextDate,
     status: assigned }`, guarded by `@@unique([bookingId, visitNumber])`
     (idempotent — safe to re-run).
   - Call `assignVisit(newJob.id)`.
3. Re-run `assignVisit` for any **future** Jobs still `employeeId = null`
   (self-healing after an employee is added or reactivated).

One-time bookings are skipped here — their single visit is handled entirely by
the event path below.

---

## 6. Wiring It Up

### 6.1 Event-driven first visit (no cron)

In `src/stripe/webhook.controller.ts`, after a booking flips to `active` in
`activateById` (one-time) and `activateBySubscription` (recurring), call
`scheduler.assignVisit()` for that booking's visit-1 Job. Instant assignment on
payment; the customer already chose the date.

### 6.2 Cron for future visits

Uses infra already present (`ScheduleModule.forRoot()` in `app.module.ts`). Add
to the scheduler service:

```ts
@Cron(CronExpression.EVERY_DAY_AT_2AM)
async rollWindow() {
  await this.generateDueVisits();
}
```

**Multi-instance caveat:** an in-process `@Cron` fires once per running instance
— fine for a single instance. If the app later runs multiple replicas, add a DB
advisory lock so the job runs once. Noted in code; **not built in MVP**.

---

## 7. Surfacing the Visit Date

- **Agent dashboard:** extend `src/agent/jobs.service.ts` responses with
  `scheduledDate` + assigned employee name; add an "Unassigned" filter.
- **Customer dashboard:** extend `src/booking/booking-jobs.controller.ts` /
  service so each visit returns its `scheduledDate`.
- **Stretch (not core):** day-before reminder email via the existing `mail`
  module, gated on `User.emailReminders`.

---

## 8. Edge Cases

| Case | Handling |
| --- | --- |
| Booking cancelled | Cron stops generating; delete/skip future `assigned` Jobs. |
| Employee deactivated | Their future Jobs get `employeeId = null` and are re-picked next cron pass. |
| Frequency / plan change | Future unstarted Jobs regenerated from the new interval. |
| Duplicate generation | Prevented by `@@unique([bookingId, visitNumber])`. |
| No employees / all full | Job created + dated, left Unassigned; retried by cron. |

---

## 9. Build Order (each step independently shippable)

1. Prisma schema + migration + backfill.
2. Employee CRUD module + frontend cards.
3. `SchedulerService.assignVisit` + unit tests.
4. Hook `assignVisit` into the webhook activation paths.
5. `generateDueVisits` + `@Cron` + tests.
6. Surface dates / employee in both dashboards.
7. *(stretch)* day-before reminder email.

---

## 10. Open Questions

1. **Capacity granularity** — `dailyCap` is currently jobs-per-*day*. Given
   `timeSlot` exists on bookings, do we want the cap enforced *per slot* instead
   (e.g. 2 morning jobs max)? Day-level is simpler; slot-level is more realistic.
2. **Single-agent assumption** — `agentId` is kept on every relevant model so
   multi-agent works later for free, but the scheduler currently assumes all
   employees belong to the one MVP agent.
