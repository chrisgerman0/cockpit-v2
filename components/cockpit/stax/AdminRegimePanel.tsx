'use client'
/**
 * UQ3 — REGIME. Quarterly win rate, split long / short / both, plus the trade-level BTC-state
 * cross-tab behind it.
 *
 * THE THIRD LINE IS THE CONTROL. `both` is not decoration: if long and short mirror each other
 * while `both` sits flat between them, that is a directional regime signature. If all three swing
 * together it is market-wide noise and there is nothing directional to find. Without `both` the
 * chart cannot tell those two apart.
 *
 * SAMPLE SIZE IS THE GUARD. Every point carries its trade count — point radius scales with n and
 * the count strip under the chart shows it numerically — so a quarter with forty trades cannot
 * look like one with four hundred. Cross-tab cells below the floor are struck through, not hidden,
 * so a thin cell is visibly thin rather than quietly persuasive.
 *
 * NOTHING HERE IS OPTIMISED. The cross-tab is a table to read. No combination is scored or ranked.
 */
import React, { useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api'

type Cell = { n: number; wr: number | null; pf: number | null; net: number }
type Point = { quarter: string; both: Cell; long: Cell; short: Cell }
type Row = {
  criterion: string; bucket: string; both: Cell; long: Cell; short: Cell
  insufficient: { both: boolean; long: boolean; short: boolean }
}
type Data = {
  generated_at?: string
  basis?: any
  criteria?: string[]
  quarters?: string[]
  overall?: { both: Cell; long: Cell; short: Cell }
  series?: Record<string, Point[]>
  crosstab?: Row[]
}

const DIRS = [
  { k: 'both'  as const, label: 'Both',  color: '#e8e8e8' },
  { k: 'long'  as const, label: 'Long',  color: '#3fbf7f' },
  { k: 'short' as const, label: 'Short', color: '#e5734f' },
]

export function RegimePanel({ active }: { active: boolean }) {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string>('')
  const [criterion, setCriterion] = useState('all')
  const [show, setShow] = useState<Record<string, boolean>>({ both: true, long: true, short: true })

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      try {
        const j = await authedFetch<Data>('/api/admin/msga-leaderboard?strategy=regime',
          { cache: 'no-store' })
        if (!cancelled) setD(j)
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'fetch failed')
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [active])

  if (!active) return null
  if (loading) return <div style={{ padding: 20, opacity: 0.7 }}>Loading regime data…</div>
  if (err || !d?.series) {
    return <div style={{ padding: 20, color: '#e5734f' }}>
      Regime data not available{err ? ` — ${err}` : ''}. Run <code>uq3_regime.py</code>.
    </div>
  }

  const seriesKeys = ['all', ...Object.keys(d.series).filter(k => k !== 'all').sort()]
  const pts: Point[] = d.series[criterion] ?? d.series['all'] ?? []
  const shown = DIRS.filter(x => show[x.k])

  // ── chart geometry ────────────────────────────────────────────────────────────────────────
  const W = 980, H = 340, PADL = 46, PADR = 14, PADT = 16, PADB = 46
  const iw = W - PADL - PADR, ih = H - PADT - PADB
  const vals = pts.flatMap(p => shown.map(s => p[s.k].wr).filter((v): v is number => v !== null))
  const lo = vals.length ? Math.max(0, Math.floor((Math.min(...vals) - 4) / 5) * 5) : 40
  const hi = vals.length ? Math.min(100, Math.ceil((Math.max(...vals) + 4) / 5) * 5) : 80
  const x = (i: number) => PADL + (pts.length <= 1 ? iw / 2 : (i * iw) / (pts.length - 1))
  const y = (v: number) => PADT + ih - ((v - lo) / Math.max(hi - lo, 1e-9)) * ih
  const maxN = Math.max(1, ...pts.map(p => Math.max(p.both.n, p.long.n, p.short.n)))
  const rad = (n: number) => 1.8 + 4.2 * Math.sqrt(n / maxN)
  const ticks = Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5)

  const overall = d.overall
  const fmt = (v: number | null) => (v === null || v === undefined ? '—' : v.toFixed(2))

  const Toggle = ({ k, label, color }: { k: string; label: string; color: string }) => (
    <button
      onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
        borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        border: `1px solid ${show[k] ? color : 'rgba(255,255,255,0.18)'}`,
        background: show[k] ? `${color}22` : 'transparent',
        color: show[k] ? color : 'rgba(255,255,255,0.45)',
      }}>
      <span style={{ width: 9, height: 9, borderRadius: 9, background: show[k] ? color : 'transparent',
                     border: `1px solid ${color}` }} />
      {label}
    </button>
  )

  return (
    <div style={{ padding: '4px 2px 24px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
        Regime — win rate by quarter, long vs short vs both
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: 12, opacity: 0.62, maxWidth: 900, lineHeight: 1.5 }}>
        <strong>Read the third line first.</strong> If long and short mirror each other while{' '}
        <em>both</em> sits flat between them, that is a directional regime signature. If all three
        swing together it is market-wide noise. Point size is the trade count — small points are
        thin quarters and must not be read as findings. 28 quarters is far too few to test a flag
        on; the cross-tab below is the actual answer, where n runs into the thousands.
      </p>

      {overall && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
          {DIRS.map(s => (
            <span key={s.k} style={{ color: s.color }}>
              <strong>{s.label}</strong> — {fmt(overall[s.k].wr)}% over{' '}
              {overall[s.k].n.toLocaleString()} trades
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {DIRS.map(s => <Toggle key={s.k} k={s.k} label={s.label} color={s.color} />)}
        <span style={{ width: 12 }} />
        <label style={{ fontSize: 12, opacity: 0.7 }}>Regime criterion</label>
        <select value={criterion} onChange={e => setCriterion(e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6,
                         background: 'rgba(255,255,255,0.06)', color: 'inherit',
                         border: '1px solid rgba(255,255,255,0.18)' }}>
          {seriesKeys.map(k => (
            <option key={k} value={k}>{k === 'all' ? 'All trades (no filter)' : k.replace('::', ' · ')}</option>
          ))}
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <svg width={W} height={H} style={{ display: 'block', minWidth: W }}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PADL} x2={W - PADR} y1={y(t)} y2={y(t)}
                    stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <text x={PADL - 8} y={y(t) + 4} textAnchor="end" fontSize={10}
                    fill="rgba(255,255,255,0.45)">{t.toFixed(0)}%</text>
            </g>
          ))}
          {pts.map((p, i) => (
            i % Math.ceil(pts.length / 14) === 0 ? (
              <text key={p.quarter} x={x(i)} y={H - PADB + 16} textAnchor="middle" fontSize={10}
                    fill="rgba(255,255,255,0.45)">{p.quarter}</text>
            ) : null
          ))}
          {shown.map(s => {
            const path = pts
              .map((p, i) => ({ i, v: p[s.k].wr }))
              .filter(o => o.v !== null)
              .map((o, j) => `${j === 0 ? 'M' : 'L'}${x(o.i).toFixed(1)},${y(o.v as number).toFixed(1)}`)
              .join(' ')
            return <path key={s.k} d={path} fill="none" stroke={s.color} strokeWidth={1.9}
                         strokeLinejoin="round" opacity={0.92} />
          })}
          {shown.map(s => pts.map((p, i) => p[s.k].wr === null ? null : (
            <circle key={`${s.k}-${i}`} cx={x(i)} cy={y(p[s.k].wr as number)} r={rad(p[s.k].n)}
                    fill={s.color} opacity={p[s.k].n < 20 ? 0.35 : 0.95}>
              <title>{`${p.quarter} · ${s.label}: ${fmt(p[s.k].wr)}% on ${p[s.k].n} trades`}</title>
            </circle>
          )))}
          <text x={PADL} y={H - 6} fontSize={10} fill="rgba(255,255,255,0.4)">
            point size = trade count · faded points are quarters under 20 trades
          </text>
        </svg>
      </div>

      {/* trade counts, numerically, per quarter */}
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 10.5, minWidth: W }}>
          <tbody>
            <tr>
              <td style={{ padding: '2px 6px', opacity: 0.55, whiteSpace: 'nowrap' }}>trades / quarter</td>
              {pts.map(p => (
                <td key={p.quarter} style={{ padding: '2px 4px', textAlign: 'center',
                    opacity: p.both.n < 20 ? 0.35 : 0.8 }} title={p.quarter}>{p.both.n}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── the cross-tab: the answer ─────────────────────────────────────────────────────── */}
      <h3 style={{ margin: '22px 0 4px', fontSize: 15, fontWeight: 600 }}>
        Trade-level cross-tab — every trade labelled by Bitcoin&apos;s state at entry
      </h3>
      <p style={{ margin: '0 0 10px', fontSize: 12, opacity: 0.62, maxWidth: 900, lineHeight: 1.5 }}>
        Read the table, do not optimise it. Cells below the sample floor
        {d.basis?.min_cell ? ` (${d.basis.min_cell} trades)` : ''} are struck through and should be
        ignored. Look for one big obvious split, not the best of many.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.18)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Criterion</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Bucket</th>
              {DIRS.map(s => (
                <React.Fragment key={s.k}>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: s.color }}>{s.label} n</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: s.color }}>{s.label} WR</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {(d.crosstab ?? []).map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ padding: '5px 8px', opacity: 0.7 }}>{r.criterion}</td>
                <td style={{ padding: '5px 8px' }}>{r.bucket}</td>
                {DIRS.map(s => {
                  const thin = r.insufficient?.[s.k]
                  const st: React.CSSProperties = {
                    padding: '5px 8px', textAlign: 'right',
                    opacity: thin ? 0.38 : 1,
                    textDecoration: thin ? 'line-through' : 'none',
                  }
                  return (
                    <React.Fragment key={s.k}>
                      <td style={st}>{r[s.k].n.toLocaleString()}</td>
                      <td style={{ ...st, fontWeight: 600 }}>{fmt(r[s.k].wr)}</td>
                    </React.Fragment>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 12, fontSize: 11, opacity: 0.5, lineHeight: 1.6 }}>
        Basis: {d.basis?.row_basis} · {d.basis?.btc_state} · generated {d.generated_at}
      </p>
    </div>
  )
}
