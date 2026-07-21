import { IsInt, IsOptional, Min } from 'class-validator';

// One non-overlapping area bracket within a plan. `surcharge` (cents) is added
// to the plan's basePrice when the measured area falls into [minSqFt, maxSqFt).
export class AreaTierDto {
  @IsInt()
  @Min(0)
  minSqFt: number;

  // null / omitted = no upper bound (only valid on the top bracket).
  @IsOptional()
  @IsInt()
  @Min(0)
  maxSqFt?: number | null;

  @IsInt()
  @Min(0)
  surcharge: number; // cents added to basePrice for this bracket
}
