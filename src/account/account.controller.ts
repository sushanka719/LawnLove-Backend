import { Body, Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { AccountService } from './account.service';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';

type AuthSession = typeof auth.$Infer.Session;

// Self-service account settings for the signed-in user (notification
// preferences + account deletion). The global AuthGuard protects every route,
// so `session.user` is always present here. Password changes go straight to
// better-auth's `/api/auth/change-password` (verifies the current password),
// so they aren't handled here.
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('settings')
  getSettings(@Session() session: AuthSession) {
    return this.account.getSettings(session.user.id);
  }

  @Patch('notifications')
  updateNotifications(
    @Session() session: AuthSession,
    @Body() dto: UpdateNotificationsDto,
  ) {
    return this.account.updateNotifications(session.user.id, dto);
  }

  // Schedule a soft delete (grace period before permanent removal).
  @Post('deletion')
  scheduleDeletion(@Session() session: AuthSession) {
    return this.account.scheduleDeletion(session.user.id);
  }

  // Cancel a previously scheduled deletion.
  @Delete('deletion')
  cancelDeletion(@Session() session: AuthSession) {
    return this.account.cancelDeletion(session.user.id);
  }
}
