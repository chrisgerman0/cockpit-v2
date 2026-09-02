'use client'
import React, { useEffect, useMemo, useState } from 'react'

/** 2026-08-19 (Chris) — BASKET SELECTION.
 *  Two things, and he analyses the rest himself:
 *    1. each basket's own four-tier metrics + the delta against the incumbent
 *    2. open a basket and see EVERY member cfg's STANDALONE metrics (bible §CFG-QUALITY)
 *  No marginal column: a seated delta per member is one publisher run each (~36h for every
 *  member of every basket) and it was not what he asked for.
 */
const TIERS = ['conservative', 'moderate', 'aggressive', 'kamikaze'] as const
type Tier = typeof TIERS[number]
type M = { returnPct: number; netUsd: number; trades: number; winRate: number; profitFactor: number; maxDD: number }
type Basket = { key: string; label: string; k: number; metrics: Record<Tier, M>; added: string[]; removed: string[]; sids: string[]; source: string }
type SA = { sid: string; asset: string; tf?: string; trades: number; winRate?: number; profitFactor?: number | null; netUsd?: number; maxDD?: number; error?: string }
type Payload = { generated_at_utc?: string; basis?: string; standalone_definition?: string; incumbent?: Record<Tier, M>; baskets?: Basket[]; standalone?: Record<string, SA>; behaviour_duplicates?: Record<string, string[]>; dedup_status?: string; error?: string }

const n2 = (v?: number | null) => (v == null ? '—' : v.toFixed(2))
const n3 = (v?: number | null) => (v == null ? '—' : v.toFixed(3))
const usd = (v?: number | null) => (v == null ? '—' : '$' + Math.round(v).toLocaleString())

function Delta({ v, invert }: { v: number; invert?: boolean }) {
  if (!isFinite(v) || Math.abs(v) < 0.005) return <span style={{ color: 'var(--muted)' }}>±0</span>
  const good = invert ? v < 0 : v > 0
  return <span style={{ color: good ? '#15803d' : '#b91c1c' }}>{v > 0 ? '+' : ''}{v.toFixed(2)}</span>
}

