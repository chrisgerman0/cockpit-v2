/**
 * Parent-domain cookie storage adapter for Supabase Auth.
 *
 * Replaces the default localStorage so that the session cookie is set on
 * `.staxs.ai` and shared between staxs.ai and app.staxs.ai. Without this,
 * the dashboard subdomain has its own origin-scoped storage and the user
 * has to handshake a session over the URL hash on every login — clunky
 * and visibly slow.
 *
 * Falls back to localStorage on localhost / non-staxs hosts so dev keeps
 * working unchanged.
 *
 * Shared verbatim between staxs-landing (lib/supabase-cookie-storage.ts)
 * and staxs-dashboard-v2 — keep the two copies in sync.
 */

type SupabaseStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const COOKIE_DOMAIN = '.staxs.ai'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year — Supabase auto-refreshes the actual JWT

function useCookies(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  // Set a `.staxs.ai` cookie only on real staxs.ai subdomains. Localhost,
  // *.vercel.app preview deploys, and bare IP access all fall back to
  // localStorage.
  return host === 'staxs.ai' || host.endsWith('.staxs.ai')
}

function readCookie(key: string): string | null {
  if (typeof document === 'undefined') return null
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp('(?:^|; )' + safeKey + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function writeCookie(key: string, value: string): void {
  if (typeof document === 'undefined') return
  // Domain-scoped to parent domain so both staxs.ai and app.staxs.ai see it.
  // Secure + SameSite=Lax: works across subdomain navigations within the
  // same site, blocks third-party leakage.
  document.cookie =
    `${key}=${encodeURIComponent(value)}; ` +
    `path=/; domain=${COOKIE_DOMAIN}; ` +
    `max-age=${COOKIE_MAX_AGE}; ` +
    `SameSite=Lax; Secure`
}

function deleteCookie(key: string): void {
  if (typeof document === 'undefined') return
  document.cookie =
    `${key}=; ` +
    `path=/; domain=${COOKIE_DOMAIN}; ` +
    `max-age=0; ` +
    `SameSite=Lax; Secure`
  // Also clear any localhost/non-domain instance left over from older
  // sessions; otherwise the Supabase client may pick up the stale value.
  document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`
}

export function getSupabaseStorage(): SupabaseStorage {
  if (!useCookies()) {
    // Dev / non-staxs host — let Supabase use the default localStorage path
    // by returning a thin adapter wrapping it. Keeping the same interface
    // means we can swap storages cleanly via the auth config.
    return {
      getItem: (k) => typeof window !== 'undefined' ? window.localStorage.getItem(k) : null,
      setItem: (k, v) => { if (typeof window !== 'undefined') window.localStorage.setItem(k, v) },
      removeItem: (k) => { if (typeof window !== 'undefined') window.localStorage.removeItem(k) },
    }
  }
  return {
    getItem: readCookie,
    setItem: writeCookie,
    removeItem: deleteCookie,
  }
}
