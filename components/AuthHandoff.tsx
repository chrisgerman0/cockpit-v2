'use client'

import { useEffect, useState } from 'react'
import { browserClient } from '@/lib/supabase-browser'

/**
 * Handles two session-arrival paths into the dashboard:
 *
 *  1. PRIMARY — parent-domain cookie (.staxs.ai)
 *     The Supabase browser client uses cookie storage (see
 *     lib/supabase-cookie-storage.ts), so a session set on staxs.ai is
 *     immediately readable on app.staxs.ai. No work needed here; we just
 *     render children.
 *
 *  2. FALLBACK — OAuth hash callback
 *     Google/etc. providers redirect back with #access_token=... in the
 *     URL hash. Supabase's `detectSessionInUrl: true` consumes it, but
 *     the consumption is async — getSession() racing the hash flush can
 *     return null on the first render. If we see the hash on mount, we
 *     await setSession() explicitly before unblocking the page.
 */
export function AuthHandoff({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function handoff() {
      if (typeof window === 'undefined') { setReady(true); return }

      const hash = window.location.hash
      // No hash → cookies (parent-domain) already provide the session.
      // Render immediately.
      if (!hash || !hash.includes('access_token=')) {
        setReady(true)
        return
      }

      try {
        const params = new URLSearchParams(hash.slice(1))
        const access_token  = params.get('access_token')
        const refresh_token = params.get('refresh_token')

        if (access_token && refresh_token) {
          const sb = browserClient()
          const { error } = await sb.auth.setSession({ access_token, refresh_token })
          // Scrub hash so tokens don't sit in the URL bar / share / history.
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
          if (error) console.warn('[AuthHandoff] setSession failed:', error.message)
        }
      } catch (e) {
        console.warn('[AuthHandoff] hash parse failed:', e)
      } finally {
        if (!cancelled) setReady(true)
      }
    }

    handoff()
    return () => { cancelled = true }
  }, [])

  if (!ready) return null
  return <>{children}</>
}
