import { Body, Controller, Post, Request, Response } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { auth } from './auth';

// `auth.api.setPassword` is server-only (not exposed by the generic
// better-auth catch-all router), so the "set password" step of the
// magic-link signup flow needs an explicit controller to call it.
@Controller('auth')
export class SetPasswordController {
  constructor(private readonly authService: AuthService<typeof auth>) {}

  @Post('set-password')
  async setPassword(
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
    @Body('newPassword') newPassword: string,
  ) {
    const headers = fromNodeHeaders(req.headers);
    const result = await this.authService.api.setPassword({
      body: { newPassword },
      headers,
    });
    // Intentional product decision: even though setPassword leaves the
    // magic-link session active, force the user to land on /login and
    // authenticate for real rather than staying signed in past this page.
    const { headers: signOutHeaders } = await this.authService.api.signOut({
      headers,
      returnHeaders: true,
    });
    const setCookie = signOutHeaders.get('set-cookie');
    if (setCookie) res.setHeader('set-cookie', setCookie);
    return result;
  }
}
