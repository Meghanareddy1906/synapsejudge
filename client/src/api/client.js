const TOKEN_KEY = 'synapsejudge.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const UNREACHABLE =
  'Cannot reach the server. The API may still be starting up — wait a moment and try again.';

export async function api(path, { method = 'GET', body, signal } = {}) {
  const token = tokenStore.get();

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // The request never reached a server: API down, dev proxy with nothing
    // behind it, or the network dropped. An aborted request is the caller
    // navigating away, not a failure, so let it through untouched.
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, UNREACHABLE);
  }

  const text = await response.text();

  // A dev proxy or a crashed upstream answers with HTML, not JSON. Parsing that
  // must not throw a SyntaxError over the top of the real problem.
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    if (response.status === 401) tokenStore.clear();

    // Without a server-sent message, `statusText` alone reads as "Internal
    // Server Error" even when the truth is that nothing answered at all —
    // which sends people debugging a backend that is merely not running.
    const message =
      payload.error ??
      (response.status >= 500 && !text ? UNREACHABLE : null) ??
      (response.status >= 500
        ? `Server error (${response.status}). Check the API logs.`
        : response.statusText || `Request failed (${response.status}).`);

    throw new ApiError(response.status, message, payload.details);
  }

  return payload;
}

export const get = (path, options) => api(path, { ...options, method: 'GET' });
export const post = (path, body, options) => api(path, { ...options, method: 'POST', body });
export const put = (path, body, options) => api(path, { ...options, method: 'PUT', body });
export const patch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
export const del = (path, options) => api(path, { ...options, method: 'DELETE' });
