import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client. Used in Server Components + Route Handlers.
 *
 * Two flavours:
 *   - serverClient()   — anon key, reads cookie session (acts as the user)
 *   - serviceClient()  — service-role key, full bypass. Never expose to browser.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Read the Supabase auth session from the cookie that the existing
 * staxs-landing app sets. Both apps share Supabase project so the same
 * session refreshes work across them.
 *
 * The cookie key matches Supabase's default for the project ref derived
 * from NEXT_PUBLIC_SUPABASE_URL (sb-<project-ref>-auth-token).
 */
export async function getSessionUser() {
  const cookieStore = await cookies()
  const projectRef = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`
  const raw = cookieStore.get(cookieName)?.value
  if (!raw) return null

  // Cookie value is JSON-encoded { access_token, refresh_token, ... }
  let token: string | null = null
  try {
    const parsed = JSON.parse(raw)
    token = parsed?.access_token || parsed?.currentSession?.access_token || null
  } catch {
    // Some Supabase variants store the access_token directly as a string.
    token = raw
  }
  if (!token) return null

  // Resolve the user via service role (we trust the cookie's access_token because
  // it was issued by Supabase to the same project).
  const supabase = createClient(SUPABASE_URL, ANON_KEY)
  const { data: { user } } = await supabase.auth.getUser(token)
  return user
}

export async function isAdmin(userId: string) {
  const sb = serviceClient()
  const { data } = await sb.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin'
}
