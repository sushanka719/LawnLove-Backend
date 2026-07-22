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

// Every field optional — a PATCH may rename, change capacity, or flip `active`
// (deactivating releases the employee's future visits back to Unassigned).
export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  dailyCap?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
