/**
 * Centralized fetch wrappers. The repeated try/catch + res.ok pattern
 * across every service was both noisy and silently inconsistent —
 * `fetch` only throws on network failure (not on 4xx/5xx), so the naive
 * `await fetch(...)` without `res.ok` check happily returned "success"
 * on auth/server errors. These helpers collapse both failure modes into
 * a single null/false return so callers handle them uniformly.
 */

/**
 * GET-style call. Returns parsed JSON on 2xx, `null` on any HTTP or
 * network error. Use for queries — callers typically `?? []` or `?? {}`
 * the result for an empty-state fallback.
 */
export async function apiGetJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Mutation that doesn't care about the response body. Returns `true` on
 * 2xx, `false` on any HTTP or network error. Use for POST/PUT/PATCH/DELETE
 * where the caller already knows the new state and just needs success/fail.
 */
export async function apiOk(url: string, init: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, init);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mutation that returns parsed JSON on success, `null` otherwise. Use
 * when the server's response carries information the caller needs (e.g.
 * the created entity, the new state).
 */
export async function apiSendJson<T>(url: string, init: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Lower-level helper for endpoints that return a useful JSON body on BOTH
 * success and error responses (e.g. `{ok: false, error: 'token_used'}` on
 * 400/409). Returns both the HTTP `ok` flag AND the parsed body so callers
 * can show server-supplied error messages instead of a generic fallback.
 * `data` is null only on network failure or unparseable response.
 */
export interface ApiCallResult<T> {
  ok: boolean;
  data: T | null;
}

export async function apiCall<T>(url: string, init?: RequestInit): Promise<ApiCallResult<T>> {
  try {
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: null };
  }
}

/** Convenience: build a RequestInit for a JSON-body mutation. */
export function jsonRequest(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown
): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
