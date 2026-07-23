import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// PUT semantics: any provided field overwrites; omitted fields are left as-is.
export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  platformName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  supportEmail?: string;

  // Commission (0..1). Stored as a fraction, e.g. 0.2 = 20%.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  platformFeePct?: number;

  @IsOptional()
  @IsBoolean()
  payoutsEnabled?: boolean;

  @IsOptional()
  @IsIn(['manual', 'daily', 'weekly'])
  payoutSchedule?: string;
}
