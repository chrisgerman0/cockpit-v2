'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser-side Supabase client. Persists session to localStorage with the
 * EXACT same key the existing staxs-landing app uses, so users who logged
 * in on staxs.ai are auto-authenticated when they walk into /v2.
 *
 * Key shape: sb-<project-ref>-auth-token
 *   project-ref = the subdomain part of NEXT_PUBLIC_SUPABASE_URL
 */

let _client: SupabaseClient | null = null

export function browserClient(): SupabaseClient {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  _client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  })
  return _client
}

export async function getAccessToken(): Promise<string | null> {
  const sb = browserClient()
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? null
}
