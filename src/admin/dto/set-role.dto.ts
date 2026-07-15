import { IsIn } from 'class-validator';

export const ASSIGNABLE_ROLES = ['user', 'agent', 'admin'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export class SetRoleDto {
  @IsIn(ASSIGNABLE_ROLES, {
    message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`,
  })
  role: AssignableRole;
}
