import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BookingStatus } from '../../../generated/prisma/client';

const BOOKING_STATUSES = Object.values(BookingStatus);

// Query params for the admin bookings list — same pagination as the customer
// list, plus an optional status filter over ALL bookings (not scoped to a user).
export class ListBookingsAdminDto {
  @IsOptional()
  @IsIn(BOOKING_STATUSES, {
    message: `status must be one of: ${BOOKING_STATUSES.join(', ')}`,
  })
  status?: BookingStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 10;
}
