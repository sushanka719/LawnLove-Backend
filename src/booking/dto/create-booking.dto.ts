import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BookingFrequency, BookingTimeSlot } from '../../../generated/prisma/client';

const PHONE_REGEX = /^[+]?[\d\s()-]{7,20}$/;
const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

class BoundaryPointDto {
  @IsNumber()
  @Min(-90)
  lat: number;

  @IsNumber()
  @Min(-180)
  lng: number;
}

export class CreateBookingDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Please provide a valid phone number.' })
  phone: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  address: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => BoundaryPointDto)
  boundary: BoundaryPointDto[];

  @IsEnum(BookingFrequency)
  frequency: BookingFrequency;

  @IsString()
  @Matches(DATE_KEY_REGEX, { message: 'Date must be in YYYY-MM-DD format.' })
  date: string;

  @IsEnum(BookingTimeSlot)
  timeSlot: BookingTimeSlot;

  @IsString()
  @MinLength(1)
  paymentMethodId: string;

  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;

  // Accepted for forward-compat but recomputed server-side (never trusted).
  @IsOptional()
  @IsInt()
  areaSqFt?: number;
}
