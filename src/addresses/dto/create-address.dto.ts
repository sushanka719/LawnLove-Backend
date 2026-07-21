import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Mirrors the address fields the booking flow captures (see
// create-booking.dto.ts): one free-text line plus optional Mapbox coordinates.
// The global ValidationPipe runs with forbidNonWhitelisted, so every accepted
// field must be declared here.
export class CreateAddressDto {
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

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
