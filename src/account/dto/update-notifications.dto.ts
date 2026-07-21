import { IsBoolean, IsOptional } from 'class-validator';

// Partial update of the signed-in user's notification preferences. Every field
// is optional so a toggle can be flipped on its own; absent fields are left
// untouched. `smsOnTheWayAlerts` is accepted for forward-compatibility even
// though the channel isn't wired yet (the UI keeps its toggle disabled).
export class UpdateNotificationsDto {
  @IsOptional()
  @IsBoolean()
  emailReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  smsOnTheWayAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  promotionalEmails?: boolean;
}
