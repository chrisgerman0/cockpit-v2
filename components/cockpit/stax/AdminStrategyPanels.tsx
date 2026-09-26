'use client'

/**
 * Strategy sub-tab panels for the admin cockpit:
 *   - SatoshiStackerSpecPanel    — V1 strategy spec (current production)
 *   - StrategyResearchPanel      — the journey: how we got to V1, asset selection, decisions
 *   - StrategyOptimizationsPanel — sizing/sequencing layers (ABC patterns, pyramid, tiers, cap5+2)
 *   - ExecutionArchitecturePanel — signal pipeline diagram
 *
 * Last updated: 2026-05-15 — Research panel Top-25 now fetches live from
 * /api/admin/msga-leaderboard (was hardcoded MSGA_TOP10 const).
 */

import type React from 'react'
import { Fragment, useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api'
import { familyInfo } from '@/lib/strategy-families'

// ─── Local helpers ────────────────────────────────────────────────────────

type Tone = 'emerald' | 'cyan' | 'amber' | 'rose' | 'violet'

function toneStyle(tone: Tone) {
  switch (tone) {
    case 'emerald': return { rgb: 'var(--pos-rgb)', solid: 'var(--pos)' }
    case 'cyan':    return { rgb: '93, 177, 255',  solid: '#5db1ff' }
    case 'amber':   return { rgb: '212, 160, 23',  solid: 'var(--gold)' }
    case 'rose':    return { rgb: 'var(--neg-rgb)', solid: 'var(--neg)' }
    case 'violet':  return { rgb: '167, 139, 250', solid: '#a78bfa' }
  }
}

function ToneCard({ tone, children, padded = true }: { tone: Tone; children: React.ReactNode; padded?: boolean }) {
  const t = toneStyle(tone)
  return (
    <div
      className={'card' + (padded ? ' card-pad' : '')}
      style={{ borderColor: `rgba(${t.rgb}, 0.4)`, background: `rgba(${t.rgb}, 0.05)` }}
    >
      {children}
    </div>
  )
}

function ToneLabel({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = toneStyle(tone)
  return <div className="bt-eyebrow" style={{ color: t.solid, marginBottom: 6 }}>{children}</div>
}

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = toneStyle(tone)
  return (
    <span
      className="badge"
      style={{ background: `rgba(${t.rgb}, 0.15)`, color: t.solid, borderColor: `rgba(${t.rgb}, 0.4)` }}
    >
      {children}
    </span>
  )
}

function H2({ children }: { children: React.ReactNode }) { return <h2 className="adm-h2">{children}</h2> }
function H3({ children }: { children: React.ReactNode }) { return <h3 className="adm-h3">{children}</h3> }
function Code({ children }: { children: React.ReactNode }) { return <code className="adm-code">{children}</code> }

// ════════════════════════════════════════════════════════════════════════════
// 1. Satoshi Stacker Spec — current V1 production strategy
// ════════════════════════════════════════════════════════════════════════════

const LANES = [
  { asset: 'BTC',  bbW: 5, brk: 0.50, pf: 1.57, wr: 72.2, trades: 1929, pnl: 472012 },
  { asset: 'ETH',  bbW: 7, brk: 0.50, pf: 1.71, wr: 72.7, trades: 2077, pnl: 650522 },
  { asset: 'SOL',  bbW: 7, brk: 0.25, pf: 1.79, wr: 73.2, trades: 2668, pnl: 942270 },
  { asset: 'XRP',  bbW: 4, brk: 0.75, pf: 1.87, wr: 70.3, trades: 2880, pnl: 1227648 },
  { asset: 'SUI',  bbW: 4, brk: 0.75, pf: 1.86, wr: 71.5, trades: 1968, pnl: 802011 },
  { asset: 'DOGE', bbW: 5, brk: 1.00, pf: 1.96, wr: 69.5, trades: 3526, pnl: 1673935 },
  { asset: 'LINK', bbW: 5, brk: 0.50, pf: 1.74, wr: 71.7, trades: 4253, pnl: 1456156 },
]

export function SatoshiStackerSpecPanel({ active: _active }: { active: boolean }) {
  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">STRATEGY SPEC · INTERNAL</div>
        <h1 className="bt-title">Satoshi Stacker V1 — full <span className="bt-title-gold">breakdown.</span></h1>
        <p className="bt-blurb">HVN-based 4H breakout · per-asset BB-width gate · dynamic trail TP · 4% SL · 7-asset basket · 2026-05-10</p>
      </div>

      <ToneCard tone="emerald">
        <ToneLabel tone="emerald">TL;DR — production numbers ($10k account, 6.8yr backtest)</ToneLabel>
        <p className="adm-p">
          Single entry engine: <strong>VolumeProfile breakout from the prior day&apos;s HVN</strong>, with a per-asset Bollinger-Band-width gate.
          Shared exit: dynamic trailing TP, hard 4% SL, EMA21 pyramid (Option-A geometry-filtered), and RSI/BB-armed rollover.
          Long and short symmetric. 7-asset basket — BTC, ETH, SOL, XRP, SUI, DOGE, LINK.
        </p>
        <p className="adm-p" style={{ marginTop: 10 }}>
          <strong>7-asset cap@5+2, uniform notional, 2019-09 → 2026-05 (6.8yr):</strong>{' '}
          17,845 trades · <span className="pos-text" style={{ fontWeight: 600 }}>71.3% WR · PF 1.82 · 8.78–10.45% max DD</span> depending on tier.
          Linear accumulation (no compounding in backtest).
        </p>
      </ToneCard>

      <H2>The 7-lane basket — locked per-asset configs</H2>
      <p className="adm-p adm-p-muted">
        Each lane uses its own <Code>bbWidthPct</Code> threshold and HVN breakout %, tuned on 5+ years of 1m candles.
        Per-lane configs are the &quot;dials&quot; that decide which signals pass the BB-width gate before becoming entries.
      </p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th style={{ textAlign: 'right' }}>bbW%</th>
              <th style={{ textAlign: 'right' }}>brk%</th>
              <th style={{ textAlign: 'right' }}>Trades</th>
              <th style={{ textAlign: 'right' }}>WR</th>
              <th style={{ textAlign: 'right' }}>PF</th>
              <th style={{ textAlign: 'right' }}>$PnL @ $10k</th>
            </tr>
          </thead>
          <tbody>
            {LANES.map(l => (
              <tr key={l.asset}>
                <td style={{ fontWeight: 600 }}>{l.asset}</td>
                <td className="num" style={{ textAlign: 'right' }}>{l.bbW}</td>
                <td className="num" style={{ textAlign: 'right' }}>{l.brk}</td>
                <td className="num" style={{ textAlign: 'right' }}>{l.trades.toLocaleString()}</td>
                <td className="num pos-text" style={{ textAlign: 'right' }}>{l.wr}%</td>
                <td className="num" style={{ textAlign: 'right' }}>{l.pf}</td>
                <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>${l.pnl.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="adm-stat-sub" style={{ marginTop: 8 }}>
        DOGE has the highest PF (1.96) and lowest standalone max DD (8.79%). LINK is the busiest lane (4,253 trades).
        Bitget tickers <Code>BTCUSDT.P</Code> · <Code>ETHUSDT.P</Code> · <Code>SOLUSDT.P</Code> · <Code>XRPUSDT.P</Code> · <Code>SUIUSDT.P</Code> · <Code>DOGEUSDT.P</Code> · <Code>LINKUSDT.P</Code>.
      </p>

      <H2>Three tiers · $10k canonical account</H2>
      <p className="adm-p adm-p-muted">
        Each tier sets a single multiplier on per-lane notional. The trades themselves are identical across tiers — only sizing changes.
      </p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th style={{ textAlign: 'right' }}>Multiplier</th>
              <th style={{ textAlign: 'right' }}>Per-lane notional</th>
              <th style={{ textAlign: 'right' }}>Total PnL (6.8yr)</th>
              <th style={{ textAlign: 'right' }}>Max DD</th>
              <th style={{ textAlign: 'right' }}>Max single loss</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pos-text" style={{ fontWeight: 600 }}>Conservative</td>
              <td className="num" style={{ textAlign: 'right' }}>0.5×</td>
              <td className="num" style={{ textAlign: 'right' }}>$5,000</td>
              <td className="num" style={{ textAlign: 'right' }}>$861,888</td>
              <td className="num pos-text" style={{ textAlign: 'right' }}>7.89%</td>
              <td className="num" style={{ textAlign: 'right' }}>-$688 (6.9%)</td>
            </tr>
            <tr style={{ background: 'rgba(212,160,23,0.05)' }}>
              <td style={{ color: 'var(--gold)', fontWeight: 600 }}>Moderate <span className="adm-muted" style={{ fontWeight: 400 }}>(default)</span></td>
              <td className="num" style={{ textAlign: 'right' }}>0.75×</td>
              <td className="num" style={{ textAlign: 'right' }}>$7,500</td>
              <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>$1,292,831</td>
              <td className="num" style={{ textAlign: 'right' }}>9.43%</td>
              <td className="num" style={{ textAlign: 'right' }}>-$1,032 (10.3%)</td>
            </tr>
            <tr>
              <td className="neg-text" style={{ fontWeight: 600 }}>Aggressive</td>
              <td className="num" style={{ textAlign: 'right' }}>1.0×</td>
              <td className="num" style={{ textAlign: 'right' }}>$10,000</td>
              <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>$1,723,775</td>
              <td className="num" style={{ textAlign: 'right' }}>10.45%</td>
              <td className="num" style={{ textAlign: 'right' }}>-$1,376 (13.8%)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="adm-stat-sub" style={{ marginTop: 8 }}>
        Numbers above are with Pattern A/B/C up-sizing ON and trailing-secured cap5+2 ON (see <strong>Optimizations</strong> tab).
        DD% computed peak-relative (matches dashboard methodology).
      </p>

      <H2>Concurrency — cap5 (+ 2 trailing-secured)</H2>
      <ToneCard tone="amber">
        <p className="adm-p">
          Maximum <strong>5 active lanes</strong> open simultaneously. Once a lane reaches +1.5% MFE (dynamic trail floor activates above entry),
          it becomes &quot;trailing-secured&quot; — guaranteed positive PnL on exit. Secured lanes don&apos;t count toward the 5-lane cap,
          so up to <strong>2 additional secured lanes</strong> can stay open while fresh signals fill the active 5.
          Total cap: 7 simultaneous open positions.
        </p>
        <p className="adm-p" style={{ marginTop: 8 }}>
          Concurrency distribution (historical): flat 2.8% · 1 lane 7% · 2 lanes 13% · 3 lanes 17% · 4 lanes 19% ·{' '}
          <strong>5 lanes 20% ⭐ modal</strong> · 6 lanes 15% · 7 lanes 7%. Avg concurrency 4.06 lanes.
        </p>
      </ToneCard>

      <H2>The five strategy components</H2>
      <div className="bt-twin-row">
        {COMPONENTS.map(c => (
          <ToneCard key={c.name} tone={c.tone}>
            <div className="adm-edge-name" style={{ color: toneStyle(c.tone).solid, marginBottom: 6 }}>{c.name}</div>
            <p className="adm-p adm-p-sm">{c.desc}</p>
          </ToneCard>
        ))}
      </div>

      <H2>Performance highlights</H2>
      <div className="card card-pad">
        <div className="row row-stats">
          <div>
            <div className="adm-stat-label">Win rate</div>
            <div className="adm-h-val pos-text">71.3%</div>
            <div className="adm-stat-sub">Across 17,845 trades over 6.8 years</div>
          </div>
          <div>
            <div className="adm-stat-label">Profit factor</div>
            <div className="adm-h-val">1.82</div>
            <div className="adm-stat-sub">$1.82 won per $1 lost</div>
          </div>
          <div>
            <div className="adm-stat-label">Max DD (Moderate)</div>
            <div className="adm-h-val">9.43%</div>
            <div className="adm-stat-sub">Peak-relative</div>
          </div>
          <div>
            <div className="adm-stat-label">Worst losing streak</div>
            <div className="adm-h-val neg-text">13 in a row</div>
            <div className="adm-stat-sub">April 14–15 2021 · once in 6.7yr</div>
          </div>
        </div>
      </div>

      <H2>Worst-month risk for new entrants</H2>
      <ToneCard tone="rose">
        <p className="adm-p">
          A user joining at the worst possible moment could face larger short-term drawdowns than the 6.8yr aggregate suggests.
          Worst single 7-day window (7-asset Aggressive · 1.0×) was April 7–14 2025 at <strong>−$8,955 net</strong> on the cap5+2 backtest.
          The April 14 2021 13-trade losing streak cost <strong>$5,125</strong> in 16 hours.
        </p>
        <p className="adm-p" style={{ marginTop: 8 }}>
          Mitigations: tier default is <strong>Moderate (0.75×)</strong> to keep new-user worst-case drawdown bounded.
          Aggressive tier is opt-in only. Pyramid is geometry-filtered (Option A) to skip mean-reversion traps.
        </p>
      </ToneCard>

      <H2>Audit history</H2>
      <ToneCard tone="amber">
        <ul className="adm-list">
          <li><strong>4H lookahead fix (2026-04-27)</strong> — inside the 1m simulation loop, indicators referenced via current 4H bar. At minute 1 of a 4H bar, that bar&apos;s close/RSI/BB don&apos;t exist yet. Fixed to use prior-completed-bar values.</li>
          <li><strong>Daily lookahead fix (2026-04-28)</strong> — daily indicators referenced via current day index. Fixed to use prior-completed-day. 16 sites across all entry engines.</li>
          <li><strong>Option-A pyramid filter (2026-05-07)</strong> — pyramid only fires when EMA21 is on the continuation side of entry (long: EMA21 below entry, support overhead). Prevents mean-reversion traps.</li>
          <li><strong>Live engine armed-freshness patch (2026-05-09)</strong> — post-entry armed check added; <Code>tpPrimeLimitBars=9</Code> expiration; <Code>FRESHNESS_MODE=refresh</Code> parity. Brings live engine in sync with backtest semantics.</li>
          <li><strong>EntryPx-sync patch (2026-05-09)</strong> — live engine now updates <Code>state.pos.entryPx</Code> to the actual Bitget fill price on <Code>LIMIT FILLED</Code> confirmation (previously kept the original limit price).</li>
        </ul>
      </ToneCard>

      <H2>Things NOT modeled in backtest</H2>
      <ToneCard tone="amber">
        <ul className="adm-list adm-list-sm">
          <li><strong>Funding fees</strong> on Bitget perpetuals (~0.01% per 8h cycle). Real haircut: ~−3% on monthly profit.</li>
          <li><strong>Realistic slippage</strong> on fast moves. Backtest models 2 bps; flash-move slippage can be 5–20 bps.</li>
          <li><strong>Position-size limits at scale.</strong> Bitget caps; liquidity walls past ~$5–10M notional on alts.</li>
          <li><strong>Black-swan flash crashes.</strong> 20%+ gap that exceeds SL would fill 5–10% past the trigger.</li>
          <li><strong>Combined real-world haircut: ~10–15% off backtested monthly profit.</strong></li>
        </ul>
      </ToneCard>

      <footer className="adm-footer">
        Production code: <Code>/root/.openclaw/workspace/hive-arena/agents/live-engine-v1/</Code> · backtest: <Code>/root/.openclaw/workspace/hive-arena/strategies/beat-bh/backtest-honeybadger.js</Code>
      </footer>
    </div>
  )
}

const COMPONENTS: { name: string; tone: Tone; desc: React.ReactNode }[] = [
  { name: '1. HVN breakout entry', tone: 'emerald',
    desc: <>4H close crosses prior-day high-volume node (HVN) by ≥ <Code>brk%</Code> (per-asset, 0.25–1.00%). Long if close &gt; HVN×(1+brk); short if close &lt; HVN×(1−brk).</> },
  { name: '2. BB-width gate', tone: 'cyan',
    desc: <>4H Bollinger Band width must be ≥ per-asset threshold (4–7%) at signal time. Filters out chop; only breakouts with sufficient volatility expansion pass.</> },
  { name: '3. Dynamic trailing TP', tone: 'amber',
    desc: <>Multi-tier reprieve: trail floor activates at 1.5% MFE (60% retrace), tightens at 3% (50%), 5% (40%), 8% (30%). Plus 1% fixed-drop ratchet floor.</> },
  { name: '4. Hard 4% SL', tone: 'rose',
    desc: <>Fixed 4% adverse move from entry price. Never moved up. Per-trade max loss is bounded; never wider than this on any single lane.</> },
  { name: '5. Pyramid + Rollover exit', tone: 'violet',
    desc: <>EMA21-retest pyramid (+50% notional, Option-A geometry filter). Rollover exit when RSI crosses its 9-EMA while position is &quot;armed&quot; (RSI ≥ 70 + close &gt; BB upper, or mirror short).</> },
]

// ════════════════════════════════════════════════════════════════════════════
// 2. Strategy Research — the journey to V1
// ════════════════════════════════════════════════════════════════════════════

type Top25Row = {
  rank: number; id: string; kind: string; wr: number; pf: number; rrr: number;
  n: number; pnl: number; totalPct: number; maxDD: number;
  hwr: number; hpf: number; hMaxDD: number; nh: number;
  hTotalPct: number;
  tag?: string; gates?: string;
  // Reproducibility / variance metadata from cfg-hash dedup
  reps: number; stability: string; covPnl: number; reproducible: boolean;
  // Dual-convention metrics (Chris 2026-05-16):
  //   *Pos = position-level (round-trip, deployment-honest)
  //   *Tv  = TradingView convention (each fill incl. partials = a trade event)
  //   null = data not available (SS pre-v2 has no pos; HODL has neither distinction)
  wrPos: number | null; pfPos: number | null; rrrPos: number | null;
  wrTv: number; pfTv: number; rrrTv: number; nRecords: number;
  // BoB-only: which convention did the row's source use?
  sourceConvention?: 'pos' | 'tv' | null;
}

// Map a raw msga-leaderboard row to the Top25Row shape used by this panel.
function mapLeaderboardRow(r: Record<string, unknown>, rank: number): Top25Row {
  const idRaw = String(r.id ?? '')
  // Asset-tagged rows (Phase G cross-asset sweeps) use the asset label as kind
  // so the TYPE column shows BTC/ETH/SOL/BNB/XRP/DOGE/LINK/SUI for sort/filter.
  const assetTag = r.asset ?? r.kind
  let kind = 'Other'
  if (typeof assetTag === 'string' && /^(BTC|ETH|SOL|BNB|XRP|DOGE|LINK|SUI)$/.test(assetTag)) {
    kind = assetTag
  } else if (idRaw.includes('mtf_1d') || idRaw.includes('M1d') || idRaw.includes('MTF1d')) kind = 'MTF Daily'
  else if (idRaw.includes('mtf_4h') || idRaw.includes('MTF4h')) kind = 'MTF 4H'
  else if (idRaw.includes('chart_1H') || idRaw.includes('chart_')) kind = 'Chart 1H'
  else if (idRaw.startsWith('HODL')) kind = 'HODL baseline'
  else if (idRaw.startsWith('V55')) kind = 'v5.5'
  else if (idRaw.startsWith('C4')) kind = 'C4'
  else if (idRaw.startsWith('WF')) kind = 'WF v2'
  else if (idRaw.startsWith('WIN_')) kind = 'WIN (gate-passing)'
  else if (idRaw.startsWith('PREVIEW_')) kind = 'Preview'
  else if (idRaw.startsWith('V3C_')) kind = 'BTC'  // Phase C BTC rows pre-Phase-G default
  const pnl = Number(r.pnl_full ?? 0)
  const wr = Number(r.wr ?? 0)
  const pf = Number(r.pf ?? 0)
  const rrr = Number(r.rrr ?? 0)
  const n = Number(r.n_pos ?? 0)
  // Total-return-% comes from the sweep when available; legacy rows derive it from PnL/$10k
  const totalPct = r.total_pct !== undefined && r.total_pct !== null
    ? Number(r.total_pct)
    : pnl / 100  // legacy fallback assumes $10k account
  const hTotalPct = r.total_pct_holdout !== undefined && r.total_pct_holdout !== null
    ? Number(r.total_pct_holdout)
    : Number(r.pnl_holdout ?? 0) / 100
  // Max DD: prefer the direct field (v3 sweeps emit max_dd_pct on every row).
  // Legacy fallback: parse from the tag string (older MSGA-era rows had
  // 'maxDD -29.1%' baked into the tag instead of a dedicated field).
  const tag = String(r.tag ?? '')
  let maxDD = 0
  if (r.max_dd_pct !== undefined && r.max_dd_pct !== null) {
    maxDD = Number(r.max_dd_pct)
  } else {
    const ddMatch = tag.match(/-?\d+(?:\.\d+)?/)
    if (tag.toLowerCase().includes('dd') && ddMatch) maxDD = parseFloat(ddMatch[0])
  }
  const hwr = Number(r.wr_holdout ?? 0)
  const hpf = Number(r.pf_holdout ?? 0)
  const nh = Number(r.n_holdout ?? 0)
  // Dual-convention metrics — engine emits both; pre-v2 SS rows have *_pos = null
  const wrPos = r.wr_pos !== undefined && r.wr_pos !== null ? Number(r.wr_pos) : null
  const pfPos = r.pf_pos !== undefined && r.pf_pos !== null ? Number(r.pf_pos) : null
  const rrrPos = r.rrr_pos !== undefined && r.rrr_pos !== null ? Number(r.rrr_pos) : null
  const wrTv = r.wr_tv !== undefined && r.wr_tv !== null ? Number(r.wr_tv) : wr
  const pfTv = r.pf_tv !== undefined && r.pf_tv !== null ? Number(r.pf_tv) : pf
  const rrrTv = r.rrr_tv !== undefined && r.rrr_tv !== null ? Number(r.rrr_tv) : rrr
  const nRecords = r.n_records !== undefined && r.n_records !== null ? Number(r.n_records) : n
  const sourceConvention = (r._source_convention === 'pos' || r._source_convention === 'tv')
    ? r._source_convention : null
  return {
    rank, id: String(idRaw ?? '').replace(/^(PREVIEW_\d+_|WIN_)/, ''),
    kind, wr, pf, rrr, n, pnl, totalPct, maxDD, hwr, hpf, hMaxDD: 0, nh,
    hTotalPct,
    tag, gates: String(r.wf_status ?? ''),
    reps: Number(r.n_reps ?? 1),
    stability: String(r.stability ?? 'single-run'),
    covPnl: Number(r.cov_pnl ?? 0),
    reproducible: Boolean(r.reproducible ?? false),
    wrPos, pfPos, rrrPos, wrTv, pfTv, rrrTv, nRecords,
    sourceConvention,
  }
}

type SortDir = 'asc' | 'desc'
type SortKey = 'rank' | 'id' | 'kind' | 'wr' | 'pf' | 'rrr' | 'n' | 'pnl' | 'totalPct' | 'maxDD' | 'hwr' | 'hpf' | 'nh' | 'hTotalPct' | 'gates' | 'reps' | 'stability' | 'covPnl' | 'wrTv' | 'pfTv' | 'rrrTv' | 'nRecords'

type StrategySource = 'msga' | 'hb' | 'gg' | 'bob' | 'swingmate'

const STRATEGY_META: Record<StrategySource, { title: string; subtitle: string; tldr: string }> = {
  swingmate: {
    title: 'SwingMate ⚡',
    subtitle: 'BTC · 25k configs swept · fixed-engine (post-min_hold-fix) · 2026-05-17',
    tldr: 'Confluence (Ichimoku + CCI + RSI + MACD + SMA200) + pullback or fractal-breakout entry. SL always honored. Survivors pass Rule 8 gates: PF≥2, RRR≥2, sPF≥1.5, n≥50, total>HODL (+508%), DD≤35%, MAE p10≥-10%. 65 cfgs survived. Top reaches PF 15.12 / +985% / DD -17.2%.',
  },
  // Kept for type-compat but no longer surfaced in UI. Dead-end strategies removed 2026-05-17.
  msga: { title: 'Satoshi Stacker Mining 🥚', subtitle: '', tldr: '' },
  hb:   { title: 'Honey Badger Mining 🦡',     subtitle: '', tldr: '' },
  gg:   { title: 'Golden Goose Mining 🪿',     subtitle: '', tldr: '' },
  bob:  { title: 'Best of The Best 🏆',        subtitle: '', tldr: '' },
}

/**
 * How old is the data actually is, derived from the payload's own updatedAt.
 *
 * 2026-08-13: every one of these tabs asserted live-updating data while serving months-old
 * snapshots — BoB said "live sweep ranking / auto-refreshes every 30s" on a file last written
 * 2026-05-26, with its aggregator not running. Six of seven sources were 40-90 days stale and two
 * were empty. Decisions get made on these numbers, so a false freshness claim is a production bug.
 *
 * Derived, never hardcoded: when a producer runs again the banner disappears on its own. Nothing
 * here needs maintaining, which is the whole point.
 */
function dataFreshness(updatedAt: string): { days: number; stale: boolean; asOf: string } | null {
  if (!updatedAt) return null
  const t = new Date(updatedAt)
  if (Number.isNaN(t.getTime())) return null
  const days = Math.floor((Date.now() - t.getTime()) / 86_400_000)
  return { days, stale: days > 7, asOf: t.toISOString().slice(0, 10) }
}

function StaleBanner({ updatedAt, what }: { updatedAt: string; what: string }) {
  const f = dataFreshness(updatedAt)
  if (!f || !f.stale) return null
  return (
    <div style={{
      border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.10)', color: '#f59e0b',
      borderRadius: 8, padding: '8px 12px', margin: '8px 0', fontSize: 13, lineHeight: 1.5,
    }}>
      <strong>SNAPSHOT — not live.</strong> {what} was last written <strong>{f.asOf}</strong> ({f.days} days
      ago) and its producer is not currently running. These numbers are a point-in-time snapshot, not a
      live ranking — do not read them as current.
    </div>
  )
}

export function StrategyResearchPanel({
  active,
  source = 'msga',
  displayName,
}: {
  active: boolean
  source?: StrategySource
  displayName?: string
}) {
  const meta = STRATEGY_META[source]
  const title = displayName ?? meta.title
  const [rows, setRows] = useState<Top25Row[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [updatedAt, setUpdatedAt] = useState<string>('')
  // Compound sort stack: primary first, then tiebreakers. Shift-click adds a column.
  // Default sort: Total return % (Option B — normalises sizing modes).
  const [sortStack, setSortStack] = useState<Array<{ key: SortKey; dir: SortDir }>>([
    { key: 'totalPct', dir: 'desc' },
  ])
  const [transitionBanner, setTransitionBanner] = useState<{ tone: string; message: string } | null>(null)
  const [page, setPage] = useState<number>(1)
  const PAGE_SIZE = 100

  const STRING_COLS: SortKey[] = ['id', 'kind', 'gates', 'stability']
  const defaultDir = (k: SortKey): SortDir => (STRING_COLS.includes(k) ? 'asc' : 'desc')

  const onSort = (k: SortKey, shiftKey: boolean) => {
    setPage(1)
    setSortStack(stack => {
      const idx = stack.findIndex(s => s.key === k)
      if (shiftKey) {
        // Shift-click: add as tiebreaker, toggle dir if already present, drop on third click
        if (idx === -1) return [...stack, { key: k, dir: defaultDir(k) }]
        const cur = stack[idx]
        const next = [...stack]
        if (cur.dir === defaultDir(k)) {
          next[idx] = { key: k, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
          return next
        }
        // Already toggled once → remove from stack
        next.splice(idx, 1)
        return next.length > 0 ? next : [{ key: 'pnl', dir: 'desc' }]
      }
      // Plain click: if it's the sole primary, toggle dir; otherwise reset to single-column
      if (stack.length === 1 && stack[0].key === k) {
        return [{ key: k, dir: stack[0].dir === 'asc' ? 'desc' : 'asc' }]
      }
      return [{ key: k, dir: defaultDir(k) }]
    })
  }
  const sortedRows = [...rows].sort((a, b) => {
    for (const { key, dir } of sortStack) {
      const av = (a as unknown as Record<SortKey, unknown>)[key]
      const bv = (b as unknown as Record<SortKey, unknown>)[key]
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''))
      }
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
    }
    return 0
  })
  const SUPERSCRIPTS = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
  const sortArrow = (k: SortKey) => {
    const idx = sortStack.findIndex(s => s.key === k)
    if (idx === -1) return ''
    const s = sortStack[idx]
    const arrow = s.dir === 'asc' ? '↑' : '↓'
    // Show priority superscript only when there are tiebreakers
    return sortStack.length > 1 ? ` ${arrow}${SUPERSCRIPTS[idx] ?? ''}` : ` ${arrow}`
  }
  const sortDescription = sortStack
    .map((s, i) => `${i + 1}. ${s.key} ${s.dir}`)
    .join(' · ')
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages)
  const pagedRows = sortedRows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await authedFetch<{
          rows?: unknown[]; updatedAt?: string;
          transition_banner?: { tone: string; message: string } | null;
        }>(
          `/api/admin/msga-leaderboard?strategy=${source}`,
          { cache: 'no-store' }
        )
        if (cancelled) return
        const mapped = (data.rows ?? []).map((r, i) =>
          mapLeaderboardRow(r as Record<string, unknown>, i + 1)
        ).slice(0, 500)
        setRows(mapped)
        setUpdatedAt(String(data.updatedAt ?? ''))
        // Transition banner (Chris 2026-05-16): shown while data is in transition state
        setTransitionBanner(data.transition_banner ?? null)
      } catch (e) {
        // Auth failure or fetch error — log to console, don't get stuck in "Loading…"
        if (typeof window !== 'undefined') {
          console.warn('[msga-leaderboard] fetch failed:', e)
        }
      } finally {
        // Always release the loading state so the table can show fallback content
        if (!cancelled) setLoading(false)
      }
    }
    if (!active) { setLoading(false); return () => { cancelled = true } }
    load()
    // 2026-08-05: gate on `active`. These panels stay MOUNTED behind display:none, so
    // without this both swingmate (9.7MB) and bob poll every 30s in the background —
    // that is what made the Strategy tab feel broken. 30s -> 120s too; the source file
    // is a batch artefact that changes at most a few times a day.
    const t = setInterval(load, 120_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [active, source])

  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">STRATEGY MINING · LIVE SWEEP</div>
        <h1 className="bt-title">{title}</h1>
        <p className="bt-blurb">{meta.subtitle}</p>
      </div>

      <ToneCard tone="emerald">
        <ToneLabel tone="emerald">TL;DR — {title}</ToneLabel>
        <p className="adm-p">{meta.tldr}</p>
      </ToneCard>

      {transitionBanner && (
        <div style={{
          background: transitionBanner.tone === 'warn'
            ? 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(251,191,36,0.05))'
            : 'rgba(255,255,255,0.05)',
          border: `1px solid ${transitionBanner.tone === 'warn' ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.15)'}`,
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 12,
          color: transitionBanner.tone === 'warn' ? '#FDE68A' : 'var(--ink)',
          fontSize: 13,
          lineHeight: 1.5,
        }}>
          {transitionBanner.message}
        </div>
      )}
      <H2>
        Top 500 — {dataFreshness(updatedAt)?.stale
          ? `sweep snapshot as of ${dataFreshness(updatedAt)!.asOf}`
          : 'live sweep ranking'} ($10k account)
      </H2>
      <StaleBanner updatedAt={updatedAt} what={`The ${source} sweep leaderboard`} />
      <p className="adm-p adm-p-muted">
        Top-500 from the <Code>{source}</Code> sweep{dataFreshness(updatedAt)?.stale
          ? <> (<strong>snapshot</strong> — the page polls every 30s but this source is not being rewritten)</>
          : <>, refreshed every 30s</>}, paginated 100 per page. {updatedAt && <>Last updated: <Code>{new Date(updatedAt).toLocaleString()}</Code>.</>} <strong>Click a column to sort. Shift-click to add a tiebreaker</strong> (then a third, fourth, etc). Currently sorting by <Code>{sortDescription}</Code>. All numbers from a $10k starting balance, <strong>compounded</strong>, fees 5bps RT and slippage 6bps each side — a DIFFERENT basis from the locked strategy surface, which is compound OFF. Do not compare the two directly.
      </p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table" style={{ fontSize: '12px' }}>
          <thead>
            <tr>
              <th onClick={(e) => onSort('rank', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none' }}>#{sortArrow('rank')}</th>
              <th onClick={(e) => onSort('id', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none' }}>Config{sortArrow('id')}</th>
              <th onClick={(e) => onSort('kind', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none' }}>Type{sortArrow('kind')}</th>
              <th onClick={(e) => onSort('wrTv', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700 }} title="Win rate — % of trades that closed profitable. SwingMate v3 has no partials so this matches Bitget logs 1:1.">WR{sortArrow('wrTv')}</th>
              <th onClick={(e) => onSort('pfTv', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700 }} title="Profit factor — gross wins / gross losses">PF{sortArrow('pfTv')}</th>
              <th onClick={(e) => onSort('rrrTv', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700 }} title="Reward:risk — avg win / avg loss">RRR{sortArrow('rrrTv')}</th>
              <th onClick={(e) => onSort('nRecords', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700 }} title="Number of trades on the panel">n{sortArrow('nRecords')}</th>
              <th onClick={(e) => onSort('pnl', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}>$ PnL{sortArrow('pnl')}</th>
              <th onClick={(e) => onSort('totalPct', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700 }} title="Total return % — primary ranking metric (Option B; normalises sizing modes). HODL baseline = +508% (7Y).">Total %{sortArrow('totalPct')}</th>
              <th onClick={(e) => onSort('maxDD', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700 }} title="Max drawdown — worst peak-to-trough equity decline as % of running peak (NOT % of starting balance).">Max DD %{sortArrow('maxDD')}</th>
              <th onClick={(e) => onSort('hwr', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>hWR{sortArrow('hwr')}</th>
              <th onClick={(e) => onSort('hpf', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}>hPF{sortArrow('hpf')}</th>
              <th onClick={(e) => onSort('nh', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}>hN{sortArrow('nh')}</th>
              <th onClick={(e) => onSort('reps', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.1)' }} title="Replications of this exact cfg in the sweep">Reps{sortArrow('reps')}</th>
              <th onClick={(e) => onSort('stability', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none' }} title="stable = cov<0.25 · medium = cov<0.75 · high-variance = cov≥0.75 · single-run = 1 rep only">Stab{sortArrow('stability')}</th>
              <th onClick={(e) => onSort('covPnl', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} title="Coefficient of variation of PnL across reps (0 = perfectly stable, higher = curve-fit risk)">cov{sortArrow('covPnl')}</th>
              <th onClick={(e) => onSort('gates', e.shiftKey)} style={{ cursor: 'pointer', userSelect: 'none' }}>Status{sortArrow('gates')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={17} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 20 }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={17} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 20 }}>No rows yet — sweep still warming up</td></tr>
            ) : pagedRows.map(r => (
              <tr key={r.id + '_' + r.rank}>
                <td style={{ fontWeight: 600 }}>{r.rank}</td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {r.sourceConvention && (
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 6px',
                      marginRight: 6,
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 3,
                      background: r.sourceConvention === 'pos' ? 'rgba(74,222,128,0.2)' : 'rgba(251,191,36,0.2)',
                      color: r.sourceConvention === 'pos' ? '#4ADE80' : '#FBBF24',
                      verticalAlign: 'middle',
                    }} title={r.sourceConvention === 'pos'
                      ? 'Source used position-level (deployment-honest) metrics'
                      : 'Source used TradingView convention (partials counted as separate trades; inflated)'}>
                      {r.sourceConvention === 'pos' ? 'POS' : 'TV'}
                    </span>
                  )}
                  {r.id}
                </td>
                <td style={{ color: 'var(--ink-mute)', fontSize: '11px' }}>{r.kind}</td>
                <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>{r.wrTv.toFixed(1)}%</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.pfTv.toFixed(2)}</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.rrrTv.toFixed(2)}</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.nRecords}</td>
                <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>{r.pnl >= 0 ? '+' : ''}${r.pnl.toLocaleString()}</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: r.totalPct >= 508 ? '#4ade80' : r.totalPct > 0 ? 'var(--ink)' : '#f87171' }}>{r.totalPct >= 0 ? '+' : ''}{r.totalPct.toFixed(0)}%</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: Math.abs(r.maxDD) <= 20 ? '#4ade80' : Math.abs(r.maxDD) <= 35 ? '#fbbf24' : '#f87171' }}>{r.maxDD ? `${r.maxDD.toFixed(1)}%` : '—'}</td>
                <td className="num pos-text" style={{ textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>{r.hwr.toFixed(1)}%</td>
                <td className="num" style={{ textAlign: 'right' }}>{r.hpf.toFixed(2)}</td>
                <td className="num" style={{ textAlign: 'right' }}>{r.nh}</td>
                <td className="num" style={{ textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                  {r.reps}{!r.reproducible && <span title="legacy: cfg not logged" style={{ marginLeft: 4, opacity: 0.5 }}>·L</span>}
                </td>
                <td style={{
                  fontSize: '10px', fontWeight: 600,
                  color: r.stability === 'stable' ? '#4ade80'
                    : r.stability === 'medium' ? '#fbbf24'
                    : r.stability === 'high-variance' ? '#f87171'
                    : 'var(--ink-mute)',
                }}>{r.stability}</td>
                <td className="num" style={{ textAlign: 'right', color: r.covPnl > 0.75 ? '#f87171' : r.covPnl > 0.25 ? '#fbbf24' : 'var(--ink)' }}>
                  {r.reps >= 2 ? r.covPnl.toFixed(2) : '—'}
                </td>
                <td style={{ color: 'var(--ink-mute)', fontSize: '10px' }}>{r.gates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={clampedPage <= 1}
          style={{
            padding: '4px 10px', fontSize: 12, cursor: clampedPage <= 1 ? 'default' : 'pointer',
            opacity: clampedPage <= 1 ? 0.4 : 1,
            background: 'transparent', color: 'var(--ink)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
          }}
        >← Prev</button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPage(p)}
            style={{
              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              background: p === clampedPage ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: 'var(--ink)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
              fontWeight: p === clampedPage ? 600 : 400,
            }}
          >{p}</button>
        ))}
        <button
          type="button"
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={clampedPage >= totalPages}
          style={{
            padding: '4px 10px', fontSize: 12, cursor: clampedPage >= totalPages ? 'default' : 'pointer',
            opacity: clampedPage >= totalPages ? 0.4 : 1,
            background: 'transparent', color: 'var(--ink)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
          }}
        >Next →</button>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ink-mute)' }}>
          Page {clampedPage} of {totalPages} · showing rows {(clampedPage - 1) * PAGE_SIZE + 1}–{Math.min(clampedPage * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
        </span>
      </div>
      <p className="adm-stat-sub" style={{ marginTop: 8 }}>
        Top 500 paginated 100 per page (the page polls every 30s; whether the SOURCE is being rewritten is shown above). <strong>Default sort is Total % (Option B)</strong> — normalises across sizing modes (fixed-notional, %-equity, risk-based, vol-adjusted) so configs with different sizing approaches are directly comparable. The <Code>#</Code> column preserves the original rank from the pusher. <strong>HODL_BTC_BUY_HOLD</strong> is pinned as the <strong style={{ color: '#4ade80' }}>+658%</strong> baseline to beat. <strong>WIN_*</strong> rows are robust winners (every replication of this exact cfg passed all gates). <strong>PREVIEW_*</strong> rows are top sweep configs from the standard filter (n≥100 + PF≥1.3) <em>or</em> the quality bypass (n≥50 + PF≥2.0, surfaces low-freq high-edge configs).
      </p>
      <p className="adm-stat-sub" style={{ marginTop: 4 }}>
        <strong>Dedup is by cfg-hash, not label.</strong> Two records with the same label but different un-encoded dimensions (exit_rollover, opp_dot, ladder_mode, kamikaze_layers/pct, counter_*) are correctly treated as <em>different strategies</em>. <Code>Reps</Code> = how many runs of this exact cfg landed in the sweep · <Code>Stab</Code> = stability bucket (<span style={{ color: '#4ade80' }}>stable</span> ≤0.25 · <span style={{ color: '#fbbf24' }}>medium</span> ≤0.75 · <span style={{ color: '#f87171' }}>high-variance</span> &gt;0.75) · <Code>cov</Code> = coefficient of variation of PnL across reps. Higher = parameter-sensitive (curve-fit risk). <Code>·L</Code> = legacy record from before cfg-logging was added; treat with caution.
      </p>

      {/* Strategy-specific narrative sections — only render for MSGA (Satoshi Stacker Mining)
          since the HB/GG/BoB sweeps don't have their own narrative yet. */}
      {source === 'msga' && <>
      <H2>Strategy architecture — Golden Goose v5.5</H2>
      <div className="card card-pad">
        <ul className="adm-list adm-list-sm">
          <li><strong>Regime</strong>: Multi-Timeframe Daily Supertrend (mult=8, ATR=14). Regime green/red projected to the 1H chart via <Code>request.security(ticker.standard(syminfo.tickerid), &quot;D&quot;, ta.supertrend(...))</Code>.</li>
          <li><strong>Entries</strong>: Market Cipher B extreme dots (WT cross + |WT2|≥53, gold buy at WT2≤-80 + RSI&lt;20). Long only in green regime, short only in red.</li>
          <li><strong>Divergence</strong>: <em>regular</em> only (50-bar window). Bullish = price makes a LOWER low + WT2 makes a HIGHER low (reversal). Bearish = price HIGHER high + WT2 LOWER high. <strong>Hidden / phantom divergences are NOT detected</strong> — that&apos;s an open lift candidate (see Next R&amp;D). Re-arms only after WT2 completes a full zero-cross round trip.</li>
          <li><strong>Pyramid</strong>: 25% per layer, fast-fill to 100% on divergence, regime-runner +25%/div beyond 100% up to 150%. Breath gate (WT2 round-trip required between adds).</li>
          <li><strong>Counter trades</strong>: on flip-flop divergence (div fires in the opposite regime). Single-fire per regime period — first one only, resets on every ST flip. Entry-relative SL (2× the buffer), quick exit on first opposing WT cross, 2-loss circuit breaker.</li>
          <li><strong>Trail SL</strong>: ST line ± 2.5% buffer, close-based trigger, ratchet only in favor (never crosses price).</li>
          <li><strong>Ladder TP</strong>: take 50% off at +2% unrealized, trail the rest. Fires once per position. This single change lifted WR from ~39% to ~63%.</li>
          <li><strong>Rollover OFF</strong>: regime-flip-on-close exit was actually <em>hurting</em> the strategy. Disabling lifted total return from −25% to +44% over the full period.</li>
        </ul>
      </div>

      <H2>What we tried · what we kept · what we threw out</H2>
      <div className="bt-twin-row">
        <ToneCard tone="emerald">
          <div className="adm-edge-name" style={{ color: 'var(--pos)', marginBottom: 6 }}>✓ Kept (positive lift)</div>
          <ul className="adm-list adm-list-sm">
            <li><strong>MTF Daily Supertrend</strong> ⭐ — biggest find. Daily regime captures macro trend; 4H/6H/12H all underperform. Holdout WR jumps to 71%.</li>
            <li><strong>Rollover OFF</strong> ⭐ — +44pp on total return. Regime flips on the 1H ST were closing winners on chop.</li>
            <li><strong>Ladder 50% @ +2%</strong> ⭐ — locks early profit, lets the rest trail. WR 39% → 63% lift.</li>
            <li><strong>SL buffer 2.5%</strong> — wider than v5.3&apos;s 1.5%. Winners need room to breathe under MTF regime.</li>
            <li><strong>Counter trades on flip-flop divs</strong> — disabling them destroyed the strategy (WR 6.7% / PF 0.10). Critical alpha.</li>
            <li><strong>Counter single-fire per regime</strong> — without this, flip-flops kept firing indefinitely on every div in the wrong regime.</li>
          </ul>
        </ToneCard>
        <ToneCard tone="rose">
          <div className="adm-edge-name" style={{ color: 'var(--neg)', marginBottom: 6 }}>✗ Tested + rejected (no lift or hurt)</div>
          <ul className="adm-list adm-list-sm">
            <li><strong>Distance-to-ST entry filter</strong> — looked great in 1.5y bull window, killed sample size on 6.84y. Bull-market artifact.</li>
            <li><strong>EMA50 / EMA100 / EMA200 trend filter</strong> — drops trades too much. Net zero or negative.</li>
            <li><strong>Volume gates (vol &gt; SMA20/50/100)</strong> — neutral to slightly negative when used alone. Doesn&apos;t survive MTF baseline.</li>
            <li><strong>RSI overextension skip</strong> (RSI&gt;70 long / &lt;30 short) — no measurable effect.</li>
            <li><strong>Time stops</strong> 24/48/72h — early results were bug-inflated; honest result is neutral on the MTF base.</li>
            <li><strong>Reprieve on first SL hit</strong> — costs you. First SL is real, not a fakeout.</li>
            <li><strong>Rollover delay (1/2/3 bars / EMA confirm / RSI confirm)</strong> — bug-inflated earlier; honest result is no lift vs rollover OFF.</li>
            <li><strong>Kamikaze tightening at 2/3/4 stacked layers</strong> — barely affects metrics; rollover and trail SL fire first.</li>
            <li><strong>Divergence-only entries (skip plain dots)</strong> — too few divergences (17 long, 28 short over 6.84y). Killed sample size.</li>
            <li><strong>Higher TFs other than 1D</strong> (2H/4H/6H/12H) — peak at 1D. Lower TFs add chop.</li>
          </ul>
        </ToneCard>
      </div>

      <H2>The bug we caught (and threw out)</H2>
      <ToneCard tone="rose">
        <ToneLabel tone="rose">First-pass results were FAKE — SL-exit pricing bug</ToneLabel>
        <p className="adm-p">
          Early in the sweep we hit a config showing <strong>WR 93% / PF 47</strong>. Smell test failed immediately. Root cause:
          on regime flip, the trail SL was ratcheting toward the new ST line (now <em>overhead</em> for a long), pushing <Code>sl_px</Code>
          above current close. The trail-SL exit then filled at <Code>sl_px</Code> instead of <Code>close</Code> — generating fake profits on every flip.
        </p>
        <p className="adm-p" style={{ marginTop: 8 }}>
          Fix: (1) ratchet only when the new trail level is still on the stop side of price, (2) close-based trigger ⇒ close-based fill.
          After the fix, baseline went from a false +25% to an honest −25%. All sweeps were re-run. The numbers in the leaderboard are post-fix and OOS-validated.
        </p>
      </ToneCard>

      <H2>Pine evolution</H2>
      <div className="card card-pad">
        <ul className="adm-list adm-list-sm">
          <li><strong>v5.3</strong> — flip-flop counter single-entry per regime + ATR mult default 14.</li>
          <li><strong>v5.4</strong> — rollover OFF default, SL buf 2.5%, ladder 50% @ +2% (the first profitable build over the full panel).</li>
          <li><strong>v5.5</strong> — switched to Pine&apos;s native <Code>ta.supertrend()</Code> to remove any drift vs TV&apos;s built-in. Added MTF Daily Supertrend toggle, defaulted ON. <strong>Current shipping research build.</strong></li>
        </ul>
      </div>

      <H2>Robustness check — winner is not a knife-edge</H2>
      <div className="card card-pad">
        <p className="adm-p adm-p-sm" style={{ marginBottom: 8 }}>
          Neighbouring configs in the MTF Daily pocket all hold up on the holdout — the winner sits inside a stable plateau, not a single overfit cell:
        </p>
        <ul className="adm-list adm-list-sm">
          <li><Code>M1d_m8_ap14</Code> (winner) — full WR 64.9% / PF 1.26 · holdout WR <strong className="pos-text">71.2%</strong> / PF <strong className="pos-text">1.94</strong></li>
          <li><Code>M1d_m8_ap16</Code> — full WR 65.3% / PF 1.23 · holdout WR 71.2% / PF 1.94</li>
          <li><Code>M1d_m9_ap16</Code> — full WR 65.8% / PF 1.20 · holdout WR 69.8% / PF 1.74</li>
          <li><Code>M1d_m12_ap16</Code> — full WR 67.2% / PF 1.16 · holdout WR 69.8% / PF 1.60</li>
          <li><Code>M1d_m5_ap12</Code> — full WR 64.6% / PF 1.30 · holdout WR 65.4% / PF 1.48</li>
        </ul>
      </div>

      <H2>Honest caveats</H2>
      <ToneCard tone="amber">
        <ToneLabel tone="amber">Read before deploying</ToneLabel>
        <ul className="adm-list adm-list-sm">
          <li><strong>BTC-only.</strong> Whole sweep was on BTCUSDT 1H. Cross-asset (ETH/SOL/XRP/etc.) not yet tested. Per-asset MTF Daily params will likely need re-tuning.</li>
          <li><strong>Trade counting differs between Python and TV — and the ladder amplifies the difference.</strong> Python appends ONE record per <em>close event</em>: a 4-layer pyramid that closes together = 1 trade; a ladder partial = +1 trade; so a pyramid with one ladder fire = 2 trades. TV appends one record per <em>entry-layer close</em>: a 4-layer pyramid closed together = 4 trades; with ladder partials = 8. Direction of variations (which config is better) survives; absolute WR and n shift in both directions when pasted into TV.</li>
          <li><strong>The ladder mechanically lifts WR in both engines.</strong> A ladder partial only fires at +2% unrealised — every ladder closure is a guaranteed winner in the trade list. With ~50% of close events being ladder partials in the top configs, ~half the "wins" come from this counting effect. The underlying edge improvement is smaller than the headline WR suggests, though PF and $PnL improvements are real (Z_rolloff sl=2.0 no-ladder: PF 1.30 / +$4,395 → Z_rolloff sl=2.5 with-ladder: PF 1.44 / +$6,262).</li>
          <li><strong>Fill model</strong>: my engine fills at close; TV fills at the next bar&apos;s open. Verify directional finding (MTF Daily &gt;&gt; chart-TF) before any live deployment.</li>
          <li><strong>Holdout is 1.4 years</strong> (n=52 trades). Strong signal but not multi-cycle yet — needs a second OOS run when more data is available.</li>
          <li><strong>v5.5 has not been live-validated.</strong> All numbers are simulator output. Live-engine parity audit is the next gate.</li>
        </ul>
      </ToneCard>

      <H2>Next R&amp;D directions</H2>
      <div className="bt-twin-row">
        <ToneCard tone="amber">
          <div className="adm-edge-name" style={{ marginBottom: 4 }}>Hidden (phantom) divergences ⭐</div>
          <p className="adm-p adm-p-sm">Trend-continuation signals — bullish hidden: price HIGHER low, WT2 LOWER low; bearish hidden: price LOWER high, WT2 HIGHER high. Pair naturally with the regime-runner pyramid (continuation, not reversal). Currently NOT detected. Likely top-priority next axis.</p>
        </ToneCard>
        <ToneCard tone="amber">
          <div className="adm-edge-name" style={{ marginBottom: 4 }}>Cross-asset MTF</div>
          <p className="adm-p adm-p-sm">Sweep MTF Daily params on ETH, SOL, XRP, SUI, DOGE, LINK using the v5.5 baseline. Goal: per-lane MTF settings that match SS V1&apos;s 7-lane basket.</p>
        </ToneCard>
        <ToneCard tone="amber">
          <div className="adm-edge-name" style={{ marginBottom: 4 }}>Live parity</div>
          <p className="adm-p adm-p-sm">Run v5.5 as a shadow engine alongside SS V1. Validate that Python sweep numbers reproduce in TV strategy tester and in live alerts.</p>
        </ToneCard>
        <ToneCard tone="amber">
          <div className="adm-edge-name" style={{ marginBottom: 4 }}>Higher-TF entries</div>
          <p className="adm-p adm-p-sm">Test 4H entries with 1D MTF regime. Fewer trades but possibly higher PF — the 1H chop is mostly noise.</p>
        </ToneCard>
        <ToneCard tone="amber">
          <div className="adm-edge-name" style={{ marginBottom: 4 }}>Alternative data layer</div>
          <p className="adm-p adm-p-sm">Volume Profile (HVN/LVN) gating, CVD divergence at signal, funding-rate filter. The same set rejected for SS V1 might lift Golden Goose since its entry trigger is different.</p>
        </ToneCard>
      </div>

      <H2>Leaderboard</H2>
      <p className="adm-p adm-p-muted">
        Live top-25 (sorted by WR × PF) at <Code>/admin/strategy-research</Code>. Source JSON written by the MSGA sweep runner at <Code>public/data/msga-leaderboard.json</Code>.
      </p>
      </>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Strategy Optimizations — ABC patterns, pyramid, tier sizing, cap5+2
// ════════════════════════════════════════════════════════════════════════════

const ABC_PATTERNS = [
  { name: 'A · Continuation', tone: 'emerald' as Tone,
    rule: <><Code>closeStrDir ≤ 0.3</Code> AND <Code>12 UTC bar</Code> AND <Code>netMove5 &gt; +2%</Code></>,
    trades: 422, wr: 82, pf: 3.05, pnl: 249141, robust: '7/7 assets',
    asset: 'all 7 assets including DOGE + LINK' },
  { name: 'B · Reversal', tone: 'cyan' as Tone,
    rule: <><Code>netMove5 &lt; -2%</Code> AND <Code>lastBarRange &gt; 1.5</Code></>,
    trades: 291, wr: 77.7, pf: 2.31, pnl: 139528, robust: '6/7 assets',
    asset: '6 assets EXCEPT DOGE (DOGE failed robustness)' },
  { name: 'C · Regime reset', tone: 'violet' as Tone,
    rule: <><Code>closeStrDir ≤ 0.3</Code> AND <Code>priorWasSL</Code> AND <Code>rangeComp &gt; 1.3</Code></>,
    trades: 306, wr: 75.2, pf: 2.54, pnl: 190688, robust: '6/7 assets',
    asset: '6 assets EXCEPT DOGE' },
]

export function StrategyOptimizationsPanel({ active: _active }: { active: boolean }) {
  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">STRATEGY OPTIMIZATIONS</div>
        <h1 className="bt-title">The layers <span className="bt-title-gold">on top of V1.</span></h1>
        <p className="bt-blurb">Pattern A/B/C sizing · Option-A pyramid · trailing-secured 6th/7th lane · tier multipliers — every layer walked-forward, no overfit.</p>
      </div>

      <ToneCard tone="emerald">
        <ToneLabel tone="emerald">TL;DR — combined lift over base V1</ToneLabel>
        <p className="adm-p">
          On Moderate tier (default): <strong>+$103k PnL (+6.4%)</strong> over uniform-sizing baseline, with max DD increasing only +0.82 pp (8.61% → 9.43%).
          The Aggressive paradox: ABC sizing on Aggressive actually <em>reduces</em> max DD (12.40% → 12.24%) because the up-sized trades win often enough to dampen drawdowns.
        </p>
      </ToneCard>

      <H2>1 · Pattern A/B/C high-conviction sizing (1.5×)</H2>
      <p className="adm-p adm-p-muted">
        Three signal-bar conditions that historically delivered 75–83% WR and PF 2.3+. When a V1 entry signal matches any of A/B/C,
        the trade is sized at <strong>1.5× the tier&apos;s base notional</strong>. Walk-forward validated 7-asset (2026-05-09).
      </p>
      <div className="bt-twin-row">
        {ABC_PATTERNS.map(p => (
          <ToneCard key={p.name} tone={p.tone}>
            <div className="adm-edge-name" style={{ color: toneStyle(p.tone).solid, marginBottom: 6 }}>{p.name}</div>
            <p className="adm-p adm-p-sm"><strong>Rule:</strong> {p.rule}</p>
            <p className="adm-p adm-p-sm" style={{ marginTop: 6 }}>
              <strong>{p.trades.toLocaleString()} trades · WR {p.wr}% · PF {p.pf}</strong> · $PnL ${p.pnl.toLocaleString()} (uniform notional)
            </p>
            <p className="adm-stat-sub" style={{ marginTop: 4 }}>Robustness: {p.robust} · applies to {p.asset}</p>
          </ToneCard>
        ))}
      </div>
      <p className="adm-stat-sub" style={{ marginTop: 8 }}>
        <strong>Total ABC-tagged trades over 6.7yr:</strong> ~769 (4.3% of all trades). Walk-forward AGG OOS WR: A 89.2% · B 81.3% · C 78.8% — all hold up out-of-sample.
        DOGE excluded from B and C because per-asset OOS WR was &lt;70% (failed 75% robustness bar).
      </p>

      <H2>2 · EMA21 pyramid (+50% notional, Option-A geometry filter)</H2>
      <p className="adm-p adm-p-muted">
        When a position is in profit AND price retests the prior 4H bar&apos;s EMA21, pyramid adds <strong>50% of base notional</strong> as a limit fill at that EMA21 level.
        Option-A geometry filter: only fires when EMA21 is on the <em>continuation</em> side of entry (long: EMA21 below entry, support overhead; short: EMA21 above entry).
        Skips mean-reversion traps.
      </p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Subset</th>
              <th style={{ textAlign: 'right' }}>Count</th>
              <th style={{ textAlign: 'right' }}>WR</th>
              <th style={{ textAlign: 'right' }}>PF</th>
              <th style={{ textAlign: 'right' }}>$PnL ($10k base)</th>
              <th style={{ textAlign: 'right' }}>Worst single</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>All pyramid sub-trades</td>
              <td className="num" style={{ textAlign: 'right' }}>390</td>
              <td className="num pos-text" style={{ textAlign: 'right' }}>~85%</td>
              <td className="num" style={{ textAlign: 'right' }}>~5</td>
              <td className="num pos-text" style={{ textAlign: 'right' }}>positive</td>
              <td className="num neg-text" style={{ textAlign: 'right' }}>—</td>
            </tr>
            <tr style={{ background: 'rgba(var(--pos-rgb),0.05)' }}>
              <td style={{ fontWeight: 600 }}>ABC + pyramid combined ⭐</td>
              <td className="num" style={{ textAlign: 'right' }}>21</td>
              <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>90.5%</td>
              <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>8.45</td>
              <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>+$8,918</td>
              <td className="num neg-text" style={{ textAlign: 'right' }}>-$611</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ToneCard tone="emerald">
        <p className="adm-p">
          <strong>The 21 ABC + pyramid trades are the highest-quality subset in the portfolio</strong> — 90.5% WR, PF 8.45, only 2 losers in 6.7 years.
          Disabling pyramid on ABC would forfeit ~33% of these trades&apos; value for a trivial risk reduction. <strong>Keep pyramid on ABC.</strong>
        </p>
      </ToneCard>

      <H2>3 · Trailing-secured 6th/7th lane (cap5+2)</H2>
      <p className="adm-p adm-p-muted">
        Standard cap is 5 active lanes. <strong>Once a lane reaches +1.5% MFE</strong> (the first dynamic trail tier), its floor sits above entry → guaranteed positive PnL on exit.
        Such &quot;trailing-secured&quot; lanes don&apos;t count toward the 5-lane cap, allowing up to 2 additional fresh entries while old winners trail to exit.
      </p>
      <div className="card card-pad">
        <p className="adm-p adm-p-sm">
          <strong>Why it works:</strong> trailing-secured lanes have bounded downside (worst-case = trail floor). In cross-margin, their unrealized PnL <em>adds</em> to free margin — opening a 6th lane actually nets free capital, not consumes it.
        </p>
        <p className="adm-p adm-p-sm" style={{ marginTop: 6 }}>
          <strong>Backtest impact:</strong> adds +650 trades over 6.7yr (3.8% more trades). +$47k PnL on Aggressive (1.0×) tier. Max DD unchanged (the extra trades don&apos;t materially affect peak-trough drawdown).
        </p>
      </div>

      <H2>4 · Three tier multipliers (0.5× / 0.75× / 1.0×)</H2>
      <p className="adm-p adm-p-muted">
        Updated 2026-05-10. The new &quot;Aggressive&quot; 1.0× is what was previously &quot;Bold&quot; — capping the worst-case single-trade loss at 13.8% of starting capital.
      </p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th style={{ textAlign: 'right' }}>Multiplier</th>
              <th style={{ textAlign: 'right' }}>Per-lane $</th>
              <th style={{ textAlign: 'right' }}>ABC+Pyr effective</th>
              <th style={{ textAlign: 'right' }}>Max DD</th>
              <th style={{ textAlign: 'right' }}>Worst single trade</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pos-text" style={{ fontWeight: 600 }}>Conservative</td>
              <td className="num" style={{ textAlign: 'right' }}>0.5×</td>
              <td className="num" style={{ textAlign: 'right' }}>$5,000</td>
              <td className="num" style={{ textAlign: 'right' }}>1.125× ($11,250)</td>
              <td className="num pos-text" style={{ textAlign: 'right' }}>7.89%</td>
              <td className="num" style={{ textAlign: 'right' }}>-$688 (6.9%)</td>
            </tr>
            <tr style={{ background: 'rgba(212,160,23,0.05)' }}>
              <td style={{ color: 'var(--gold)', fontWeight: 600 }}>Moderate (default)</td>
              <td className="num" style={{ textAlign: 'right' }}>0.75×</td>
              <td className="num" style={{ textAlign: 'right' }}>$7,500</td>
              <td className="num" style={{ textAlign: 'right' }}>1.688× ($16,875)</td>
              <td className="num" style={{ textAlign: 'right' }}>9.43%</td>
              <td className="num" style={{ textAlign: 'right' }}>-$1,032 (10.3%)</td>
            </tr>
            <tr>
              <td className="neg-text" style={{ fontWeight: 600 }}>Aggressive</td>
              <td className="num" style={{ textAlign: 'right' }}>1.0×</td>
              <td className="num" style={{ textAlign: 'right' }}>$10,000</td>
              <td className="num" style={{ textAlign: 'right' }}>2.25× ($22,500)</td>
              <td className="num" style={{ textAlign: 'right' }}>10.45%</td>
              <td className="num" style={{ textAlign: 'right' }}>-$1,376 (13.8%)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="adm-stat-sub" style={{ marginTop: 8 }}>
        ABC+Pyr effective notional = tier × 1.5 (ABC) × 1.5 (pyramid added on top). Worst-case loss bounded by 4% SL × effective notional.
      </p>

      <H2>Losing-streak frequency (sanity check)</H2>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>Streak length</th><th style={{ textAlign: 'right' }}>Count over 6.7yr</th><th style={{ textAlign: 'right' }}>Frequency</th><th>Date of worst</th></tr></thead>
          <tbody>
            <tr><td>13 in a row</td><td className="num" style={{ textAlign: 'right' }}>1</td><td className="num" style={{ textAlign: 'right' }}>once</td><td className="num">2021-04-14 (15.9h, 5 lanes)</td></tr>
            <tr><td>≥10 in a row</td><td className="num" style={{ textAlign: 'right' }}>5</td><td className="num" style={{ textAlign: 'right' }}>~once / 16mo</td><td className="adm-muted">—</td></tr>
            <tr><td>≥8 in a row</td><td className="num" style={{ textAlign: 'right' }}>18</td><td className="num" style={{ textAlign: 'right' }}>every ~4.5mo</td><td className="adm-muted">—</td></tr>
            <tr><td>≥5 in a row</td><td className="num" style={{ textAlign: 'right' }}>147</td><td className="num" style={{ textAlign: 'right' }}>~2 / month</td><td className="adm-muted">expected at this WR</td></tr>
          </tbody>
        </table>
      </div>

      <H2>What we&apos;re NOT shipping (and why)</H2>
      <div className="card card-pad">
        <ul className="adm-list">
          <li><span className="neg-text">✗</span> <strong>Confluence-tiered sizing (past 12h)</strong> — +19.7% PnL but +50% peak leverage; risk/reward not worth it.</li>
          <li><span className="neg-text">✗</span> <strong>Quantum scoring engine</strong> — in-sample looked great (25pp WR lift top decile), OOS evaporated to 10pp AND $PnL spread went negative. Overfit.</li>
          <li><span className="neg-text">✗</span> <strong>Smart replacement (rodizio swap)</strong> — perfect-lookahead gave 21% lift; real-world heuristic estimated 4–8%, with complex implementation cost.</li>
          <li><span className="neg-text">✗</span> <strong>Same-bar reentry after rollover</strong> — adds 47 trades over 6.7yr, loses $16,678 net. The 4h implicit cooldown is alpha; keep it.</li>
        </ul>
      </div>

      <footer className="adm-footer">
        Backtest scripts: <Code>/tmp/abc-tiered-comprehensive-backtest.js</Code> · <Code>/tmp/per-trade-classified.json</Code> · re-run instantly from cache for any new tier-multiplier configuration.
      </footer>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Execution Architecture — pipeline diagram
// ════════════════════════════════════════════════════════════════════════════

type ArchStep = {
  num: number
  name: string
  badge: string
  tone: Tone
  desc: React.ReactNode
  tags: string[]
  side?: { title: string; tone: Tone; desc: string; examples: { text: string; tone: 'pos' | 'neg' | 'muted' }[] }
}

const ARCH_STEPS: ArchStep[] = [
  {
    num: 1, name: 'Strategy producer', badge: 'V1 LIVE', tone: 'amber',
    desc: <>Per-asset PM2 processes (<Code>live-engine-v1-{'{btc,eth,sol,xrp,sui,doge,link}'}</Code>) poll Bitget REST every 10s. On each new 4H bar they evaluate the V1 entry/exit logic (HVN breakout + per-asset BB-width gate) and emit signals to the queue protocol.</>,
    tags: ['poll: 10s', 'entries at 4H bar close', 'exits anytime', 'lookahead-safe'],
  },
  {
    num: 2, name: 'Signal queue protocol', badge: 'ATOMIC', tone: 'cyan',
    desc: <>Producer appends to <Code>signal-confirmed-bitget-{'{asset}'}.json</Code>. Executor reads cursor from <Code>signal-consumed-bitget-{'{asset}'}.json</Code>. Append-only files; if either side crashes mid-write, the other side still has consistent state.</>,
    tags: ['file: append-only', 'cursor: per-asset', 'no broker, no DB'],
  },
  {
    num: 3, name: 'Signal executor', badge: 'GATE', tone: 'amber',
    desc: <>Polls all 7 asset queues every 5s. Pre-flight: kill switch check, account balance, per-tier sizing, max-margin headroom, duplicate-in-flight check. Routes ENTRY/EXIT/PYRAMID to Bitget via the Staxs execute-signal API.</>,
    tags: ['kill-switch aware', 'tier sizing', 'duplicate suppression'],
    side: { title: 'Cap5+2 enforcement', tone: 'violet', desc: 'Counts non-trailing-secured open positions; rejects new entries at the cap.', examples: [
      { text: '5 active + 0 secured → accept new', tone: 'pos' },
      { text: '5 active + 2 secured → accept new (replaces oldest secured if needed)', tone: 'pos' },
      { text: '5 active + 0 secured + 6th signal → reject', tone: 'neg' },
    ] },
  },
  {
    num: 4, name: 'Bitget API', badge: 'EXCHANGE', tone: 'emerald',
    desc: <>Limit-order entry at <Code>signal_price × (1 − offset%)</Code> (0.3% by default). If unfilled in 60min, cancel + market fallback. SL at fill price × (1 − 4%). Cross-margin per asset with global 4× leverage cap.</>,
    tags: ['limit-or-market', '60min wait', '4% hard SL', 'cross-margin'],
  },
  {
    num: 5, name: 'Position monitor', badge: 'SHADOW', tone: 'rose',
    desc: <>Independent process polls Bitget every 30s. If engine state shows open but Bitget shows flat (or vice versa), fires RECON_ORPHAN alert. Also detects SL hits before engine sees them and force-closes the trade in the DB.</>,
    tags: ['poll: 30s', 'reconciles state', 'forces DB close on missed SL'],
  },
  {
    num: 6, name: 'Parity validator', badge: 'AUDIT', tone: 'cyan',
    desc: <>~5 min after each live signal, compares it to the backtest simulator&apos;s trades. 0.1% price tolerance, 10min match window. Drift &gt; tolerance fires a warning; no match in 15min fires RECON_NO_SIM_MATCH critical alert.</>,
    tags: ['per-signal', 'tolerance: 0.1%', 'severity: ok/drift/fail'],
  },
  {
    num: 7, name: 'Deadman switch', badge: 'WATCHDOG', tone: 'violet',
    desc: <>Edge-triggered heartbeat monitor. If producer, executor, monitor, or parity validator stops emitting heartbeats, fires PROCESS_DOWN Telegram alert within 1min. Also detects stuck pending fills and signal-queue blockages.</>,
    tags: ['edge-triggered', 'TG alerts', '1min latency'],
  },
]

export function ExecutionArchitecturePanel({ active: _active }: { active: boolean }) {
  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">ADMIN · ARCHITECTURE</div>
        <h1 className="bt-title">Execution <span className="bt-title-gold">pipeline.</span></h1>
        <p className="bt-blurb">From strategy signal to exchange fill, with safeguards. Each step lives as its own PM2 process; signals pass via append-only JSON queues so failure of any one node doesn&apos;t corrupt state.</p>
      </div>

      <div className="adm-arch-flow">
        {ARCH_STEPS.map((s, i) => (
          <div key={s.num} className="adm-arch-step">
            {i > 0 && (
              <div className="adm-arch-connector">
                <div className="adm-arch-line" />
                <div className="adm-arch-arrow">▼</div>
                <div className="adm-arch-conn-label">SIGNAL FLOW</div>
                <div className="adm-arch-line" />
              </div>
            )}
            <div className="adm-arch-row">
              <div className="card card-pad adm-arch-card">
                <div className="adm-arch-head">
                  <div className="adm-arch-num" style={{
                    background: `rgba(${toneStyle(s.tone).rgb}, 0.12)`,
                    color: toneStyle(s.tone).solid,
                  }}>{s.num}</div>
                  <div className="adm-arch-name">{s.name}</div>
                  <ToneBadge tone={s.tone}>{s.badge}</ToneBadge>
                </div>
                <p className="adm-p adm-p-sm">{s.desc}</p>
                <div className="adm-arch-tags">
                  {s.tags.map(t => <span key={t} className="adm-arch-tag">{t}</span>)}
                </div>
              </div>
              {s.side && (
                <div className="adm-arch-side">
                  <div className="card card-pad" style={{ borderColor: `rgba(${toneStyle(s.side.tone).rgb}, 0.3)` }}>
                    <div className="adm-edge-name" style={{ color: toneStyle(s.side.tone).solid, marginBottom: 4 }}>{s.side.title}</div>
                    <p className="adm-p adm-p-sm" style={{ color: 'var(--muted)' }}>{s.side.desc}</p>
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {s.side.examples.map((ex, j) => (
                        <div key={j} className={'adm-arch-example adm-arch-example-' + ex.tone}>{ex.text}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <H2>State files</H2>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>Path</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td className="num adm-mono-sm"><Code>agents/live-engine-v1/state-{'{symbol}'}.json</Code></td><td>Per-asset live engine state. Authoritative for engine decisions.</td></tr>
            <tr><td className="num adm-mono-sm"><Code>the-hive/signal-confirmed-bitget-{'{asset}'}.json</Code></td><td>Signal queue. Engines append, executor reads.</td></tr>
            <tr><td className="num adm-mono-sm"><Code>the-hive/signal-consumed-bitget-{'{asset}'}.json</Code></td><td>Per-asset consume cursor.</td></tr>
            <tr><td className="num adm-mono-sm"><Code>/tmp/reconciliation-status.json</Code></td><td>Recon-cron output. DB ↔ exchange diff.</td></tr>
            <tr><td className="num adm-mono-sm"><Code>/tmp/staxs-feed-status.json</Code></td><td>Feed freshness monitor. Per-asset lag.</td></tr>
            <tr><td className="num adm-mono-sm"><Code>/tmp/deadman-heartbeat.json</Code></td><td>Strategy daemon heartbeat. Edge-triggered TG alerts.</td></tr>
            <tr><td className="num adm-mono-sm"><Code>/tmp/staxs-kill-switch</Code></td><td>If present, executor refuses all signals (manual halt).</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Best Staxs — stack leaderboard (top 100 stacks)
//    Reads from /public/data/staxs-leaderboard.json (updated every 60s by
//    phase_h_staxs_lb.py). Source = 'staxs' on the msga-leaderboard endpoint.
// ════════════════════════════════════════════════════════════════════════════

type StackRow = {
  rank: number
  sig: string
  phase: string
  size: number
  sids: string[]
  archetypes: string[]
  archetype_mix: string
  asset_coverage: string
  wr: number
  pf: number
  total_pct: number
  max_dd_pct: number
  ra: number
  skip_rate: number
  n_signals: number
  n_taken: number
  capital_eff: number
  composite_score: number
  wr_position: number | null
  wr_tv: number | null
  pf_position: number | null
  pf_tv: number | null
  n_position: number | null
  n_tv: number | null
  monthly_win_rate_pct: number | null
  longest_underwater_days: number | null
}

type StackSortKey = 'rank' | 'phase' | 'size' | 'archetype_mix' | 'asset_coverage' |
  'wr' | 'pf' | 'total_pct' | 'max_dd_pct' | 'ra' | 'skip_rate' |
  'n_signals' | 'n_taken' | 'capital_eff' | 'composite_score' |
  'wr_position' | 'wr_tv' | 'pf_position' | 'pf_tv' |
  'monthly_win_rate_pct' | 'longest_underwater_days'

export function BestStaxsPanel({ active }: { active: boolean }) {
  const [rows, setRows] = useState<StackRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [updatedAt, setUpdatedAt] = useState<string>('')
  const [total, setTotal] = useState<number>(0)
  const [sort, setSort] = useState<{ key: StackSortKey; dir: 'asc' | 'desc' }>({
    key: 'composite_score', dir: 'desc',
  })
  // Filters
  const [filterSize, setFilterSize] = useState<string>('all')
  const [filterArchetype, setFilterArchetype] = useState<string>('all')
  const [filterAsset, setFilterAsset] = useState<string>('all')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await authedFetch<{
          rows?: StackRow[]; updatedAt?: string; total_unique_stacks?: number;
        }>('/api/admin/msga-leaderboard?strategy=staxs', { cache: 'no-store' })
        if (cancelled) return
        setRows(data.rows ?? [])
        setUpdatedAt(String(data.updatedAt ?? ''))
        setTotal(Number(data.total_unique_stacks ?? 0))
      } catch (e) {
        if (typeof window !== 'undefined') console.warn('[staxs-leaderboard] fetch failed:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (!active) { setLoading(false); return () => { cancelled = true } }
    load()
    const t = setInterval(load, 120_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [active])

  const archetypeOptions = Array.from(new Set(rows.flatMap(r => r.archetypes ?? []))).sort()
  const sizeOptions = Array.from(new Set(rows.map(r => r.size))).sort((a, b) => a - b)
  const assetOptions = Array.from(new Set(rows.map(r => r.asset_coverage))).sort()

  const filtered = rows.filter(r => {
    if (filterSize !== 'all' && r.size !== Number(filterSize)) return false
    if (filterArchetype !== 'all' && !(r.archetypes ?? []).includes(filterArchetype)) return false
    if (filterAsset !== 'all' && r.asset_coverage !== filterAsset) return false
    return true
  })

  const onSort = (k: StackSortKey) => {
    setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' })
  }
  const sorted = [...filtered].sort((a, b) => {
    const av = (a as unknown as Record<StackSortKey, unknown>)[sort.key]
    const bv = (b as unknown as Record<StackSortKey, unknown>)[sort.key]
    let cmp = 0
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
    else cmp = String(av ?? '').localeCompare(String(bv ?? ''))
    return sort.dir === 'asc' ? cmp : -cmp
  })

  const arrow = (k: StackSortKey) => sort.key !== k ? '' : (sort.dir === 'asc' ? ' ↑' : ' ↓')

  return (
    <div className="stax-page">
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Best Staxs 🥞 — top {rows.length} stacks</h2>
        <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>
          {total > 0 ? `${total} unique stacks scored` : ''} · updated {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}{dataFreshness(updatedAt)?.stale ? ` — ${dataFreshness(updatedAt)!.days}d old, SNAPSHOT` : ''}
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          Size:&nbsp;
          <select value={filterSize} onChange={e => setFilterSize(e.target.value)} style={{ fontSize: 12, padding: '2px 6px' }}>
            <option value="all">All</option>
            {sizeOptions.map(s => <option key={s} value={s}>{s}-cfg</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          Has archetype:&nbsp;
          <select value={filterArchetype} onChange={e => setFilterArchetype(e.target.value)} style={{ fontSize: 12, padding: '2px 6px' }}>
            <option value="all">All</option>
            {archetypeOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          Asset coverage:&nbsp;
          <select value={filterAsset} onChange={e => setFilterAsset(e.target.value)} style={{ fontSize: 12, padding: '2px 6px' }}>
            <option value="all">All</option>
            {assetOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)', marginLeft: 'auto' }}>
          showing {sorted.length} / {rows.length}
        </span>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
        <table className="adm-table" style={{ fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-2, #f1f5f9)' }}>
            <tr>
              <th onClick={() => onSort('rank')} style={{ cursor: 'pointer' }}>#{arrow('rank')}</th>
              <th onClick={() => onSort('phase')} style={{ cursor: 'pointer' }}>Phase{arrow('phase')}</th>
              <th onClick={() => onSort('size')} style={{ cursor: 'pointer' }}>Sz{arrow('size')}</th>
              <th onClick={() => onSort('archetype_mix')} style={{ cursor: 'pointer' }}>Archetypes{arrow('archetype_mix')}</th>
              <th onClick={() => onSort('asset_coverage')} style={{ cursor: 'pointer' }}>Assets{arrow('asset_coverage')}</th>
              <th onClick={() => onSort('wr')} style={{ cursor: 'pointer' }}>WR%{arrow('wr')}</th>
              <th onClick={() => onSort('pf')} style={{ cursor: 'pointer' }}>PF{arrow('pf')}</th>
              <th onClick={() => onSort('total_pct')} style={{ cursor: 'pointer' }}>Total%{arrow('total_pct')}</th>
              <th onClick={() => onSort('max_dd_pct')} style={{ cursor: 'pointer' }}>DD%{arrow('max_dd_pct')}</th>
              <th onClick={() => onSort('ra')} style={{ cursor: 'pointer' }}>RA{arrow('ra')}</th>
              <th onClick={() => onSort('skip_rate')} style={{ cursor: 'pointer' }}>Skip{arrow('skip_rate')}</th>
              <th onClick={() => onSort('n_taken')} style={{ cursor: 'pointer' }}>n taken{arrow('n_taken')}</th>
              <th onClick={() => onSort('wr_position')} style={{ cursor: 'pointer' }}>WR pos{arrow('wr_position')}</th>
              <th onClick={() => onSort('pf_position')} style={{ cursor: 'pointer' }}>PF pos{arrow('pf_position')}</th>
              <th onClick={() => onSort('monthly_win_rate_pct')} style={{ cursor: 'pointer' }}>Mo+%{arrow('monthly_win_rate_pct')}</th>
              <th onClick={() => onSort('longest_underwater_days')} style={{ cursor: 'pointer' }}>UW d{arrow('longest_underwater_days')}</th>
              <th onClick={() => onSort('composite_score')} style={{ cursor: 'pointer' }}>Comp{arrow('composite_score')}</th>
              <th>sids</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={18} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-mute)' }}>Loading stacks…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={18} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-mute)' }}>No stacks match filters.</td></tr>
            ) : sorted.map(r => (
              <tr key={`${r.phase}-${r.sig}`}>
                <td>{r.rank}</td>
                <td style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{r.phase}</td>
                <td>{r.size}</td>
                <td style={{ fontSize: 10, color: 'var(--ink-mute)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.archetype_mix}>{r.archetype_mix}</td>
                <td style={{ fontSize: 10 }}>{r.asset_coverage}</td>
                <td className="num">{r.wr.toFixed(1)}</td>
                <td className="num">{r.pf.toFixed(2)}</td>
                <td className="num" style={{ color: r.total_pct > 0 ? 'var(--ok)' : 'var(--err)' }}>{r.total_pct > 0 ? '+' : ''}{r.total_pct.toFixed(0)}%</td>
                <td className="num" style={{ color: 'var(--err)' }}>{r.max_dd_pct.toFixed(1)}%</td>
                <td className="num">{r.ra.toFixed(1)}</td>
                <td className="num" style={{ fontSize: 10 }}>{(r.skip_rate * 100).toFixed(0)}%</td>
                <td className="num">{r.n_taken}</td>
                <td className="num" style={{ color: 'var(--ink-mute)' }}>{r.wr_position != null ? r.wr_position.toFixed(1) : '—'}</td>
                <td className="num" style={{ color: 'var(--ink-mute)' }}>{r.pf_position != null ? r.pf_position.toFixed(2) : '—'}</td>
                <td className="num" style={{ color: 'var(--ink-mute)' }}>{r.monthly_win_rate_pct != null ? r.monthly_win_rate_pct.toFixed(0) + '%' : '—'}</td>
                <td className="num" style={{ color: 'var(--ink-mute)' }}>{r.longest_underwater_days != null ? r.longest_underwater_days + 'd' : '—'}</td>
                <td className="num"><strong>{r.composite_score.toFixed(1)}</strong></td>
                <td className="adm-mono-sm" style={{ fontSize: 9, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sids.join(', ')}>{r.sids.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-mute)' }}>
        Source: <code>/api/admin/msga-leaderboard?strategy=staxs</code> ← <code>staxs-leaderboard.json</code> (Phase F + Phase 2 + Phase 4 stacks, updated every 60s).
        Dual WR/PF (position vs TV) populated when partial-TP cfgs are in stack. Monthly+% / UW days computed for top stacks only.
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 2026-08-05 · CFG DISCOVERY leaderboard
// New-archetype sweep output. Every row has already cleared the standalone gate
// (TF floor + per-year consistency + PF >= incumbent median + IS/OOS + plateau);
// this panel is for slicing what survived — sort any column, filter on WR/PF/etc.
// ────────────────────────────────────────────────────────────────────────────

type DiscRow = {
  rank: number; id: string; asset: string; tf: string; archetype: string; direction: string
  n: number; tpy: number | null; pf: number; wr: number; net: number; mdd: number
  is_pf: number; is_n: number; oos_pf: number; oos_n: number
  yrs_solid: number; yrs_pos: number; yrs_pf2: number; worst_yr_pf: number | null
  plateau: number | null; nbhd: number | null
  x_len?: number; x_mult?: number; x_len2?: number; x_mult2?: number; x_mode?: string
  x_prim?: string; x_conf?: string; x_tgate?: string; x_htf?: number
  sl_type?: string; trail_mode?: string; breakeven_at_R?: string
  per_year?: Record<string, [number, number, number]>
}
type DiscKey = 'rank'|'asset'|'tf'|'archetype'|'direction'|'n'|'tpy'|'pf'|'wr'|'net'|'mdd'
  |'is_pf'|'oos_pf'|'yrs_solid'|'yrs_pos'|'worst_yr_pf'|'plateau'

const DISC_COLS: Array<{ k: DiscKey; label: string; num: boolean; title?: string }> = [
  { k: 'rank',        label: '#',        num: true  },
  { k: 'asset',       label: 'Asset',    num: false },
  { k: 'tf',          label: 'TF',       num: false },
  { k: 'archetype',   label: 'Archetype',num: false },
  { k: 'direction',   label: 'Dir',      num: false },
  { k: 'n',           label: 'n',        num: true,  title: 'total trades over the pinned ~7y window' },
  { k: 'tpy',         label: 't/yr',     num: true,  title: 'trades per year' },
  { k: 'pf',          label: 'PF',       num: true,  title: 'profit factor, standalone' },
  { k: 'wr',          label: 'WR %',     num: true,  title: 'win rate' },
  { k: 'net',         label: 'Net $',    num: true,  title: 'flat-notional net P&L' },
  { k: 'mdd',         label: 'maxDD %',  num: true },
  { k: 'is_pf',       label: 'IS PF',    num: true,  title: 'in-sample (first 70% of bars)' },
  { k: 'oos_pf',      label: 'OOS PF',   num: true,  title: 'out-of-sample (last 30%)' },
  { k: 'yrs_pos',     label: 'yrs+',     num: true,  title: 'years profitable (of years with >=10 trades)' },
  { k: 'yrs_solid',   label: 'yrs',      num: true,  title: 'years carrying >=10 trades' },
  { k: 'worst_yr_pf', label: 'worst yr', num: true,  title: 'lowest single-year PF' },
  { k: 'plateau',     label: 'plateau %',num: true,  title: 'share of the parameter neighbourhood also at PF>=1.5' },
]

export function DiscoveryPanel({ active }: { active: boolean }) {
  const [rows, setRows] = useState<DiscRow[]>([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [gate, setGate] = useState<{ rules?: string[] } | null>(null)
  const [basis, setBasis] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: DiscKey; dir: 'asc' | 'desc' }>({ key: 'pf', dir: 'desc' })
  // filters
  const [fAsset, setFAsset] = useState('all')
  const [fTf, setFTf] = useState('all')
  const [fArch, setFArch] = useState('all')
  const [fDir, setFDir] = useState('all')
  const [wrMin, setWrMin] = useState('')
  const [wrMax, setWrMax] = useState('')
  const [pfMin, setPfMin] = useState('')
  const [nMin, setNMin] = useState('')
  const [oosMin, setOosMin] = useState('')

  // Only poll while the tab is actually on screen — the legacy panels fetch
  // regardless of visibility, which is what made this page feel broken.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async () => {
      try {
        const d = await authedFetch<{ rows?: DiscRow[]; updatedAt?: string; gate?: { rules?: string[] }; basis?: string }>(
          '/api/admin/msga-leaderboard?strategy=discovery', { cache: 'no-store' })
        if (cancelled) return
        setRows(d.rows ?? []); setUpdatedAt(String(d.updatedAt ?? ''))
        setGate(d.gate ?? null); setBasis(String(d.basis ?? ''))
      } catch (e) {
        if (typeof window !== 'undefined') console.warn('[discovery] fetch failed:', e)
      } finally { if (!cancelled) setLoading(false) }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [active])

  const uniq = (f: (r: DiscRow) => string) => Array.from(new Set(rows.map(f))).sort()
  const num = (s: string) => (s.trim() === '' ? null : Number(s))

  const filtered = rows.filter(r => {
    if (fAsset !== 'all' && r.asset !== fAsset) return false
    if (fTf !== 'all' && r.tf !== fTf) return false
    if (fArch !== 'all' && r.archetype !== fArch) return false
    if (fDir !== 'all' && r.direction !== fDir) return false
    const a = num(wrMin), b = num(wrMax), c = num(pfMin), d = num(nMin), e = num(oosMin)
    if (a !== null && r.wr < a) return false
    if (b !== null && r.wr > b) return false
    if (c !== null && r.pf < c) return false
    if (d !== null && r.n < d) return false
    if (e !== null && r.oos_pf < e) return false
    return true
  })
  const sorted = [...filtered].sort((x, y) => {
    const av = x[sort.key] as unknown, bv = y[sort.key] as unknown
    let cmp = 0
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
    else if (av === null || av === undefined) cmp = -1
    else if (bv === null || bv === undefined) cmp = 1
    else cmp = String(av).localeCompare(String(bv))
    return sort.dir === 'asc' ? cmp : -cmp
  })
  const onSort = (k: DiscKey) =>
    setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' }))
  const arrow = (k: DiscKey) => (sort.key !== k ? '' : sort.dir === 'asc' ? ' ↑' : ' ↓')
  const clearAll = () => { setFAsset('all'); setFTf('all'); setFArch('all'); setFDir('all')
    setWrMin(''); setWrMax(''); setPfMin(''); setNMin(''); setOosMin('') }

  const numCell = (v: number | null | undefined, dp = 2) =>
    v === null || v === undefined ? '—' : v.toFixed(dp)

  return (
    <div className="stax-page">
      <div className="bt-header" style={{ marginBottom: 12 }}>
        <div className="bt-eyebrow">ADMIN · STRATEGY · CFG DISCOVERY</div>
        <h1 className="bt-title">New-archetype sweep <span className="bt-title-gold">survivors.</span></h1>
        <p className="bt-blurb">
          Every row here has already cleared the standalone gate. Sort any column; filter to slice.
          Click a row for its verbatim parameters and per-year breakdown. {basis}
        </p>
      </div>

      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
          {sorted.length} of {rows.length} candidates
        </h2>
        <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>
          updated {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}{dataFreshness(updatedAt)?.stale ? ` — ${dataFreshness(updatedAt)!.days}d old, SNAPSHOT` : ''}
        </span>
      </div>

      {/* Filters */}
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {([['Asset', fAsset, setFAsset, uniq(r => r.asset)],
             ['TF', fTf, setFTf, uniq(r => r.tf)],
             ['Archetype', fArch, setFArch, uniq(r => r.archetype)],
             ['Direction', fDir, setFDir, uniq(r => r.direction)]] as const).map(([lab, val, set, opts]) => (
            <label key={lab} style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {lab}<br />
              <select value={val} onChange={e => (set as (v: string) => void)(e.target.value)}
                      style={{ fontSize: 12, padding: '3px 6px', marginTop: 3, minWidth: 110 }}>
                <option value="all">All</option>
                {(opts as string[]).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {([['WR ≥ %', wrMin, setWrMin], ['WR ≤ %', wrMax, setWrMax], ['PF ≥', pfMin, setPfMin],
             ['n ≥', nMin, setNMin], ['OOS PF ≥', oosMin, setOosMin]] as const).map(([lab, val, set]) => (
            <label key={lab} style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {lab}<br />
              <input value={val} onChange={e => (set as (v: string) => void)(e.target.value)}
                     inputMode="decimal" placeholder="—"
                     style={{ fontSize: 12, padding: '3px 6px', marginTop: 3, width: 72 }} />
            </label>
          ))}
          <button onClick={clearAll} style={{ fontSize: 12, padding: '5px 12px', cursor: 'pointer' }}>Clear</button>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Quick:</span>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setWrMax('55'); setSort({ key: 'pf', dir: 'desc' }) }}>
            WR &lt; 55% · by PF
          </button>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setWrMin('60'); setSort({ key: 'pf', dir: 'desc' }) }}>
            WR ≥ 60% · by PF
          </button>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setPfMin('2.5'); setOosMin('1.5'); setSort({ key: 'oos_pf', dir: 'desc' }) }}>
            PF ≥ 2.5 &amp; OOS ≥ 1.5
          </button>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setSort({ key: 'plateau', dir: 'desc' }) }}>
            Widest plateau
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="adm-table" style={{ fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              {DISC_COLS.map(c => (
                <th key={c.k} title={c.title} onClick={() => onSort(c.k)}
                    style={{ cursor: 'pointer', whiteSpace: 'nowrap', textAlign: c.num ? 'right' : 'left' }}>
                  {c.label}{arrow(c.k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={DISC_COLS.length}>Loading…</td></tr>}
            {!loading && sorted.length === 0 &&
              <tr><td colSpan={DISC_COLS.length}>No rows match these filters.</td></tr>}
            {sorted.map(r => (
              <Fragment key={r.id}>
                <tr onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ textAlign: 'right' }}>{r.rank ?? '—'}</td>
                  <td>{r.asset}</td>
                  <td>{r.tf}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.archetype}</td>
                  <td>{String(r.direction ?? '').replace('_only', '') || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.n ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{numCell(r.tpy, 1)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{numCell(r.pf)}</td>
                  <td style={{ textAlign: 'right' }}>{numCell(r.wr, 1)}</td>
                  <td style={{ textAlign: 'right' }}>{typeof r.net === 'number' ? r.net.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{numCell(r.mdd, 1)}</td>
                  <td style={{ textAlign: 'right' }}>{numCell(r.is_pf)}</td>
                  <td style={{ textAlign: 'right' }}>{numCell(r.oos_pf)}</td>
                  <td style={{ textAlign: 'right' }}>{r.yrs_pos ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.yrs_solid ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{numCell(r.worst_yr_pf)}</td>
                  <td style={{ textAlign: 'right' }}>{typeof r.plateau === 'number' ? `${r.plateau.toFixed(0)}%` : '—'}</td>
                </tr>
                {expanded === r.id && (
                  <tr>
                    <td colSpan={DISC_COLS.length} style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7 }}>
                        <div><strong>verbatim cfg</strong></div>
                        <div>entry_archetype={r.archetype} tf={r.tf} direction={r.direction}</div>
                        <div>x_len={r.x_len} x_mult={r.x_mult} x_len2={r.x_len2} x_mult2={r.x_mult2} x_mode={r.x_mode}</div>
                        {r.x_prim && <div>x_prim={r.x_prim} x_conf={r.x_conf} x_tgate={r.x_tgate} x_htf={r.x_htf}</div>}
                        <div>sl_type={r.sl_type} trail_mode={r.trail_mode} breakeven_at_R={r.breakeven_at_R}</div>
                        <div>slippage_bps=2.0 commission_taker_pct=0.06</div>
                        {r.per_year && (
                          <div style={{ marginTop: 8 }}>
                            <strong>per-year [n · PF · net]</strong>
                            <div>{Object.entries(r.per_year).sort().map(([y, v]) =>
                              `${y}: ${v[0]} · ${Number(v[1]).toFixed(2)} · ${Number(v[2]).toFixed(0)}`).join('   ')}</div>
                          </div>
                        )}
                        <div style={{ marginTop: 6, color: 'var(--ink-mute)' }}>
                          plateau {r.plateau ?? 'n/a'}% of {r.nbhd ?? '?'} neighbours ·
                          IS n={r.is_n} / OOS n={r.oos_n}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {gate?.rules && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>The gate every row above has passed</div>
          <ol style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {gate.rules.map((x, i) => <li key={i}>{x}</li>)}
          </ol>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// CFG QUALITY — the 70-cfg basket, STANDALONE beside SEATED.
//
// Bible §CFG-QUALITY: a cfg's quality is judged STANDALONE — every signal it fires, with no FCFS
// lane competition. The metrics of whichever arbitrary subset happened to win a lane do not measure
// the cfg. So this table shows both, side by side, and the GAP between them is the finding:
//   strong standalone + big gap  -> being crowded out; a LANE problem, not a cfg problem
//   weak standalone              -> mis-admitted; an admission failure
//
// Bible §BASIS: both sides are scored on the LOCKED risk-sized basis through the identical
// risk_sizing_canonical formula, so the difference is seating and nothing else. The header states
// the basis; every column says which side it belongs to.
// ────────────────────────────────────────────────────────────────────────────────────────────
type CqRow = {
  sid: string; asset: string; tf: string; archetype: string; direction: string
  sa_trades: number; sa_winRate: number; sa_profitFactor: number; sa_netUsd: number
  seated_trades: number; seated_netUsd: number; seatRate: number; lost: number; gapPct: number
}
type CqKey = keyof CqRow

export function CfgQualityPanel({ active }: { active: boolean }) {
  const [rows, setRows] = useState<CqRow[]>([])
  const [basis, setBasis] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<{ key: CqKey; dir: 'asc' | 'desc' }>({ key: 'lost', dir: 'desc' })
  const [fAsset, setFAsset] = useState('all')
  const [fTf, setFTf] = useState('all')
  const [fArch, setFArch] = useState('all')
  const [fDir, setFDir] = useState('all')
  const [wrMin, setWrMin] = useState('')
  const [wrMax, setWrMax] = useState('')
  const [pfMin, setPfMin] = useState('')
  const [nMin, setNMin] = useState('')
  const [seatMax, setSeatMax] = useState('')

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async () => {
      try {
        const d = await authedFetch<{ rows?: CqRow[]; updatedAt?: string; basis?: string }>(
          '/api/admin/msga-leaderboard?strategy=cfgquality', { cache: 'no-store' })
        if (cancelled) return
        setRows(d.rows ?? []); setBasis(String(d.basis ?? '')); setUpdatedAt(String(d.updatedAt ?? ''))
      } catch (e) {
        if (typeof window !== 'undefined') console.warn('[cfg-quality] fetch failed:', e)
      } finally { if (!cancelled) setLoading(false) }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [active])

  const uniq = (f: (r: CqRow) => string) => Array.from(new Set(rows.map(f).filter(Boolean))).sort()
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const clearAll = () => {
    setFAsset('all'); setFTf('all'); setFArch('all'); setFDir('all')
    setWrMin(''); setWrMax(''); setPfMin(''); setNMin(''); setSeatMax('')
  }

  const filtered = rows.filter(r => {
    if (fAsset !== 'all' && r.asset !== fAsset) return false
    if (fTf !== 'all' && r.tf !== fTf) return false
    if (fArch !== 'all' && r.archetype !== fArch) return false
    if (fDir !== 'all' && r.direction !== fDir) return false
    const a = num(wrMin), b = num(wrMax), c = num(pfMin), d = num(nMin), e = num(seatMax)
    if (a !== null && r.sa_winRate < a) return false
    if (b !== null && r.sa_winRate > b) return false
    if (c !== null && r.sa_profitFactor < c) return false
    if (d !== null && r.sa_trades < d) return false
    if (e !== null && r.seatRate > e) return false
    return true
  })
  const sorted = [...filtered].sort((x, y) => {
    const av = x[sort.key], bv = y[sort.key]
    const n = typeof av === 'number' && typeof bv === 'number'
      ? av - bv : String(av).localeCompare(String(bv))
    return sort.dir === 'asc' ? n : -n
  })
  const onSort = (k: CqKey) =>
    setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' }))
  const arrow = (k: CqKey) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')
  const totSa = filtered.reduce((s, r) => s + (r.sa_netUsd || 0), 0)
  const totSe = filtered.reduce((s, r) => s + (r.seated_netUsd || 0), 0)

  if (!active) return null
  const H = ({ k, children, title }: { k: CqKey; children: React.ReactNode; title?: string }) => (
    <th onClick={() => onSort(k)} title={title}
        style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700 }}>
      {children}{arrow(k)}
    </th>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          CFG Quality 🎯 — {sorted.length} of {rows.length} basket cfgs
        </h2>
        <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>
          updated {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}
          {dataFreshness(updatedAt)?.stale ? ` — ${dataFreshness(updatedAt)!.days}d old, SNAPSHOT` : ''}
        </span>
      </div>

      <div className="card card-pad" style={{ marginTop: 8, marginBottom: 12, fontSize: 12, lineHeight: 1.5 }}>
        <strong>Quality is STANDALONE.</strong> The <Code>SA</Code> columns are every signal the cfg fires with no lane
        competition — that is the admission gate. The <Code>SEAT</Code> columns are only the trades that won a lane;
        they measure the <em>book</em>, not the cfg. <strong>GAP</strong> is what seating costs.
        <br />
        <strong>Basis:</strong> {basis || 'locked risk-sized'} — both sides scored through the identical locked formula,
        so the difference is seating and nothing else.
        <br />
        Filtered totals: standalone <strong>${totSa.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> ·
        seated <strong>${totSe.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> ·
        lost to seating <strong style={{ color: '#f59e0b' }}>
          ${(totSa - totSe).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </strong>{totSa > 0 ? ` (${((totSa - totSe) / totSa * 100).toFixed(1)}%)` : ''}
      </div>

      {/* Filters — same control set as CFG Discovery */}
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {([['Asset', fAsset, setFAsset, uniq(r => r.asset)],
             ['TF', fTf, setFTf, uniq(r => r.tf)],
             ['Archetype', fArch, setFArch, uniq(r => r.archetype)],
             ['Direction', fDir, setFDir, uniq(r => r.direction)]] as const).map(([lab, val, set, opts]) => (
            <label key={lab} style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {lab}<br />
              <select value={val} onChange={e => (set as (v: string) => void)(e.target.value)}
                      style={{ fontSize: 12, padding: '3px 6px', marginTop: 3, minWidth: 110 }}>
                <option value="all">All</option>
                {(opts as string[]).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {([['SA WR ≥ %', wrMin, setWrMin], ['SA WR ≤ %', wrMax, setWrMax], ['SA PF ≥', pfMin, setPfMin],
             ['SA n ≥', nMin, setNMin], ['Seat ≤ %', seatMax, setSeatMax]] as const).map(([lab, val, set]) => (
            <label key={lab} style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {lab}<br />
              <input value={val} onChange={e => (set as (v: string) => void)(e.target.value)}
                     inputMode="decimal" placeholder="—"
                     style={{ fontSize: 12, padding: '3px 6px', marginTop: 3, width: 76 }} />
            </label>
          ))}
          <button onClick={clearAll} style={{ fontSize: 12, padding: '5px 12px', cursor: 'pointer' }}>Clear</button>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Quick:</span>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setSeatMax('50'); setSort({ key: 'seatRate', dir: 'asc' }) }}>
            Seat &lt; 50% · starved
          </button>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setSort({ key: 'lost', dir: 'desc' }) }}>
            Worst seating cost
          </button>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setPfMin('2'); setSort({ key: 'lost', dir: 'desc' }) }}>
            SA PF ≥ 2 · by cost
          </button>
          <button style={{ fontSize: 11, padding: '3px 9px', cursor: 'pointer' }}
                  onClick={() => { clearAll(); setSort({ key: 'sa_profitFactor', dir: 'asc' }) }}>
            Weakest standalone PF
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? <p className="adm-p adm-p-muted">Loading…</p> : (
        <div className="card card-pad" style={{ overflowX: 'auto' }}>
          <table className="adm-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>cfg_sid</th>
                <th style={{ textAlign: 'left' }}>asset</th>
                <th style={{ textAlign: 'left' }}>tf</th>
                <th style={{ textAlign: 'left' }}>archetype</th>
                <th style={{ textAlign: 'left' }}>dir</th>
                <H k="sa_trades" title="STANDALONE — every signal the cfg fires">SA n</H>
                <H k="sa_winRate" title="STANDALONE win rate">SA WR%</H>
                <H k="sa_profitFactor" title="STANDALONE profit factor — the quality measure">SA PF</H>
                <H k="sa_netUsd" title="STANDALONE net, locked risk-sized">SA net $</H>
                <H k="seated_trades" title="SEATED — only trades that won a lane">SEAT n</H>
                <H k="seated_netUsd" title="SEATED net, locked risk-sized">SEAT net $</H>
                <H k="seatRate" title="share of its signals that won a lane">seat %</H>
                <H k="lost" title="standalone minus seated — what lane competition cost">GAP $</H>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.sid}>
                  <td className="num adm-mono-sm" style={{ textAlign: 'left' }}>{r.sid}</td>
                  <td style={{ textAlign: 'left' }}>{r.asset}</td>
                  <td style={{ textAlign: 'left' }}>{r.tf}</td>
                  <td style={{ textAlign: 'left' }}>{r.archetype}</td>
                  <td style={{ textAlign: 'left' }}>{r.direction}</td>
                  <td className="num">{r.sa_trades}</td>
                  <td className="num">{r.sa_winRate?.toFixed(1)}</td>
                  <td className="num" style={{ fontWeight: r.sa_profitFactor < 1 ? 700 : 400,
                                               color: r.sa_profitFactor < 1 ? '#ef4444' : undefined }}>
                    {r.sa_profitFactor?.toFixed(2)}
                  </td>
                  <td className="num">{Math.round(r.sa_netUsd).toLocaleString()}</td>
                  <td className="num">{r.seated_trades}</td>
                  <td className="num">{Math.round(r.seated_netUsd).toLocaleString()}</td>
                  <td className="num" style={{ color: r.seatRate < 50 ? '#f59e0b' : undefined }}>
                    {r.seatRate?.toFixed(1)}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{Math.round(r.lost).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Contenders — every candidate scored against the k=58 seed.
//
// WHY THIS TAB EXISTS. The original scorer emitted net_with / net_empty / gain_pct and nothing
// else, so every "admissible" verdict ever produced passed a PnL floor with WIN RATE UNEXAMINED.
// The evaluator had winRate/PF/trades/maxDD per tier all along and the scorer discarded them.
// They are recovered here so a cull can be made on both axes.
//
// DELIBERATELY NO WEIGHTED SCORE and no ranking that trades PnL against win rate. Chris judges;
// the page presents the metrics side by side and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
type CoTier = 'conservative' | 'moderate' | 'aggressive' | 'kamikaze'
const CO_TIERS: { k: CoTier; lanes: number }[] = [
  { k: 'conservative', lanes: 2 }, { k: 'moderate', lanes: 4 },
  { k: 'aggressive', lanes: 6 }, { k: 'kamikaze', lanes: 7 },
]
type CoRow = {
  sid: string; asset: string | null; archetype: string | null; tf: string | null
  direction: string | null
  clearedFloor: boolean; admissible: boolean
  killedBy: { tier: string; pct: number } | null
  verdict: string; gainPct: number | null; seatRate: number | null; contended: boolean | null
  sa_winRate: number | null; sa_profitFactor: number | null
  sa_netUsd: number | null; sa_trades: number | null
  [k: string]: any
}

// 2026-09-16 (Chris, Part A1/A5): this panel rendered the LEGACY 626-row contender population and
// its hand-built-basket tooling. It is KEPT, not deleted — it is simply no longer mounted. The
// population it read is archived at
// research_scratch/ui_archive/LEGACY_CONTENDERS_ARCHIVE_20260916T074940Z (manifest carries every
// sha256 and the restore steps), and its payload file is still on disk, now served under
// ?strategy=contenders-legacy. To bring this back: mount ContendersPanelLegacy instead of
// ContendersPanel and point its fetch at that key.
export function ContendersPanelLegacy({ active }: { active: boolean }) {
  const [rows, setRows] = useState<CoRow[]>([])
  const [meta, setMeta] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // 2026-08-27 UQ1d: default WIDENED from 'floor' to 'all'. The tab reporting "101" was two
  // problems stacked: the file had 101 rows AND the panel opened on a scope that hid anything
  // without clearedFloor. Opening on 'all' means the count on screen is the count in the file.
  const [scope, setScope] = useState<'floor' | 'admissible' | 'all'>('all')
  const [wrFloor, setWrFloor] = useState<string>('')
  const [fAsset, setFAsset] = useState('all')
  const [fArch, setFArch] = useState('all')
  const [fTf, setFTf] = useState('all')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'sa_winRate', dir: 'desc' })
  // 2026-08-28 (Chris): NOTHING IS TICKED BY DEFAULT. It used to default to every row kept, so
  // building a basket by hand meant unticking hundreds of cfgs. `picked` is now the source of
  // truth — empty means empty — and the two buttons below do the bulk work.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [saveMsg, setSaveMsg] = useState('')
  // XA — the hand-built basket simulator. tierS is SEPARATE from keep: a cfg must be kept to be
  // Tier-S (XA1), so unticking keep silently drops it from the Tier-S set at submit time.
  const [tierS, setTierS] = useState<Record<string, boolean>>({})
  const [simRun, setSimRun] = useState<any>(null)
  const [simHist, setSimHist] = useState<any[]>([])
  const [simMsg, setSimMsg] = useState('')
  // XV/XW — presets and the post-run paint. Both are plain state; they live here with every other
  // hook and ABOVE the `if (!active) return null` guard, because a hook after a conditional return
  // is what blanked this tab with React #310.
  const [presets, setPresets] = useState<Record<string, any>>({})
  const [presetName, setPresetName] = useState('')
  const [paint, setPaint] = useState(true)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async () => {
      try {
        const d = await authedFetch<any>('/api/admin/msga-leaderboard?strategy=contenders-legacy',
          { cache: 'no-store' })
        if (cancelled) return
        setRows(d.rows ?? []); setMeta(d)
      } catch (e) {
        if (typeof window !== 'undefined') console.warn('[contenders] fetch failed:', e)
      } finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [active])

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // XA hooks. THESE MUST STAY ABOVE `if (!active) return null`. 2026-08-28: they were BELOW it,
  // so an inactive tab rendered 16 hooks and an active one rendered 18. React counts hooks per
  // render and threw #310 — "rendered more hooks than during the previous render" — which blanked
  // the ENTIRE tab. A hook placed after a conditional return is always a bug, however harmless
  // the hook itself looks. This is the third time this page has gone dark; see the smoke test.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  const loadSimHistory = async () => {
    try {
      const r = await authedFetch<any>('/api/admin/basket-sim')
      setSimHist(Array.isArray(r?.runs) ? r.runs : [])
    } catch { /* history is a convenience; never block the tab on it */ }
  }
  useEffect(() => { if (active) loadSimHistory() }, [active])

  useEffect(() => {
    if (!active) return
    authedFetch<any>('/api/admin/basket-sim?presets=1')
      .then(r => setPresets(r?.presets ?? {}))
      .catch(() => { /* presets are a convenience; never block the tab */ })
  }, [active])

  // XA3: a run takes 2-4 minutes, so poll — never block the page.
  useEffect(() => {
    if (!active) return
    if (!simRun?.runId || simRun.status === 'done' || simRun.status === 'error') return
    let stop = false
    const t = setInterval(async () => {
      try {
        const r = await authedFetch<any>(`/api/admin/basket-sim?runId=${simRun.runId}`)
        if (stop || !r?.runId) return
        setSimRun(r)
        if (r.status === 'done' || r.status === 'error') { clearInterval(t); loadSimHistory() }
      } catch { /* transient poll failure is not a run failure */ }
    }, 4000)
    return () => { stop = true; clearInterval(t) }
  }, [active, simRun?.runId, simRun?.status])
  if (!active) return null

  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  // EXPLICIT null check, never a falsy test: 0.0 is a real and important value here.
  const n = (v: any): number | null => (v === null || v === undefined ? null : Number(v))
  const fmt = (v: any, d = 2) => (n(v) === null ? '—' : Number(v).toFixed(d))
  const fmtI = (v: any) => (n(v) === null ? '—' : Number(v).toLocaleString())
  const sgn = (v: any, d = 2) => (n(v) === null ? '—' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(d))

  const scoped = rows.filter(r => scope === 'all' ? true : scope === 'admissible' ? r.admissible : r.clearedFloor)
  const wf = num(wrFloor)
  const passesFloor = (r: CoRow) => {
    if (wf === null) return true
    return CO_TIERS.every(t => { const v = n(r[`${t.k}_dWR`]); return v !== null && v >= wf })
  }
  const filtered = scoped.filter(r => {
    if (fAsset !== 'all' && r.asset !== fAsset) return false
    if (fArch !== 'all' && r.archetype !== fArch) return false
    if (fTf !== 'all' && r.tf !== fTf) return false
    return passesFloor(r)
  })
  const sorted = [...filtered].sort((x, y) => {
    const a = x[sort.key], b = y[sort.key]
    const an = n(a), bn = n(b)
    let c: number
    if (an !== null && bn !== null) c = an - bn
    else if (an === null && bn === null) c = 0
    else c = an === null ? -1 : 1
    if (c === 0) c = String(x.sid).localeCompare(String(y.sid))
    return sort.dir === 'asc' ? c : -c
  })
  const survivors = sorted.filter(r => !!picked[r.sid])

  // ── XX: the two numbers that change his picks BEFORE he runs, not after ────────────────────
  // Anti-pyramid allows ONE position per asset, so two ticked cfgs on the same asset+timeframe
  // contend for a seat only one of them can ever hold. He was flying blind on the one constraint
  // that decides whether a pick can trade at all.
  const pickedAll = rows.filter(r => !!picked[r.sid])          // across ALL rows, not just filtered
  const seatKey = (r: any) => `${r.asset}|${r.tf}`
  const seatCount: Record<string, number> = {}
  pickedAll.forEach(r => { seatKey(r) && (seatCount[seatKey(r)] = (seatCount[seatKey(r)] ?? 0) + 1) })
  const collidingSeats = Object.entries(seatCount).filter(([, n]) => n > 1)
  const nCollisions = collidingSeats.reduce((a, [, n]) => a + (n - 1), 0)
  const nAssets = new Set(pickedAll.map(r => r.asset)).size
  const worstSeat = collidingSeats.sort((a, b) => b[1] - a[1])[0]

  // ── XW: paint the table from the last completed run ────────────────────────────────────────
  const memByS: Record<string, any> = {}
  ;(simRun?.members ?? []).forEach((m: any) => { memByS[m.sid] = m })
  const painted = paint && simRun?.status === 'done' && (simRun.members ?? []).length > 0
  const topEarners = new Set(
    (simRun?.members ?? []).filter((m: any) => (m.seated_pnl ?? 0) > 0)
      .sort((a: any, b: any) => b.seated_pnl - a.seated_pnl).slice(0, 10).map((m: any) => m.sid))
  const rowPaint = (r: any): { bg?: string; title?: string } => {
    if (!painted) {
      // pre-run: still warn on a collision he has just created
      if (picked[r.sid] && (seatCount[seatKey(r)] ?? 0) > 1) {
        return { bg: 'rgba(217,119,6,0.16)',
                 title: `COLLISION — ${seatCount[seatKey(r)]} ticked cfgs on ${r.asset} ${r.tf}. Anti-pyramid allows one position per asset, so only one can ever hold the seat.` }
      }
      return {}
    }
    const m = memByS[r.sid]
    if (!m) return {}
    if ((m.seated_trades ?? 0) === 0) {
      return { bg: 'rgba(185,28,28,0.14)',
               title: `ZERO SEATS — fired ${m.sa_trades ?? '?'} signals alone and took NO seated trades. Contributed nothing.` }
    }
    if ((seatCount[seatKey(r)] ?? 0) > 1) {
      return { bg: 'rgba(217,119,6,0.16)',
               title: `COLLISION — ${seatCount[seatKey(r)]} ticked cfgs on ${r.asset} ${r.tf}; seated ${m.seated_trades} (${m.seat_rate}% of its own signals).` }
    }
    if (topEarners.has(r.sid)) {
      return { bg: 'rgba(21,128,61,0.16)',
               title: `TOP EARNER — $${Math.round(m.seated_pnl).toLocaleString()} seated over ${m.seated_trades} trades (${m.seat_rate}% seat rate).` }
    }
    return {}
  }

  const loadPreset = (name: string) => {
    const pr = presets[name]
    if (!pr) return
    const pk: Record<string, boolean> = {}
    ;(pr.sids ?? []).forEach((x: string) => { pk[x] = true })
    const ts: Record<string, boolean> = {}
    ;(pr.tierS ?? []).forEach((x: string) => { ts[x] = true })
    setPicked(pk); setTierS(ts); setPresetName(name); setPaint(false)
    setSimMsg(`loaded ${pr.label} — ${pr.sids?.length ?? 0} cfgs, ${pr.tierS?.length ?? 0} Tier-S. Edit freely.`)
  }

  const dropZeroSeat = () => {
    const zero = (simRun?.members ?? []).filter((m: any) => (m.seated_trades ?? 0) === 0)
    if (!zero.length) return
    setPicked(pk => { const n = { ...pk }; zero.forEach((m: any) => { delete n[m.sid] }); return n })
    setSimMsg(`unticked ${zero.length} zero-seat member(s) — re-run to see the effect`)
  }
  const uniq = (f: (r: CoRow) => any) =>
    Array.from(new Set(rows.map(f).filter(v => v !== null && v !== undefined))).map(String).sort()
  const onSort = (k: string) =>
    setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' }))
  const arrow = (k: string) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')
  const H = ({ k, children, title }: { k: string; children: React.ReactNode; title?: string }) => (
    <th onClick={() => onSort(k)} title={title}
        style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {children}{arrow(k)}
    </th>
  )

  const exportCull = async () => {
    setSaveMsg('saving…')
    try {
      const r = await authedFetch<any>('/api/admin/contenders-cull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sids: survivors.map(s => s.sid),
          note: `Contenders tab cull · scope=${scope} · wrFloor=${wrFloor || 'none'}`,
          filters: { scope, wrFloor, fAsset, fArch, fTf },
        }),
      })
      setSaveMsg(r?.ok ? `saved ${r.n} sids → CONTENDERS_CULLED.json` : `failed: ${JSON.stringify(r)}`)
    } catch (e: any) { setSaveMsg(`failed: ${e?.message ?? e}`) }
  }

  const runSimulation = async () => {
    const sids = survivors.map(s => s.sid)
    if (!sids.length) { setSimMsg('nothing kept — tick at least one cfg'); return }
    const ts = sids.filter(x => tierS[x])
    setSimMsg('')
    try {
      const r = await authedFetch<any>('/api/admin/basket-sim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sids, tierS: ts, label: `hand-built · ${sids.length} cfgs · ${ts.length} Tier-S` }),
      })
      if (r?.runId) { setPaint(true); setSimRun({ runId: r.runId, status: 'queued', n_members: sids.length, n_tier_s: ts.length }) }
      else setSimMsg(`failed: ${JSON.stringify(r)}`)
    } catch (e: any) { setSimMsg(`failed: ${e?.message ?? e}`) }
  }

  const openRun = async (runId: string) => {
    // XW5: loading an old result must repaint the table exactly as a fresh run does.
    try { setSimRun(await authedFetch<any>(`/api/admin/basket-sim?runId=${runId}`)); setPaint(true) }
    catch (e: any) { setSimMsg(`could not open ${runId}: ${e?.message ?? e}`) }
  }

  const SA_BG = 'rgba(59,130,246,0.10)'   // STANDALONE — blue band
  const SE_BG = 'rgba(16,185,129,0.10)'   // SEATED — green band
  const c = meta?.counts ?? {}
  const preview = meta?.winRateFloorPreview ?? {}

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          Contenders 🎯 — {sorted.length} shown · {survivors.length} ticked
        </h2>
        <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>
          {c.scored ?? 0} scored · {c.clearedFloor ?? 0} cleared the +0.5% PnL floor ·{' '}
          {c.admissible ?? 0} admissible · {c.gateKilled ?? 0} killed by a tier gate
          {meta?.generated_at ? ` · generated ${meta.generated_at}` : ''}
        </span>
      </div>

      <div className="card card-pad" style={{ marginTop: 8, marginBottom: 10, fontSize: 12, lineHeight: 1.55 }}>
        <strong style={{ color: '#f59e0b' }}>READ THESE TWO BEFORE CULLING.</strong>
        <br />
        <strong>1. Standalone WR is NOT on the same scale as the basket.</strong> It runs 17.6–52.5% here and is the
        cfg&apos;s own hit rate across <em>every</em> signal it fires with no lane competition. The seated basket sits
        at <Code>65.2%</Code> (aggressive). <strong>Compare rows to each other, never to 65.2%.</strong>
        <br />
        <strong>2. &ldquo;64 of the 70 fail the gate&rdquo; is true against the gate, and it overstates
        them.</strong> The gate judges a cfg <em>standalone</em>, but no incumbent has ever been traded
        standalone — six lanes of FCFS competition keep the better trades and drop the rest, so a cfg
        reading 55% alone can contribute more once seated. Read the failures as &ldquo;would not be
        admitted today&rdquo;, not as &ldquo;is losing money in the book&rdquo;.
        <br />
        <strong>3. There is no standalone max-drawdown column</strong> and there should not be — the figure computed
        for it measured drawdown against a peak starting near zero, so 27 of 58 exceeded 100%. It was withdrawn as
        untrustworthy.
        <br />
        <span style={{ color: 'var(--ink-mute)' }}>
          A cfg with a weak standalone figure but a strong seated Δ is not a bad cfg — seated, it only takes the
          trades that win a lane, and it displaces worse incumbents. Three rows here <em>lose money standalone</em>
          and still add money seated.
        </span>
        <br />
        <strong>No weighted score, and no ranking that trades PnL against win rate.</strong> The metrics are side by
        side; the judgement is yours.
      </div>

      <div className="card card-pad" style={{ marginBottom: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <label>Scope{' '}
          <select value={scope} onChange={e => setScope(e.target.value as any)}>
            <option value="floor">cleared the PnL floor ({c.clearedFloor ?? 0})</option>
            <option value="admissible">admissible only ({c.admissible ?? 0})</option>
            <option value="all">all scored ({c.scored ?? 0})</option>
          </select>
        </label>
        <label title="A candidate passes only if its ΔWR clears this on ALL FOUR tiers.">
          <strong>WIN-RATE FLOOR</strong> ΔWR ≥{' '}
          <input value={wrFloor} onChange={e => setWrFloor(e.target.value)} placeholder="e.g. 0"
                 style={{ width: 70 }} /> pp
        </label>
        <span style={{ color: '#10b981', fontWeight: 700 }}>
          {wf === null ? 'no floor' : `${filtered.length} pass on all four tiers`}
        </span>
        <span style={{ color: 'var(--ink-mute)' }}>
          preview: {Object.entries(preview).map(([k, v]) => `${k}→${v}`).join(' · ')}
        </span>
        <label>Asset{' '}
          <select value={fAsset} onChange={e => setFAsset(e.target.value)}>
            <option value="all">all</option>{uniq(r => r.asset).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Archetype{' '}
          <select value={fArch} onChange={e => setFArch(e.target.value)}>
            <option value="all">all</option>{uniq(r => r.archetype).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>TF{' '}
          <select value={fTf} onChange={e => setFTf(e.target.value)}>
            <option value="all">all</option>{uniq(r => r.tf).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {/* XV: a starting point, never a lock — load it, then tick and untick freely. */}
        <label>preset{' '}
          <select value={presetName} onChange={e => loadPreset(e.target.value)}>
            <option value="">load a basket…</option>
            {Object.entries(presets).map(([k, v]: any) => (
              <option key={k} value={k}>{v.label} ({v.k} cfgs)</option>
            ))}
          </select>
        </label>
        {presetName && presets[presetName]?.note && (
          <span style={{ color: 'var(--ink-mute)', maxWidth: 420 }} title={presets[presetName].note}>
            {String(presets[presetName].note).slice(0, 70)}…
          </span>
        )}
        <button onClick={() => setPicked(p => {
          const n = { ...p }; sorted.forEach(r => { n[r.sid] = true }); return n
        })} title="tick every row currently visible under the filters">tick all {sorted.length} shown</button>
        <button onClick={() => { setPicked({}); setTierS({}) }}
                title="clear every tick, including Tier-S">untick all</button>
        <button onClick={exportCull} style={{ fontWeight: 700 }}>
          EXPORT {survivors.length} kept → next search
        </button>
        {/* XA2: score the ticked set on the LOCKED basis — the same pipeline that produced the
            eight baskets, Tier-S honoured, victim table populated. Never the fast harness. */}
        <button onClick={runSimulation}
                disabled={!!simRun && simRun.status !== 'done' && simRun.status !== 'error'}
                title="Score the kept set on the locked basis: publisher clone, Tier-S from your ticks, victim table populated. 2-4 minutes."
                style={{ fontWeight: 800, background: '#b45309', color: '#fff', border: 'none',
                         padding: '5px 12px', borderRadius: 5, cursor: 'pointer' }}>
          {simRun && simRun.status !== 'done' && simRun.status !== 'error'
            ? `RUNNING… ${simRun.status}`
            : `RUN SIMULATION (${pickedAll.length} cfgs · ${pickedAll.filter(x => tierS[x.sid]).length} Tier-S)`}
        </button>
        {/* XX2/XX1: assets and duplicated seats, live as he ticks. */}
        <span style={{ fontSize: 11 }}>
          <strong>{nAssets}</strong> assets ·{' '}
          <strong style={{ color: nCollisions ? '#b45309' : '#15803d' }}>
            {nCollisions} duplicated seat{nCollisions === 1 ? '' : 's'}
          </strong>
          {worstSeat ? (
            <span style={{ color: 'var(--ink-mute)' }}> (worst: {worstSeat[0].replace('|', ' ')} ×{worstSeat[1]})</span>
          ) : null}
        </span>
        <button onClick={() => setTierS({})}>clear Tier-S</button>
        <span style={{ color: 'var(--ink-mute)' }}>{saveMsg}{simMsg ? ` · ${simMsg}` : ''}</span>
      </div>

      {(simRun || simHist.length > 0) && (
        <div className="card card-pad" style={{ marginBottom: 12, fontSize: 12 }}>
          {simRun && (
            <div style={{ marginBottom: simHist.length ? 12 : 0 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>
                {simRun.label ?? simRun.runId}
                <span style={{ marginLeft: 8, color: 'var(--ink-mute)', fontWeight: 400 }}>
                  {simRun.status}{simRun.progress ? ` — ${simRun.progress}` : ''}
                  {simRun.elapsed_min != null ? ` · ${simRun.elapsed_min} min` : ''}
                </span>
              </div>
              {simRun.status !== 'done' && simRun.status !== 'error' && (
                <div style={{ height: 3, background: 'rgba(0,0,0,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '35%', background: '#b45309',
                                animation: 'staxsIndet 1.2s ease-in-out infinite' }} />
                </div>
              )}
              {/* XA6: warn, never block. */}
              {(simRun.warnings ?? []).map((w: string, i: number) => (
                <div key={i} style={{ color: '#b45309', marginTop: 4 }}>⚠ {w}</div>
              ))}
              {simRun.error && <div style={{ color: '#b91c1c', marginTop: 4 }}>✗ {simRun.error}</div>}
              {simRun.metrics && (
                <>
                  <table className="adm-table" style={{ fontSize: 12, marginTop: 8 }}>
                    <thead><tr>
                      <th /><th style={{ textAlign: 'right' }}>net $</th><th style={{ textAlign: 'right' }}>win %</th>
                      <th style={{ textAlign: 'right' }}>PF</th><th style={{ textAlign: 'right' }}>trades</th>
                      <th style={{ textAlign: 'right' }}>maxDD</th><th style={{ textAlign: 'right' }}>evictions</th>
                      <th style={{ textAlign: 'center' }}>A</th><th style={{ textAlign: 'center' }}>B</th>
                    </tr></thead>
                    <tbody>
                      <tr style={{ fontWeight: 700 }}>
                        <td>your basket</td>
                        <td style={{ textAlign: 'right' }}>{fmtI(simRun.metrics.netUsd)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(simRun.metrics.winRate)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(simRun.metrics.profitFactor, 3)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtI(simRun.metrics.trades)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(simRun.metrics.maxDD)}%</td>
                        <td style={{ textAlign: 'right' }}>{fmtI(simRun.metrics.evictions)}</td>
                        {(['A', 'B'] as const).map(t => (
                          <td key={t} style={{ textAlign: 'center',
                                               color: simRun.targets?.[t]?.clears ? '#15803d' : 'var(--ink-mute)',
                                               fontWeight: simRun.targets?.[t]?.clears ? 800 : 400 }}
                              title={simRun.targets?.[t]?.goal}>
                            {simRun.targets?.[t]?.clears ? 'PASS' : 'fail'}
                          </td>
                        ))}
                      </tr>
                      {simRun.book_bar && (
                        <tr style={{ color: 'var(--ink-mute)' }}>
                          <td title={simRun.book_bar.note}>his live 70 (same footing)</td>
                          <td style={{ textAlign: 'right' }}>{fmtI(simRun.book_bar.netUsd)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(simRun.book_bar.winRate)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(simRun.book_bar.profitFactor, 3)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtI(simRun.book_bar.trades)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(simRun.book_bar.maxDD)}%</td>
                          <td style={{ textAlign: 'right' }}>{fmtI(simRun.book_bar.evictions)}</td>
                          <td /><td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {/* XW5: the legend, and the toggle that clears the paint. */}
                  <div style={{ marginTop: 8, fontSize: 11, display: 'flex', gap: 14,
                                alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>table painted from this run:</strong>
                    <span><span style={{ background: 'rgba(21,128,61,0.16)', padding: '2px 8px',
                                         borderRadius: 3 }}>top earner</span> — best 10 by seated PnL</span>
                    <span><span style={{ background: 'rgba(217,119,6,0.16)', padding: '2px 8px',
                                         borderRadius: 3 }}>collision</span> — shares asset+TF with another ticked row</span>
                    <span><span style={{ background: 'rgba(185,28,28,0.14)', padding: '2px 8px',
                                         borderRadius: 3 }}>zero seats</span> — took no trades at all</span>
                    <button onClick={() => setPaint(p => !p)}>{paint ? 'clear paint' : 'repaint'}</button>
                    {/* XW6: one click, untick every passenger, re-run. */}
                    {(simRun.members ?? []).some((m: any) => (m.seated_trades ?? 0) === 0) && (
                      <button onClick={dropZeroSeat} style={{ fontWeight: 700 }}>
                        remove {(simRun.members ?? []).filter((m: any) => (m.seated_trades ?? 0) === 0).length} zero-seat members
                      </button>
                    )}
                  </div>

                  {/* XA4: which picks earned their seat. */}
                  {(simRun.members ?? []).length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                        per-member seated contribution ({simRun.members.length}) — which picks earned their seat
                      </summary>
                      <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 6 }}>
                        <table className="adm-table" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          <thead><tr>
                            <th style={{ textAlign: 'left' }}>sid</th><th>asset</th><th>tf</th><th>Tier S</th>
                            <th style={{ textAlign: 'right' }}>seated $</th><th style={{ textAlign: 'right' }}>seated tr</th>
                            <th style={{ textAlign: 'right' }}>seated WR</th><th style={{ textAlign: 'right' }}>seat %</th>
                            <th style={{ textAlign: 'right' }}>alone WR</th><th style={{ textAlign: 'right' }}>alone PF</th>
                          </tr></thead>
                          <tbody>
                            {simRun.members.map((m: any) => (
                              <tr key={m.sid} style={{ opacity: m.seated_trades ? 1 : 0.45 }}>
                                <td style={{ fontFamily: 'monospace' }}>{m.sid}</td>
                                <td>{m.asset}</td><td>{m.tf}</td>
                                <td style={{ textAlign: 'center' }}>{m.tier_s ? '★' : ''}</td>
                                <td style={{ textAlign: 'right',
                                             color: (m.seated_pnl ?? 0) < 0 ? '#b91c1c' : undefined }}>
                                  {fmtI(m.seated_pnl)}</td>
                                <td style={{ textAlign: 'right' }}>{fmtI(m.seated_trades)}</td>
                                <td style={{ textAlign: 'right' }}>{fmt(m.seated_wr)}</td>
                                <td style={{ textAlign: 'right' }}>{fmt(m.seat_rate)}</td>
                                <td style={{ textAlign: 'right' }}>{fmt(m.sa_wr)}</td>
                                <td style={{ textAlign: 'right' }}>{fmt(m.sa_pf, 3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
          {/* XA5: every run kept and re-openable. */}
          {simHist.length > 0 && (
            <details open={!simRun}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>run history ({simHist.length})</summary>
              <table className="adm-table" style={{ fontSize: 11, marginTop: 6, whiteSpace: 'nowrap' }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>when</th><th style={{ textAlign: 'left' }}>label</th>
                  <th>status</th><th style={{ textAlign: 'right' }}>net $</th>
                  <th style={{ textAlign: 'right' }}>win %</th><th style={{ textAlign: 'right' }}>PF</th>
                  <th style={{ textAlign: 'center' }}>A</th><th style={{ textAlign: 'center' }}>B</th><th />
                </tr></thead>
                <tbody>
                  {simHist.map(h => (
                    <tr key={h.runId} style={h.causal_provenance?.state && h.causal_provenance.state !== 'CLEAN'
                      ? { opacity: 0.55 } : undefined}
                        title={h.causal_provenance?.state === 'CLEAN'
                          ? 'CLEAN — every cfg holds a current causal certificate'
                          : `${h.causal_provenance?.state ?? 'UNKNOWN'} — ${h.causal_provenance?.certified_cfgs ?? 0}/${h.causal_provenance?.total_cfgs ?? 0} cfgs certified`}>
                      <td>{String(h.created_at ?? h.when ?? '').replace('T', ' ').slice(0, 16)}</td>
                      <td>{h.label}</td>
                      <td style={{ textAlign: 'center' }}>{h.status}</td>
                      <td style={{ textAlign: 'right' }}>{h.metrics ? fmtI(h.metrics.netUsd) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{h.metrics ? fmt(h.metrics.winRate) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{h.metrics ? fmt(h.metrics.profitFactor, 3) : '—'}</td>
                      <td style={{ textAlign: 'center', color: h.targets?.A?.clears ? '#15803d' : 'var(--ink-mute)' }}>
                        {h.targets?.A?.clears ? 'PASS' : '—'}</td>
                      <td style={{ textAlign: 'center', color: h.targets?.B?.clears ? '#15803d' : 'var(--ink-mute)' }}>
                        {h.targets?.B?.clears ? 'PASS' : '—'}</td>
                      <td><button onClick={() => openRun(h.runId)}>open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {loading ? <div style={{ padding: 16 }}>loading…</div> : (
      <div style={{ overflowX: 'auto' }}>
        <table className="adm-table" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th colSpan={7} style={{ textAlign: 'left' }}>IDENTITY</th>
              <th colSpan={4} style={{ background: SA_BG, textAlign: 'center' }}>STANDALONE — cfg alone, no lane competition</th>
              <th colSpan={5} style={{ background: SE_BG, textAlign: 'center' }}>SEATED vs k=58 — aggressive (6 lanes)</th>
              {CO_TIERS.map(t => (
                <th key={t.k} colSpan={3} style={{ textAlign: 'center' }}>{t.k} ({t.lanes})</th>
              ))}
              <th colSpan={2} style={{ textAlign: 'center' }}>GATE</th>
            </tr>
            <tr>
              <th style={{ textAlign: 'center' }}>keep</th>
              <th style={{ textAlign: 'center' }}
                  title="Tier S: this cfg may EVICT a weaker occupant to take a lane. A cfg must be KEPT to be Tier-S. Chris's live book runs 7.">
                Tier S
              </th>
              <H k="sid">sid</H><H k="asset">asset</H><H k="archetype">archetype</H>
              <H k="tf">tf</H><H k="direction">dir</H>
              <H k="sa_winRate" title="the cfg's own hit rate on every signal — NOT comparable to the basket's 65.2%">WR%</H>
              <H k="sa_profitFactor">PF</H><H k="sa_netUsd">net $</H><H k="sa_trades">trades</H>
              <H k="aggressive_dNet">Δnet $</H><H k="aggressive_dWR">ΔWR</H>
              <H k="aggressive_dPF">ΔPF</H><H k="aggressive_dTrades">Δtr</H><H k="seatRate">seat%</H>
              {CO_TIERS.map(t => (
                <Fragment key={t.k}>
                  <H k={`${t.k}_dNet`}>Δnet</H><H k={`${t.k}_dWR`}>ΔWR</H>
                  <th style={{ textAlign: 'center' }}>gate</th>
                </Fragment>
              ))}
              <th style={{ textAlign: 'center' }}>adm</th>
              <th style={{ textAlign: 'left' }}>killed by</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const off = !picked[r.sid]
              const pnt = rowPaint(r)
              return (
                <tr key={r.sid} title={pnt.title}
                    style={{ opacity: off ? 0.35 : 1, background: pnt.bg }}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={!off}
                           onChange={() => setPicked(pk => ({ ...pk, [r.sid]: off }))} />
                  </td>
                  {/* XA1: membership and elevation are separate ticks. Unkeeping a row disables
                      its Tier-S box — a cfg that is not in the basket cannot evict anything. */}
                  <td style={{ textAlign: 'center', background: tierS[r.sid] && !off ? 'rgba(180,83,9,0.14)' : undefined }}>
                    <input type="checkbox" disabled={off} checked={!!tierS[r.sid] && !off}
                           title={off ? 'keep this cfg first' : 'elevate to Tier S'}
                           onChange={() => setTierS(t => ({ ...t, [r.sid]: !t[r.sid] }))} />
                  </td>
                  <td style={{ fontFamily: 'monospace' }}>{r.sid}</td>
                  <td>{r.asset ?? '—'}</td><td>{r.archetype ?? '—'}</td>
                  <td>{r.tf ?? '—'}</td><td>{r.direction ?? '—'}</td>
                  <td style={{ background: SA_BG, textAlign: 'right' }}>{fmt(r.sa_winRate)}</td>
                  <td style={{ background: SA_BG, textAlign: 'right' }}>{fmt(r.sa_profitFactor, 3)}</td>
                  <td style={{ background: SA_BG, textAlign: 'right' }}>{fmtI(r.sa_netUsd)}</td>
                  <td style={{ background: SA_BG, textAlign: 'right' }}>{fmtI(r.sa_trades)}</td>
                  <td style={{ background: SE_BG, textAlign: 'right' }}>{fmtI(r.aggressive_dNet)}</td>
                  <td style={{ background: SE_BG, textAlign: 'right',
                               color: n(r.aggressive_dWR) === null ? undefined
                                 : Number(r.aggressive_dWR) >= 0 ? '#10b981' : '#ef4444' }}>
                    {sgn(r.aggressive_dWR)}
                  </td>
                  <td style={{ background: SE_BG, textAlign: 'right' }}>{sgn(r.aggressive_dPF, 3)}</td>
                  <td style={{ background: SE_BG, textAlign: 'right' }}>{sgn(r.aggressive_dTrades, 0)}</td>
                  <td style={{ background: SE_BG, textAlign: 'right' }}>{fmt(r.seatRate, 1)}</td>
                  {CO_TIERS.map(t => {
                    const kb = r.killedBy && r.killedBy.tier === t.k
                    return (
                      <Fragment key={t.k}>
                        <td style={{ textAlign: 'right' }}>{fmtI(r[`${t.k}_dNet`])}</td>
                        <td style={{ textAlign: 'right',
                                     color: n(r[`${t.k}_dWR`]) === null ? undefined
                                       : Number(r[`${t.k}_dWR`]) >= 0 ? '#10b981' : '#ef4444' }}>
                          {sgn(r[`${t.k}_dWR`])}
                        </td>
                        <td style={{ textAlign: 'center', color: kb ? '#ef4444' : 'var(--ink-mute)' }}>
                          {kb && n(r.killedBy?.pct) !== null ? `KILL ${Number(r.killedBy!.pct).toFixed(2)}%` : '·'}
                        </td>
                      </Fragment>
                    )
                  })}
                  <td style={{ textAlign: 'center', fontWeight: 700,
                               color: r.admissible ? '#10b981' : '#ef4444' }}>
                    {r.admissible ? 'YES' : 'no'}
                  </td>
                  {/* 2026-08-27: a publisher wrote killedBy as a STRING; a non-empty string is
                      truthy, so `.pct.toFixed(2)` threw and took the WHOLE TAB down with
                      "This page couldn't load". A rendering cell must never be able to blank the
                      page because an upstream field arrived in an unexpected shape. */}
                  <td style={{ color: '#ef4444' }}>
                    {typeof r.killedBy === 'string'
                      ? r.killedBy
                      : (r.killedBy && n(r.killedBy.pct) !== null
                          ? `${r.killedBy.tier ?? ''} ${Number(r.killedBy.pct).toFixed(2)}%`
                          : '')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!sorted.length && <div style={{ padding: 16, color: 'var(--ink-mute)' }}>No rows match the filters.</div>}
      </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 7b. CONTENDERS — the quality-admitted view of the research-PASS library (Chris, 2026-09-16).
//
// RESEARCH PASS is statistically validated research evidence. CONTENDER ADMISSION is Chris's
// standalone quality preference. They are NOT the same thing: every PASS cfg stays preserved in
// the authoritative library whether or not it appears here, and the library is never pruned.
//
// TWO METRIC AREAS AND NOTHING ELSE:
//   BLUE  — STANDALONE: the cfg alone, no lane competition. Tier-independent by construction:
//           these fields live on row.standalone and are never read through the tier selector.
//   GREEN — SEATED SIMULATION: one section, one tier dropdown. Changing the tier reads a different
//           key of row.seated and touches nothing blue. The four parallel per-tier blocks that
//           used to sit on the right are gone.
//
// The tier list comes from public/data/canonical-tiers.json, generated from the live engine's
// tier_sizing.py — no duplicate hard-coded tier table lives in this file.
// ─────────────────────────────────────────────────────────────────────────────────────────────
type CanonTier = {
  key: string; label: string; ordinary_lanes: number; total_lanes: number
  leverage: number; reserve_pct: number; base_pct: number
}
type ConRow = {
  candidate_id: string; sid: string; quality_band: string; strategy_family: string
  family_lifecycle_status: string | null; role: string | null; robust_label: boolean | null
  mechanism: string; version: string | null; asset: string; tf: string; direction: string | null
  standalone: {
    trades: number | null; wr_pct: number | null; pf: number | null; realised_rrr: number | null
    net_pct_total: number | null; annualized_net_pct: number | null
    trades_per_year: number | null; years: number | null
    // 2026-09-26 — the metrics now cover the COMPLETE period (pre-seal IS + sealed OOS as one
    // continuous series), not the sealed year alone. `pf_status` travels WITH `pf` because
    // `pf: null` is ambiguous on its own: NO_LOSSES is the best possible outcome and
    // NO_ECONOMIC_OBSERVATIONS is the absence of any, and rendering both as '—' hides the
    // difference. The sealed-year figures remain on `oos_only_standalone`.
    pf_status?: string | null
    net_usd?: number | null
    max_dd_pct?: number | null; max_dd_usd?: number | null
    first_ts?: string | null; last_ts?: string | null
    period?: string | null
  }
  seated: Record<string, any>
  admission_reason: string
  economics_flags_for_review: string[]
  research_classification: string
  cfg: Record<string, any>
  cfg_fingerprint: string | null; cfg_sha256: string | null; cfg_variant: string | null
  table_candidate_version: string | null; data_fingerprint: string | null
  standalone_ledger: string | null; standalone_ledger_sha256: string | null
  // ── PROVENANCE, KEPT APART (2026-09-26) ────────────────────────────────────────────────────
  // `preseal_band` is what made this a contender; `oos_tier` is what the sealed year then said
  // about it. An OOS Tier A is NOT evidence of pre-seal admission, and one column for both is
  // how 13 OOS-only promotions ended up in a selectable surface.
  preseal_band?: string | null
  preseal_admitted?: boolean | null
  admission_artifact?: string | null
  admission_predates_oos?: boolean | null
  certificate_status?: string | null
  oos_tier?: string | null
  provenance?: string | null
  alias_count?: number | null
  aliases?: Array<{ candidate_id: string; role?: string | null; preseal_band?: string | null }> | null
  duplicate_basis?: string | null
  source_verdict_artifact: string | null
  historical_cutoff: string | null; fees: number | null
}

const BAND_COLOR: Record<string, string> = {
  // 2026-09-26 OOS pool tiers. Gold / green / grey mirror the contender PDF so the two surfaces
  // cannot drift apart, and SPARSE is amber because it is deliberately NOT in the deployable pool.
  TIER_A: '#eab308', TIER_B: '#10b981', TIER_C: '#94a3b8', SPARSE: '#f59e0b',
  CORE: '#10b981', FLEX: '#3b82f6', EXCEPTIONAL: '#a855f7',
  // no QUALITY_FAIL band exists: no PASS winner disappears (WINNER SELECTION rule 3, 2026-09-16)
  MANUAL_REVIEW: '#f59e0b',
}

export function ContendersPanel({ active }: { active: boolean }) {
  const [rows, setRows] = useState<ConRow[]>([])
  const [meta, setMeta] = useState<any>(null)
  const [tiers, setTiers] = useState<CanonTier[]>([])
  const [tier, setTier] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [fAsset, setFAsset] = useState('all')
  const [fTf, setFTf] = useState('all')
  const [fBand, setFBand] = useState('all')
  const [fFam, setFFam] = useState('all')
  const [showFamInfo, setShowFamInfo] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'wr_pct', dir: 'desc' })
  const [openCfg, setOpenCfg] = useState<string | null>(null)
  const [showNotAdmitted, setShowNotAdmitted] = useState(false)
  // OOS_SPARSE_SUPPORTIVE is preserved and selectable, but OFF by default: these met every economic
  // requirement and missed ONLY the trade-count floor, so they are not part of the strict deployable
  // pool unless Chris/Codex rule otherwise.
  const [inclSparse, setInclSparse] = useState(false)
  const [sparseRows, setSparseRows] = useState<ConRow[]>([])
  // ── basket construction. `picked` is the source of truth — nothing is ticked by default.
  //    tierS is SEPARATE and must be a subset of picked; unticking a cfg drops it from Tier-S.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [tierS, setTierS] = useState<Record<string, boolean>>({})
  // ── ONE MODE, ONE RESULT, ONE HISTORY (2026-09-26) ─────────────────────────────────────────
  // The page previously carried two run buttons and three result areas: a green "basket net"
  // line, a separate ACCOUNT block, and a yellow full-period card — which could be left on screen
  // together from DIFFERENT runs, with the history table quoting a fourth set of numbers. A reader
  // could not tell which figure belonged to which run, or which was the account P&L.
  //
  // Now: an explicit mode, one RUN button, exactly one authoritative card, and one history whose
  // rows carry the SAME normalised metrics the card shows. Switching mode CLEARS the result — a
  // pre-seal card must never sit beside a full-period one.
  const [simRun, setSimRun] = useState<any>(null)            // raw doc of the loaded run
  const [simMode, setSimMode] = useState<'PRE_SEAL' | 'FULL_PERIOD'>('FULL_PERIOD')
  const [simHist, setSimHist] = useState<any[]>([])
  const [fpHist, setFpHist] = useState<any[]>([])
  // Switching mode discards the loaded result. Two modes' numbers must never be on screen at once.
  const switchMode = (m: 'PRE_SEAL' | 'FULL_PERIOD') => {
    if (m === simMode) return
    setSimMode(m); setSimRun(null); setSimMsg('')
  }
  const [simMsg, setSimMsg] = useState('')
  const [simBusy, setSimBusy] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async () => {
      try {
        const [d, t, h] = await Promise.all([
          authedFetch<any>('/api/admin/msga-leaderboard?strategy=contenders', { cache: 'no-store' }),
          authedFetch<any>('/api/admin/msga-leaderboard?strategy=canonical-tiers', { cache: 'no-store' }),
          authedFetch<any>('/api/admin/contender-sim', { cache: 'no-store' }).catch(() => ({ runs: [] })),
        ])
        if (cancelled) return
        setRows(d.rows ?? []); setMeta(d); setSparseRows(d.sparse_rows ?? [])
        const tl: CanonTier[] = t?.tiers ?? []
        setTiers(tl)
        // AGGRESSIVE BY DEFAULT (Chris, 2026-09-26). This defaulted to `tl[0]`, which is
        // CONSERVATIVE — the canonical tier list is ordered by risk — so the panel opened on a
        // 3-lane book while every number quoted beside it was the 7-lane aggressive figure.
        setTier(prev => prev || (tl.find(t => t.key === 'aggressive')?.key ?? tl[0]?.key ?? ''))
        setSimHist(h?.runs ?? [])
        try { const fh = await authedFetch<any>('/api/admin/basket-sim-full', { cache: 'no-store' }); setFpHist(fh?.runs ?? []) } catch { /* advisory */ }
      } catch (e) {
        if (typeof window !== 'undefined') console.warn('[contenders] fetch failed:', e)
      } finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [active])

  if (!active) return null

  const SA_BG = 'rgba(59,130,246,0.10)'
  const SE_BG = 'rgba(16,185,129,0.10)'
  const uniq = (f: (r: ConRow) => string | null) =>
    Array.from(new Set(rows.map(f).filter(Boolean) as string[])).sort()

  // The strict pool is the default simulator universe; sparse-supportive folds in only on request.
  const pool = inclSparse ? [...rows, ...sparseRows] : rows
  let view = pool.filter(r =>
    (fAsset === 'all' || r.asset === fAsset) &&
    (fTf === 'all' || r.tf === fTf) &&
    (fBand === 'all' || r.quality_band === fBand) &&
    (fFam === 'all' || r.strategy_family === fFam))

  // GREEN comes from the CURRENT simulation's per-cfg result. No simulation -> no seated numbers.
  const seatedOf = (id: string) => simRun?.per_cfg?.[id]?.seated ?? null
  const seatRateOf = (id: string) => simRun?.per_cfg?.[id]?.seat_rate ?? null

  const val = (r: ConRow, k: string): any => {
    if (k in r.standalone) return (r.standalone as any)[k]
    if (k.startsWith('seated.')) {
      const s = seatedOf(r.candidate_id)
      return k === 'seated.seat_rate' ? seatRateOf(r.candidate_id) : (s ? s[k.slice(7)] : null)
    }
    return (r as any)[k]
  }
  view = [...view].sort((a, b) => {
    const x = val(a, sort.key), y = val(b, sort.key)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    const c = typeof x === 'string' ? x.localeCompare(y) : (x as number) - (y as number)
    return sort.dir === 'asc' ? c : -c
  })

  const th = (key: string, label: string, bg?: string) => (
    <th
      onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
      style={{ padding: '4px 6px', cursor: 'pointer', whiteSpace: 'nowrap', background: bg,
               textAlign: 'right', fontWeight: sort.key === key ? 700 : 500 }}
      title="click to sort"
    >{label}{sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}</th>
  )
  const n = (v: any, d = 2) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v))

  const pickedIds = Object.keys(picked).filter(k => picked[k])
  const tierSIds = Object.keys(tierS).filter(k => tierS[k] && picked[k])
  const sel = tiers.find(t => t.key === tier)
  const c = meta?.counts ?? {}
  // TWO POPULATIONS, NEVER ONE HEADLINE (SOL, 2026-09-19). SELECTABLE is counted here from `rows`,
  // the same deduplicated array "tick all" acts on, so the headline cannot disagree with what a tick
  // selects. PRESERVED RESEARCH is the research classification of every PASS row, duplicate aliases
  // included — a different population, read from the publisher and never mixed with the first.
  const selBand = (b: string) => rows.filter(r => r.quality_band === b).length
  const selCore = selBand('CORE'), selFlex = selBand('FLEX'), selExc = selBand('EXCEPTIONAL')
  const selOutside = rows.length - selCore - selFlex - selExc
  const pres = meta?.preserved_research_classifications
  const presBands = pres?.bands_including_duplicate_aliases ?? c

  const togglePick = (id: string) => setPicked(p => {
    const next = { ...p, [id]: !p[id] }
    if (!next[id]) setTierS(t => ({ ...t, [id]: false }))   // Tier-S is always a subset of picked
    return next
  })
  const tickAllShown = () => setPicked(p => {
    const next = { ...p }; view.forEach(r => { next[r.candidate_id] = true }); return next
  })
  const untickAll = () => { setPicked({}); setTierS({}) }
  const clearTierS = () => setTierS({})

  // ── ONE RUN PATH ────────────────────────────────────────────────────────────────────────
  // PRE_SEAL  -> /api/admin/contender-sim   (publisher-rig pass; the sealed year is never read)
  // FULL_PERIOD -> /api/admin/basket-sim-full (black-box walk, IS + OOS, no reset at the seal)
  // Both write a run doc; both are normalised by `normaliseRun` into one shape so the card and the
  // history row cannot disagree.
  const runSimulation = async () => {
    if (!pickedIds.length) { setSimMsg('select at least one cfg first'); return }
    setSimBusy(true); setSimRun(null)
    const isFull = simMode === 'FULL_PERIOD'
    const url = isFull ? '/api/admin/basket-sim-full' : '/api/admin/contender-sim'
    setSimMsg(`starting ${isFull ? 'FULL-PERIOD' : 'PRE-SEAL'} simulation…`)
    try {
      const body = isFull
        ? { sids: pickedIds, selected: pickedIds, tierS: tierSIds, tier: tier || 'aggressive' }
        : { selected: pickedIds, tierS: tierSIds, tier }
      const r = await authedFetch<any>(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r?.runId) { setSimMsg(`failed: ${JSON.stringify(r)}`); setSimBusy(false); return }
      const t0 = Date.now()
      for (let i = 0; i < 160; i++) {
        await new Promise(res => setTimeout(res, isFull ? 4000 : 2000))
        const d = await authedFetch<any>(`${url}?runId=${r.runId}`, { cache: 'no-store' })
        const secs = Math.round((Date.now() - t0) / 1000)
        if (d?.status === 'done') {
          setSimRun(d)
          setSimMsg(`run ${r.runId} complete in ${secs} s`)
          await loadHistories()
          setSimBusy(false); return
        }
        if (d?.status === 'error') {
          setSimRun(null)
          setSimMsg(`run ${r.runId} failed: ${d.error}`); setSimBusy(false); return
        }
        setSimMsg(`run ${r.runId} · ${d?.progress || d?.status || 'running'} · ${secs} s`)
      }
      setSimMsg(`run ${r.runId} still running — open it from history when it finishes`)
    } catch (e: any) {
      setSimMsg(`simulation failed: ${e?.message ?? e}`)
    }
    setSimBusy(false)
  }

  const loadHistories = async () => {
    try {
      const [a, b] = await Promise.all([
        authedFetch<any>('/api/admin/contender-sim', { cache: 'no-store' }).catch(() => null),
        authedFetch<any>('/api/admin/basket-sim-full', { cache: 'no-store' }).catch(() => null),
      ])
      setSimHist(a?.runs ?? []); setFpHist(b?.runs ?? [])
    } catch { /* history is advisory; a failure must not blank the card */ }
  }

  // Clicking a history row reloads THAT EXACT RESULT — including switching the page into the
  // mode the run belongs to, so the card's period label always matches the numbers under it.
  const openRun = async (runId: string, mode: 'PRE_SEAL' | 'FULL_PERIOD') => {
    const url = mode === 'FULL_PERIOD' ? '/api/admin/basket-sim-full' : '/api/admin/contender-sim'
    try {
      const d = await authedFetch<any>(`${url}?runId=${runId}`, { cache: 'no-store' })
      setSimMode(mode)
      setSimRun(d)
      const sel: string[] = d.selected_cfgs ?? d.members ?? []
      const ts: string[] = d.tier_s_cfgs ?? d.tier_s ?? []
      setPicked(Object.fromEntries(sel.map((x: string) => [x, true])))
      setTierS(Object.fromEntries(ts.map((x: string) => [x, true])))
      if (d.tier) setTier(d.tier)
      setSimMsg(`loaded ${runId} (${mode === 'FULL_PERIOD' ? 'full period' : 'pre-seal'})`)
    } catch (e: any) {
      setSimMsg(`could not open ${runId}: ${e?.message ?? e}`)
    }
  }


  const exportSelection = () => {
    const payload = {
      exported_at: new Date().toISOString(), tier,
      selected: pickedIds, tierS: tierSIds,
      rows: rows.filter(r => picked[r.candidate_id]).map(r => ({
        candidate_id: r.candidate_id, family: r.strategy_family, asset: r.asset, tf: r.tf,
        direction: r.direction, quality_band: r.quality_band, role: r.role, robust: r.robust_label,
        cfg: r.cfg, cfg_sha256: r.cfg_sha256, standalone: r.standalone,
        standalone_ledger: r.standalone_ledger, standalone_ledger_sha256: r.standalone_ledger_sha256,
      })),
      simulation: simRun ? { runId: simRun.runId, tier: simRun.tier, metrics: simRun.seated_basket_metrics } : null,
    }
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `contender-selection-${tier}-${pickedIds.length}cfgs.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Contenders 🎯</h3>
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {loading ? 'loading…' : `${view.length} of ${rows.length} active`}
          {meta?.updatedAt ? ` · generated ${meta.updatedAt}` : ''}
        </span>
      </div>

      <p style={{ fontSize: 12, opacity: 0.85, margin: '8px 0 4px', maxWidth: 1100 }}>
        <b>This page is a quality-admitted VIEW of the authoritative research-PASS library.</b>{' '}
        Research PASS is statistically validated research evidence; contender admission is Chris&apos;s
        standalone quality preference. Every PASS cfg stays preserved in the library whether or not it
        appears here. ROBUST is a label, never a gate; role is provenance, never a filter; prior
        visibility of the data is provenance, never contamination; and a cfg that clears the gate belongs
        here even if its strategy family is still undergoing research.
      </p>

      {/* ── OOS POOL HEADER (2026-09-26). The simulator universe is the STRICT survivors; sparse
           supportive is a separate, clearly-labelled opt-in and is never on by default. ── */}
      {/* ── THE POOL CORRECTION, STATED WHERE THE POOL IS USED (2026-09-26) ─────────────────
          This surface previously served CFGs promoted by the sealed year alone. The banner names
          the gate and the exact arithmetic so a reader can see which population they are picking
          from without opening an artifact. */}
      {meta?.pool_correction && (
        <div style={{ margin: '8px 0', padding: '8px 10px', borderRadius: 6, fontSize: 11,
                      background: 'rgba(217,164,65,0.07)', border: '1px solid rgba(217,164,65,0.28)' }}>
          <div style={{ fontWeight: 800, letterSpacing: 0.5, color: '#d9a441' }}>
            SELECTABLE = PRE-SEAL CORE/FLEX/EXCEPTIONAL ∩ CERTIFICATE ∩ OOS ∩ NO HOLD
          </div>
          <div style={{ marginTop: 3, opacity: 0.9 }}>
            {meta.pool_correction.arithmetic} · sparse {meta.pool_correction.displayed_sparse} displayed
            − {meta.pool_correction.removed_oos_only_sparse} OOS-only = {meta.pool_correction.canonical_sparse}.
            {' '}<b>{(meta.pool_correction.removed_oos_only_strict ?? 0) + (meta.pool_correction.removed_oos_only_sparse ?? 0)}</b>
            {' '}rows were promoted by the sealed year without ever passing the pre-seal admission
            gate — preserved and labelled OOS_SEEN_BEFORE_PRESEAL_ADMISSION, excluded here.
          </div>
          <div style={{ marginTop: 3, opacity: 0.72 }}>
            OOS is the final validation step; it cannot create contender status. Combined IS+OOS
            metrics below are DESCRIPTIVE and are never an admission gate. Data cutoff:{' '}
            {meta.data_cutoff ?? 'unstated'}.
          </div>
          <div style={{ marginTop: 3, opacity: 0.72 }}>
            strict sha <code>{String(meta.strict_sha256 ?? '').slice(0, 16)}</code> · sparse sha{' '}
            <code>{String(meta.sparse_sha256 ?? '').slice(0, 16)}</code>
          </div>
        </div>
      )}
      {meta?.counts?.strict_survivors != null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12,
                      margin: '6px 0 10px', padding: '8px 10px', borderRadius: 6,
                      border: '1px solid rgba(148,163,184,0.35)' }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <b>CONTENDERS — OOS SCREENED</b>
            <span>Strict Survivors <b>{meta.counts.strict_survivors}</b></span>
            <span style={{ color: BAND_COLOR.TIER_A }}>Tier A <b>{meta.counts.tier_A}</b></span>
            <span style={{ color: BAND_COLOR.TIER_B }}>Tier B <b>{meta.counts.tier_B}</b></span>
            <span style={{ color: BAND_COLOR.TIER_C }}>Tier C <b>{meta.counts.tier_C}</b></span>
            <span>clusters <b>{meta.counts.economic_clusters}</b></span>
            <span>newly discovered <b>{meta.counts.newly_discovered}</b></span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer',
                            color: BAND_COLOR.SPARSE }}>
              <input type="checkbox" checked={inclSparse}
                     onChange={e => setInclSparse(e.target.checked)} />
              <span>INCLUDE SPARSE SUPPORTIVE <b>{meta.counts.sparse_supportive}</b></span>
            </label>
            <span style={{ opacity: 0.75 }}>
              positive OOS, insufficient trade count — preserved and monitored, NOT part of the
              strict deployable pool
            </span>
          </div>
          <div style={{ opacity: 0.7 }}>
            default simulator universe: <b>STRICT SURVIVORS ONLY</b> · generated{' '}
            {String(meta.generated_at ?? '')} · <b>{meta.label}</b>
          </div>
          <div style={{ opacity: 0.6 }}>
            archived research (preserved, excluded from the selector):{' '}
            universe <b>{meta.archived_research?.universe_total}</b> ·{' '}
            quarantined exec-disagreement <b>{meta.archived_research?.quarantined_exec_disagreement}</b> ·{' '}
            invalidated OOS results <b>{meta.archived_research?.invalidated_oos_results}</b>
          </div>
        </div>
      )}

      {meta?.counts && meta?.counts?.strict_survivors == null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, margin: '6px 0 10px' }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <b>SELECTABLE</b>
            <span style={{ color: BAND_COLOR.CORE }}>CORE <b>{selCore}</b></span>
            <span style={{ color: BAND_COLOR.FLEX }}>FLEX <b>{selFlex}</b></span>
            <span style={{ color: BAND_COLOR.EXCEPTIONAL }}>EXCEPTIONAL <b>{selExc}</b></span>
            <span>TOTAL <b>{rows.length}</b></span>
            {selOutside !== 0 && (
              <span style={{ color: '#ef4444' }}>outside the three bands <b>{selOutside}</b> — publisher defect</span>
            )}
            {meta?.selectable?.total != null && meta.selectable.total !== rows.length && (
              <span style={{ color: '#ef4444' }}>publisher&apos;s selectable total says <b>{meta.selectable.total}</b></span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', opacity: 0.75 }}>
            <b>PRESERVED RESEARCH</b>
            <span>PASS <b>{pres?.total_pass_library ?? c.total_pass_library}</b></span>
            <span style={{ color: BAND_COLOR.CORE }}>CORE <b>{presBands.CORE}</b></span>
            <span style={{ color: BAND_COLOR.FLEX }}>FLEX <b>{presBands.FLEX}</b></span>
            <span style={{ color: BAND_COLOR.EXCEPTIONAL }}>EXCEPTIONAL <b>{presBands.EXCEPTIONAL}</b></span>
            <span style={{ color: BAND_COLOR.MANUAL_REVIEW }}>MANUAL REVIEW <b>{presBands.MANUAL_REVIEW}</b></span>
            <span>duplicate aliases <b>{pres?.duplicate_aliases ?? '—'}</b></span>
            <span>· every research row incl. aliases — not separately selectable</span>
          </div>
        </div>
      )}

      {/* ── BASKET CONTROLS ─────────────────────────────────────────────────────────────── */}
      <div style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '10px 12px',
                    margin: '0 0 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12 }}>BASKET</b>
          <span style={{ fontSize: 12 }}>selected <b>{pickedIds.length}</b></span>
          <span style={{ fontSize: 12 }}>Tier-S <b>{tierSIds.length}</b></span>
          <button onClick={tickAllShown} style={{ fontSize: 12 }}>tick all shown ({view.length})</button>
          <button onClick={untickAll} style={{ fontSize: 12 }}>untick all</button>
          <button onClick={clearTierS} style={{ fontSize: 12 }}>clear Tier-S</button>
          <label style={{ fontSize: 12 }}>
            tier{' '}
            <select value={tier} onChange={e => setTier(e.target.value)} style={{ fontSize: 12 }}>
              {tiers.map(t => (
                <option key={t.key} value={t.key}>
                  {t.label} — {t.total_lanes} lanes ({t.ordinary_lanes} ordinary + 1 reserved Tier-S)
                </option>
              ))}
            </select>
          </label>
          {/* ── MODE, THEN ONE RUN BUTTON ────────────────────────────────────────────────
              Two buttons produced two result cards that could disagree and both stay on screen.
              The period is now a mode the reader picks BEFORE running, it is printed on the card,
              and changing it clears the previous result. */}
          <div className="csim-modes" role="radiogroup" aria-label="simulation period">
            {([['PRE_SEAL', 'PRE-SEAL (IS ONLY)'], ['FULL_PERIOD', 'FULL PERIOD (IS + OOS)']] as const)
              .map(([m, lab]) => (
                <button key={m} type="button" role="radio" aria-checked={simMode === m}
                        onClick={() => switchMode(m)} disabled={simBusy}
                        className={'csim-mode' + (simMode === m ? ' on' : '')}>
                  {lab}
                </button>
              ))}
          </div>
          <button onClick={runSimulation} disabled={simBusy || !pickedIds.length}
                  aria-busy={simBusy}
                  style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, padding: '7px 16px',
                           borderRadius: 5, border: 'none', display: 'inline-flex', alignItems: 'center',
                           gap: 8, color: '#06140b',
                           background: simBusy ? 'rgba(126,231,135,0.45)'
                                      : (!pickedIds.length ? 'rgba(255,255,255,0.18)' : '#7ee787'),
                           cursor: (simBusy || !pickedIds.length) ? 'not-allowed' : 'pointer' }}>
            {simBusy && (
              <span style={{ width: 11, height: 11, borderRadius: '50%', display: 'inline-block',
                             border: '2px solid rgba(6,20,11,0.28)', borderTopColor: '#06140b',
                             animation: 'staxsSpin 0.7s linear infinite' }} />
            )}
            {simBusy ? 'RUNNING…' : 'RUN SIMULATION'}
          </button>
          <style>{'@keyframes staxsSpin{to{transform:rotate(360deg)}}'}</style>
          <button onClick={exportSelection} disabled={!pickedIds.length} style={{ fontSize: 12 }}>
            export selection
          </button>
        </div>
        {simMsg && <div style={{ fontSize: 11, opacity: 0.85 }}>{simMsg}</div>}
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          Tier-S is always a subset of the selected basket — unticking a cfg drops it from Tier-S. The
          simulation replays each contender&apos;s authoritative standalone ledger through the live
          engine&apos;s canonical FCFS allocator: chronological ordering, lane availability and release,
          one lane per asset, one lane per cfg, and the reserved Tier-S seat.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 10px' }}>
        {[['family', fFam, setFFam, uniq(r => r.strategy_family)],
          ['asset', fAsset, setFAsset, uniq(r => r.asset)],
          ['tf', fTf, setFTf, uniq(r => r.tf)],
          ['band', fBand, setFBand, uniq(r => r.quality_band)]].map(([lab, v, set, opts]: any) => (
          <label key={lab} style={{ fontSize: 12 }}>
            {lab}{' '}
            <select value={v} onChange={e => set(e.target.value)} style={{ fontSize: 12 }}>
              <option value="all">all</option>
              {opts.map((o: string) => (
                <option key={o} value={o}>
                  {lab === 'family' && familyInfo(o) ? `${o} — ${familyInfo(o)!.nickname}` : o}
                </option>
              ))}
            </select>
          </label>
        ))}
        {/* STRATEGY EXPLANATIONS — nickname + plain-English mechanism, from the single map in lib/strategy-families.ts */}
        <button onClick={() => setShowFamInfo(x => !x)} style={{ fontSize: 12 }}
                title="what does each strategy family do?" aria-expanded={showFamInfo}>
          ⓘ {showFamInfo ? 'hide' : fFam === 'all' ? 'what are these families?' : 'what is this family?'}
        </button>
      </div>
      {showFamInfo && (
        <div style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '8px 10px',
                      margin: '-4px 0 10px', fontSize: 12, maxWidth: 1100, display: 'grid', gap: 6 }}>
          {(fFam === 'all' ? uniq(r => r.strategy_family) : [fFam]).map(name => {
            const fi = familyInfo(name)
            return (
              <div key={name}>
                <b>{name}</b>
                {fi ? <> — <i>&ldquo;{fi.nickname}&rdquo;</i><div style={{ opacity: 0.85 }}>{fi.explanation}</div></>
                    : <span style={{ opacity: 0.7 }}> — no explanation recorded yet</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* ── GREEN SECTION HEADER ────────────────────────────────────────────────────────── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th colSpan={10} style={{ padding: '4px 6px', textAlign: 'left' }}>
                IDENTITY — role and ROBUST are COLUMNS, never filters
              </th>
              <th colSpan={7} style={{ padding: '4px 6px', background: SA_BG, textAlign: 'left' }}>
                STANDALONE — CFG ALONE, NO LANE COMPETITION
              </th>
              <th colSpan={5} style={{ padding: '4px 6px', background: SE_BG, textAlign: 'left' }}>
                SEATED SIMULATION — {sel ? `${sel.label.toUpperCase()} (${sel.total_lanes} LANES)` : '—'}
              </th>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.18)' }}>
              <th style={{ padding: '4px 6px' }} title="include in the basket">keep</th>
              <th style={{ padding: '4px 6px' }} title="designate as Tier-S (subset of keep)">Tier-S</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }} title="the frozen PRE-SEAL admission band — CORE / FLEX / EXCEPTIONAL. This is what made the cfg a contender.">pre-seal</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }} title="the causal certificate verdict">cert</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }} title="the SEALED-YEAR screening tier. Evidence ABOUT the cfg, never evidence that it was admitted.">OOS</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>band</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>candidate ID</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>family</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>asset</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>tf</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>dir</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>role</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }} title="exact aliases collapsed into this row — preserved, not independently selectable">alias</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>ROBUST</th>
              {th('trades', 'trades', SA_BG)}
              {th('wr_pct', 'WR %', SA_BG)}
              {th('pf', 'PF', SA_BG)}
              {th('realised_rrr', 'realised RRR', SA_BG)}
              {th('annualized_net_pct', 'ann net %', SA_BG)}
              {th('net_pct_total', 'total net %', SA_BG)}
              {th('net_usd', 'total net $', SA_BG)}
              {th('max_dd_pct', 'max DD %', SA_BG)}
              {th('years', 'years', SA_BG)}
              {th('first_ts', 'first', SA_BG)}
              {th('last_ts', 'last', SA_BG)}
              {th('seated.n', 'seated trades', SE_BG)}
              {th('seated.wr_pct', 'seated WR %', SE_BG)}
              {th('seated.pf', 'seated PF', SE_BG)}
              {th('seated.net_pct_total', 'seated net %', SE_BG)}
              {th('seated.seat_rate', 'seat %', SE_BG)}
            </tr>
          </thead>
          <tbody>
            {view.map(r => {
              const s = r.standalone
              const g = seatedOf(r.candidate_id)
              const sr = seatRateOf(r.candidate_id)
              const open = openCfg === r.candidate_id
              return (
                <Fragment key={r.candidate_id}>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                      <input type="checkbox" checked={!!picked[r.candidate_id]}
                             onChange={() => togglePick(r.candidate_id)} />
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                      <input type="checkbox" checked={!!tierS[r.candidate_id]}
                             disabled={!picked[r.candidate_id]}
                             title={picked[r.candidate_id] ? 'designate Tier-S' : 'select the cfg first'}
                             onChange={() => setTierS(t => ({ ...t, [r.candidate_id]: !t[r.candidate_id] }))} />
                    </td>
                    <td style={{ padding: '3px 6px', fontWeight: 700,
                                 color: r.preseal_band === 'CORE' ? '#4ade80'
                                      : r.preseal_band === 'FLEX' ? '#d9a441'
                                      : r.preseal_band === 'EXCEPTIONAL' ? '#60a5fa' : 'var(--muted)' }}
                        title={r.admission_predates_oos
                          ? `admitted by ${r.admission_artifact ?? 'the frozen pre-seal procedure'} before any OOS result existed for it`
                          : 'no pre-seal admission on record'}>
                      {r.preseal_band ?? '—'}
                    </td>
                    <td style={{ padding: '3px 6px', color: r.certificate_status === 'PASS' ? '#4ade80' : '#f0b429' }}>
                      {r.certificate_status ?? '—'}
                    </td>
                    <td style={{ padding: '3px 6px', color: 'var(--muted)' }}
                        title="sealed-year screening tier — the FINAL VALIDATION STEP, not an admission gate">
                      {(r.oos_tier ?? '').replace('_OOS_STRONG', ' strong').replace('_OOS_PRACTICAL', ' practical').replace('_OOS_PROMISING', ' promising') || '—'}
                    </td>
                    <td style={{ padding: '3px 6px', color: BAND_COLOR[r.quality_band] ?? undefined, fontWeight: 700 }}>
                      {r.quality_band}
                    </td>
                    <td style={{ padding: '3px 6px', cursor: 'pointer', textDecoration: 'underline dotted' }}
                        onClick={() => setOpenCfg(open ? null : r.candidate_id)}
                        title="show the resolved configuration and its provenance">
                      {r.candidate_id}
                    </td>
                    <td style={{ padding: '3px 6px' }}
                        title={familyInfo(r.strategy_family) ? `${familyInfo(r.strategy_family)!.nickname} — ${familyInfo(r.strategy_family)!.explanation}` : undefined}>
                      {r.strategy_family}
                    </td>
                    <td style={{ padding: '3px 6px' }}>{r.asset}</td>
                    <td style={{ padding: '3px 6px' }}>{r.tf}</td>
                    <td style={{ padding: '3px 6px' }}>{r.direction ?? '—'}</td>
                    <td style={{ padding: '3px 6px' }}>{r.provenance ?? r.role ?? '—'}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--muted)' }}
                        title={(r.alias_count ?? 0) > 0
                          ? `${r.duplicate_basis}: ${(r.aliases ?? []).map(a => a.candidate_id).join(', ')}`
                          : 'no exact alias'}>
                      {(r.alias_count ?? 0) > 0 ? `+${r.alias_count}` : '—'}
                    </td>
                    <td style={{ padding: '3px 6px' }}>{r.robust_label == null ? '—' : r.robust_label ? 'yes' : 'no'}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>{s.trades ?? '—'}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>{n(s.wr_pct)}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}
                        title={s.pf_status ? `profit factor status: ${s.pf_status}` : undefined}>
                      {s.pf_status === 'NO_LOSSES'
                        ? <span style={{ color: '#4ade80', fontWeight: 700 }} title="no losing trade in the whole period — the profit factor is undefined because the denominator is zero, which is the BEST case, not the worst">∞</span>
                        : s.pf_status === 'NO_ECONOMIC_OBSERVATIONS'
                        ? <span style={{ color: 'var(--muted)' }} title="no economic observations">n/a</span>
                        : n(s.pf, 3)}
                    </td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>{n(s.realised_rrr, 3)}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>{n(s.annualized_net_pct, 1)}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>{n(s.net_pct_total, 1)}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>
                      {s.net_usd == null ? '—' : `$${Math.round(s.net_usd).toLocaleString()}`}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>{n(s.max_dd_pct, 2)}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right' }}>{n(s.years, 2)}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right', fontSize: 9.5 }}>{s.first_ts ?? '—'}</td>
                    <td style={{ padding: '3px 6px', background: SA_BG, textAlign: 'right', fontSize: 9.5 }}>{s.last_ts ?? '—'}</td>
                    <td style={{ padding: '3px 6px', background: SE_BG, textAlign: 'right' }}>{g?.n ?? '—'}</td>
                    <td style={{ padding: '3px 6px', background: SE_BG, textAlign: 'right' }}>{n(g?.wr_pct)}</td>
                    <td style={{ padding: '3px 6px', background: SE_BG, textAlign: 'right' }}>{n(g?.pf, 3)}</td>
                    <td style={{ padding: '3px 6px', background: SE_BG, textAlign: 'right' }}>{n(g?.net_pct_total, 1)}</td>
                    <td style={{ padding: '3px 6px', background: SE_BG, textAlign: 'right' }}>
                      {sr == null ? '—' : (sr * 100).toFixed(1)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={22} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                          <div><b>admission</b> — {r.admission_reason}</div>
                          <div><b>research classification</b> — {r.research_classification} · <b>family lifecycle</b> — {r.family_lifecycle_status}</div>
                          <div><b>cfg fingerprint (sha256)</b> {r.cfg_sha256} · <b>variant</b> {r.cfg_variant ?? '—'}</div>
                          <div><b>data fingerprint (tape sha256)</b> {r.data_fingerprint}</div>
                          <div><b>history cutoff</b> {r.historical_cutoff} · <b>fees</b> {r.fees}% round trip</div>
                          <div><b>standalone ledger</b> {r.standalone_ledger} · sha256 {r.standalone_ledger_sha256}</div>
                          <div><b>source verdict artifact</b> {r.source_verdict_artifact}</div>
                          <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 11 }}>
                            {JSON.stringify(r.cfg, null, 1)}
                          </pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── RUN HISTORY ─────────────────────────────────────────────────────────────────── */}

      {/* ── EXACTLY ONE AUTHORITATIVE RESULT CARD ──────────────────────────────────────────
          It renders only the loaded run, in the mode that run belongs to. There is no second
          P&L: the risk-sized ACCOUNT simulation is the authoritative figure, and the unweighted
          per-trade percentage sum is shown once, beneath it, with its formula and an explicit
          non-account label. */}
      <SimResultCard run={simRun} mode={simMode} busy={simBusy} sel={sel} />

      {/* ── ONE HISTORY, SAME METRICS AS THE CARD ────────────────────────────────────────
          Rows previously quoted "basket net %" while the card quoted an account P&L, so the same
          run appeared to have two different results. Every row now shows the ACCOUNT figures the
          card shows, tagged with the mode the run belongs to, and opening a row switches the page
          into that mode and reloads that exact document. */}
      <div style={{ marginTop: 14 }}>
        <b style={{ fontSize: 12 }}>SIMULATION RUN HISTORY</b>
        <span style={{ fontSize: 10.5, opacity: 0.7, marginLeft: 8 }}>
          account P&amp;L, identical to the card above · open a row to reload that exact run
        </span>
        {(() => {
          const rows = [
            ...fpHist.map((x: any) => ({ mode: 'FULL_PERIOD' as const, x })),
            ...simHist.map((x: any) => ({ mode: 'PRE_SEAL' as const, x })),
          ].sort((a, b) => String(b.x.created_at ?? b.x.when ?? '').localeCompare(String(a.x.created_at ?? a.x.when ?? '')))
          if (!rows.length) return <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>no runs yet</div>
          return (
            <div style={{ overflowX: 'auto', marginTop: 6 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.18)' }}>
                  {['mode', 'run ID', 'when', 'tier', 'cfgs', 'Tier-S', 'account P&L', 'return %',
                    'trades', 'WR %', 'PF', 'status', ''].map(h => (
                      <th key={h} style={{ padding: '3px 6px', textAlign: 'left' }}>{h}</th>))}
                </tr></thead>
                <tbody>
                  {rows.map(({ mode: m, x }) => {
                    const isFull = m === 'FULL_PERIOD'
                    // The summary endpoints return different fields; both are mapped to the SAME
                    // account quantities the card renders, so a row can never disagree with it.
                    const pnl = isFull ? x.net_usd : (x.account_simulation?.pnl_usd ?? null)
                    // Read the served field rather than re-deriving it — a second derivation is
                    // a second chance to disagree with the card.
                    const ret = isFull ? (x.return_pct ?? null) : (x.account_simulation?.return_pct ?? null)
                    const trd = isFull ? (x.trades ?? null) : (x.account_simulation?.trades ?? x.seated_trades ?? null)
                    const wr = isFull ? (x.wr ?? null) : (x.account_simulation?.wr_pct ?? null)
                    const p = isFull ? (x.pf ?? null) : (x.account_simulation?.pf ?? null)
                    const loaded = simRun?.runId === x.runId
                    return (
                      <tr key={`${m}:${x.runId}`}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)',
                                   background: loaded ? 'rgba(217,164,65,0.10)' : undefined }}>
                        <td style={{ padding: '3px 6px', color: isFull ? '#d9a441' : '#7ee787', fontWeight: 700 }}>
                          {isFull ? 'FULL' : 'PRE-SEAL'}</td>
                        <td style={{ padding: '3px 6px' }}>{x.runId}</td>
                        <td style={{ padding: '3px 6px' }}>{String(x.created_at ?? x.when ?? '—').replace('T', ' ').slice(0, 16)}</td>
                        <td style={{ padding: '3px 6px' }}>{x.tier ?? '—'}</td>
                        <td style={{ padding: '3px 6px' }}>{x.n_members ?? x.selected_count ?? '—'}</td>
                        <td style={{ padding: '3px 6px' }}>{x.n_tier_s ?? x.tier_s_count ?? '—'}</td>
                        <td style={{ padding: '3px 6px' }}>
                          {pnl == null ? '—' : `${pnl < 0 ? '-' : ''}$${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</td>
                        <td style={{ padding: '3px 6px' }}>{ret == null ? '—' : `${Number(ret).toFixed(2)}`}</td>
                        <td style={{ padding: '3px 6px' }}>{trd == null ? '—' : Number(trd).toLocaleString()}</td>
                        <td style={{ padding: '3px 6px' }}>{wr == null ? '—' : Number(wr).toFixed(2)}</td>
                        <td style={{ padding: '3px 6px' }}>{p == null ? '—' : Number(p).toFixed(3)}</td>
                        <td style={{ padding: '3px 6px', opacity: 0.75 }}>{x.status ?? 'done'}</td>
                        <td style={{ padding: '3px 6px' }}>
                          <button onClick={() => openRun(x.runId, m)} style={{ fontSize: 11 }}>
                            {loaded ? 'reload' : 'open'}</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>

      {meta?.not_admitted?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowNotAdmitted(v => !v)} style={{ fontSize: 12 }}>
            {showNotAdmitted ? 'hide' : 'show'} the {meta.not_admitted.length} PASS winners preserved but not admitted
          </button>
          {showNotAdmitted && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.18)' }}>
                  {['band', 'candidate ID', 'family', 'asset', 'tf', 'WR %', 'PF', 'RRR', 'ann net %', 'reason not admitted']
                    .map(h => <th key={h} style={{ padding: '3px 6px', textAlign: 'left' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {meta.not_admitted.map((x: any) => (
                    <tr key={x.candidate_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '3px 6px', color: BAND_COLOR[x.quality_band] ?? undefined }}>{x.quality_band}</td>
                      <td style={{ padding: '3px 6px' }}>{x.candidate_id}</td>
                      <td style={{ padding: '3px 6px' }}>{x.family ?? '—'}</td>
                      <td style={{ padding: '3px 6px' }}>{x.asset}</td>
                      <td style={{ padding: '3px 6px' }}>{x.tf}</td>
                      <td style={{ padding: '3px 6px' }}>{n(x.wr_pct)}</td>
                      <td style={{ padding: '3px 6px' }}>{n(x.pf, 3)}</td>
                      <td style={{ padding: '3px 6px' }}>{n(x.realised_rrr, 3)}</td>
                      <td style={{ padding: '3px 6px' }}>{n(x.annualized_net_pct, 1)}</td>
                      <td style={{ padding: '3px 6px', maxWidth: 520 }}>{x.reason_not_admitted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {meta?.admission?.stamped_pool_thresholds && (
        <p style={{ fontSize: 11, opacity: 0.7, marginTop: 12, maxWidth: 1100 }}>
          <b>Stamped global admission thresholds</b> (computed from ALL verified PASS winners at admission
          time, so this decision stays reproducible): pool {meta.admission.stamped_pool_thresholds.pool_size} ·
          mean PF {meta.admission.stamped_pool_thresholds.global_mean_pf} ·
          mean realised RRR {meta.admission.stamped_pool_thresholds.global_mean_realised_rrr} ·
          mean annualized net {meta.admission.stamped_pool_thresholds.global_mean_annualized_net_pct}% ·
          p75 {meta.admission.stamped_pool_thresholds.global_p75_pf} /
          {meta.admission.stamped_pool_thresholds.global_p75_realised_rrr} /
          {meta.admission.stamped_pool_thresholds.global_p75_annualized_net_pct}%.
        </p>
      )}
    </div>
  )
}


// ─── FULL-PERIOD SEATED RESULT ──────────────────────────────────────────────
/**
 * The complete seated field set for a hand-built basket over the whole history.
 *
 * FOUR THINGS THIS BLOCK IS CAREFUL ABOUT.
 *
 * 1. `pf: null` is rendered from its STATUS, not as a dash. NO_LOSSES is the best possible outcome
 *    and shows as ∞; NO_ECONOMIC_OBSERVATIONS shows as n/a. Collapsing both to "—" loses the
 *    distinction that matters most for exactly the strongest rows.
 *
 * 2. The reserved lane's own P&L and the VALUE of the Tier-S designation are shown as two separate
 *    numbers. They differ, and the first version of this measurement conflated them: the reserved
 *    lane seated nothing in every basket while the designation was worth thousands, because Tier-S
 *    also confers priority in the ORDINARY lanes. One number for both made the seat look useless
 *    and the designation look free.
 *
 * 3. Realised and unrealised are never summed. Terminal open positions are counted and their
 *    unrealised P&L is left explicitly unpriced rather than imputed, and the reconciliation line
 *    states the identity it actually proves.
 *
 * 4. The contamination label is rendered, not just recorded in the artifact. This pool was selected
 *    on sealed-year results and then measured over a period that includes them, so the number is a
 *    diagnostic ceiling and the panel says so where the number is read.
 */
function FullPeriodResult({ r }: { r: any }) {
  const c = r.full_period ?? {}
  const a = r.accounting ?? {}
  const L = r.lanes ?? {}
  const p = r.period ?? {}
  const rec = r.reconciliation ?? {}
  const num = (v: any, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d))
  const usd = (v: any) => (v == null || !Number.isFinite(Number(v))
    ? '—' : `${Number(v) >= 0 ? '' : '-'}$${Math.abs(Number(v)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
  const pf = c.pf_status === 'NO_LOSSES' ? '∞ (no losing trade)'
    : c.pf_status === 'NO_ECONOMIC_OBSERVATIONS' ? 'n/a' : num(c.pf, 3)
  const cell = (k: string, v: any, t?: string) => (
    <div title={t} style={{ minWidth: 104 }}>
      <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.6 }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{v}</div>
    </div>
  )
  return (
    <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 6,
                  background: 'rgba(217,164,65,0.07)', border: '1px solid rgba(217,164,65,0.28)' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.7, color: '#d9a441' }}>
        FULL PERIOD — ONE CONTINUOUS ALLOCATOR WALK, NO RESET AT THE SEAL
      </div>
      <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
        {(r.labels ?? []).join(' · ')}
      </div>
      <div style={{ fontSize: 10.5, opacity: 0.8, marginTop: 4 }}>
        {p.first_entry} → {p.last_exit} · {num(p.total_years, 2)} years · {r.n_members} cfgs ·{' '}
        {r.n_tier_s} Tier-S · {r.tier} tier · ${Number(r.capital ?? 10000).toLocaleString()} start
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 8 }}>
        {cell('seated trades', (a.seated_trades ?? '—').toLocaleString?.() ?? a.seated_trades)}
        {cell('net', usd(c.net_usd))}
        {cell('return', `${num(c.return_pct_on_capital, 1)} %`)}
        {cell('WR', `${num(c.wr, 2)} %`)}
        {cell('PF', pf, `profit factor status: ${c.pf_status}`)}
        {cell('realised RRR', num(c.rrr, 3))}
        {cell('max DD', `${num(c.max_dd_pct, 2)} % / ${usd(c.max_dd_usd)}`)}
        {cell('ending equity', usd(rec.ending_equity_realised_basis))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 8,
                    paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
        {cell('profitable yrs', `${r.profitable_years}/${r.years_active}`)}
        {cell('profitable Q', `${r.profitable_quarters}/${r.quarters_active}`)}
        {cell('seat rate', `${num(a.seat_pct, 1)} %`,
              `${a.seated_trades} seated of ${a.signals_eligible} eligible signals`)}
        {cell('rejected', (a.rejected_signals ?? '—'),
              Object.entries(a.rejection_reasons ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}
        {cell('ordinary lanes', `${num(L.ordinary_lane_utilisation_pct, 1)} %`,
              `per-lane seated counts: ${JSON.stringify(L.ordinary_lane_seated_counts ?? {})}`)}
        {cell('reserved lane', `${num(L.reserved_lane_utilisation_pct, 1)} % (${L.reserved_lane_seated ?? 0})`,
              r.reserved_lane_note)}
        {cell('Tier-S designation', usd(r.tier_s_designation_incremental_net_usd),
              r.tier_s_designation_note)}
        {cell('open at end', r.terminal_open_positions?.count ?? '—',
              'positions the tape never closed — counted, never given an imputed exit')}
      </div>
      <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 8, lineHeight: 1.6 }}>
        <div>
          <strong>Reconciliation:</strong> {rec.proof}
          {rec.identity_holds === true ? ' ✓' : ` — ${rec.identity_holds}`} · seal-crossing positions{' '}
          {r.seal_crossing_positions?.count ?? 0} (carried across the boundary by the single walk,
          never closed and reopened)
        </div>
        <div style={{ marginTop: 2, opacity: 0.8 }}>
          Unrealised P&amp;L on the {r.terminal_open_positions?.count ?? 0} terminal open position
          {(r.terminal_open_positions?.count ?? 0) === 1 ? '' : 's'} is <strong>not</strong> included
          in net, return, PF, WR or drawdown above, and no exit is imputed for any of them.
        </div>
        <div style={{ marginTop: 2, opacity: 0.7 }}>{r.execution}</div>
      </div>
    </div>
  )
}


// ─── ONE SHAPE FOR BOTH SIMULATION MODES ───────────────────────────────────
/**
 * The two run types write different documents. Normalising them here is what makes it impossible
 * for the result card and the history row to quote different numbers for the same run: both read
 * this function.
 *
 * THE AUTHORITATIVE P&L IS THE RISK-SIZED ACCOUNT SIMULATION. In PRE-SEAL that is
 * `account_simulation`, produced by the live engine's own risk_per_lane_notional off each trade's
 * entry-time stop. In FULL-PERIOD it is the walk itself, which sizes every seated signal the same
 * way against a $10,000 non-compounding account.
 *
 * `basket net %` IS NOT AN ACCOUNT RETURN and is never presented as one. Its formula, from
 * cfgbook/ledger_basket_sim.py, is the UNWEIGHTED SUM OF PER-TRADE PERCENTAGE RETURNS:
 *     net_pct_total = Σ (trade.net × 100)
 * A trade risking $500 and a trade risking $10,000 contribute equally, and nothing compounds. It
 * is a research statistic about the edge, useful for comparing baskets on equal footing, and it
 * will not agree with the account figure. It is shown once, labelled, with that formula attached.
 */
type SimNorm = {
  mode: 'PRE_SEAL' | 'FULL_PERIOD'
  runId: string | null; when: string | null; tier: string | null; lanes: number | null
  periodLabel: string; startIso: string | null; endIso: string | null
  nCfgs: number | null; nTierS: number | null; tierS: string[]
  startEquity: number | null; endEquity: number | null; pnlUsd: number | null; returnPct: number | null
  trades: number | null; wr: number | null; pf: number | null; pfStatus: string | null
  rrr: number | null; maxDdUsd: number | null; maxDdPct: number | null
  eligible: number | null; seated: number | null; seatPct: number | null
  rejections: Record<string, number>
  perLane: Record<string, number>; ordinarySeated: number | null; reservedSeated: number | null
  reservedPct: number | null
  tierSContribution: number | null; tierSVerdict: string | null
  basketNetPct: number | null
  isNet: number | null; oosNet: number | null
  reconciliation: string | null
  dataCutoff: string | null
}

function normaliseRun(d: any, mode: 'PRE_SEAL' | 'FULL_PERIOD'): SimNorm | null {
  if (!d || d.status !== 'done') return null
  if (mode === 'FULL_PERIOD') {
    const c = d.full_period ?? {}
    const a = d.accounting ?? {}
    const L = d.lanes ?? {}
    const rec = d.reconciliation ?? {}
    const p = d.period ?? {}
    return {
      mode, runId: d.runId ?? null, when: d.created_at ?? null, tier: d.tier ?? null,
      lanes: L.total ?? null,
      periodLabel: 'FULL PERIOD — pre-seal IS + sealed OOS, one continuous allocator walk, no reset at the seal',
      startIso: p.first_entry ?? null, endIso: p.last_exit ?? null,
      nCfgs: d.n_members ?? null, nTierS: d.n_tier_s ?? null, tierS: d.tier_s ?? [],
      startEquity: rec.starting_equity ?? null,
      endEquity: rec.ending_equity_realised_basis ?? null,
      pnlUsd: c.net_usd ?? null, returnPct: c.return_pct_on_capital ?? null,
      trades: c.trades ?? null, wr: c.wr ?? null, pf: c.pf ?? null, pfStatus: c.pf_status ?? null,
      rrr: c.rrr ?? null, maxDdUsd: c.max_dd_usd ?? null, maxDdPct: c.max_dd_pct ?? null,
      eligible: a.signals_eligible ?? null, seated: a.seated_trades ?? null,
      seatPct: a.seat_pct ?? null, rejections: a.rejection_reasons ?? {},
      perLane: L.ordinary_lane_seated_counts ?? {},
      ordinarySeated: L.ordinary_lane_seated_counts
        ? Object.values<number>(L.ordinary_lane_seated_counts).reduce((x, y) => x + y, 0) : null,
      reservedSeated: L.reserved_lane_seated ?? null,
      reservedPct: L.reserved_lane_utilisation_pct ?? null,
      tierSContribution: d.tier_s_designation_incremental_net_usd ?? null,
      tierSVerdict: d.tier_s_designation_note ?? null,
      basketNetPct: null,
      isNet: null, oosNet: null,
      reconciliation: rec.proof ?? null,
      dataCutoff: null,
    }
  }
  const acc = d.account_simulation ?? {}
  const bm = d.seated_basket_metrics ?? {}
  const seated: any[] = Array.isArray(d.seated) ? d.seated : []
  const ts = seated.map(r => Number(r?.exit_ms)).filter(Number.isFinite)
  const en = seated.map(r => Number(r?.entry_ms)).filter(Number.isFinite)
  const lanes: Record<string, number> = {}
  for (const r of seated) { const k = String(r?.lane ?? '?'); lanes[k] = (lanes[k] ?? 0) + 1 }
  const nLanes = d.lanes_total ?? null
  return {
    mode, runId: d.runId ?? null, when: d.when ?? d.created_at ?? null, tier: d.tier ?? null,
    lanes: nLanes,
    periodLabel: 'PRE-SEAL ONLY — the sealed year is never read by this pass',
    startIso: en.length ? new Date(Math.min(...en)).toISOString() : null,
    endIso: ts.length ? new Date(Math.max(...ts)).toISOString() : null,
    nCfgs: d.selected_count ?? null, nTierS: d.tier_s_count ?? null, tierS: d.tier_s_cfgs ?? [],
    startEquity: acc.start_balance ?? null, endEquity: acc.final_balance ?? null,
    pnlUsd: acc.pnl_usd ?? null, returnPct: acc.return_pct ?? null,
    trades: acc.trades ?? d.seated_trades ?? null, wr: acc.wr_pct ?? null,
    pf: acc.pf ?? null, pfStatus: null, rrr: acc.realised_rrr ?? null,
    maxDdUsd: acc.max_dd_usd ?? null, maxDdPct: acc.max_dd_pct ?? null,
    eligible: d.eligible_trades ?? null, seated: d.seated_trades ?? null,
    seatPct: d.overall_seat_rate == null ? null : Math.round(d.overall_seat_rate * 1000) / 10,
    rejections: d.rejection_reasons ?? {},
    perLane: lanes,
    ordinarySeated: nLanes ? Object.entries(lanes).filter(([k]) => Number(k) !== nLanes)
      .reduce((x, [, v]) => x + v, 0) : null,
    reservedSeated: nLanes ? (lanes[String(nLanes)] ?? 0) : null,
    reservedPct: nLanes && seated.length
      ? Math.round(((lanes[String(nLanes)] ?? 0) / seated.length) * 10000) / 100 : null,
    tierSContribution: null,
    tierSVerdict: null,
    basketNetPct: bm.net_pct_total ?? null,
    isNet: null, oosNet: null,
    reconciliation: acc.start_balance != null && acc.pnl_usd != null && acc.final_balance != null
      ? `${acc.start_balance} + ${acc.pnl_usd} = ${acc.final_balance}` : null,
    dataCutoff: d.data_cutoff ?? null,
  }
}

function SimResultCard({ run, mode, busy, sel }: { run: any; mode: 'PRE_SEAL' | 'FULL_PERIOD'; busy: boolean; sel: any }) {
  const n = normaliseRun(run, mode)
  const N = (v: any, d = 2, suf = '') => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(d)}${suf}`)
  const U = (v: any) => (v == null || !Number.isFinite(Number(v))
    ? '—' : `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
  const PF = () => (n?.pfStatus === 'NO_LOSSES'
    ? <span style={{ color: '#4ade80', fontWeight: 700 }} title="no losing trade — the ratio is undefined because the denominator is zero, which is the best case">∞</span>
    : n?.pfStatus === 'NO_ECONOMIC_OBSERVATIONS' ? 'n/a' : N(n?.pf, 3))
  const head = mode === 'FULL_PERIOD' ? 'FULL-PERIOD SIMULATION (IS + OOS)' : 'PRE-SEAL SIMULATION (IS ONLY)'
  const accent = mode === 'FULL_PERIOD' ? '#d9a441' : '#7ee787'
  const box = {
    marginTop: 8, padding: '10px 12px', borderRadius: 6,
    background: mode === 'FULL_PERIOD' ? 'rgba(217,164,65,0.07)' : 'rgba(126,231,135,0.06)',
    border: `1px solid ${mode === 'FULL_PERIOD' ? 'rgba(217,164,65,0.30)' : 'rgba(126,231,135,0.28)'}`,
  } as React.CSSProperties
  const cell = (k: string, v: React.ReactNode, t?: string) => (
    <div title={t} style={{ minWidth: 100 }}>
      <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.6 }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{v}</div>
    </div>
  )
  if (!n) {
    return (
      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.7, color: accent }}>{head}</div>
        <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 4 }}>
          {busy ? 'running — no figure is shown until the run completes'
                : `no ${mode === 'FULL_PERIOD' ? 'full-period' : 'pre-seal'} result loaded. Pick cfgs and press RUN SIMULATION, or open one from the history below.`}
        </div>
      </div>
    )
  }
  const d10 = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')
  return (
    <div style={box}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.7, color: accent }}>{head}</div>
      <div style={{ fontSize: 10.5, opacity: 0.82, marginTop: 2 }}>{n.periodLabel}</div>
      <div style={{ fontSize: 10.5, opacity: 0.82, marginTop: 2 }}>
        run <b>{n.runId ?? '—'}</b> · {d10(n.startIso)} → {d10(n.endIso)} · {n.nCfgs ?? '—'} cfgs ·{' '}
        {n.nTierS ?? 0} Tier-S · {n.tier ?? '—'} tier{n.lanes ? ` · ${n.lanes} lanes` : ''}
        {n.dataCutoff ? ` · cutoff ${n.dataCutoff}` : ''}
      </div>
      <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.6, marginTop: 8 }}>
        account simulation — risk-sized, the authoritative P&amp;L
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 4 }}>
        {cell('starting equity', U(n.startEquity))}
        {cell('ending equity', U(n.endEquity))}
        {cell('P&L', U(n.pnlUsd))}
        {cell('return', N(n.returnPct, 2, ' %'))}
        {cell('trades', n.trades == null ? '—' : n.trades.toLocaleString())}
        {cell('WR', N(n.wr, 2, ' %'))}
        {cell('PF', <PF />)}
        {cell('RRR', N(n.rrr, 3))}
        {cell('max DD', `${N(n.maxDdPct, 2, ' %')} / ${U(n.maxDdUsd)}`)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 8,
                    paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
        {cell('eligible', n.eligible == null ? '—' : n.eligible.toLocaleString())}
        {cell('seated', n.seated == null ? '—' : n.seated.toLocaleString())}
        {cell('seat rate', N(n.seatPct, 1, ' %'))}
        {cell('ordinary lanes', n.ordinarySeated == null ? '—' : n.ordinarySeated.toLocaleString(),
              `per-lane seated: ${JSON.stringify(n.perLane)}`)}
        {cell('reserved lane', `${n.reservedSeated ?? '—'} (${N(n.reservedPct, 2, ' %')})`,
              'the reserved seat is reachable only when a Tier-S cfg signals while every ordinary lane is full')}
        {cell('Tier-S contribution', n.tierSContribution == null ? '—' : U(n.tierSContribution),
              n.tierSVerdict ?? 'measured by rerunning the identical basket with no designation')}
        {cell('rejected', Object.values(n.rejections).reduce((a, b) => a + b, 0).toLocaleString(),
              Object.entries(n.rejections).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none')}
      </div>
      {n.reconciliation && (
        <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 8 }}>
          <b>Reconciliation:</b> {n.reconciliation} — starting equity + realised P&amp;L = ending equity.
          {mode === 'FULL_PERIOD'
            ? ' Every seated trade in a completed historical replay carries a recorded exit, so terminal unrealised is 0 by construction.'
            : ''}
        </div>
      )}
      {n.basketNetPct != null && (
        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 6, paddingTop: 6,
                      borderTop: '1px dashed rgba(255,255,255,0.14)' }}>
          <b>NON-ACCOUNT DIAGNOSTIC</b> — basket net {n.basketNetPct} %. Formula:
          {' '}<code>Σ (per-trade net return × 100)</code> over seated trades
          (cfgbook/ledger_basket_sim.py). It is UNWEIGHTED and does not compound: a trade risking
          $500 counts the same as one risking $10,000. It is a research statistic for comparing
          baskets on equal footing and will not agree with the account figures above. It is not a
          return on any account.
        </div>
      )}
      {n.tierS.length > 0 && (
        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>Tier-S: {n.tierS.join(', ')}</div>
      )}
    </div>
  )
}
