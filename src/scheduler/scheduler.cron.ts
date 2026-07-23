import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';

// Daily rolling-window pass: tops up future visits for active recurring
// bookings and re-picks any Unassigned ones. This is the ONLY piece that needs
// a timer — first-visit assignment is event-driven off the Stripe webhook.
//
// Multi-instance caveat: an in-process @Cron fires once per running replica —
// fine for the single-instance MVP. If the app is ever scaled out, wrap
// generateDueVisits in a Postgres advisory lock (pg_try_advisory_lock) so the
// pass runs once cluster-wide. Not built in the MVP.
@Injectable()
export class SchedulerCron {
  private readonly logger = new Logger(SchedulerCron.name);

  constructor(private readonly scheduler: SchedulerService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async rollWindow() {
    try {
      await this.scheduler.generateDueVisits();
    } catch (err) {
      this.logger.error('Rolling-window pass failed', err as Error);
    }
  }
}
