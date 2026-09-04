'use client'
/**
 * LANE CONTROL — replaces the Health tab.
 *
 * THE PRODUCT IS ONE NUMBER: does LIVE have the same number of FREE LANES as canonical?
 * That decides whether live can take the trades canonical takes. Everything else supports it.
 *
 * Design language matches Backtesting / CFG Discovery: card card-pad, adm-stat-label,
 * adm-h-val, adm-stat-sub, bt-eyebrow, adm-table, num. Not a bespoke look.
 */
import { useEffect, useMemo, useState } from 'react'
import { authedFetch } from '@/lib/api'

type Lane = {
  lane_id: number; cfg_sid: string | null; asset: string | null
  kind: 'REAL' | 'MIRROR' | 'PENDING' | null; qty: number | null; adopted: boolean; seat_ts_ms: number | null
  pending_since_ms?: number | null; pending_note?: string | null
}
type Row = { kind: 'MATCH' | 'CANON_ONLY' | 'LIVE_ONLY'; live: Lane | null; canon: { cfg_sid: string; asset: string } | null }
type SuperLane = {
  lane_id: number; occupied: boolean; cfg_sid: string | null; asset: string | null
  kind: string | null; tier_s: boolean | null; label: string; note: string
}
type Tier = {
  tier: string; lanes: number
  ordinary_lanes?: number
  super_lane?: SuperLane
  live: { occupied: number; free: number; n_lanes: number; ordinary_lanes?: number; occupied_total?: number } | null
  canon: { occupied: number; free: number; ordinary_lanes?: number; occupied_total?: number;
    super_lane_occupied?: boolean;
    // canonical publishes no seat assignment; false means 'render as unknown, never assert'
    super_lane_known?: boolean }
  state: 'MATCH' | 'MATCH_CARRIED_EXCLUDED' | 'CANONICAL_BEHIND' | 'CONTENDED'
    | 'SEATING_DIVERGENCE' | 'CAPACITY_SHORT' | 'LAG' | 'MISMATCH' | 'NO_LIVE_ACCOUNT'
  capacity_short?: boolean
  capacity_note?: string | null
  not_seen_sids?: string[]
  canon_age_sec?: number | null
  gate?: { computed_at: string | null; age_sec: number | null; holds: string[]; frozen: boolean } | null
  divergence_age_sec: number | null; maturity_sec: number
  computed_at: string | null; rows: Row[]
}
type Payload = {
  headline: { tier: string; live: any; canon: any; state: string; match: boolean }
  tiers: Tier[]
  timestamps: { now_ms: number; last_parity_check_ms: number | null; last_state_change_ms?: number | null; last_lane_write_ms: number | null; monitor_heartbeat: string | null }
  canonical_freshness?: {
    computed_at: string | null; age_sec: number | null; stale: boolean
    served_from_lkg: boolean; publisher_halted: boolean; halt_reason: string | null
    consecutive_fails: number; last_publish_outcome: string | null; warning: string | null
    halt_note?: string | null
    last_refresh_at?: string | null; last_discard_at?: string | null
    last_discard_position?: string | null; discard_is_current_cause?: boolean
    cycles_behind?: number | null
  }
  history?: { ts: string | null; resolved: boolean; text: string }[]
  state_held_since_ms?: number | null
}

const ENDPOINT = '/api/admin/lane-control'

