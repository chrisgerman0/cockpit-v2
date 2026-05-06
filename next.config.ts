import type { NextConfig } from 'next'

// In production, nginx fronts both apps under staxs.ai (v1 at /, v2 at /v2/).
// In dev, v2 runs on :3007 and v1 on :3005 — these rewrites let v2's relative
// fetch('/api/...') and fetch('/data/...') reach v1 without CORS plumbing.
// Skip /api/admin/system-health since v2 ships its own copy of that route.
const STAXS_LANDING = process.env.STAXS_LANDING_ORIGIN || 'http://localhost:3005'

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Served at staxs.ai/v2/* via nginx — nginx forwards requests with the /v2
  // prefix intact, so Next.js needs basePath to recognise its own routes.
  basePath: '/v2',
  // Allow HMR + dev assets when v2 is reached via the staxs.ai nginx proxy.
  allowedDevOrigins: ['staxs.ai', 'www.staxs.ai'],
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
    ]
  },
}

export default nextConfig
