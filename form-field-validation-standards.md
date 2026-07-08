# Form Input Field Validation Standards

**Purpose:** Standard validation rules for all input fields in the web application.
**Scope:** All rules must be enforced **both client-side (UX) and server-side (security)** — client-side validation alone can be bypassed.

---

## 1. Personal Information Fields

| Field | Type | Required | Min | Max | Allowed Characters | Error Message |
|---|---|---|---|---|---|---|
| First Name | Text | Yes | 2 | 50 | Letters only (A–Z, a–z); space, hyphen, apostrophe | First name must contain only letters (2–50 characters). |
| Last Name | Text | Yes | 2 | 50 | Letters only; space, hyphen, apostrophe | Last name must contain only letters (2–50 characters). |
| Full Name | Text | Yes | 3 | 100 | Letters + single spaces; hyphen, apostrophe | Full name must contain only letters and spaces (3–100 characters). |
| Middle Name | Text | No | 1 | 50 | Letters only | Middle name must contain only letters. |
| Display Name | Text | No | 2 | 30 | Alphanumeric + space, `_`, `-` | Display name can contain letters, numbers, spaces, _ and - only. |

**Rules (all name fields):**
- No digits (e.g. `W1sr` → invalid)
- No emojis or special characters
- No leading/trailing spaces; no consecutive spaces
- Trim whitespace before save
- ✅ Valid: `Sundar`, `Mary-Jane`, `O'Brien` — ❌ Invalid: `Wisr1`, `@John`, `123`

---

## 2. Account / Authentication Fields

| Field | Type | Required | Min | Max | Allowed Characters | Error Message |
|---|---|---|---|---|---|---|
| Username | Text | Yes | 4 | 20 | Lowercase letters, digits, `_`, `.`; must start with a letter | Username must be 4–20 characters, start with a letter, and use only letters, numbers, _ or . |
| Email | Email | Yes | 6 | 254 | RFC 5322 format `local@domain.tld` | Please enter a valid email address. |
| Password | Password | Yes | 8 | 16 | All printable characters | Password must be 8–64 characters with uppercase, lowercase, number and special character. |
| Confirm Password | Password | Yes | 8 | 16 | Same as Password | Passwords do not match. |
| OTP / Verification Code | Numeric | Yes | 4–6 | 4–6 | Digits only | Please enter the 6-digit code sent to your email/phone. |

**Username rules:**
- Unique (server check, case-insensitive)
- No spaces; cannot start with a digit or underscore; no consecutive `.` or `_`
- ✅ `sundar_07` — ❌ `07sundar`, `sun dar`, `sundar__x`

**Email rules:**
- Exactly one `@`; valid TLD; no spaces; no consecutive dots
- Unique on registration; case-insensitive
- Suggested regex: `^[\w.+-]+@[\w-]+\.[\w.]{2,}$`
- ✅ `sundar@gmail.com` — ❌ `sundar@@gmail`, `sundar@.com`, `@gmail.com`

**Password rules:**
- At least 1 uppercase, 1 lowercase, 1 digit, 1 special character
- Cannot equal username/email; not in common-password list
- Masked input with show/hide toggle; strength meter recommended
- Confirm Password: exact case-sensitive match; re-validate if Password changes

**OTP rules:**
- Exact length (4 or 6 per system); numeric keypad on mobile
- Expiry (e.g. 5 minutes); max 3–5 attempts, then lock/resend
- Allow pasting the full code

---

## 3. Contact Fields

| Field | Type | Required | Min | Max | Allowed Characters | Error Message |
|---|---|---|---|---|---|---|
| Phone Number | Tel | Yes | 10 | 15 | Digits only; optional leading `+` | Please enter a valid 10-digit phone number. |
| Landline | Tel | No | 7 | 12 | Digits; optional area code hyphen | Please enter a valid landline number. |
| Alternate Email | Email | No | 6 | 254 | Same as Email | Alternate email must differ from primary email. |

**Phone rules:**
- No alphabets/special characters (except `+` for country code)
- Country-specific length (Nepal: 10 digits starting with 98/97)
- Numeric keypad on mobile; strip spaces/dashes before save
- ✅ `9841234567`, `+9779841234567` — ❌ `98412345ab`

---

## 4. Address Fields