const dur = (ms: number | null, now: number) => {
  if (!ms) return '—'
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  const h = Math.floor(s / 3600)
  return h < 48 ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(h / 24)}d`
}

export default function LaneControlPanel({ active }: { active: boolean }) {
  const [d, setD] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let stop = false
    const load = async () => {
      try {
        // authedFetch returns the PARSED BODY, not a Response, and throws on non-2xx with
        // "<status> <statusText>: <text>". Treating it as a Response is what rendered
        // "unavailable: undefined" — r.ok was undefined so it threw Error(undefined).
        const j = await authedFetch<Payload>(ENDPOINT)
        if (!j || !j.headline) throw new Error(`malformed payload from ${ENDPOINT}`)
        if (!stop) { setD(j); setErr(null) }
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : (e ? String(e) : 'unknown error (no message)')
        if (!stop) setErr(`${ENDPOINT} — ${msg}`)
      }
    }
    load()
    const t = setInterval(load, 30_000)
    return () => { stop = true; clearInterval(t) }
  }, [active])

  // HISTORY: collapse consecutive identical states into one line. Eight red dots all saying
  // "clean" is noise, not history — and red on a healthy book reads as alarming when it is fine.
  // The endpoint now emits TRANSITIONS ONLY (it used to return every ~5min log line, and
  // classified the monitor's own `clean:` line as a failure — a healthy book rendered as
  // eight red dots). Nothing to collapse here any more; pass them through unchanged, and
  // keep the guard against two consecutive same-direction entries in case the log repeats.
  const history = useMemo(() => {
    const h: any[] = (d?.history as any[]) ?? []
    return h.filter((e, i) => i === 0 || e.resolved !== h[i - 1].resolved)
  }, [d])

  if (err) return (
    <div className="card card-pad" style={{ borderLeft: '4px solid var(--neg, #dc2626)' }}>
      <div className="bt-eyebrow" style={{ color: 'var(--neg, #dc2626)' }}>LANE CONTROL UNAVAILABLE</div>
      <div className="adm-p" style={{ marginTop: 6, wordBreak: 'break-word' }}>{err}</div>
      <div className="adm-p adm-p-sm adm-p-muted" style={{ marginTop: 8 }}>
        <code>/api</code> is served by staxs-landing; this panel by staxs-dashboard-v2 under
        <code> /v2</code>. A 404 means landing was not rebuilt since the route was added; 401/403
        means the admin session did not reach it.
      </div>
    </div>
  )
  if (!d) return <div className="card card-pad"><div className="adm-p adm-p-muted">Loading lane parity…</div></div>

  const now = d.timestamps.now_ms
  const liveTier = d.headline.tier
  const cur = d.tiers.find(t => t.tier === (sel ?? liveTier)) ?? d.tiers[0]
  const isLiveTier = cur.tier === liveTier
  // 2026-09-03 (Chris, HD1): three states, named in words. The panel used to render RED for all
  // three — "in sync", "canonical has not seen this bar yet", and "genuinely diverged" looked
  // identical. On 2026-09-03 that turned an 18-minute publish delay into hours of divergence
  // hunting. `CANONICAL_BEHIND` means the live lane's bar closed AFTER canonical last computed:
  // canonical has not judged it, so there is nothing to disagree about yet.
  const ok = cur.state === 'MATCH' || cur.state === 'MATCH_CARRIED_EXCLUDED'
  const behind = cur.state === 'CANONICAL_BEHIND'
  const lag = cur.state === 'LAG'
  // 2026-09-04 (Chris, TB4): a FIFTH state. The API has been returning CONTENDED since the
  // forward-guard fix, but this component only knew MATCH / CANONICAL_BEHIND / LAG, so CONTENDED
  // fell through to red DIVERGED and the screen still said "live cannot mirror canonical — needs
  // action" for a difference that is one cfg in one lane and fully understood. Fixing the API
  // without teaching the panel the word is why this looked unfixed three times.
  const seating = cur.state === 'CONTENDED' || cur.state === 'SEATING_DIVERGENCE'
  // 2026-09-04: the books can AGREE while live still cannot act on them. An off-book position is
  // real money in a real lane, so it costs capacity until it exits — and a missed entry is a
  // worse outcome for Chris than a book disagreement. Rendered RED, never green.
  const capShort = cur.state === 'CAPACITY_SHORT'
  // §OFF-BOOK-POSITION: a lane Chris has declared off the BOOK. Still managed to its exit and
  // still shown here with its reason — it is simply not counted in lane parity, exactly like a
  // carried lane. Excluding it from the comparison is the point; hiding it would not be.
  const offbook: any[] = (cur as any).offbook ?? []
  const tone = ok ? 'var(--pos, #16a34a)'
    : capShort ? 'var(--neg, #dc2626)'
    : (behind || lag || seating) ? 'var(--warn, #d97706)' : 'var(--neg, #dc2626)'
  const verdictWord = ok ? 'IN SYNC'
    : capShort ? 'LANE SHORT'
    : behind ? 'CANONICAL BEHIND'
    : seating ? 'SEATING DIVERGENCE'
    : lag ? 'PROPAGATING' : 'DIVERGED'
  const ageTxt = (n?: number | null) =>
    (n == null ? 'unknown age'
      : n < 90 ? `${n}s ago`
      : n < 5400 ? `${Math.round(n / 60)}m ago`
      : `${(n / 3600).toFixed(1)}h ago`)
  const liveFree = cur.live?.free
  const canonFree = cur.canon?.free
  const mr: any = (cur as any).mirror_release
  const mrTone = !mr || mr.stale === 0 ? 'var(--pos, #16a34a)' : 'var(--neg, #dc2626)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── TIER SWITCHER. His live tier default and marked; he may move to kamikaze. ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {d.tiers.map(t => {
          const on = t.tier === cur.tier
          return (
            <button key={t.tier} onClick={() => setSel(t.tier)}
              style={{
                padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13,
                fontWeight: on ? 700 : 500, textTransform: 'capitalize',
                border: `1px solid ${on ? tone : 'var(--border, rgba(0,0,0,.14))'}`,
                background: on ? tone : 'transparent',
                color: on ? '#fff' : 'inherit', opacity: on ? 1 : .75,
              }}>
              {t.tier}
              {t.tier === liveTier && (
                <span style={{
                  marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: .5,
                  padding: '1px 5px', borderRadius: 4,
                  background: on ? 'rgba(255,255,255,.25)' : 'var(--pos, #16a34a)',
                  color: '#fff',
                }}>LIVE</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── THE STATUS CARD. The FREE number dominates; it is what he glances at. ── */}
      <div className="card card-pad" style={{ borderLeft: `4px solid ${tone}` }}>
        <div className="bt-eyebrow" style={{ color: tone }}>
          {ok ? 'IN PARITY' : lag ? 'PUBLISH LAG' : cur.state === 'NO_LIVE_ACCOUNT' ? 'NO LIVE ACCOUNT' : 'OUT OF PARITY'}
          {' · '}{cur.tier.toUpperCase()}
        </div>

        {cur.live ? (
          <>
            <div className="row row-stats" style={{ marginTop: 4 }}>
              <div>
                <div className="adm-stat-label">Live free lanes</div>
                <div className="adm-h-val num" style={{ color: tone }}>{liveFree}</div>
                <div className="adm-stat-sub">{cur.live.occupied} of {cur.ordinary_lanes ?? cur.live.n_lanes} occupied</div>
              </div>
              <div>
                <div className="adm-stat-label">Canonical free lanes</div>
                <div className="adm-h-val num">{canonFree}</div>
                <div className="adm-stat-sub">{cur.canon.occupied} of {cur.canon.ordinary_lanes ?? cur.lanes} occupied</div>
              </div>
              <div>
                <div className="adm-stat-label">Verdict</div>
                <div className="adm-h-val" style={{ color: tone, fontSize: '1.4rem' }}>
                  {verdictWord}
                </div>
                <div className="adm-stat-sub">
                  {capShort ? (cur.capacity_note ?? 'live has fewer free lanes than canonical — it will miss the next entry')
                    : ok ? 'live can take what canonical takes'
                    : behind ? `canonical has not seen this bar yet — it last computed ${ageTxt(cur.canon_age_sec)}`
                    : seating ? 'same capacity, different cfg in one lane — live seats by arrival, '
                        + 'canonical by pool index. Both books are correct; nothing to do.'
                    : lag ? `${cur.divergence_age_sec}s old — inside the ${Math.round(cur.maturity_sec / 60)}m publish window`
                      : 'live cannot mirror canonical — needs action'}
                </div>
              </div>
            </div>
            <div className="adm-p adm-p-sm adm-p-muted" style={{ marginTop: 10 }}>
              {/* GD4: the verdict uses the FORWARD book; the gating surface is shown as its own
                  line so a frozen gate is a visible fact instead of silently becoming the
                  comparison — which is exactly what it did on 2026-09-03. */}
              {cur.gate?.frozen ? (
                <div style={{ marginBottom: 6, color: 'var(--neg, #dc2626)' }}>
                  <b>The gating surface is FROZEN</b> — the engine gates on a book computed{' '}
                  {ageTxt(cur.gate.age_sec)} holding {cur.gate.holds.length} position(s). The forward
                  book below is current; the gate advances only when a forward publish is accepted.
                </div>
              ) : null}
              Comparing against the FORWARD canonical book computed {ageTxt(cur.canon_age_sec)}
              {cur.computed_at ? ` (${cur.computed_at.replace('T', ' ').slice(0, 19)}Z)` : ''}
              {(cur.not_seen_sids?.length ?? 0) > 0
                ? ` · canonical has not judged ${cur.not_seen_sids!.length} live lane(s) yet: ${cur.not_seen_sids!.join(', ')}`
                : ''}
              <br />
              Checked {dur(d.timestamps.last_parity_check_ms, now)} ago · last lane action{' '}
              {dur(d.timestamps.last_lane_write_ms, now)} ago
              {d.timestamps.last_state_change_ms
                ? ` · unchanged for ${dur(d.timestamps.last_state_change_ms, now)}` : ''}
            </div>
            {/* Every timestamp above describes the LIVE side. If the canonical book itself is
                stale the verdict above is about yesterday's canonical, and saying nothing makes
                this panel lie — which is exactly what it did on 2026-08-26. */}
            {/* 2026-08-29 — THE HALT IS CONTEXT, NOT AN ALARM. The amber banner used to fire on
                `publisher_halted` alone, and that flag has been true continuously since the
                operator halt of 2026-08-27 — so it rendered on EVERY load, including when the
                canonical book was perfectly fresh, and then blamed the halt for a staleness that
                did not exist. A warning that is always on teaches you to ignore it. The halt now
                states itself, neutrally, and the amber banner is reserved for a book that is
                genuinely behind. */}
            {d.canonical_freshness?.halt_note && (
              <div
                className="adm-p adm-p-sm"
                style={{
                  marginTop: 8, padding: '8px 10px', borderRadius: 6,
                  border: '1px solid var(--border, #d4d4d8)', color: 'var(--muted, #71717a)',
                  background: 'transparent',
                }}
              >
                {d.canonical_freshness.halt_note}
              </div>
            )}
            {d.canonical_freshness?.warning && (
              <div
                className="adm-p adm-p-sm"
                style={{
                  marginTop: 8, padding: '8px 10px', borderRadius: 6,
                  border: '1px solid var(--warn, #d97706)', color: 'var(--warn, #d97706)',
                  background: 'color-mix(in srgb, var(--warn, #d97706) 8%, transparent)',
                }}
              >
                <b>CANONICAL BOOK STALE — the comparison above is not current.</b>
                <div style={{ marginTop: 4 }}>{d.canonical_freshness.warning}</div>
                <div style={{ marginTop: 4, opacity: 0.85 }}>
                  computed_at {d.canonical_freshness.computed_at ?? 'unknown'}
                  {d.canonical_freshness.consecutive_fails > 0
                    ? ` · ${d.canonical_freshness.consecutive_fails} consecutive validation failure${d.canonical_freshness.consecutive_fails === 1 ? '' : 's'}`
                    : ''}
                </div>
                {d.canonical_freshness.last_publish_outcome && (
                  <div style={{ marginTop: 4, opacity: 0.7, fontFamily: 'var(--mono, monospace)', fontSize: '0.85em' }}>
                    {d.canonical_freshness.last_publish_outcome}
                  </div>
                )}
                {d.canonical_freshness.last_refresh_at && (
                  <div style={{ marginTop: 4, opacity: 0.85 }}>
                    last good forward refresh {d.canonical_freshness.last_refresh_at}
                    {d.canonical_freshness.cycles_behind != null && d.canonical_freshness.cycles_behind > 0
                      ? ` · ${d.canonical_freshness.cycles_behind} publish cycle${d.canonical_freshness.cycles_behind === 1 ? '' : 's'} behind`
                      : ''}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="adm-p" style={{ marginTop: 6 }}>
            Canonical holds <b className="num">{cur.canon.occupied}</b> of {cur.canon.ordinary_lanes ?? cur.lanes} ordinary lanes
            ({cur.canon.free} free). No live account trades this tier, so there is nothing to
            compare — switch to <b style={{ textTransform: 'capitalize' }}>{liveTier}</b> for parity.
          </div>
        )}
      </div>

      {/* ── LANE TABLE. Aligned, LIVE | CANON split, row-level match indicator. ── */}
      <div className="card card-pad">
        <div className="bt-eyebrow">LANES · {cur.tier.toUpperCase()}</div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="adm-table" style={{ width: '100%', minWidth: 460 }}>
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: 'center' }} />
                <th style={{ textAlign: 'left' }}>Live</th>
                <th style={{ width: 88, textAlign: 'center' }}>Backing</th>
                <th style={{ textAlign: 'right' }}>Canonical</th>
              </tr>
            </thead>
            <tbody>
              {/* 2026-09-02 (Chris) — THE SUPER LANE IS ALWAYS ITS OWN ROW.
                  It is not a regular lane: only a protected (Tier-S) strategy can take it, so it
                  is excluded from the ordinary free-lane counts above and shown here on its own,
                  empty or not. An empty super lane is normal and must not read as a missing lane. */}
              {cur.super_lane && (
                <tr style={{
                  background: cur.super_lane.occupied ? 'rgba(212,160,23,0.14)' : 'rgba(212,160,23,0.06)',
                  borderTop: '2px solid rgba(212,160,23,0.45)',
                  borderBottom: '2px solid rgba(212,160,23,0.45)',
                }}>
                  <td style={{ textAlign: 'center' }} title={cur.super_lane.note}>
                    {cur.super_lane.occupied ? '★' : '☆'}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <b style={{ color: 'var(--gold)', letterSpacing: 0.4 }}>SUPER LANE</b>
                    <span style={{ opacity: 0.65, fontSize: 11 }}> · lane {cur.super_lane.lane_id} · Tier-S only</span>
                    {cur.super_lane.occupied && (
                      <div style={{ fontSize: 12 }}>
                        <b>{cur.super_lane.asset}</b>{' '}
                        <span style={{ opacity: 0.7 }}>{cur.super_lane.cfg_sid}</span>
                        {cur.super_lane.tier_s === false && (
                          <b style={{ color: 'var(--neg, #dc2626)' }}> — NOT Tier-S, the reservation is not being honoured</b>
                        )}
                      </div>
                    )}
                    {!cur.super_lane.occupied && (
                      <div style={{ fontSize: 11.5, opacity: 0.7 }}>Empty and waiting — an ordinary signal can never take it.</div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {cur.super_lane.occupied
                      ? <span className="adm-pill" style={{ borderColor: 'rgba(212,160,23,0.5)', color: 'var(--gold)' }}>{cur.super_lane.kind ?? 'HELD'}</span>
                      : <span style={{ opacity: 0.5, fontSize: 11 }}>—</span>}
                  </td>
                  {/* right-aligned to sit directly above the cfg in the ordinary rows below */}
                  <td style={{ textAlign: 'right', opacity: 0.85 }}>
                    {/* Canonical publishes NO seat assignment — its rows carry no lane id. The
                        panel used to infer "in use" from the presence of any Tier-S cfg and printed
                        it above a table listing six canonical holdings while claiming five. An
                        unknown must render as unknown. */}
                    {cur.canon?.super_lane_known === false
                      ? <span style={{ opacity: 0.6 }}>not published by canonical</span>
                      : cur.canon?.super_lane_occupied
                        ? <span style={{ color: 'var(--gold)' }}>reserved seat in use</span>
                        : <span style={{ opacity: 0.6 }}>reserved seat free</span>}
                  </td>
                </tr>
              )}
              {cur.rows.filter((r: any) => !(cur.super_lane?.cfg_sid && r.live?.cfg_sid === cur.super_lane.cfg_sid))
                       .map((r: any, i: number) => {
                const k = r.kind ?? (r.live && r.canon ? 'MATCH' : r.canon ? 'CANON_ONLY' : 'LIVE_ONLY')
                const bad = k !== 'MATCH'
                const c = k === 'CANON_ONLY' ? 'var(--neg, #dc2626)' : 'var(--warn, #d97706)'
                return (
                  <tr key={i} style={bad ? { background: k === 'CANON_ONLY' ? 'rgba(220,38,38,.07)' : 'rgba(217,119,6,.09)' } : undefined}>
                    <td style={{ textAlign: 'center', color: bad ? c : 'var(--pos, #16a34a)', fontWeight: 700 }}>
                      {bad ? '!' : '✓'}
                    </td>
                    <td>
                      {r.live?.cfg_sid
                        ? <><b>{r.live.asset}</b> <span className="adm-mono-sm adm-p-muted">{r.live.cfg_sid}</span></>
                        : <span style={{ color: c, fontWeight: 600 }}>live is missing this</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.live?.kind === 'REAL' && (
                        <span style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: .6, padding: '3px 8px',
                          borderRadius: 4, background: 'var(--pos, #16a34a)', color: '#fff',
                        }}>REAL</span>
                      )}
                      {/* 2026-08-28: a resting LIMIT ENTRY is neither REAL nor MIRROR. It used to
                          show as REAL because qty>0 was read as money — but a pending limit carries
                          its INTENDED size, so a lane owning no position looked like a phantom. */}
                      {r.live?.kind === 'PENDING' && (
                        <span title={r.live.pending_note ?? undefined}
                              style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: .6, padding: '2px 7px',
                          borderRadius: 4, border: '1px solid #2563eb',
                          color: '#2563eb', background: 'rgba(37,99,235,0.10)',
                        }}>PENDING FILL</span>
                      )}
                      {r.live?.kind === 'MIRROR' && (
                        <span style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: .6, padding: '2px 7px',
                          borderRadius: 4, border: '1px dashed var(--warn, #d97706)',
                          color: 'var(--warn, #d97706)', background: 'transparent',
                        }}>MIRROR</span>
                      )}
                      {/* §OFF-BOOK-POSITION: managed to its exit, excluded from lane parity.
                          Shown, not hidden — the exclusion is from the COUNT, not from view. */}
                      {offbook.some((o: any) => o.cfg_sid === r.live?.cfg_sid) && (
                        <span title={(offbook.find((o: any) => o.cfg_sid === r.live?.cfg_sid) || {}).reason || ''}
                          style={{
                            marginLeft: 6, fontSize: 10, fontWeight: 800, letterSpacing: .6,
                            padding: '2px 7px', borderRadius: 4,
                            border: '1px dashed var(--ink-mute, #8a8a8a)',
                            color: 'var(--ink-mute, #8a8a8a)', background: 'transparent',
                          }}>OFF-BOOK</span>
                      )}
                    </td>
                    <td>
                      {r.canon
                        ? <><b>{r.canon.asset}</b> <span className="adm-mono-sm adm-p-muted">{r.canon.cfg_sid}</span></>
                        : offbook.some((o: any) => o.cfg_sid === r.live?.cfg_sid)
                          ? <span style={{ color: 'var(--ink-mute)' }}>off the book — not compared</span>
                        : (r.live?.kind === 'PENDING'
                            ? <span style={{ color: 'var(--ink-mute)' }}>
                                not yet — the limit has not filled, so canonical cannot hold it
                              </span>
                            : <span style={{ color: c, fontWeight: 600 }}>canonical does not hold this</span>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="adm-p adm-p-sm adm-p-muted" style={{ marginTop: 8 }}>
          <b>REAL</b> = Bitget money behind the lane. <b style={{ color: '#2563eb' }}>PENDING FILL</b> = a limit entry is resting and has <b>not</b> filled, so no Bitget position exists yet and both canonical and the customer app correctly show nothing — the lane is reserved while the order waits (0.15% away, up to 120 min). <b>MIRROR</b> = adopted occupancy holding a
          seat for a cfg canonical is in but live never filled.
        </div>
      </div>

      {/* ── MIRROR RELEASE. The invariant made visible: a mirror must drop AT THE MOMENT
             canonical closes its cfg, so both sides free the lane together and the free-lane
             counts never drift. A mirror canonical no longer holds is a seat live could be
             trading with. ── */}
      {mr && (
        <div className="card card-pad" style={{ borderLeft: `4px solid ${mrTone}` }}>
          <div className="bt-eyebrow" style={{ color: mrTone }}>MIRROR RELEASE</div>
          {mr.held === 0 ? (
            <div className="adm-p" style={{ marginTop: 4 }}>
              No occupancy mirrors held — every occupied lane has Bitget money behind it.
            </div>
          ) : mr.stale === 0 ? (
            /* "all still backed by an open canonical trade ... in step" is a claim about NOW,
               derived entirely from the canonical book. On 2026-08-26 that book was 1,198 minutes
               old and still listed a cfg that had closed hours earlier, so this sentence rendered
               as a present-tense fact that was false. A claim is only as current as its source:
               when the source is stale the claim is withheld and the age is shown instead. */
            d.canonical_freshness?.stale ? (
              <div className="adm-p" style={{ marginTop: 4 }}>
                <b className="num">{mr.in_sync}</b> mirror{mr.in_sync === 1 ? '' : 's'} held.{' '}
                <b style={{ color: 'var(--warn, #d97706)' }}>Cannot say whether they are in step</b>
                {' '}— that depends on the canonical book, which is{' '}
                <b className="num">
                  {d.canonical_freshness.age_sec !== null
                    ? Math.floor(d.canonical_freshness.age_sec / 60).toLocaleString()
                    : '?'}
                </b>{' '}minutes old. A mirror whose cfg canonical closed since then would look
                healthy here.
              </div>
            ) : (
              <div className="adm-p" style={{ marginTop: 4 }}>
                <b className="num">{mr.in_sync}</b> mirror{mr.in_sync === 1 ? '' : 's'} held, all
                still backed by an open canonical trade. Each will free its lane in the same
                moment canonical closes it — <b style={{ color: 'var(--pos, #16a34a)' }}>in step</b>.
              </div>
            )
          ) : (
            <>
              <div className="adm-p" style={{ marginTop: 4 }}>
                <b className="num" style={{ color: mrTone }}>{mr.stale}</b> of{' '}
                <b className="num">{mr.held}</b> mirrors are holding a lane for a cfg canonical
                has <b>already closed</b>. They should have dropped simultaneously; until they do,
                live is short {mr.stale} lane{mr.stale === 1 ? '' : 's'} that canonical can trade.
              </div>
              <div className="adm-p adm-p-sm" style={{ marginTop: 6 }}>
                {mr.stale_sids.map((s: any) => (
                  <div key={s.cfg_sid}>
                    <b>{s.asset}</b>{' '}
                    <span className="adm-mono-sm adm-p-muted">{s.cfg_sid}</span>
                  </div>
                ))}
                {mr.oldest_stale_sec != null && (
                  <div className="adm-p-muted" style={{ marginTop: 4 }}>
                    oldest seated {Math.floor(mr.oldest_stale_sec / 60)}m ago
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── HISTORY: state CHANGES only, collapsed. Not a repeated-line dump. ── */}
      <div className="card card-pad">
        <div className="bt-eyebrow">HISTORY</div>
        <div className="adm-p" style={{ marginTop: 4 }}>
          {ok ? 'Clean' : lag ? 'Lagging' : 'Diverged'}
          {d.state_held_since_ms ? <> — held <b>{dur(d.state_held_since_ms, now)}</b></> : ''}
        </div>
        {history.length ? (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.slice(0, 6).map((h: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{
                  flex: '0 0 auto', width: 8, height: 8, borderRadius: 5, marginTop: 6,
                  background: h.resolved ? 'var(--pos, #16a34a)' : 'var(--neg, #dc2626)',
                }} />
                <div style={{ minWidth: 0 }}>
                  <div className="adm-p adm-p-sm" style={{ wordBreak: 'break-word' }}>
                    {h.resolved ? 'Returned to parity' : 'Diverged'}
                    {h.held_sec != null && (
                      <span className="adm-p-muted">
                        {' '}· previous state held {h.held_sec < 3600
                          ? `${Math.round(h.held_sec / 60)}m`
                          : `${Math.floor(h.held_sec / 3600)}h ${Math.round((h.held_sec % 3600) / 60)}m`}
                      </span>
                    )}
                  </div>
                  <div className="adm-p adm-p-sm adm-p-muted" style={{ wordBreak: 'break-word' }}>
                    {h.ts ?? '—'}{!h.resolved && h.text ? ` — ${h.text}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="adm-p adm-p-sm adm-p-muted" style={{ marginTop: 6 }}>
            No state changes recorded — the book has stayed in parity for the whole retained log.
          </div>
        )}
        <div className="adm-p adm-p-sm adm-p-muted" style={{ marginTop: 10 }}>
          Transitions only. The monitor writes a line every ~5 minutes whether or not anything
          changed; listing those made a clean book look like a wall of incidents.
        </div>
      </div>

      <CronTimersStrip />
    </div>
  )
}

