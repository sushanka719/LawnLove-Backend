import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JobStatus } from '../../../generated/prisma/client';

const JOB_STATUSES = Object.values(JobStatus);

// Query params for the paginated jobs list (admin dispatch view).
export class ListJobsDto {
  @IsOptional()
  @IsIn(JOB_STATUSES, {
    message: `status must be one of: ${JOB_STATUSES.join(', ')}`,
  })
  status?: JobStatus;

  // Filter to a single agent's jobs (used from the Agents view).
  @IsOptional()
  @IsString()
  agentId?: string;

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
