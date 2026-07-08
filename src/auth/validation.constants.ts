// Shared field-validation rules for auth input, mirrored on the frontend in
// lib/validation/auth-schemas.ts. Keep both in sync — the messages here are
// what the user ultimately sees when a check only catches a bad value
// server-side (e.g. requests made outside the normal form).

export const NAME_REGEX = /^[A-Za-z][A-Za-z' -]*$/;
export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const NAME_MESSAGE =
  'Name must contain only letters and spaces (2-100 characters).';

export const EMAIL_REGEX = /^[\w.+-]+@[\w-]+\.[\w.]{2,}$/;
export const EMAIL_MAX = 254;
export const EMAIL_MESSAGE = 'Please enter a valid email address.';

export const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
export const PASSWORD_MESSAGE =
  'Password must be 8-64 characters with uppercase, lowercase, number and special character.';

export const USERNAME_REGEX = /^[a-z][a-z0-9_.]*$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_MESSAGE =
  'Username must be 3-30 characters, start with a letter, and use only lowercase letters, numbers, _ or .';

export function hasConsecutive(value: string, chars: string) {
  return chars.split('').some((char) => value.includes(char.repeat(2)));
}

export function collapseSpaces(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}
