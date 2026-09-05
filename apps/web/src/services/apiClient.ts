/**
 * Shared authenticated-fetch plumbing for every Twin API client
 * (memoryApi.ts, ingestionApi.ts). Every call attaches the in-memory
 * access token authService tracks; on a 401 (the 15-minute access
 * token expired mid-session) this transparently attempts one silent
 * refresh and retries the request once before giving up.
 */

import type { ErrorResponse } from '@twin/contracts';
import { authService, API_BASE_URL } from './authService';

export class ApiError extends Error {}

export async function authorizedFetch(path: string, init: RequestInit = {}, isRetry = false): Promise<Response> {
  const token = authService.getAccessToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && !isRetry) {
    const restored = await authService.restoreSession();
    if (restored) {
      return authorizedFetch(path, init, true);
    }
  }

  return response;
}

export async function parseOrThrow<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // No JSON body — fall through to the generic error below.
  }

  if (!response.ok) {
    const message = (data as ErrorResponse | null)?.message;
    throw new ApiError(message || 'Something went wrong. Please try again.');
  }

  return data as T;
}
