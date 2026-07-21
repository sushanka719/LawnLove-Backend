import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PlanBillingType,
  PlanInterval,
} from '../../../generated/prisma/client';
import { AreaTierDto } from './area-tier.dto';

// Lowercase kebab-case, e.g. "weekly-mow". Optional on create — derived from the
// name when omitted (see PlansService.create).
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreatePlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG_REGEX, {
    message: 'slug must be lowercase kebab-case (e.g. "weekly-mow").',
  })
  @MaxLength(140)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(PlanBillingType)
  billingType: PlanBillingType;

  // Required iff billingType = recurring; must be absent for one-time plans.
  // Cross-field rule enforced in PlansService.
  @IsOptional()
  @IsEnum(PlanInterval)
  interval?: PlanInterval | null;

  @IsInt()
  @Min(0)
  basePrice: number; // cents

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AreaTierDto)
  areaTiers?: AreaTierDto[];
}
