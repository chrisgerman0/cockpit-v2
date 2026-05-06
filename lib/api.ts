'use client'

import { browserClient, getAccessToken } from './supabase-browser'

/**
 * Authed fetch — attaches the Bearer token from the user's Supabase session.
 * Use for any v1 API that requires authentication. For unauth'd reads
 * (static JSONs, public endpoints) just use plain fetch().
 *
 * Returns the parsed JSON body, or throws on non-2xx with the response text.
 */
export async function authedFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('NOT_AUTHENTICATED')
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text || path}`)
  }
  return res.json() as Promise<T>
}

export { browserClient, getAccessToken }
