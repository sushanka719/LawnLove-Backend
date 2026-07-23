import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { AreaTierDto } from './area-tier.dto';

// Full replacement of the global pricing config (PUT semantics). `areaTiers`
// replaces the entire ladder; an empty array means "no area surcharges".
export class UpdatePricingSettingsDto {
  // Maximum serviceable lawn area (sq ft). null = no maximum (never block a
  // booking for being too large). @IsOptional() skips validation for null too.
  @IsOptional()
  @IsInt()
  @Min(0)
  maxAreaSqFt?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AreaTierDto)
  areaTiers: AreaTierDto[];
}