/**
 * The three recurring timers, judged by what they WROTE — never by process state.
 * A cron-type pm2 app reads "stopped" between fires; that is normal, and reading it as DOWN is a
 * mistake already made once against these exact timers. Age of the artifact each one touches every
 * run is the only thing that settles whether it is alive.
 */
function CronTimersStrip() {
  const [d, setD] = useState<any | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    const run = async () => {
      try {
        const j = await authedFetch<any>('/api/admin/cron-timers')
        if (!stop) { setD(j); setErr(null) }
      } catch (e: any) {
        if (!stop) setErr(e?.message ?? String(e))
      }
    }
    run()
    const id = setInterval(run, 60_000)
    return () => { stop = true; clearInterval(id) }
  }, [])

  if (err) return null
  if (!d?.timers) return null

  const fmtAge = (s: number | null) =>
    s === null ? '—' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`

  return (
    <div className="adm-card" style={{ marginTop: 12 }}>
      <div className="adm-card-title">— TIMERS</div>
      <div style={{ marginTop: 8 }}>
        {d.timers.map((t: any) => {
          const ok = t.state === 'OK'
          const color = ok ? 'var(--pos, #16a34a)' : 'var(--warn, #d97706)'
          return (
            <div
              key={t.name}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 0',
                borderBottom: '1px solid var(--hairline, rgba(128,128,128,0.18))',
              }}
            >
              <span style={{ color, fontWeight: 700, minWidth: 58 }}>{t.state}</span>
              <span style={{ fontWeight: 600, minWidth: 168 }}>{t.name}</span>
              <span className="num adm-p-sm adm-p-muted" style={{ minWidth: 104 }}>{t.schedule}</span>
              <span className="adm-p-sm" style={{ minWidth: 118 }}>
                last wrote <b className="num">{fmtAge(t.age_sec)}</b> ago
              </span>
              <span className="adm-p-sm adm-p-muted" style={{ flex: 1 }}>{t.what}</span>
            </div>
          )
        })}
      </div>
      <div className="adm-p adm-p-sm adm-p-muted" style={{ marginTop: 8 }}>
        Judged by the file each timer writes every run, not by process state — a cron-type pm2 app
        reads &ldquo;stopped&rdquo; between fires and that is normal. LATE = two fires missed.
      </div>
    </div>
  )
}
