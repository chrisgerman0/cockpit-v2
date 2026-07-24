'use client'

// LIVE-ENGINE-STATUS banner (2026-06-17). Display-only, ADMIN-ONLY. Makes a live
// halt impossible to miss (Chris had the alpha engine paused since 12:10Z with no
// indicator anywhere). Reads REAL engine state from /api/admin/system-status
// (guards.json paused_global/reasons/cfgs + daemon liveness) — never a guess.
// Renders nothing for non-admins (the alpha engine state is owner-facing, and we
// must never alarm a customer about their own bot).

import { useEffect, useState } from 'react'
import { useIsAdmin } from '@/lib/use-is-admin'
import { authedFetch } from '@/lib/api'

type EngineState = 'ACTIVE' | 'PAUSED' | 'DOWN'
type S = {
  state: EngineState
  reason?: string | null
  message?: string | null
  since?: number | null
  pausedCfgs?: number
  held?: number
}

function fmtSince(ms?: number | null): string {
  if (!ms) return ''
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000))
  const ago = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')}Z (${ago} ago)`
}

export function LiveEngineStatusBanner() {
  const { isAdmin } = useIsAdmin()
  const [s, setS] = useState<S | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    const load = async () => {
      try {
        const r = await authedFetch<any>('/api/admin/system-status')
        const live = r?.engine?.live
        if (!alive || !live) return
        // DOWN needs a grace: the daemon is briefly absent during the :15-:45 restart
        // (kill→relaunch ~8s), but its state file (last_processed) stays fresh. Require
        // process-missing AND state stale >3min so a normal restart can't flash a false alarm.
        const state: EngineState = (!live.alive && (live.state_age_min ?? 999) > 3)
          ? 'DOWN'
          : (live.paused_global || live.shutdown ? 'PAUSED' : 'ACTIVE')
        setS({
          state,
          reason: live.paused_reason,
          message: live.paused_message,
          since: live.paused_since_ms,
          pausedCfgs: live.paused_cfgs_count,
          held: live.held_count,
        })
      } catch { /* keep last good state on a transient error */ }
    }
    load()
    const id = window.setInterval(load, 30000)
    return () => { alive = false; window.clearInterval(id) }
  }, [isAdmin])

  if (!isAdmin || !s) return null

  // 2026-07-06 (Chris): INVERTED — a HEALTHY live engine is the normal state and
  // needs no banner (the subtle green strip just wasted vertical space + read as
  // noise). Render ONLY the abnormal states (DOWN / PAUSED) prominently below, so
  // the banner's presence itself is the alarm. Same health-check source as before.
  if (s.state === 'ACTIVE') return null

  const down = s.state === 'DOWN'
  return (
    <>
      <style>{`@keyframes staxLivePulse{0%,100%{opacity:1}50%{opacity:.72}}`}</style>
      <div style={{
        position: 'sticky', top: 0, zIndex: 300,
        background: down ? '#7f1d1d' : '#b45309', color: '#fff',
        padding: '10px 16px', fontSize: 14, fontWeight: 700,
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        borderBottom: '2px solid rgba(0,0,0,0.35)',
        animation: 'staxLivePulse 1.6s ease-in-out infinite',
      }}>
        <span style={{ fontSize: 18 }}>⚠</span>
        <span>{down ? 'LIVE ENGINE DOWN — daemon not running' : 'LIVE ENGINE PAUSED — new entries blocked'}</span>
        {!down && s.reason && <span style={{ fontWeight: 600, opacity: 0.95 }}>· {s.reason}</span>}
        {!down && s.since && <span style={{ fontWeight: 500, opacity: 0.85 }}>· since {fmtSince(s.since)}</span>}
        {!down && typeof s.held === 'number' && (
          <span style={{ fontWeight: 500, opacity: 0.85 }}>· {s.held} held, no new entries since pause</span>
        )}
        {!down && !!s.pausedCfgs && <span style={{ fontWeight: 500, opacity: 0.7 }}>· {s.pausedCfgs} cfgs paused</span>}
      </div>
    </>
  )
}
