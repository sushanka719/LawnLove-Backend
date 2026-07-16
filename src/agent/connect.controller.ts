import { Controller, Get, Post } from '@nestjs/common';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { ConnectService } from './connect.service';

type AuthSession = typeof auth.$Infer.Session;

// All routes require role=agent (checked by the global AuthGuard via @Roles).
@Roles(['agent'])
@Controller('agent/connect')
export class ConnectController {
  constructor(private readonly connectService: ConnectService) {}

  // Returns a Stripe Express onboarding link for the agent to complete payouts.
  @Post('onboard')
  onboard(@Session() session: AuthSession) {
    return this.connectService.startOnboarding(session.user);
  }

  // Polled when the agent returns from onboarding; persists payoutsEnabled.
  @Get('status')
  status(@Session() session: AuthSession) {
    return this.connectService.getStatus(session.user);
  }
}
