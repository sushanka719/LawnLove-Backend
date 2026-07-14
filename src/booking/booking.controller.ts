import { Body, Controller, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';

type AuthSession = typeof auth.$Infer.Session;

// The global AuthGuard (enabled by AuthModule.forRoot) protects every route
// that isn't @Public()/@AllowAnonymous(), so reaching these handlers guarantees
// a session — `session.user` is always present here.
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post('setup-intent')
  createSetupIntent(@Session() session: AuthSession) {
    return this.bookingService.createSetupIntent(session.user);
  }

  @Post()
  createBooking(
    @Session() session: AuthSession,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingService.createBooking(session.user, dto);
  }
}
