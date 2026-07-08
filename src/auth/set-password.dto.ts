import { Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_MESSAGE } from './validation.constants';

export class SetPasswordDto {
  @MinLength(8, { message: PASSWORD_MESSAGE })
  @MaxLength(64, { message: PASSWORD_MESSAGE })
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword: string;
}
