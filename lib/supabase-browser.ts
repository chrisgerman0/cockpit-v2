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

export async function getAccessToken(): Promise<string | null> {
  const sb = browserClient()
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? null
}
