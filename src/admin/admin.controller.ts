import { Body, Controller, Param, Post } from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { AdminService } from './admin.service';
import { SetRoleDto } from './dto/set-role.dto';

// Admin-only. Used to promote a user to agent (or admin). The first admin must
// be seeded out-of-band (Prisma Studio / SQL / seed script).
@Roles(['admin'])
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('users/:id/role')
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.adminService.setUserRole(id, dto.role);
  }

  // Refund a disputed job (before payout has been transferred to the agent).
  @Post('jobs/:id/refund')
  refundJob(@Param('id') id: string) {
    return this.adminService.refundJob(id);
  }
}
