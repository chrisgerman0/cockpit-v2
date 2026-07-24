'use client'

import { browserClient, getAccessToken } from './supabase-browser'

/**
 * Authed fetch — attaches the Bearer token from the user's Supabase session.
 * Use for any v1 API that requires authentication. For unauth'd reads
 * (static JSONs, public endpoints) just use plain fetch().
 *
 * Returns the parsed JSON body, or throws on non-2xx with the response text.
 */
// RESILIENCE (2026-07-06): the proxied /api/* routes validate the token via
// Supabase getUser() server-side; when GoTrue (/auth/v1/user) hangs, those
// routes hold the connection open and the dashboard's Promise.all([...]) never
// settles → infinite "Loading". Abort after AUTHED_FETCH_TIMEOUT_MS so callers'
// .catch() fallbacks fire and the UI resolves to a real (degraded) state.
const AUTHED_FETCH_TIMEOUT_MS = 12000

export async function authedFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('NOT_AUTHENTICATED')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), AUTHED_FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      signal: ctl.signal,
      headers: {
        ...(init.headers || {}),
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text || path}`)
  }
  return res.json() as Promise<T>
}

export { browserClient, getAccessToken }