| Field | Type | Required | Min | Max | Allowed Characters | Error Message |
|---|---|---|---|---|---|---|
| Address Line 1 | Text | Yes | 5 | 100 | Alphanumeric + space `, . - / #` | Address must be 5–100 characters. |
| Address Line 2 | Text | No | 0 | 100 | Same as Line 1 | Address line 2 must not exceed 100 characters. |
| City | Text | Yes | 2 | 50 | Letters + space, hyphen (no digits) | City must contain only letters (2–50 characters). |
| State / Province | Dropdown | Yes | — | — | Predefined list (depends on Country) | Please select a state/province. |
| Country | Dropdown | Yes | — | — | Predefined ISO country list | Please select a country. |
| ZIP / Postal Code | Alphanumeric | Yes | 4 | 10 | Country-dependent (Nepal: 5 digits) | Please enter a valid postal code. |

**Rules:**
- Dropdown placeholder ("Select…") must not be submittable
- Changing Country resets State/City; postal format validated per selected country
- Server must re-check dropdown values exist in the option list

---

## 5. Date / Time Fields

| Field | Type | Required | Format | Error Message |
|---|---|---|---|---|
| Date of Birth | Date | Yes | Date picker, `DD/MM/YYYY` | Please enter a valid date of birth. You must be at least 18 years old. |
| Start Date | Date | Yes | Date picker | Start date cannot be in the past. |
| End Date | Date | Yes | Date picker | End date must be after start date. |
| Time | Time | Cond. | `HH:MM` (12h/24h) | Please enter a valid time. |

**Rules:**
- DOB: no future dates; minimum age check (e.g. ≥ 18); max reasonable age (≤ 120); reject impossible dates (`31/02/2000`)
- Start ≤ End; booking start dates cannot be in the past
- Prefer date pickers over free-text input

---

## 6. Numeric Fields

| Field | Type | Required | Range / Format | Error Message |
|---|---|---|---|---|
| Age | Number | Cond. | 1–120, integer, no negatives | Age must be between 1 and 120. |
| Quantity | Number | Yes | ≥ 1, integer, ≤ available stock | Quantity must be between 1 and available stock. |
| Price / Amount | Decimal | Yes | > 0, max 2 decimal places | Please enter a valid amount greater than 0. |
| Percentage / Discount | Decimal | Cond. | 0–100, max 2 decimals | Percentage must be between 0 and 100. |

**Rules:**
- No negatives, no letters; digits-only keypad on mobile
- Quantity: no `0`, no decimals; stepper (+/−) recommended
- Price: no currency symbol in input (show as prefix); strip thousand separators before save
- ❌ Examples: `-5`, `3.5` (qty), `12.999` (price), `150` (%)

---

## 7. Financial / Payment Fields

| Field | Type | Required | Length | Rules | Error Message |
|---|---|---|---|---|---|
| Card Number | Numeric | Yes | 13–19 | Luhn check; card-type detection; auto-space every 4 digits; mask after entry | Please enter a valid card number. |
| CVV | Numeric | Yes | 3–4 | 3 digits (Visa/MC), 4 (Amex); masked; **never stored** | Please enter a valid CVV. |
| Card Expiry | Date | Yes | `MM/YY` | MM 01–12; not in past; auto-insert `/` | Card expiry date is invalid or expired. |
| Bank Account No. | Numeric | Cond. | 8–20 | Digits only; confirm field must match | Please enter a valid account number. |

---

## 8. Selection Controls

| Field | Type | Required | Rules | Error Message |
|---|---|---|---|---|
| Dropdown (single) | Select | Yes | Placeholder not submittable; server re-checks value exists | Please select an option. |
| Multi-select | Multi | Cond. | Min/max selection count (e.g. up to 3) | Please select between 1 and 3 options. |
| Radio Group | Radio | Yes | Exactly one selected; no default for sensitive choices | Please select one option. |
| Checkbox (T&C) | Checkbox | Yes | Must be checked to proceed | You must accept the Terms & Conditions to continue. |
| Checkbox (optional) | Checkbox | No | Default unchecked (opt-in) | — |

---

## 9. Content / Free-Text Fields

