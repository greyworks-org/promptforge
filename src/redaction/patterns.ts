/**
 * Secret detection patterns (Phase 5, SECURITY.md §3.2).
 *
 * Data-driven: each entry is a regex + a human-readable class name.
 * Extending the pattern list never touches pipeline code.
 *
 * Detection rules (SECURITY.md §3.2):
 * 1. Match → replace with `[REDACTED:<class>]`
 * 2. Whole-line redaction for key=value pairs where the value is the secret
 * 3. High-entropy strings matching no class are flagged, not blocked
 */

export interface SecretPattern {
  /** Human-readable class for the redaction marker. */
  class: string;
  /** Regex applied to every line of every outbound payload. */
  regex: RegExp;
  /**
   * When true, the entire line containing the match is redacted
   * (for key=value assignments where exposing the key is still a leak).
   */
  wholeLine?: boolean;
  /**
   * When true AND wholeLine is true, redact every line from the first
   * match until a line matching `endMarker` is found (inclusive).
   * Used for multi-line blocks like PEM private keys.
   */
  multiLine?: boolean;
  /** Required when multiLine is true — the regex that marks the end. */
  endMarker?: RegExp;
}

/** All active secret-detection patterns in priority order. */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // --- Private key blocks (entire block) ---
  {
    class: 'private-key',
    regex: /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY( BLOCK)?-----/,
    wholeLine: true,
    multiLine: true,
    endMarker: /-----END (RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY( BLOCK)?-----/,
  },

  // --- AWS keys ---
  {
    class: 'aws-access-key',
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    class: 'aws-secret-key',
    regex: /aws_secret_access_key\s*[:=]\s*\S+/gi,
    wholeLine: true,
  },

  // --- Stripe ---
  {
    class: 'stripe-secret-key',
    regex: /\b(sk_live_|sk_test_|rk_live_|rk_test_)[0-9A-Za-z]{10,}\b/g,
  },

  // --- Supabase ---
  {
    class: 'supabase-key',
    regex: /supabase[_-]?(service_role|anon)[_-]?key\s*[:=]\s*\S+/gi,
    wholeLine: true,
  },

  // --- JWT ---
  {
    class: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },

  // --- Bearer tokens ---
  {
    class: 'bearer-token',
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  },

  // --- DB connection strings ---
  {
    class: 'db-connection-string',
    regex: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/\S+:\S+@\S+/gi,
  },

  // --- OAuth client secrets ---
  {
    class: 'oauth-client-secret',
    regex: /client_secret\s*[:=]\s*\S+/gi,
    wholeLine: true,
  },

  // --- Generic API key assignments ---
  {
    class: 'api-key',
    regex: /(api[_-]?key|apikey|auth[_-]?token|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{16,}/gi,
    wholeLine: true,
  },

  // --- OpenAI-style keys (both standard and project-prefixed) ---
  {
    class: 'openai-key',
    regex: /\bsk-[A-Za-z0-9-]{20,}\b/g,
  },
];

/**
 * Threshold for flagging high-entropy strings (characters).
 * Strings longer than this that match no pattern are flagged as entropy warnings.
 */
export const ENTROPY_FLAG_MIN_LENGTH = 40;

/**
 * Check whether a string looks like a high-entropy token
 * (long, mixed-case alphanumeric with symbols).
 */
export function isHighEntropy(value: string): boolean {
  if (value.length < ENTROPY_FLAG_MIN_LENGTH) return false;
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasDigit = /[0-9]/.test(value);
  const uniqueRatio =
    new Set(value).size / value.length;
  return hasUpper && hasLower && hasDigit && uniqueRatio > 0.4;
}
