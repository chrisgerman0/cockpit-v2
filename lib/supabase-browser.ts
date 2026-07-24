'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client (dashboard app on app.staxs.ai).
 *
 * Uses @supabase/ssr's createBrowserClient with cookie storage scoped to
 * `.staxs.ai` — the same parent-domain cookies the landing app writes,
 * so the dashboard reads the session set by staxs.ai/login without any
 * URL-hash handshake. Handles cookie chunking automatically when the
 * session payload exceeds the 4 KB per-cookie browser limit.
 */
function isStaxsHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'staxs.ai' || h.endsWith('.staxs.ai')
}

let _client: SupabaseClient | null = null

export function browserClient(): SupabaseClient {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  _client = createBrowserClient(url, anon, {
    cookieOptions: {
      ...(isStaxsHost() ? { domain: '.staxs.ai' } : {}),
      path: '/',
      sameSite: 'lax',
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
    },
  })
  return _client
}

// RESILIENCE (2026-07-06): Supabase Auth (GoTrue /auth/v1/*) can hang — the
// token-refresh network call inside getSession() then never resolves, which
// froze callers that `await getAccessToken()` outside a try/finally (the
// Backtesting "Loading…" that never cleared during the GoTrue incident). Cap
// it: on timeout resolve to null so the caller degrades to the public/preview
// path instead of hanging forever. Auth blips become a soft state, not a dead page.
const AUTH_TIMEOUT_MS = 5000

export async function getAccessToken(): Promise<string | null> {
  const sb = browserClient()
  try {
    const { data } = await Promise.race([
      sb.auth.getSession(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('auth-timeout')), AUTH_TIMEOUT_MS)),
    ]) as Awaited<ReturnType<typeof sb.auth.getSession>>
    return data.session?.access_token ?? null
  } catch {
    return null  // GoTrue slow/unreachable — treat as no token (public path), never hang.
  }
}