| Field | Type | Required | Min | Max | Rules | Error Message |
|---|---|---|---|---|---|---|
| Search | Text | No | 1 | 100 | Trim; sanitize special chars (SQLi/XSS); debounce live search | No results found for your search. |
| Comment / Description | Textarea | Cond. | 10 | 500 | Live character counter; XSS sanitization; reject whitespace-only | Comment must be 10–500 characters. |
| Title / Subject | Text | Yes | 3 | 100 | No HTML tags; not blank/whitespace-only | Title must be 3–100 characters. |
| URL / Website | URL | No | 10 | 2048 | Must start `http(s)://`; valid domain | Please enter a valid URL (e.g. https://example.com). |

**Security notes:**
- Input like `<script>alert(1)</script>` or `'; DROP TABLE--` must be escaped/treated as plain text — never executed
- Suggested URL regex: `^https?://[\w.-]+\.[a-z]{2,}(/\S*)?$`

---

## 10. File Upload Fields

| Field | Required | Allowed Types | Max Size | Rules | Error Message |
|---|---|---|---|---|---|
| Profile Picture | Cond. | JPG, JPEG, PNG, WEBP | 2–5 MB | Extension **and** MIME-type check (server-side); reject renamed executables; show preview + progress | Only JPG/PNG images up to 5 MB are allowed. |
| Document | Cond. | PDF, DOC, DOCX | 10 MB | Extension + MIME validation; max file count; server-side virus scan | Only PDF/DOC files up to 10 MB are allowed. |

---

## 11. Identity Fields (Region-Specific)

| Field | Required | Length | Format | Error Message |
|---|---|---|---|---|
| Citizenship / National ID | Cond. | 5–20 | Digits, hyphen, slash (per country) | Please enter a valid ID number. |
| PAN / Tax Number | Cond. | 9–15 | Nepal PAN: 9 digits | Please enter a valid PAN number. |

**Rules:** Unique per user/business; masked display after save.

---

## 12. Whitespace Handling (apply to ALL text inputs)

| # | Rule | Behavior | Example |
|---|---|---|---|
| 1 | Trim leading/trailing spaces | Applied to **every** text input before validation and before save | `"  Sundar  "` → saved as `"Sundar"` |
| 2 | Whitespace-only = empty | Input containing only spaces/tabs must fail the **required** check after trimming | `"   "` in First Name → "First name is required." |
| 3 | Collapse consecutive spaces | Internal multiple spaces reduced to a single space (names, titles, addresses) | `"Sundar   Shrestha"` → `"Sundar Shrestha"` |
| 4 | No spaces allowed at all | Username, Email, Phone, OTP, Postal Code — reject or strip any space | `"sun dar"` → invalid username |
| 5 | Spaces normalized on save | Phone/card numbers: strip all spaces/dashes before storing | `"984 123 4567"` → `"9841234567"` |
| 6 | Password edge spaces | Trim leading/trailing spaces on password (or block them); internal spaces may be allowed per policy — pick one and enforce on both register **and** login | `" Pass@123 "` → treated as `"Pass@123"` |
| 7 | Length check after trim | Min/max length validated on the **trimmed** value, not raw input | `"  ab  "` (2 chars after trim) fails min-3 rule |
| 8 | Textarea internal whitespace | Preserve line breaks/spacing inside comments/descriptions, but still trim edges and reject whitespace-only | `"\n\n  \n"` → "Comment is required." |

---

## 13. General / Cross-Cutting Rules (apply to ALL forms)

| # | Rule | Description |
|---|---|---|
| 1 | Required indicator | Mark mandatory fields with `*`. Show errors after blur/submit, not while typing the first time. |
| 2 | Trim whitespace | Trim leading/trailing spaces on all text inputs before validation and save. |
| 3 | Client + Server | Every rule enforced in the UI must also be enforced on the server. |
| 4 | Error placement | Inline error below/beside the field in red + red border. Focus first invalid field on submit. |
| 5 | Validation timing | Format checks (email/phone) on blur; required checks on submit; password strength live. |
| 6 | Copy-paste | Allow paste everywhere; OTP must accept pasted full code. |
| 7 | Max length | Use `maxlength` to hard-stop typing; character counter on textareas. |
| 8 | Input types | Use correct HTML types (`email`, `tel`, `number`, `date`, `url`, `password`) for mobile keypads. |
| 9 | XSS | Escape/sanitize all input before rendering; encode `<`, `>`, script tags. |
| 10 | SQL Injection | Parameterized queries only; treat injection strings as plain text. |
| 11 | Double submit | Disable submit button while request is in flight. |
| 12 | Case sensitivity | Email/username: case-insensitive uniqueness. Password: case-sensitive. |
| 13 | Autocomplete | Set proper `autocomplete` attributes (`email`, `tel`, `new-password`, etc.). |
| 14 | Localization | Date, phone, and postal formats adapt to selected country/locale. |
| 15 | Accessibility | `aria-invalid`, `aria-describedby` on errors; labels tied via `for`/`id`. |
