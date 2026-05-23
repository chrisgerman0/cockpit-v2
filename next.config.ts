import type { NextConfig } from 'next'

// In production, dashboard is served at https://app.staxs.ai/* via nginx.
// The marketing/auth landing app stays at https://staxs.ai/*. Nginx routes
// `/api/*` and `/data/*` requests received on app.staxs.ai back to the landing
// app on port 3005. The rewrites below are for DEV — they let `fetch('/api/...')`
// reach localhost:3005 when running `next dev` outside the nginx fabric.
const STAXS_LANDING = process.env.STAXS_LANDING_ORIGIN || 'http://localhost:3005'

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Subdomain deploy (2026-05-11): dashboard owns app.staxs.ai root — no
  // basePath needed. Old `staxs.ai/v2/*` URLs are 301-redirected by nginx.
  // basePath: '/v2',  // REMOVED — see app.staxs.ai server block in nginx
  allowedDevOrigins: ['staxs.ai', 'www.staxs.ai', 'app.staxs.ai'],
  async rewrites() {
    return [
      // Static portfolio JSONs published by multi-asset-backtest daemon
      { source: '/data/:path*', destination: `${STAXS_LANDING}/data/:path*` },
      // v1 user-scoped APIs (Bearer auth, server-side Supabase)
      { source: '/api/balance',           destination: `${STAXS_LANDING}/api/balance` },
      { source: '/api/trades',            destination: `${STAXS_LANDING}/api/trades` },
      { source: '/api/trades-live',       destination: `${STAXS_LANDING}/api/trades-live` },
      { source: '/api/bot-activate',      destination: `${STAXS_LANDING}/api/bot-activate` },
      { source: '/api/live-position',     destination: `${STAXS_LANDING}/api/live-position` },
      { source: '/api/strategy-state',    destination: `${STAXS_LANDING}/api/strategy-state` },
      { source: '/api/profile',           destination: `${STAXS_LANDING}/api/profile` },
      { source: '/api/billing/:path*',    destination: `${STAXS_LANDING}/api/billing/:path*` },
      { source: '/api/broker/:path*',     destination: `${STAXS_LANDING}/api/broker/:path*` },
      { source: '/api/wizard/:path*',     destination: `${STAXS_LANDING}/api/wizard/:path*` },
      // Admin-only endpoints (Bearer + admin-role gate enforced server-side).
      // Includes /api/admin/portfolio-trades (Phase H trade ledger with cfg_sid).
      { source: '/api/admin/:path*',      destination: `${STAXS_LANDING}/api/admin/:path*` },
    ]
  },
}

export default nextConfig
