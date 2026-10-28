/**
 * Everything that reaches the audit log or an approval dialog passes through
 * here first. The rule is blunt on purpose: it is far better to over-redact a
 * harmless string than to write one token to disk.
 */

const SECRET_KEYS = /^(pass(word)?|pwd|secret|token|api[-_]?key|apikey|authorization|auth|bearer|cookie|session|credential|private[-_]?key|refresh[-_]?token|client[-_]?secret)$/i;

const SECRET_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'api-key', re: /\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g },
  { label: 'api-key', re: /\bAIza[A-Za-z0-9_-]{20,}\b/g },
  { label: 'token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { label: 'jwt', re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g },
  { label: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{10,}/gi },
  { label: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: 'url-credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi },
];

export const REDACTED = '[redactado]';

export function redactString(value: string): string {
  let out = value;
  for (const { label, re } of SECRET_PATTERNS) {
    out = out.replace(re, (_match: string, prefix?: string) =>
      label === 'url-credentials' ? `${prefix ?? ''}${REDACTED}@` : `[${label} ${REDACTED}]`);
  }
  return out;
}

/** Deep-redacts an arbitrary value by key name and by content pattern. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? REDACTED : redactValue(raw, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

/** One-line, bounded, redacted rendering of tool arguments. */
export function summarizeArgs(args: unknown, maxLength = 220): string {
  if (args === undefined || args === null) return '—';
  const safe = redactValue(args);
  let text: string;
  try {
    text = typeof safe === 'string' ? safe : JSON.stringify(safe);
  } catch {
    return REDACTED;
  }
  if (!text) return '—';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
