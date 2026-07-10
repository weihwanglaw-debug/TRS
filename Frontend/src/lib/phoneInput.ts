const PHONE_ALLOWED_CHARS = /[^\d+\-()\s]/g;

export function sanitizePhoneInput(value: string): string {
  return value.replace(PHONE_ALLOWED_CHARS, "");
}

export function isValidPhoneInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return sanitizePhoneInput(trimmed) === trimmed && /\d/.test(trimmed);
}
