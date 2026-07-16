import { IsString, MinLength } from 'class-validator';

// Assign (or reassign) a job to an agent. The service verifies the target user
// actually has role=agent before writing job.agentId.
export class AssignJobDto {
  @IsString()
  @MinLength(1)
  agentId: string;
}
