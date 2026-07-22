import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// A field worker the agent manages. No login — just a card in the Employees
// menu. The global ValidationPipe runs with forbidNonWhitelisted, so every
// accepted field must be declared here.
export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  // Max jobs/day for this employee — the only capacity constraint in the MVP.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  dailyCap?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
