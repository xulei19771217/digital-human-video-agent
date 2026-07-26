const SENSITIVE_KEY =
  /authorization|x-api-key|api[_-]?key|token|secret|password/i;
const BEARER_TOKEN = /\bBearer\s+[^\s"',;]+/gi;
const SENSITIVE_QUERY =
  /([?&](?:api[_-]?key|token|secret|password)=)[^&#\s]+/gi;

export const REDACTED = "[REDACTED]";

function redactString(value: string): string {
  return value
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(SENSITIVE_QUERY, `$1${REDACTED}`);
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : redact(item),
      ]),
    );
  }
  return value;
}
