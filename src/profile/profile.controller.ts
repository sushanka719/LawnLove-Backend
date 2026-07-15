import {
  Controller,
  Post,
  Request,
  Response,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService, Session } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { auth } from '../auth/auth';
import { MAX_AVATAR_BYTES, ProfileService } from './profile.service';

type AuthSession = typeof auth.$Infer.Session;

// Customer/agent-facing profile actions. The global AuthGuard protects every
// route, so `session.user` is always present here. Name and phone number are
// updated through better-auth's `/api/auth/update-user` (validated in the auth
// before-hook); this controller owns the avatar upload.
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly authService: AuthService<typeof auth>,
  ) {}

  // Avatar upload is proxied through the backend (multipart) rather than a
  // direct browser → R2 presigned PUT: the bytes are validated server-side and
  // no bucket CORS is needed. The file is stored in R2, then `user.image` is set
  // via better-auth so the change lands on the session like any other profile
  // field. `@UploadedFile` is populated by FileInterceptor (memory storage).
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES } }),
  )
  async uploadAvatar(
    @Session() session: AuthSession,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const image = await this.profileService.uploadAvatar(session.user.id, file);

    // Persist the new image on the user through better-auth and forward the
    // refreshed session cookie so the client's session reflects it immediately.
    const headers = fromNodeHeaders(req.headers);
    const { headers: outHeaders } = await this.authService.api.updateUser({
      body: { image },
      headers,
      returnHeaders: true,
    });
    const setCookie = outHeaders.get('set-cookie');
    if (setCookie) res.setHeader('set-cookie', setCookie);

    return { image };
  }
}
