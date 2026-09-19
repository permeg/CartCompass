/**
 * Kroger identifies products by a 13-digit code, but barcodes arrive as 8, 12
 * or 13 digits. Left-pad to 13, and return null for anything that isn't a plausible code.
 */
export function padUpc(raw: string | undefined | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits.length <= 13 ? digits.padStart(13, '0') : digits.replace(/^0/, '');
}
