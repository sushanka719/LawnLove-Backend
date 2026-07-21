import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';

type AuthSession = typeof auth.$Infer.Session;

// The global AuthGuard (enabled by AuthModule.forRoot) protects every route
// that isn't @Public()/@AllowAnonymous(), so reaching these handlers guarantees
// a session — `session.user` is always present here.
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  createBooking(
    @Session() session: AuthSession,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingService.createBooking(session.user, dto);
  }

  @Get()
  listBookings(
    @Session() session: AuthSession,
    @Query() query: ListBookingsDto,
  ) {
    return this.bookingService.listBookings(session.user.id, query);
  }

  @Get('invoices')
  listInvoices(
    @Session() session: AuthSession,
    @Query() query: ListBookingsDto,
  ) {
    return this.bookingService.listInvoices(session.user.id, query);
  }

  // Current recurring plans (active/past-due subscriptions) for the Settings
  // "Plan" section. Concrete route — must stay before the `:id` catch-all.
  @Get('current-plans')
  listCurrentPlans(@Session() session: AuthSession) {
    return this.bookingService.listCurrentPlans(session.user.id);
  }

  // NOTE: `GET /bookings/:id` overlaps concrete routes — `:id` would capture
  // "jobs" (jobs controller) or "invoices" (above). Declaration/registration
  // order matters: `invoices` is declared before this, and BookingJobsController
  // is registered before this controller in booking.module.ts, so the concrete
  // routes always win. Keep `:id` LAST.
  @Get(':id')
  getBooking(@Param('id') id: string, @Session() session: AuthSession) {
    return this.bookingService.getBooking(id, session.user.id);
  }
}
