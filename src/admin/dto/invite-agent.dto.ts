import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  EMAIL_MAX,
  EMAIL_MESSAGE,
  EMAIL_REGEX,
} from '../../auth/validation.constants';

// Business name is stored as the invited user's `name` (see the invite plan —
// no dedicated column). Business names legitimately include digits, "&", ".",
// etc., so this is a plain trimmed/length-capped string, not the strict
// letters-only NAME_REGEX used for personal names.
const BUSINESS_NAME_MAX = 100;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class InviteAgentDto {
  @Transform(trim)
  @IsString()
  @MaxLength(EMAIL_MAX, { message: EMAIL_MESSAGE })
  @Matches(EMAIL_REGEX, { message: EMAIL_MESSAGE })
  email: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(BUSINESS_NAME_MAX)
  businessName?: string;
}
