/**
 * Gateway fetch wrapper. All requests carry HttpOnly cookies via
 * `credentials: 'include'` so the gateway can read the session JWT.
 *
 * Non-2xx responses are thrown as typed `ApiError` instances so calling
 * code (TanStack Query hooks) can inspect status + body.
 */

// Same-origin in production (`leylek.nexvar.io/api/*` is the worker route);
// relative URLs avoid hardcoding the host. `VITE_GATEWAY_URL` overrides this
// for local dev (e.g. `http://localhost:8788`) or split-origin staging.
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<TResponse>(path: string, opts: RequestOptions = {}): Promise<TResponse> {
  const { method = 'GET', body, signal } = opts;

  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const message =
      (typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof (payload as { error: unknown }).error === 'string' &&
        (payload as { error: string }).error) ||
      response.statusText ||
      `HTTP ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as TResponse;
}

export { GATEWAY_URL };
