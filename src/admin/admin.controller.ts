import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { AdminService } from './admin.service';
import { SetRoleDto } from './dto/set-role.dto';
import { BanUserDto } from './dto/ban-user.dto';
import { AssignJobDto } from './dto/assign-job.dto';
import { ReassignJobDto } from './dto/reassign-job.dto';
import { PayoutJobDto } from './dto/payout-job.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { ListJobsDto } from './dto/list-jobs.dto';
import { ListBookingsAdminDto } from './dto/list-bookings-admin.dto';
import { InviteAgentDto } from './dto/invite-agent.dto';

// Admin-only ops console API. The whole controller is @Roles(['admin']); the
// global AuthGuard 401s the unauthenticated and this 403s non-admins. The first
// admin must be seeded out-of-band (Prisma Studio / SQL / seed script).
@Roles(['admin'])
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ---- Overview ------------------------------------------------------------
  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  // Revenue time series for the dashboard chart. range = 7d | 30d | 12m.
  @Get('stats/revenue')
  getRevenue(@Query('range') range?: string) {
    return this.adminService.getRevenue(range);
  }

  // ---- Users ---------------------------------------------------------------
  @Get('users')
  listUsers(@Query() query: ListUsersDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Post('users/:id/role')
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.adminService.setUserRole(id, dto.role);
  }

  @Post('users/:id/ban')
  banUser(@Param('id') id: string, @Body() dto: BanUserDto) {
    return this.adminService.banUser(id, dto);
  }

  @Post('users/:id/unban')
  unbanUser(@Param('id') id: string) {
    return this.adminService.unbanUser(id);
  }

  // ---- Agents --------------------------------------------------------------
  @Get('agents')
  listAgents() {
    return this.adminService.listAgents();
  }

  // Invite a new agent by email (magic link → set password → /agent), or
  // promote an existing user account to agent.
  @Post('agents/invite')
  inviteAgent(@Body() dto: InviteAgentDto) {
    return this.adminService.inviteAgent(dto);
  }

  // ---- Bookings ------------------------------------------------------------
  @Get('bookings')
  listBookings(@Query() query: ListBookingsAdminDto) {
    return this.adminService.listBookings(query);
  }

  @Get('bookings/:id')
  getBooking(@Param('id') id: string) {
    return this.adminService.getBooking(id);
  }

  @Post('bookings/:id/cancel')
  cancelBooking(@Param('id') id: string) {
    return this.adminService.cancelBooking(id);
  }

  // ---- Jobs (dispatch) -----------------------------------------------------
  @Get('jobs')
  listJobs(@Query() query: ListJobsDto) {
    return this.adminService.listJobs(query);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.adminService.getJob(id);
  }

  @Post('jobs/:id/assign')
  assignJob(@Param('id') id: string, @Body() dto: AssignJobDto) {
    return this.adminService.assignJob(id, dto.agentId);
  }

  // Set/clear the job's field-worker (employee), or re-run the scheduler (auto).
  @Post('jobs/:id/reassign')
  reassignJob(@Param('id') id: string, @Body() dto: ReassignJobDto) {
    return this.adminService.reassignJob(id, dto);
  }

  // Mark a completed visit's per-visit payout as paid (deferred manual model).
  @Post('jobs/:id/payout')
  payoutJob(@Param('id') id: string, @Body() dto: PayoutJobDto) {
    return this.adminService.payoutJob(id, dto.ref);
  }

  // Refund a disputed job (before payout has been transferred to the agent).
  @Post('jobs/:id/refund')
  refundJob(@Param('id') id: string) {
    return this.adminService.refundJob(id);
  }

  // ---- Payouts -------------------------------------------------------------
  @Get('payouts')
  listPayouts() {
    return this.adminService.listPayouts();
  }

  // ---- Disputes ------------------------------------------------------------
  @Get('disputes')
  listDisputes() {
    return this.adminService.listDisputes();
  }
}
