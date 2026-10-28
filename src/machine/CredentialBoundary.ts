import { redactValue, summarizeArgs, REDACTED } from '@/agent/redaction';

/**
 * JARVIS never stores web passwords. The user signs in inside the browser, and
 * the session cookie that results is theirs to keep — a session is not a
 * password, and conflating the two is what makes password managers dangerous.
 *
 * This boundary makes sure the *other* direction holds too: a secret the user
 * types into a page must never travel back out through page text, DOM
 * snapshots, agent events, audit entries, model context or logs.
 */

/**
 * English and Spanish: Windows UIs are localized, so a field labelled
 * "Contraseña" or "NIP" with an automationId like "txtClave" must be caught by
 * its name alone. "Palabra clave" and "Código postal" are deliberately not.
 */
const SENSITIVE_FIELD_NAMES = /(pass(word|phrase)?|pwd|pin|otp|mfa|2fa|totp|one[-_ ]?time|verification[-_ ]?code|security[-_ ]?code|recovery[-_ ]?code|backup[-_ ]?code|cvv|cvc|secret|token|credential|contrase(ñ|n)a|(?<!palabra[\s_-])clave|\bnip\b|c(ó|o)digo[\s_-]*de[\s_-]*(verificaci|seguridad|recuperaci|respaldo|acceso|un[\s_-]*solo[\s_-]*uso)|credencial)/i;

const SENSITIVE_INPUT_TYPES = new Set(['password']);
// Populated only by main's credential service. Known opaque credentials are not
// dependent on a regex label. Retired values remain masked for this session.
const knownCredentialValues = new Set<string>();
export function registerCredentialValue(value: string): void {
  if (value.length < 6) throw Error('CREDENTIAL_TOO_SHORT');
  knownCredentialValues.add(value);
  knownCredentialValues.add(encodeURIComponent(value));
  knownCredentialValues.add(JSON.stringify(value).slice(1, -1));
}
export function redactKnownCredentials(text: string): string {
  let out = text;
  for (const value of [...knownCredentialValues].sort((a, b) => b.length - a.length)) out = out.split(value).join(REDACTED);
  return out;
}

/**
 * Lines that look like a credential being entered or echoed.
 *
 * Group 1 is the label to keep, group 2 is the secret to destroy. Splitting on
 * a separator instead would leave the secret intact whenever the text has none
 * ("2FA 118204"), which is exactly how a leak gets through.
 */
const SENSITIVE_LINE_PATTERNS: RegExp[] = [
  /\b(contrase[nñ]a|password|passphrase|clave)\b\s*(?:es\s+|son\s+)?[:=]?\s*(\S+)/gi,
  /\b(pin|otp|c[oó]digo(?:\s+de\s+(?:verificaci[oó]n|seguridad|recuperaci[oó]n|acceso))?)\b\s*(?:es\s+|:\s*|=\s*)?\s*(\d[\d\s-]{3,12})/gi,
  /\b(2fa|mfa|totp|one[-\s]?time\s+code|verification\s+code|security\s+code)\b\s*(?:is\s+|es\s+)?[:=]?\s*(\S+)/gi,
  /\b((?:recovery|backup)[-_\s]?code)\b\s*(?:is\s+|es\s+)?[:=]?\s*(\S+)/gi,
];

export interface DomFieldLike {
  tag?: string;
  type?: string;
  name?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  autocomplete?: string;
  value?: string;
}

/** True when a form field is one whose value must never be read. */
export function isSensitiveField(field: DomFieldLike): boolean {
  if (field.type && SENSITIVE_INPUT_TYPES.has(field.type.toLowerCase())) return true;
  if (field.autocomplete && /(current|new)-password|one-time-code/i.test(field.autocomplete)) return true;
  return [field.name, field.id, field.ariaLabel, field.placeholder]
    .some((v) => typeof v === 'string' && SENSITIVE_FIELD_NAMES.test(v));
}

/** Strips the value from any sensitive field before it leaves the page. */
export function sanitizeField<T extends DomFieldLike>(field: T): T {
  if (!isSensitiveField(field)) return field;
  return { ...field, value: REDACTED };
}

/**
 * Applied to page text and DOM text before it reaches an event, the audit log
 * or a model. Deliberately aggressive: over-redacting a harmless line costs
 * nothing, leaking one costs everything.
 */
export function sanitizeText(text: string): string {
  let out = redactKnownCredentials(text);
  for (const pattern of SENSITIVE_LINE_PATTERNS) {
    out = out.replace(pattern, (_match, label: string) => `${label.trim()}: ${REDACTED}`);
  }
  // Reuse the agent redactor for api keys, tokens, jwts and url credentials.
  const viaAgent = redactValue(out);
  return typeof viaAgent === 'string' ? viaAgent : out;
}

/** Deep-sanitises a DOM snapshot: attribute values and text nodes alike. */
export function sanitizeDom(node: unknown, depth = 0): unknown {
  if (depth > 12 || node === null || typeof node !== 'object') {
    return typeof node === 'string' ? sanitizeText(node) : node;
  }
  if (Array.isArray(node)) return node.map((n) => sanitizeDom(n, depth + 1));

  const record = node as Record<string, unknown>;
  const attributes = record.attributes as Record<string, string> | undefined;
  const sensitive = isSensitiveField({
    tag: typeof record.tag === 'string' ? record.tag : undefined,
    type: attributes?.type,
    name: attributes?.name,
    id: attributes?.id,
    ariaLabel: attributes?.['aria-label'],
    placeholder: attributes?.placeholder,
    autocomplete: attributes?.autocomplete,
  });

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (sensitive && (key === 'value' || key === 'text')) { out[key] = REDACTED; continue; }
    if (key === 'attributes' && attributes) {
      out[key] = Object.fromEntries(Object.entries(attributes).map(([k, v]) =>
        [k, k === 'value' && sensitive ? REDACTED : sanitizeText(String(v))]));
      continue;
    }
    out[key] = sanitizeDom(value, depth + 1);
  }
  return out;
}

/** Last stop before anything is written to the audit trail or an event. */
export function sanitizeForLog(value: unknown): string {
  return summarizeArgs(typeof value === 'string' ? sanitizeText(value) : sanitizeDom(value));
}

export { REDACTED };
