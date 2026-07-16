import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { BookingJobsService } from './booking-jobs.service';
import { CreateReviewDto } from './dto/create-review.dto';

type AuthSession = typeof auth.$Infer.Session;

// Customer-facing job routes. Auth-only (global AuthGuard); ownership is checked
// per-job in the service against booking.userId.
@Controller('bookings/jobs')
export class BookingJobsController {
  constructor(private readonly bookingJobsService: BookingJobsService) {}

  @Get()
  listJobs(@Session() session: AuthSession) {
    return this.bookingJobsService.listMyJobs(session.user.id);
  }

  @Get(':id')
  getJob(@Param('id') id: string, @Session() session: AuthSession) {
    return this.bookingJobsService.getJob(id, session.user.id);
  }

  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Session() session: AuthSession,
    @Body() dto: CreateReviewDto,
  ) {
    return this.bookingJobsService.submitReview(id, session.user.id, dto);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Session() session: AuthSession) {
    return this.bookingJobsService.approve(id, session.user.id);
  }

  @Post(':id/dispute')
  dispute(@Param('id') id: string, @Session() session: AuthSession) {
    return this.bookingJobsService.dispute(id, session.user.id);
  }
}
