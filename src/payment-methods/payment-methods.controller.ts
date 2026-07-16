import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { PaymentMethodsService } from './payment-methods.service';

type AuthSession = typeof auth.$Infer.Session;

// Saved-card wallet for the signed-in customer. Every route is protected by the
// global AuthGuard, so `session.user` is always present here.
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  list(@Session() session: AuthSession) {
    return this.paymentMethods.list(session.user);
  }

  @Post('setup-intent')
  createSetupIntent(@Session() session: AuthSession) {
    return this.paymentMethods.createSetupIntent(session.user);
  }

  @Post(':id/default')
  setDefault(@Param('id') id: string, @Session() session: AuthSession) {
    return this.paymentMethods.setDefault(session.user, id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Session() session: AuthSession) {
    return this.paymentMethods.remove(session.user, id);
  }
}
