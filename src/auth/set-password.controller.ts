import {
  Body,
  Controller,
  HttpException,
  Post,
  Request,
  Response,
} from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { auth } from './auth';
import { SetPasswordDto } from './set-password.dto';

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
    @Body() { newPassword }: SetPasswordDto,
  ) {
    const headers = fromNodeHeaders(req.headers);
    let result: Awaited<ReturnType<typeof this.authService.api.setPassword>>;
    try {
      result = await this.authService.api.setPassword({
        body: { newPassword },
        headers,
      });
    } catch (error) {
      // `APIError` is a plain Error, not a Nest `HttpException` — if we
      // rethrow it as-is, Nest's default filter doesn't recognize it and
      // returns a generic 500, losing the real status/message. Convert it
      // so the frontend's shared error parsing (lib/auth-client.ts), which
      // reads `message` off the JSON body, gets the same shape as every
      // other auth error.
      if (error instanceof APIError) {
        throw new HttpException(
          error.body ?? { message: error.message },
          error.statusCode,
        );
      }
      throw new HttpException(
        { message: 'Could not set your password. Please try again.' },
        400,
      );
    }
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
