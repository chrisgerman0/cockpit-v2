'use client'

/**
 * Social sub-tab panels for the admin cockpit:
 *   - SocialDispatchPanel — queue review (Approve / Reject / Dispatch),
 *     ports /admin-social/page.tsx into v2 design.
 *   - SocialGalleryPanel  — trade-card gallery (raw bg images + rendered
 *     samples via /api/trade-card).
 *
 * Both replace earlier link-out cards. No iframes — fully native v2.
 */

import { useCallback, useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api'

// ════════════════════════════════════════════════════════════════════════════
// Social Dispatch — queue review + actions
// ════════════════════════════════════════════════════════════════════════════

type Post = {
  id: string
  content_type: string
  source_ref: string | null
  status: string
  image_url: string | null
  captions: Record<string, string>
  channels: string[]
  channels_posted: string[] | null
  channels_failed: string[] | null
  errors: any
  post_urls: any
  metadata: any
  created_at: string
  approved_at: string | null
  rejected_at: string | null
  rejected_reason: string | null
  dispatched_at: string | null
  posted_at: string | null
}

type QueueResp = { posts: Post[] }

const STATUSES = ['pending', 'approved', 'dispatching', 'posted', 'failed', 'rejected', 'all'] as const
type Status = typeof STATUSES[number]

function statusTone(s: string) {
  if (s === 'posted') return { bg: 'rgba(var(--pos-rgb), 0.12)', fg: 'var(--pos)', border: 'rgba(var(--pos-rgb), 0.4)' }
  if (s === 'pending') return { bg: 'rgba(212,160,23,0.12)', fg: 'var(--gold)', border: 'rgba(212,160,23,0.4)' }
  if (s === 'failed' || s === 'rejected') return { bg: 'rgba(var(--neg-rgb), 0.12)', fg: 'var(--neg)', border: 'rgba(var(--neg-rgb), 0.4)' }
  if (s === 'dispatching') return { bg: 'rgba(93,177,255,0.12)', fg: '#5db1ff', border: 'rgba(93,177,255,0.4)' }
  if (s === 'approved') return { bg: 'rgba(var(--pos-rgb), 0.08)', fg: 'var(--pos)', border: 'rgba(var(--pos-rgb), 0.3)' }
  return { bg: 'rgba(255,255,255,0.05)', fg: 'var(--muted)', border: 'var(--line)' }
}

export function SocialDispatchPanel({ active }: { active: boolean }) {
  const [posts, setPosts] = useState<Post[]>([])
  const [status, setStatus] = useState<Status>('pending')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const json = await authedFetch<QueueResp>(`/api/admin/social/queue?status=${status}&limit=50`)
      setPosts(json.posts || [])
    } catch (e: any) {
      // The legacy 403 path — hint the actual cause.
      const msg = e?.message?.includes('403') ? 'Forbidden — your account is not admin.' : (e?.message || 'Load failed')
      setErr(msg); setPosts([])
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    if (!active) return
    load()
  }, [active, load])

  const act = async (postId: string, endpoint: 'approve' | 'reject' | 'dispatch', body?: any) => {
    setBusyId(postId); setErr(null)
    try {
      // Action endpoints are POST. Use authedFetch for the bearer + JSON.
      await authedFetch(`/api/admin/social/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ postId, ...(body || {}) }),
      })
      await load()
    } catch (e: any) {
      setErr(e?.message || `${endpoint} failed`)
    } finally {
      setBusyId(null)
    }
  }
  const approve = (id: string) => act(id, 'approve')
  const reject = (id: string) => {
    const reason = prompt('Reason for rejection?') || ''
    act(id, 'reject', { reason })
  }
  const dispatchNow = (id: string) => {
    if (!confirm('Dispatch this post now to all channels?')) return
    act(id, 'dispatch')
  }

  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="bt-eyebrow">SOCIAL · QUEUE</div>
          <h1 className="bt-title">Review &amp; <span className="bt-title-gold">dispatch.</span></h1>
          <p className="bt-blurb">AI-generated posts awaiting human review before they hit Instagram / X / Telegram. Approve to queue · Reject to kill · Dispatch now to push to live channels.</p>
        </div>
        <button type="button" className="adm-icon-btn" disabled={loading} onClick={load} title="Refresh">↻</button>
      </div>

      <div className="bt-tier-pills" style={{ marginBottom: 12 }}>
        {STATUSES.map(s => (
          <button
            key={s}
            type="button"
            className={'bt-tier-pill' + (status === s ? ' active' : '')}
            onClick={() => setStatus(s)}
          >{s}</button>
        ))}
      </div>

      {err && <div className="adm-error">{err}</div>}

      {!err && !loading && posts.length === 0 && (
        <div className="card card-pad">
          <div className="adm-empty">No posts in status <code>{status}</code>.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {posts.map(p => {
          const isPending = p.status === 'pending'
          const isApproved = p.status === 'approved'
          const isFailed = p.status === 'failed'
          const tone = statusTone(p.status)
          return (
            <div key={p.id} className="card card-pad adm-soc-card">
              <div className="adm-soc-row">
                <a className="adm-soc-imgwrap" href={p.image_url || '#'} target="_blank" rel="noreferrer">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="adm-soc-img" />
                  ) : (
                    <div className="adm-soc-img adm-soc-img-empty">no image</div>
                  )}
                </a>

                <div className="adm-soc-meta">
                  <div className="adm-soc-meta-head">
                    <code className="adm-code">{p.content_type}</code>
                    <span
                      className="badge"
                      style={{ background: tone.bg, color: tone.fg, borderColor: tone.border }}
                    >{p.status}</span>
                    <span className="adm-mono-sm" style={{ color: 'var(--muted-2)' }}>
                      {new Date(p.created_at).toLocaleString()}
                    </span>
                    {p.channels?.length ? (
                      <span className="adm-stat-sub">→ {p.channels.join(', ')}</span>
                    ) : null}
                  </div>

                  {p.source_ref && (
                    <div className="adm-mono-sm" style={{ color: 'var(--muted-2)', marginBottom: 8 }}>{p.source_ref}</div>
                  )}

                  {(['instagram_en', 'twitter_en', 'telegram_en'] as const).map(key => {
                    const cap = p.captions?.[key]
                    if (!cap) return null
                    const label = key.replace('_en', '').toUpperCase()
                    return (
                      <details key={key} open className="adm-soc-cap">
                        <summary>{label}</summary>
                        <pre>{cap}</pre>
                      </details>
                    )
                  })}

                  {p.status === 'rejected' && p.rejected_reason && (
                    <div className="adm-soc-rejnote">
                      <strong>Rejected:</strong> {p.rejected_reason}
                    </div>
                  )}

                  <div className="adm-soc-actions">
                    {isPending && (
                      <>
                        <button type="button" className="adm-btn adm-btn-pos" disabled={busyId === p.id} onClick={() => approve(p.id)}>Approve</button>
                        <button type="button" className="adm-btn adm-btn-neg-outline" disabled={busyId === p.id} onClick={() => reject(p.id)}>Reject</button>
                      </>
                    )}
                    {(isApproved || isFailed) && (
                      <button type="button" className="adm-btn adm-btn-gold" disabled={busyId === p.id} onClick={() => dispatchNow(p.id)}>
                        {isFailed ? 'Retry dispatch' : 'Dispatch now'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Social Gallery — trade-card backgrounds + rendered samples
// ════════════════════════════════════════════════════════════════════════════

const WIN_BGS = [
  { src: '/trade-cards/bg-win-1.png', name: '💪 1 — Jacked Rock', file: 'bg-win-1.png' },
  { src: '/trade-cards/bg-win-2.png', name: '🥂 2 — Gatsby',      file: 'bg-win-2.png' },
  { src: '/trade-cards/bg-win-3.png', name: '🏎️ 3 — Lambo',      file: 'bg-win-3.png' },
  { src: '/trade-cards/bg-win-4.png', name: '👑 4 — King',        file: 'bg-win-4.png' },
]

const LOSS_BGS = [
  { src: '/trade-cards/bg-loss-0.png', name: '😈 0 — Original Moody Floor', file: 'bg-loss-0.png' },
  { src: '/trade-cards/bg-loss-1.png', name: '🌧️ 1 — Film Noir Rain',      file: 'bg-loss-1.png' },
  { src: '/trade-cards/bg-loss-2.png', name: '🥊 2 — Boxing Gym',           file: 'bg-loss-2.png' },
]

const WIN_RENDERED = [
  { url: '/api/trade-card?side=SHORT&pnl=1367&pnlPct=3.42&ref=CHRIS&bg=1', name: '💪 Jacked Rock' },
  { url: '/api/trade-card?side=LONG&pnl=2841&pnlPct=7.10&ref=CHRIS&bg=2',  name: '🥂 Gatsby' },
  { url: '/api/trade-card?side=SHORT&pnl=956&pnlPct=2.39&ref=CHRIS&bg=3',  name: '🏎️ Lambo' },
  { url: '/api/trade-card?side=LONG&pnl=1803&pnlPct=4.51&ref=CHRIS&bg=4',  name: '👑 King' },
]

const LOSS_RENDERED = [
  { url: '/api/trade-card?side=LONG&pnl=-1636&pnlPct=-4.09&ref=CHRIS',  name: 'Random loss bg' },
  { url: '/api/trade-card?side=SHORT&pnl=-800&pnlPct=-2.00&ref=CHRIS',  name: 'Random loss bg' },
]

type GallerySection = 'wins-raw' | 'losses-raw' | 'wins-rendered' | 'losses-rendered'

export function SocialGalleryPanel({ active: _active }: { active: boolean }) {
  const [section, setSection] = useState<GallerySection>('wins-rendered')
  // Cache-buster for rendered images (so re-rolling regenerates without a hard refresh)
  const [seed, setSeed] = useState(() => Date.now())

  const items =
    section === 'wins-raw'      ? WIN_BGS
    : section === 'losses-raw'  ? LOSS_BGS
    : section === 'wins-rendered'  ? WIN_RENDERED.map(r => ({ src: r.url + '&seed=' + seed, name: r.name, file: '' }))
    :                              LOSS_RENDERED.map(r => ({ src: r.url + '&seed=' + seed, name: r.name, file: '' }))

  const isRendered = section === 'wins-rendered' || section === 'losses-rendered'

  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="bt-eyebrow">SOCIAL · GALLERY</div>
          <h1 className="bt-title">Trade card <span className="bt-title-gold">backgrounds.</span></h1>
          <p className="bt-blurb">Raw scene PNGs and live-rendered samples. Rendered cards pull through <code>/api/trade-card</code> with overlay text.</p>
        </div>
        {isRendered && (
          <button type="button" className="adm-icon-btn" onClick={() => setSeed(Date.now())} title="Reroll rendered samples">↻</button>
        )}
      </div>

      <div className="bt-tier-pills" style={{ marginBottom: 12 }}>
        <button type="button" className={'bt-tier-pill' + (section === 'wins-rendered' ? ' active' : '')} onClick={() => setSection('wins-rendered')}>🏆 Wins · rendered</button>
        <button type="button" className={'bt-tier-pill' + (section === 'losses-rendered' ? ' active' : '')} onClick={() => setSection('losses-rendered')}>😤 Losses · rendered</button>
        <button type="button" className={'bt-tier-pill' + (section === 'wins-raw' ? ' active' : '')} onClick={() => setSection('wins-raw')}>🏆 Wins · raw</button>
        <button type="button" className={'bt-tier-pill' + (section === 'losses-raw' ? ' active' : '')} onClick={() => setSection('losses-raw')}>😤 Losses · raw</button>
      </div>

      <div className="adm-gallery-grid">
        {items.map((it, i) => (
          <div key={i} className="card adm-gallery-card">
            <img src={it.src} alt={it.name} className="adm-gallery-img" loading="lazy" />
            <div className="adm-gallery-label">
              <div className="adm-gallery-name">{it.name}</div>
              {it.file && <div className="adm-gallery-file">{it.file}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="adm-stat-sub" style={{ marginTop: 12, textAlign: 'center' }}>
        Source images: <code className="adm-code">/public/trade-cards/bg-{'{win,loss}'}-N.png</code> · Renderer: <code className="adm-code">/api/trade-card</code> with overlay text
      </div>
    </div>
  )
}
