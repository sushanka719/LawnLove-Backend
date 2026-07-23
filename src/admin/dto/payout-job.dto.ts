import { IsOptional, IsString, MaxLength } from 'class-validator';

// Optional free-text reference recorded when an admin marks a payout paid.
export class PayoutJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ref?: string;
}
