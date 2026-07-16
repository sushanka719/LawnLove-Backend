// Shared field-validation rules for auth input, mirrored on the frontend in
// lib/validation/auth-schemas.ts. Keep both in sync — the messages here are
// what the user ultimately sees when a check only catches a bad value
// server-side (e.g. requests made outside the normal form).

export const NAME_REGEX = /^[A-Za-z][A-Za-z' -]*$/;
export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const NAME_MESSAGE =
  'Name must contain only letters and spaces (2-100 characters).';

// Full Name (profile) — stricter minimum than the auth `name` field per the
// form-field validation standards (3-100 characters). Same allowed characters
// as NAME_REGEX (letters + single spaces, hyphen, apostrophe).
export const FULL_NAME_MIN = 3;
export const FULL_NAME_MAX = 100;
export const FULL_NAME_MESSAGE =
  'Full name must contain only letters and spaces (3-100 characters).';

// Phone Number — 10-15 digits, optional leading `+` for a country code. Spaces
// and dashes are stripped before validation/save (see stripPhoneSeparators).
export const PHONE_REGEX = /^\+?\d{10,15}$/;
export const PHONE_MESSAGE = 'Please enter a valid 10-digit phone number.';

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

// Phone numbers are stored digits-only (plus an optional leading `+`); users may
// type spaces/dashes for readability, so strip them before validating/saving.
export function stripPhoneSeparators(value: string) {
  return value.replace(/[\s-]/g, '');
}
