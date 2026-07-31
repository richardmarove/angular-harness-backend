export interface NormalizedAgentError {
  code: number | string;
  status: string;
  message: string;
  retryAfterSec?: number;
  raw: string;
}

export function normalizeAgentError(err: unknown): NormalizedAgentError {
  const raw = String(err instanceof Error ? err.message : err);

  // SDK errors often look like: "ApiError: { ...json... }"
  const jsonStart = raw.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const inner = parsed.error ?? parsed;
      if (inner && (inner.code || inner.status || inner.message)) {
        return {
          code: inner.code ?? 'unknown',
          status: inner.status ?? 'ERROR',
          message: humanize(inner),
          retryAfterSec: extractRetryDelay(inner),
          raw,
        };
      }
    } catch {
      // not JSON — fall through to generic handling
    }
  }

  return {
    code: 'unknown',
    status: 'ERROR',
    message: raw.length > 180 ? raw.slice(0, 180) + '…' : raw,
    raw,
  };
}

function humanize(inner: any): string {
  switch (inner.status) {
    case 'RESOURCE_EXHAUSTED':
      return 'The model is rate-limited right now.';
    case 'UNAVAILABLE':
      return 'The model is temporarily unavailable.';
    case 'PERMISSION_DENIED':
      return 'Access to the model was denied — check the API key.';
    case 'INVALID_ARGUMENT':
      return 'The request was rejected by the model provider.';
    default:
      return typeof inner.message === 'string' && inner.message.length < 180
        ? inner.message
        : 'The model provider returned an error.';
  }
}

function extractRetryDelay(inner: any): number | undefined {
  const details = inner.details;
  if (!Array.isArray(details)) return undefined;
  const retryInfo = details.find((d: any) => String(d['@type']).includes('RetryInfo'));
  const delay: string | undefined = retryInfo?.retryDelay;
  if (!delay) return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(delay);
  return match ? Math.ceil(parseFloat(match[1])) : undefined;
}