export function BasketSelectionPanel({ active }: { active: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier>('aggressive')
  const [sortKey, setSortKey] = useState<string>('netUsd')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  // ZR5 — members open sorted by STANDALONE WIN RATE, LOWEST FIRST. Chris's reason for asking
  // for this tab: "I DON'T WANT LOW WIN RATE STANDALONE CFG IN MY BASKET". Sorting by net
  // descending put exactly those members at the bottom of a long list.
  const [cfgSort, setCfgSort] = useState<{ k: keyof SA; d: 1 | -1 }>({ k: 'winRate', d: 1 })

  useEffect(() => {
    if (!active || data) return
    fetch('/api/strategies/basket-selection').then(r => r.json()).then(setData).catch(() => setData({ error: 'fetch failed' }))
  }, [active, data])

  const inc = data?.incumbent
  const rows = useMemo(() => {
    const b = [...(data?.baskets ?? [])]
    b.sort((x, y) => {
      const gv = (r: Basket) => (sortKey === 'k' ? r.k : (r.metrics?.[tier] as never)?.[sortKey as keyof M] as number)
      return ((gv(x) ?? 0) - (gv(y) ?? 0)) * sortDir
    })
    return b
  }, [data, tier, sortKey, sortDir])

  const dupOf = data?.behaviour_duplicates ?? {}

  if (!active) return null
  if (!data) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading basket selection…</div>
  if (data.error || !(data.baskets ?? []).length) {
    // 2026-08-27 (VT1): an empty tab is the HONEST answer when nothing clears all three goals —
    // but a bare "no payload" line tells Chris nothing about whether the search is even running.
    // Show the goals, the control row on its full basis, and how much has been evaluated and
    // parked, so an empty tab reads as "searching, nothing qualifies yet" rather than "broken".
    const g: any = (data as any).goals ?? {}
    const inc: any = (data as any).incumbent?.aggressive
    const st: string = (data as any).search_status ?? ''
    const parked: string = (data as any).parked_path ?? ''
    return (
      <div style={{ padding: '8px 2px 24px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600 }}>
          Basket Selection 🧺 — no basket clears all three goals yet
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 12, opacity: 0.66, maxWidth: 900, lineHeight: 1.55 }}>
          A basket appears here <strong>only</strong> if it clears <strong>all three</strong> — not two
          of three. Anything failing even one is fully scored and parked on disk. An empty tab means
          the search has not found one; the bar is not softened to fill it.
          {data.error ? <><br /><span style={{ color: '#b91c1c' }}>{data.error}</span></> : null}
        </p>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
          <tbody>
            {[['Net', g.net, (v: number) => usd(v)],
              ['Win rate', g.winRate, (v: number) => `${n2(v)}%`],
              ['Profit factor', g.profitFactor, (v: number) => n3(v)]].map(([label, val, f]: any) => (
              <tr key={label}>
                <td style={{ padding: '4px 14px 4px 0', opacity: 0.7 }}>{label} must beat</td>
                <td style={{ padding: '4px 0', fontWeight: 700 }}>{val == null ? '—' : f(val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {inc && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Control row — {(data as any).incumbent_label ?? 'the book we trade today'}
            </div>
            <div style={{ fontSize: 13 }}>
              {usd(inc.netUsd)} · win {n2(inc.winRate)}% · PF {n3(inc.profitFactor)} ·{' '}
              {inc.trades?.toLocaleString?.() ?? inc.trades} trades · maxDD {n2(inc.maxDD)}%
            </div>
          </div>
        )}
        {st && <p style={{ fontSize: 12, opacity: 0.7, maxWidth: 900, lineHeight: 1.55 }}>{st}</p>}
        <p style={{ fontSize: 11, opacity: 0.55, marginTop: 12, lineHeight: 1.6 }}>
          Basis: {(data as any).basis ?? '—'}
          {parked ? <><br />Parked (fully scored, failed at least one goal): <code>{parked}</code></> : null}
        </p>
      </div>
    )
  }

  const hdr = (k: string, label: string) => (
    <th style={{ cursor: 'pointer', textAlign: 'right', padding: '6px 8px', whiteSpace: 'nowrap' }}
        onClick={() => { if (sortKey === k) setSortDir(d => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(-1) } }}>
      {label}{sortKey === k ? (sortDir === -1 ? ' ▼' : ' ▲') : ''}
    </th>
  )

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.55 }}>
        <strong>BASIS:</strong> {data.basis}
        <br /><strong>STANDALONE:</strong> {data.standalone_definition}
        <br />generated {data.generated_at_utc} · behavioural dedup: {data.dedup_status}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {TIERS.map(t => (
          <button key={t} onClick={() => setTier(t)}
            style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                     border: '1px solid var(--border, #ddd)',
                     background: tier === t ? 'var(--accent, #d97706)' : 'transparent',
                     color: tier === t ? '#fff' : 'inherit' }}>{t}</button>
        ))}
      </div>

      {/* WA1: no horizontal scroll — the acceptance test. tableLayout:fixed stops a long label
          from widening the table past the viewport. */}
      {/* ZZ4 — say the filter happened. A five-row tab must read as FILTERED, not broken. */}
      {(data as any)?.floor_note && (
        <div style={{ margin: '6px 0 4px', padding: '6px 10px', borderRadius: 6, fontSize: 11,
                      color: 'var(--muted)', background: 'rgba(0,0,0,0.03)' }}>
          {(data as any).floor_note}
        </div>
      )}
      {/* ZX2 — the answer Chris built this tab for, stated as a RESULT. An empty WR<45 column
          looks broken; one line saying there is nothing to flag is the finding. */}
      {(data as any)?.member_quality_note && (
        <div style={{ margin: '0 0 8px', padding: '6px 10px', borderRadius: 6, fontSize: 11,
                      color: '#15803d', background: 'rgba(21,128,61,0.08)',
                      border: '1px solid rgba(21,128,61,0.25)' }}>
          ✓ {(data as any).member_quality_note}
        </div>
      )}
      <div>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border,#ddd)', textAlign: 'right' }}>
              {/* WA: NO HORIZONTAL SCROLL. Only what Chris judges on stays in the top table —
                  size, net, win rate, PF, trades and the two target chips. return%, drawdown, the
                  deltas, asset spread, direction split and basis moved into the expansion or a
                  tooltip. Unvetted share is gone entirely: it is zero by construction now. */}
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>BASKET</th>
              {hdr('k', 'size')}{hdr('netUsd', 'net USD')}
              {hdr('winRate', 'WIN RATE')}{hdr('profitFactor', 'PF')}{hdr('trades', 'trades')}
              <th style={{ textAlign: 'center', padding: '6px 8px' }}>TARGET</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const m = r.metrics?.[tier]; const i = inc?.[tier]
              const isRef = r.key === 'incumbent70' || r.key === 'sweep_drop11'
              const dupsHere = r.sids.filter(s => dupOf[s]).length
              return (
                <React.Fragment key={r.key}>
                  <tr onClick={() => setOpen(o => (o === r.key ? null : r.key))}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--border,#eee)',
                               background: isRef ? 'rgba(217,119,6,0.07)' : undefined }}>
                    <td style={{ textAlign: 'left', padding: '6px 8px', overflow: 'hidden',
                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>
                      {open === r.key ? '▾ ' : '▸ '}<strong>{r.label}</strong>
                      {(r as any).is_live_book && (
                        <span title="This is the book trading real money today. It is the BENCHMARK the candidates are measured against — it is not a candidate and it is exempt from the net floor."
                              style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10,
                                       fontWeight: 700, background: 'rgba(217,119,6,0.16)',
                                       color: '#b45309', border: '1px solid rgba(217,119,6,0.4)' }}>
                          LIVE BOOK · BENCHMARK
                        </span>
                      )}
                      {dupsHere > 0 && <span title="members with a behavioural duplicate elsewhere in the pool"
                        style={{ marginLeft: 6, color: '#b91c1c' }}>⚠ {dupsHere} dup</span>}
                      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.source}</div>
                      {/* ZR3/ZR6: drawdown and concentration matter to the judgement but must NOT
                          become columns — sub-line instead, so the table still fits. */}
                      <div style={{ color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap' }}>
                        {(r as any).metrics?.aggressive?.maxDD != null && <>maxDD {(r as any).metrics.aggressive.maxDD}% · </>}
                        {(r as any).distinct_assets} assets · {(r as any).heaviest_asset} {(r as any).heaviest_asset_pct}% · {(r as any).heaviest_tf} {(r as any).heaviest_tf_pct}%
                        {(r as any).members_wr_under_45 > 0 && <span style={{ color: '#b91c1c', fontWeight: 700 }}> · {(r as any).members_wr_under_45} member(s) WR&lt;45</span>}
                      </div>
                      {(r as any).bounded_dd_warning && (
                        <div style={{ color: '#b45309', fontSize: 10, whiteSpace: 'nowrap' }}
                             title={(r as any).bounded_dd_warning.note}>
                          ⚠ bounded arm: maxDD {(r as any).bounded_dd_warning.base_maxDD}% → {(r as any).bounded_dd_warning.arm_maxDD}% ({(r as any).bounded_dd_warning.delta > 0 ? '+' : ''}{(r as any).bounded_dd_warning.delta}pp)
                        </div>
                      )}
                      {/* WA: the row carries ONLY the label. Composition, basis, round and the
                          deltas live in the expansion — leaving them here made the BASKET column
                          so wide that PF, trades and the target chips fell off the right edge. */}
                    </td>
                    {/* WI2: density lives as a SUB-LINE, not a new column — an 8th column is
                        what put PF and the chips off the right edge at Chris's viewport. */}
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      {r.k}
                      {(r as any).trades_per_year?.median != null && (
                        <div style={{ color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap' }}
                             title={`per MEMBER, standalone: median ${(r as any).trades_per_year.median} and min ${(r as any).trades_per_year.min} trades/yr, over ${(r as any).trades_per_year.covered ?? '?'} of ${(r as any).trades_per_year.of ?? r.k} members`}>
                          {(r as any).trades_per_year.median}/{(r as any).trades_per_year.min}
                          {(r as any).trades_per_year.under_3 > 0 && (
                            <span style={{ color: '#b91c1c', fontWeight: 700 }}
                                  title="members firing under 3 trades a year">
                              {' '}·{(r as any).trades_per_year.under_3}&lt;3
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    {/* WZ: drawdown ON the row, as a sub-line — it was only in the expansion and
                        Chris could not see the trade-off he was being asked to accept. Still a
                        SUB-LINE, not a column: WA1 is no horizontal scroll. */}
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      {usd(m?.netUsd)}
                      {/* XK: the commercial fact ON the row. Chris set the lower goal on purpose,
                          but "29% less than what I publish today" should never be an inference. */}
                      {(r as any).vs_book && (
                        <div style={{ fontSize: 10, whiteSpace: 'nowrap',
                                      color: (r as any).vs_book.dNet >= 0 ? '#15803d' : '#b45309' }}
                             title={`vs the live book: ${(r as any).vs_book.dNet >= 0 ? '+' : ''}$${Math.round((r as any).vs_book.dNet).toLocaleString()} net (${(r as any).vs_book.dNetPct}%), ${(r as any).vs_book.dWinRate >= 0 ? '+' : ''}${(r as any).vs_book.dWinRate}pp win rate, ${(r as any).vs_book.dProfitFactor >= 0 ? '+' : ''}${(r as any).vs_book.dProfitFactor} PF`}>
                          {(r as any).vs_book.dNet >= 0 ? '+' : ''}{(r as any).vs_book.dNetPct}% vs book
                        </div>
                      )}
                      {m?.maxDD != null && i?.maxDD != null && (
                        <div style={{ fontSize: 10, whiteSpace: 'nowrap',
                                      color: m.maxDD > i.maxDD * 1.5 ? '#b91c1c'
                                           : m.maxDD < i.maxDD ? '#15803d' : 'var(--muted)' }}
                             title={`max drawdown ${n2(m.maxDD)}% against the book's ${n2(i.maxDD)}%. Never optimised for — this is variance, not design.`}>
                          DD {n2(m.maxDD)}%
                          {i.maxDD ? ` (${(m.maxDD / i.maxDD).toFixed(1)}× book)` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{n2(m?.winRate)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{n3(m?.profitFactor)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      {m?.trades ?? '—'}
                      {(r as any).seated_per_cfg_per_year != null && (
                        <div style={{ color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap' }}
                             title="SEATED density: basket trades / members / 7.0y. His live book runs 7.56.">
                          {(r as any).seated_per_cfg_per_year}/cfg/yr
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {(['A', 'B'] as const).map(t => {
                        const tv: any = (r as any).targets?.[t]
                        if (!tv) return null
                        const g = tv.goals || {}
                        return (
                          <span key={t}
                                title={`Target ${t}: net > $${(g.net ?? 0).toLocaleString()} · WR > ${g.winRate}% · PF > ${g.profitFactor}`}
                                style={{ display: 'inline-block', margin: '0 3px', padding: '1px 7px',
                                         borderRadius: 4, fontSize: 10, fontWeight: 700,
                                         background: tv.clears ? 'rgba(21,128,61,0.14)' : 'transparent',
                                         color: tv.clears ? '#15803d' : 'var(--muted)',
                                         border: tv.clears ? '1px solid rgba(21,128,61,0.35)' : '1px solid transparent' }}>
                            {t}
                          </span>
                        )
                      })}
                    </td>
                  </tr>
                  {open === r.key && (
                    <tr><td colSpan={7} style={{ padding: '8px 12px 18px', background: 'rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
                        return {n2(r.metrics?.[tier]?.returnPct)}% · maxDD {n2(r.metrics?.[tier]?.maxDD)}%
                        <span title="The search never optimised for drawdown and never filtered on it. Reported, never enforced."
                              style={{ color: 'var(--muted)' }}> (reported, not optimised)</span>
                        {(r as any).asset_spread ? <> · {(r as any).asset_spread.n_assets} assets</> : null}
                        {(r as any).direction_split
                          ? <> · {Object.entries((r as any).direction_split).map(([k, v]) => `${v} ${k}`).join(' / ')}</> : null}
                        {(r as any).trades_per_year?.median != null
                          ? <> · median {(r as any).trades_per_year.median} trades/yr per cfg</> : null}
                        {(r as any).round ? <> · found in {(r as any).round}</> : null}
                        {inc && r.metrics?.[tier]
                          ? <> · vs the live book: net {usd(r.metrics[tier]!.netUsd - inc[tier].netUsd)},
                              WR {n2(r.metrics[tier]!.winRate - inc[tier].winRate)}pp,
                              PF {n3(r.metrics[tier]!.profitFactor - inc[tier].profitFactor)}</> : null}
                        <br />{(r as any).basis}
                      </div>
                      <div style={{ fontSize: 12, marginBottom: 8 }}>
                        <strong style={{ color: '#15803d' }}>ADDED vs incumbent:</strong>{' '}
                        {r.added.length ? r.added.join(', ') : '—'}
                        <br />
                        <strong style={{ color: '#b91c1c' }}>REMOVED vs incumbent:</strong>{' '}
                        {r.removed.length ? r.removed.join(', ') : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                        STANDALONE metrics — every trade the cfg fires in the shared pool, BEFORE lane
                        competition. The quality measure (§CFG-QUALITY), not seated performance.
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead><tr style={{ borderBottom: '1px solid var(--border,#ddd)' }}>
                          {([['sid', 'CFG (STANDALONE)'], ['asset', 'asset'], ['tf', 'tf'],
                             ['direction', 'dir'], ['archetype', 'archetype'], ['trades', 'trades'],
                             ['trades_per_year', 'tr/yr'],
                             ['winRate', 'WIN RATE'], ['profitFactor', 'PF'], ['netUsd', 'net USD'], ['maxDD', 'maxDD']] as const).map(([k, lbl]) => (
                            <th key={k} onClick={() => setCfgSort(s => ({ k: k as keyof SA, d: s.k === k && s.d === -1 ? 1 : -1 }))}
                                style={{ cursor: 'pointer', padding: '4px 6px', textAlign: ['sid','asset','tf','direction','archetype'].includes(k as string) ? 'left' : 'right' }}>
                              {lbl}{cfgSort.k === k ? (cfgSort.d === -1 ? ' ▼' : ' ▲') : ''}
                            </th>))}
                        </tr></thead>
                        <tbody>
                          {[...r.sids].map(s => data.standalone?.[s] ?? { sid: s, asset: '', trades: 0 })
                            .sort((a, b) => {
                              const av = a[cfgSort.k] as number | string, bv = b[cfgSort.k] as number | string
                              if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * cfgSort.d
                              return (((av as number) ?? 0) - ((bv as number) ?? 0)) * cfgSort.d
                            })
                            .map(sa => {
                              const dup = dupOf[sa.sid]
                              const losing = (sa.profitFactor ?? 99) < 1
                              return [
                                <tr key={sa.sid} style={{ borderBottom: '1px solid var(--border,#f0f0f0)',
                                                          background: losing ? 'rgba(185,28,28,0.06)' : undefined }}>
                                  <td style={{ padding: '3px 6px', fontFamily: 'monospace' }}>
                                    {sa.sid}
                                    {dup && <span title={`behavioural duplicate of: ${dup.filter(x => x !== sa.sid).join(', ')}`}
                                      style={{ marginLeft: 6, color: '#b91c1c' }}>⚠ dup</span>}
                                    {losing && <span title="loses money standalone (PF < 1)" style={{ marginLeft: 6, color: '#b91c1c' }}>PF&lt;1</span>}
                                    {(sa.winRate ?? 100) < 45 && <span title="standalone win rate under 45% — the thing Chris does not want in the basket"
                                      style={{ marginLeft: 6, padding: '0 4px', borderRadius: 3, fontWeight: 700,
                                               background: 'rgba(185,28,28,0.14)', color: '#b91c1c' }}>WR&lt;45</span>}
                                  </td>
                                  <td style={{ padding: '3px 6px' }}>
                                    {sa.asset}
                                    {/* VH6: is this member gate-passing, or one of Chris's incumbents? */}
                                    {(sa as any).incumbent
                                      ? <span title="incumbent — already in the live book"
                                              style={{ marginLeft: 5, fontSize: 9, padding: '0 4px', borderRadius: 3,
                                                       background: 'rgba(217,119,6,0.15)', color: '#b45309' }}>INC</span>
                                      : (sa as any).gate_pass === false
                                        ? <span title="does NOT clear the full gate"
                                                style={{ marginLeft: 5, fontSize: 9, padding: '0 4px', borderRadius: 3,
                                                         background: 'rgba(185,28,28,0.12)', color: '#b91c1c' }}>UNVETTED</span>
                                        : null}
                                  </td>
                                  <td style={{ padding: '3px 6px' }}>{sa.tf ?? '—'}</td>
                                  <td style={{ padding: '3px 6px' }}>{(sa as any).direction ?? '—'}</td>
                                  <td style={{ padding: '3px 6px' }}>{(sa as any).archetype ?? '—'}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{sa.trades}</td>
                                  {/* VH5: trades per year. A basket padded with barely-firing cfgs is
                                      the failure Chris caught himself on the 184-cfg basket — it has to
                                      be visible at a glance, not buried in a total. */}
                                  <td style={{ padding: '3px 6px', textAlign: 'right',
                                               color: ((sa as any).trades_per_year ?? 99) < 3 ? '#b45309' : undefined }}
                                      title={((sa as any).trades_per_year ?? 99) < 3 ? 'barely fires — under 3 trades a year' : undefined}>
                                    {n2((sa as any).trades_per_year)}
                                  </td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{n2(sa.winRate)}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{n3(sa.profitFactor)}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{usd(sa.netUsd)}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{n2(sa.maxDD)}</td>
                                </tr>,
                                /* VH4: the full parameter set. Being able to open a basket and read
                                   every member's actual cfg is the point of the tab. */
                                (sa as any).params
                                  ? <tr key={sa.sid + '_p'}>
                                      <td colSpan={11} style={{ padding: '0 6px 6px 18px' }}>
                                        <details>
                                          <summary style={{ cursor: 'pointer', fontSize: 10, color: 'var(--muted)' }}>
                                            parameters
                                          </summary>
                                          <code style={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: 10,
                                                         color: 'var(--muted)', marginTop: 4 }}>
                                            {Object.entries((sa as any).params)
                                              .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ·  ')}
                                          </code>
                                        </details>
                                      </td>
                                    </tr>
                                  : null,
                              ]
                            })}
                        </tbody>
                      </table>
                    </td></tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>

        {/* XH — the holdout verdict has to be impossible to miss. These rows were selected AND
            scored on the same history; out of sample the construction loses most of its edge. */}
        {(data as any)?.holdout && (
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 6, fontSize: 11,
                        lineHeight: 1.6, background: 'rgba(185,28,28,0.08)',
                        border: '1px solid rgba(185,28,28,0.35)' }}>
            <strong style={{ color: '#b91c1c' }}>
              HOLDOUT: the frontier does not survive data it never saw.
            </strong>{' '}
            Selected using only trades that closed before <strong>{(data as any).holdout.split_utc}</strong>,
            then scored on the held-out remainder:
            <table style={{ marginTop: 6, borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ textAlign: 'right', color: 'var(--muted)' }}>
                <th style={{ textAlign: 'left', padding: '2px 10px 2px 0' }}>basket</th>
                <th style={{ padding: '2px 10px' }}>IS win %</th><th style={{ padding: '2px 10px' }}>OOS win %</th>
                <th style={{ padding: '2px 10px' }}>IS PF</th><th style={{ padding: '2px 10px' }}>OOS PF</th>
                <th style={{ padding: '2px 10px' }}>OOS net</th>
              </tr></thead>
              <tbody>
                {(['frontier_k52', 'live70'] as const).map(k => {
                  const h = (data as any).holdout[k]
                  if (!h) return null
                  const drop = (h.is.pf - h.oos.pf) / h.is.pf
                  return (
                    <tr key={k} style={{ textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '2px 10px 2px 0', fontWeight: 700 }}>
                        {k === 'live70' ? 'your live book' : k}
                      </td>
                      <td style={{ padding: '2px 10px' }}>{n2(h.is.wr)}</td>
                      <td style={{ padding: '2px 10px' }}>{n2(h.oos.wr)}</td>
                      <td style={{ padding: '2px 10px' }}>{n3(h.is.pf)}</td>
                      <td style={{ padding: '2px 10px', fontWeight: 800,
                                   color: drop > 0.25 ? '#b91c1c' : '#15803d' }}>{n3(h.oos.pf)}</td>
                      <td style={{ padding: '2px 10px' }}>{usd(h.oos.net)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 6 }}>
              The frontier loses <strong>36% of its profit factor</strong> out of sample; the live book
              loses 12% and its win rate <em>rises</em>. This is a <strong>metric, not a veto</strong> —
              but the headline numbers on these rows are an upper bound, not an expectation.
            </div>
          </div>
        )}

        {/* WI2 + WJ1 legend. The sub-lines are dense on purpose — they have to fit inside the
            existing seven columns, because WA1 is no horizontal scroll at any viewport. */}
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
          <strong>size</strong> sub-line = member trades/yr <em>standalone</em>, median/min ·
          <span style={{ color: '#b91c1c', fontWeight: 700 }}> N&lt;3</span> = members firing under 3 a year ·
          <strong> trades</strong> sub-line = <em>seated</em> trades per member per year
          (his live book runs <strong>7.56</strong>).
          <br />
          <strong style={{ color: '#b45309' }}>Every basket here was scored with eviction INACTIVE.</strong>{' '}
          Eviction fires only for a <em>Tier-S</em> cfg, and Tier-S is a hardcoded seven-strategy list
          tied to the shipped book — a searched cfg can never be on it. Measured: the live book fires
          <strong> 67</strong> evictions worth <strong>+$17,527</strong> net / +0.049 PF; every one of
          these fires <strong>0</strong>. So the like-for-like bar is the book with eviction off —
          <strong> $492,961 · 64.50% · PF 2.276</strong>, not the served $509,742. The gap runs against
          these baskets, not for them. Tier-S membership for a new basket is <strong>undecided</strong>.
          <br />
          <strong style={{ color: '#b45309' }}>The trade, plainly:</strong> the frontier baskets earn
          <strong> less</strong> than the book Chris trades today — k=52 is <strong>$146,975 below it,
          a 29% cut to the public headline</strong> — in exchange for <strong>+6.40pp win rate</strong> and
          <strong> +0.200 profit factor</strong> at slightly lower drawdown. The lower goal was set
          deliberately; the number belongs on the row rather than in an inference.
          <br />
          <strong>Drawdown is reported, never optimised.</strong> The search never ranked or filtered
          on it, so the spread below is <em>luck of the draw, not design</em>. Concretely:
          <strong> k159</strong> buys $10,065 of extra net with <strong>twice the book&apos;s drawdown</strong>
          (20.64% against 10.47%), while <strong>k86</strong> gives up $76,009 for an <strong>8.20%</strong>
          ride and is the only basket smoother than the book. Neither was selected for that.
        </div>
      </div>
    </div>
  )
}
