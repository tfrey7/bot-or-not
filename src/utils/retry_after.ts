// Parse the HTTP `Retry-After` header (RFC 7231: delta-seconds or HTTP-date)
// into a delay in ms. Reddit usually sends seconds; Anthropic does too. Both
// occasionally omit the header on a 429, in which case callers pick a default.

// Floor for the global Reddit pause. When upstream returns 429 (or 5xx)
// without a Retry-After header, a 1s pause just lets us hammer the same
// failing endpoint a second later — 30s gives the budget time to refill.
const RETRY_AFTER_MIN_MS = 30_000;
const RETRY_AFTER_MAX_MS = 15 * 60 * 1_000;

export function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) {
    return null;
  }

  return Math.max(0, date - Date.now());
}

export function clampRetryAfter(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return RETRY_AFTER_MIN_MS;
  }

  return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms));
}
