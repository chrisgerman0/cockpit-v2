'use client'

/**
 * useIsAdmin — probes a known admin-gated endpoint to determine whether
 * the current user has the admin role. Result is cached in module scope
 * for 60s so the sidebar + admin pages don't re-probe on every render.
 *
 * Returns:
 *   - { isAdmin: null, loading: true }  while the probe is in flight
 *   - { isAdmin: true,  loading: false } if the probe succeeds (HTTP 200)
 *   - { isAdmin: false, loading: false } on any non-200 (no token, 401, 403, network error)
 *
 * Default-deny: while loading or on any error, isAdmin is false. The
 * sidebar + admin guard rely on this to hide admin UI from regular users.
 *
 * The API endpoints under /api/admin/* are independently gated server-
 * side via Bearer-token role check, so this hook is purely a UX layer —
 * a non-admin who pasted /v2/admin into the URL bar would already get
 * 403s from every request anyway.
 */

import { useEffect, useState } from 'react'
import { getAccessToken } from './supabase-browser'

let cachedIsAdmin: boolean | null = null
let cachedAt = 0
const CACHE_TTL_MS = 60_000
let inFlight: Promise<boolean> | null = null

async function probe(): Promise<boolean> {
  const token = await getAccessToken().catch(() => null)
  if (!token) return false
  try {
    const res = await fetch('/api/admin/strategy-research', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.status === 200
  } catch {
    return false
  }
}

export function clearAdminCache() {
  cachedIsAdmin = null
  cachedAt = 0
  inFlight = null
}

export function useIsAdmin(): { isAdmin: boolean | null; loading: boolean } {
  const fresh = cachedIsAdmin != null && Date.now() - cachedAt < CACHE_TTL_MS
  const [state, setState] = useState<{ isAdmin: boolean | null; loading: boolean }>(
    () => fresh ? { isAdmin: cachedIsAdmin, loading: false } : { isAdmin: null, loading: true }
  )

  useEffect(() => {
    if (cachedIsAdmin != null && Date.now() - cachedAt < CACHE_TTL_MS) {
      setState({ isAdmin: cachedIsAdmin, loading: false })
      return
    }
    let cancelled = false
    if (!inFlight) {
      inFlight = probe().then(result => {
        cachedIsAdmin = result
        cachedAt = Date.now()
        inFlight = null
        return result
      })
    }
    inFlight.then(result => {
      if (!cancelled) setState({ isAdmin: result, loading: false })
    })
    return () => { cancelled = true }
  }, [])

  return state
}
