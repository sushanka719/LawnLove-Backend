import { Controller, Get, Query } from '@nestjs/common';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { AgentService } from './agent.service';
import { PaginationQueryDto, ScheduleQueryDto } from './dto/agent-query.dto';

type AuthSession = typeof auth.$Infer.Session;

// Agent dashboard read endpoints (role=agent). Everything is scoped to the
// signed-in agent (session.user.id) — see AgentService.
@Roles(['agent'])
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get('schedule')
  schedule(@Session() session: AuthSession, @Query() q: ScheduleQueryDto) {
    return this.agent.getSchedule(session.user.id, q.from, q.to);
  }

  @Get('stats')
  stats(@Session() session: AuthSession) {
    return this.agent.getStats(session.user.id);
  }

  @Get('bookings')
  bookings(@Session() session: AuthSession, @Query() q: PaginationQueryDto) {
    return this.agent.getBookings(session.user.id, q.page, q.pageSize);
  }

  @Get('earnings')
  earnings(@Session() session: AuthSession, @Query() q: PaginationQueryDto) {
    return this.agent.getEarnings(session.user.id, q.page, q.pageSize);
  }
}
