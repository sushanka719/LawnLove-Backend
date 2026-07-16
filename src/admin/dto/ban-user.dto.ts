import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Ban a user. Both fields optional: no reason and no expiry means a permanent
// ban with no stated reason. The `banned`/`banReason`/`banExpires` columns are
// the ones the better-auth `admin` plugin reads.
export class BanUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  // Number of days until the ban lifts. Omit for a permanent ban.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;
}
