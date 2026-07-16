import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ASSIGNABLE_ROLES, type AssignableRole } from './set-role.dto';

// Query params for the paginated users list. `transform: true` on the global
// ValidationPipe coerces the raw string query values (mirrors ListBookingsDto).
export class ListUsersDto {
  // Free-text search over name + email (case-insensitive).
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES, {
    message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`,
  })
  role?: AssignableRole;

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
