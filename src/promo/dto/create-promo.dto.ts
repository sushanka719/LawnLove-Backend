import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PromoType } from '../../../generated/prisma/client';

// `value` is a 1..100 percentage for type=percent, or CENTS off for type=fixed
// (the exact range is enforced per-type in PromoService.assertValue).
export class CreatePromoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may only contain letters, numbers, - and _',
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsEnum(PromoType)
  type!: PromoType;

  @IsInt()
  @Min(1)
  value!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSubtotal?: number; // cents

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
