import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';

// Admin override of a job's field-worker (employee), distinct from assign (which
// sets the agent). Either set `employeeId`, clear it (null/omit), or `auto` to
// re-run the scheduler's automatic picker.
export class ReassignJobDto {
  @IsOptional()
  @ValidateIf((o) => o.employeeId !== null)
  @IsString()
  employeeId?: string | null;

  @IsOptional()
  @IsBoolean()
  auto?: boolean;

  // Optional payout reference note when marking a payout paid (unused here but
  // kept for symmetry with the payout action's body).
  @IsOptional()
  @IsString()
  ref?: string;
}
