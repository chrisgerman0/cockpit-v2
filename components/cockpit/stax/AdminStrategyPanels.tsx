'use client'

/**
 * Strategy sub-tab panels for the admin cockpit:
 *   - StrategyResearchPanel    — HoneyBadger phase research (static research doc)
 *   - SatoshiStackerSpecPanel  — V2 multi-strategy spec (static research doc, dense)
 *   - SignalComparisonPanel    — 3-way trade history (Binance / Bitget engine / Bitget live), dynamic
 *   - ExecutionArchitecturePanel — pipeline diagram (re-rendered native, no iframe)
 *
 * Ports of the legacy /admin/strategy-research, /admin/satoshi-stacker-spec,
 * /admin/signal-comparison, /admin/architecture pages into v2 design tokens.
 * Static research content is faithful to the legacy text — admins can keep
 * referring to the same numbers and tables that lived under staxs.ai/admin/*.
 */

import { useCallback, useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api'

// ─── Local helpers (mirror the helper components from the legacy pages) ─────

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
      style={{
        borderColor: `rgba(${t.rgb}, 0.4)`,
        background: `rgba(${t.rgb}, 0.05)`,
      }}
    >
      {children}
    </div>
  )
}

function ToneLabel({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = toneStyle(tone)
  return (
    <div
      className="bt-eyebrow"
      style={{ color: t.solid, marginBottom: 6 }}
    >
      {children}
    </div>
  )
}

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = toneStyle(tone)
  return (
    <span
      className="badge"
      style={{
        background: `rgba(${t.rgb}, 0.15)`,
        color: t.solid,
        borderColor: `rgba(${t.rgb}, 0.4)`,
      }}
    >
      {children}
    </span>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="adm-h2">{children}</h2>
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="adm-h3">{children}</h3>
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="adm-code">{children}</code>
}

// ─── Format helpers ────────────────────────────────────────────────────────

function fmtUsd(n: number | null | undefined, signed = false) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const sign = signed ? (n >= 0 ? '+' : '') : ''
  return sign + (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtPct(n: number | null | undefined) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}
function fmtPrice(n: number | null | undefined) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toUTCString().slice(5, 22) : '—'
}
function pnlClass(n: number | null | undefined) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  if (n > 0) return 'pos-text'
  if (n < 0) return 'neg-text'
  return ''
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Strategy Research — HB phase research (static doc)
// ════════════════════════════════════════════════════════════════════════════

const HB_EDGES = [
  {
    n: 1, name: 'Bias sizing (2-tier)', status: 'ships' as const,
    hyp: 'Trades close to the daily EMA100 (low bias) win more often than overextended ones. Size 2× on low-bias, 1× otherwise.',
    result: '+$242k vs C1. Low-bias trades are genuinely better setups — confirmed across every threshold tested.',
    cfg: 'HB_BIAS_EMA_PERIOD=100\nHB_LOW_BIAS_THRESHOLD_PCT=30\nHB_SIZE_MULT_LOW_BIAS=2.0',
  },
  {
    n: 2, name: 'Tier-4 brackets', status: 'ships' as const,
    hyp: 'Use 4 size buckets (super-low ≤10% / low ≤30% / mid / high) instead of 2 for finer granularity. Hit the cleanest setups at 2.5× instead of 2×.',
    result: '+$544k vs C1 at 3.89× avg leverage. Tier-4 beats 2-tier on both $ and DD when leverage-normalized. The 2.5× on super-low bucket is the real driver.',
    cfg: 'HB_BIAS_EMA_PERIOD=100\nHB_SUPER_LOW_BIAS_THRESHOLD_PCT=10\nHB_SIZE_MULT_SUPER_LOW_BIAS=2.5\nHB_LOW_BIAS_THRESHOLD_PCT=30\nHB_SIZE_MULT_LOW_BIAS=2.0',
  },
  {
    n: 3, name: 'Combined bias+ATR filter', status: 'ships' as const,
    hyp: 'Only size up when BOTH bias is low AND ATR ≤ 2% (low volatility). Double-filter for highest-quality setups.',
    result: "+$299k vs C1 with DD falling from 8.68% → 5.60%. Genuine Pareto improvement. Fewer trades sized up, but they're the cleanest. Median option.",
    cfg: 'HB_BIAS_EMA_PERIOD=100\nHB_LOW_BIAS_THRESHOLD_PCT=20\nHB_SIZE_MULT_LOW_BIAS=2.0\nHB_COMBINED_LOW_ATR_PCT=2.0',
  },
  {
    n: 4, name: 'LOSS-mode pyramid-50', status: 'trashed' as const,
    hyp: 'Currently pyramid-50 fires on every EMA50D touch. Only fire it when the parent trade is underwater — avoid adding to winners.',
    result: 'Trashed. ALWAYS mode captures PROFIT fires (83% WR, 18 legs) AND LOSS fires (51% WR, 61 legs) — both are net-positive. ALWAYS beats LOSS by +$12k PnL. Never restrict an 83% bucket.',
    cfg: '— removed, not shipping —',
  },
  {
    n: 5, name: 'Phantom filter ($1 on high-bias)', status: 'trashed' as const,
    hyp: 'Size high-bias trades to $1 (preserve MRS pipeline, zero the PnL drag from overextended entries).',
    result: 'Trashed. High-bias trades have 58% WR with 1.65× average payoff ratio — net-positive. Removing them hurts equity recovery and actually increases HB-only DD from 12.67% → 18%. The "drag" is a misconception.',
    cfg: '— removed, not shipping —',
  },
]

const HB_DEAD_ENDS: [string, string][] = [
  ['LOSS-mode pyramid-50', 'ALWAYS fires both 83% and 51% WR buckets — both net-positive; ALWAYS wins'],
  ['Phantom filter ($1 on high-bias trades)', '58% WR bucket is net-positive (1.65× payoff); removing it hurts equity curve'],
  ['ATR-based stop losses', 'underperformed fixed 4%'],
  ['Skipping MRS scalp on overextended trades', 'MRS is net positive — keep it'],
  ['Pre-entry retrace (enter earlier)', 'hurt PnL'],
  ['Tighter/wider limit offset', '0.3% is already optimal'],
  ['Early-entry (0.2-0.3% before breakout)', 'hurt WR'],
  ['EMA150D / EMA200D as bias reference', 'EMA100D is the sweet spot'],
  ['Tighter SL on high-bias only', 'neutral'],
  ['Disabling pyramid-21 on high-bias', 'neutral — already PROFIT-gated'],
]

const HB_LEADERBOARD = [
  { r: 1,  c: 'tier4_30_always',          f: '$1,366,804', d: '10.01%', delta: '+$544k', note: '🚀 Ship option B', hl: 'emerald' as const },
  { r: 2,  c: 'loss_tier4_30 (ph11)',      f: '$1,350,524', d: '8.68%',  delta: '+$528k', note: 'Superseded — LOSS mode' },
  { r: 3,  c: 'champ_30 (ph6)',            f: '$1,341,282', d: '13.74%', delta: '+$519k', note: 'Dominated by tier4_30' },
  { r: 4,  c: 'combined_20_ema100',        f: '$1,121,661', d: '5.60%',  delta: '+$299k', note: '🛡️ Ship option A', hl: 'violet' as const },
  { r: 5,  c: 'champ_30_dollar_40 (ph10)', f: '$1,135,916', d: '6.10%',  delta: '+$313k', note: 'Legacy risk-adj option' },
  { r: 6,  c: 'champ_40 (ph9)',            f: '$1,190,283', d: '8.68%',  delta: '+$368k', note: 'ALWAYS mode, champ' },
  { r: 7,  c: 'anchor_champ_30 (ph9)',     f: '$1,181,030', d: '8.68%',  delta: '+$359k', note: 'Anchor variant' },
  { r: 8,  c: 'loss_champ_30 (ph9)',       f: '$1,167,577', d: '8.68%',  delta: '+$345k', note: 'LOSS variant — superseded' },
  { r: 9,  c: 'loss_tier4_25 (ph11)',      f: '$1,336,660', d: '8.68%',  delta: '+$514k', note: 'LOSS variant — superseded' },
  { r: 10, c: 'C1 baseline',               f: '$822,259',   d: '8.68%',  delta: '—',      note: 'Reference ($40k fixed notional)' },
]

export function StrategyResearchPanel({ active: _active }: { active: boolean }) {
  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">STRATEGY RESEARCH</div>
        <h1 className="bt-title">Golden Goose — HB <span className="bt-title-gold">optimization.</span></h1>
        <p className="bt-blurb">11 phases · ~110 configs · 8-year backtest · holdout validated · 2026-04-21</p>
      </div>

      <ToneCard tone="emerald">
        <ToneLabel tone="emerald">TL;DR</ToneLabel>
        <p className="adm-p">
          Tested 5 distinct edges — sizing dials only, entries/exits untouched.
          Two survived the full gauntlet (apples-to-apples leverage normalization + holdout test).
          Both are real: <strong className="pos-text">bias sizing</strong> and <strong className="pos-text">tier-4 super-low bucket</strong>.
        </p>
        <div className="bt-twin-row" style={{ marginTop: 12 }}>
          <div className="card card-pad">
            <div className="adm-stat-label" style={{ marginBottom: 4 }}>Option A · smooth &amp; safe</div>
            <div className="num" style={{ color: 'var(--gold)', fontSize: 12, marginBottom: 4 }}>combined_20_ema100</div>
            <div className="pos-text" style={{ fontWeight: 600 }}>+$299k · DD <span className="neg-text" style={{ textDecoration: 'line-through' }}>8.68%</span> → 5.60%</div>
            <div className="adm-stat-sub" style={{ marginTop: 4 }}>Beats C1 on BOTH $ and DD with no leverage increase</div>
          </div>
          <div className="card card-pad">
            <div className="adm-stat-label" style={{ marginBottom: 4 }}>Option B · max return</div>
            <div className="num" style={{ color: 'var(--gold)', fontSize: 12, marginBottom: 4 }}>tier4_30_always</div>
            <div className="pos-text" style={{ fontWeight: 600 }}>+$544k · DD 10.01%</div>
            <div className="adm-stat-sub" style={{ marginTop: 4 }}>At same effective leverage, beats uniform C1 by +$31k with 7pp less DD</div>
          </div>
        </div>
      </ToneCard>

      <H2>One thing, and one thing only</H2>
      <div className="card card-pad">
        <p className="adm-p">
          Every config in this research runs the <strong style={{ color: 'var(--gold)' }}>exact same HB strategy</strong> — same Donchian(20) 4H breakout, same EMA50D filter, same RSI prime, same pyramid-21, same pyramid-50, same MRS counter-scalp, same 4% stop-loss. We only changed <strong className="pos-text">how big each position is</strong>, based on how far price is from the daily EMA100 (a bias signal).
        </p>
        <p className="adm-p adm-p-muted" style={{ marginTop: 8 }}>
          Closer to the EMA = less stretched = higher probability setup → size up. Far from EMA = overextended = lower probability → keep normal size.
        </p>
      </div>

      <H2>The 5 edges we tested</H2>
      <div className="bt-twin-row">
        {HB_EDGES.map((e) => (
          <ToneCard key={e.n} tone={e.status === 'ships' ? 'emerald' : 'rose'}>
            <div className="adm-edge-head">
              <span className="adm-stat-label">Edge #{e.n}</span>
              <ToneBadge tone={e.status === 'ships' ? 'emerald' : 'rose'}>{e.status === 'ships' ? '✓ ships' : '✗ trashed'}</ToneBadge>
            </div>
            <div className="adm-edge-name">{e.name}</div>
            <p className="adm-p adm-p-sm" style={{ marginTop: 6 }}><span className="adm-muted">Hypothesis: </span>{e.hyp}</p>
            <p className="adm-p adm-p-sm" style={{ marginTop: 6 }}><span className="adm-muted">Finding: </span>{e.result}</p>
            <pre className="adm-pre">{e.cfg}</pre>
          </ToneCard>
        ))}
      </div>

      <H2>Dead ends <span className="adm-muted" style={{ fontSize: 13, fontWeight: 400 }}>— things we tested that didn&apos;t help</span></H2>
      <div className="card card-pad">
        <ul className="adm-list">
          {HB_DEAD_ENDS.map(([what, why]) => (
            <li key={what}><span className="neg-text">✗</span> <strong>{what}</strong> <span className="adm-muted">— {why}</span></li>
          ))}
        </ul>
      </div>

      <H2>The leverage trap</H2>
      <p className="adm-p adm-p-muted">Bigger positions mean bigger returns — that&apos;s not skill. The fair comparison is: how does the selective config perform vs C1 running at the <em>same average leverage</em>?</p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>Config</th><th style={{ textAlign: 'right' }}>Avg lev</th><th style={{ textAlign: 'right' }}>Final $</th><th style={{ textAlign: 'right' }}>DD%</th><th>vs matched-lev C1</th></tr></thead>
          <tbody>
            <tr><td className="num adm-muted">C1 baseline</td><td className="num" style={{ textAlign: 'right' }}>2×</td><td className="num" style={{ textAlign: 'right' }}>$822,259</td><td className="num" style={{ textAlign: 'right' }}>8.68%</td><td className="adm-muted">—</td></tr>
            <tr><td className="num adm-muted">C1 uniform @ 3× (matched)</td><td className="num" style={{ textAlign: 'right' }}>3×</td><td className="num" style={{ textAlign: 'right' }}>$1,096,810</td><td className="num neg-text" style={{ textAlign: 'right' }}>12.66%</td><td className="adm-muted">baseline at 3×</td></tr>
            <tr><td className="num adm-muted">C1 uniform @ 4× (matched)</td><td className="num" style={{ textAlign: 'right' }}>4×</td><td className="num" style={{ textAlign: 'right' }}>$1,365,284</td><td className="num neg-text" style={{ textAlign: 'right' }}>17.02%</td><td className="adm-muted">baseline at 4×</td></tr>
            <tr style={{ background: 'rgba(167,139,250,0.05)' }}><td className="num" style={{ color: 'var(--gold)' }}>combined_20_ema100</td><td className="num" style={{ textAlign: 'right' }}>2.99×</td><td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>$1,121,661</td><td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>5.60%</td><td><span className="pos-text">+$25k PnL</span> · <span className="pos-text">−7.06pp DD</span> <span className="adm-muted">vs C1@3×</span></td></tr>
            <tr style={{ background: 'rgba(var(--pos-rgb),0.05)' }}><td className="num" style={{ color: 'var(--gold)' }}>tier4_30_always</td><td className="num" style={{ textAlign: 'right' }}>3.89×</td><td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>$1,366,804</td><td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>10.01%</td><td><span className="pos-text">+$2k PnL</span> · <span className="pos-text">−7.01pp DD</span> <span className="adm-muted">vs C1@4×</span></td></tr>
          </tbody>
        </table>
      </div>
      <ToneCard tone="emerald">
        <span className="pos-text" style={{ fontWeight: 600 }}>Key insight: </span>
        <span className="adm-p">Both selective configs beat their matched-leverage C1 on <em>both</em> PnL and DD simultaneously. That&apos;s the edge — not just using more leverage. Uniform higher leverage explodes DD non-linearly (8.68% → 12.66% → 17.02%) while selective sizing keeps it flat.</span>
      </ToneCard>

      <H2>Holdout test — 2025-01-01 → now</H2>
      <p className="adm-p adm-p-muted">~15.5 months of data, completely unseen during tuning (all 11 phases were run on 2017–2024 in-sample data).</p>
      <div className="card card-pad">
        <div className="row row-stats">
          <div><div className="adm-stat-label">Holdout trades fired</div><div className="adm-h-val">~130 per config</div><div className="adm-stat-sub">Ratio 17.7% = expected (15.5/87 months)</div></div>
          <div><div className="adm-stat-label">All 3 selective configs</div><div className="adm-h-val pos-text">+$58k vs C1 holdout</div><div className="adm-stat-sub">Same delta for all — 2025+ was low-bias environment</div></div>
          <div><div className="adm-stat-label">Edge verdict</div><div className="adm-h-val pos-text">EDGE HOLDS</div><div className="adm-stat-sub">Low-bias 2× multiplier fired consistently in recent data</div></div>
        </div>
      </div>
      <ToneCard tone="amber">
        <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Why all 3 configs converge in holdout: </span>
        <span className="adm-p">The 2025–2026 period was a persistently low-bias environment (price close to EMA100D most of the time). All 3 configs use 2× on low-bias trades — they behave identically on this data. This is actually good news: it confirms the &quot;low-bias = better setup&quot; thesis was firing in live market conditions.</span>
      </ToneCard>

      <H2>Full leaderboard</H2>
      <p className="adm-p adm-p-muted">Historical top configs across all phases. LOSS-mode entries are preserved for reference but were superseded by ALWAYS-mode equivalents.</p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>#</th><th>Config</th><th style={{ textAlign: 'right' }}>Final $</th><th style={{ textAlign: 'right' }}>DD%</th><th style={{ textAlign: 'right' }}>Δ$ vs C1</th><th>Note</th></tr></thead>
          <tbody>
            {HB_LEADERBOARD.map(r => {
              const bg = r.hl === 'emerald' ? 'rgba(var(--pos-rgb),0.05)' : r.hl === 'violet' ? 'rgba(167,139,250,0.05)' : undefined
              return (
                <tr key={r.r} style={bg ? { background: bg } : undefined}>
                  <td className="adm-muted">{r.r}</td>
                  <td className="num" style={{ color: 'var(--gold)', fontSize: 12 }}>{r.c}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.f}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{r.d}</td>
                  <td className="num pos-text" style={{ textAlign: 'right', fontWeight: 600 }}>{r.delta}</td>
                  <td className="adm-muted" style={{ fontSize: 11 }}>{r.note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <H2>My suggestion</H2>
      <ToneCard tone="emerald">
        <ToneLabel tone="emerald">RECOMMENDED PATH</ToneLabel>
        <ol className="adm-numlist">
          <li><span style={{ color: 'var(--pos)', fontWeight: 700 }}>1.</span> Ship <Code>combined_20_ema100</Code> first. It&apos;s a genuine Pareto improvement — more return <em>and</em> lower drawdown vs C1, no catches. Conservative enough to run without hand-holding. The double-filter (bias + ATR) is the most defensible logic.</li>
          <li><span style={{ color: 'var(--pos)', fontWeight: 700 }}>2.</span> After 90 days live data confirms the bias-sizing thesis, upgrade to <Code>tier4_30_always</Code>. The 4-tier brackets and 2.5× super-low bucket unlock the full upside. The extra 1.33pp DD vs baseline is the honest cost of using ~4× leverage.</li>
        </ol>
        <div className="adm-stat-sub" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(var(--pos-rgb),0.2)' }}>
          Both configs use the same core insight: trades close to the daily EMA100 are cleaner setups. The research is thorough — 11 phases, ~110 configs, apples-to-apples leverage normalization, holdout on unseen data. The edge is real.
        </div>
      </ToneCard>

      <footer className="adm-footer">
        Research artefacts: <Code>{'/tmp/hb-phase{2..11}-out/'}</Code> · Sandbox: <Code>/tmp/backtest-preentry-sandbox.js</Code> · Holdout script: <Code>/tmp/hb-holdout-analyzer.js</Code>
      </footer>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Satoshi Stacker Spec — V2 multi-strategy spec (static doc, dense)
// ════════════════════════════════════════════════════════════════════════════

const SS_ENGINES = [
  {
    name: '1. Donchian breakout', direction: 'long + short', volume: '~95% of trades', wr: '71-72% blended',
    setup: 'Close exceeds the highest high of the last 20 4H bars (long) or lowest low (short).',
    filters: [
      'Daily 50EMA aligned with direction (trend prime)',
      'RSI(14) ≤ 65 (longs) or ≥ 35 (shorts) — skip extended setups',
      'Not already at OB/OS + BB extreme (skip armed entries)',
    ],
    tone: 'emerald' as const,
  },
  {
    name: '2. MACD quality cross', direction: 'long + short', volume: '~5% of trades', wr: '81% standalone',
    setup: 'MACD histogram crosses zero (bull or bear).',
    filters: [
      'ADX(14) ≥ 25 (real trend, not chop)',
      'Histogram trended toward zero for ≥ 3 bars before cross',
      'Volume on cross-bar > 1.5× 20-bar avg',
      'Daily MACD same direction (multi-TF align)',
      'Close within 4% of EMA21 (no chasing extended)',
      'Cross-bar close > prev high (long) / < prev low (short)',
    ],
    tone: 'cyan' as const,
  },
  {
    name: '3. EMA21 pullback in trend', direction: 'long + short', volume: '~3% of trades', wr: '78.6% standalone',
    setup: 'Price retraces to 4H EMA21 in confirmed trend stack.',
    filters: [
      'EMA21 > EMA50 > EMA200 on 4H (uptrend stack)',
      'Daily close > daily 50EMA AND daily EMA21 > 50EMA',
      'ADX(14) ≥ 25',
      'Touch within 0.3% of EMA21',
      'Prior bar already turning (close > open)',
      'Continuation candle on retest (bullish + close in upper half)',
    ],
    tone: 'amber' as const,
  },
  {
    name: '4. REV_LONG (bull reversal)', direction: 'long only', volume: '~3% of trades', wr: '63-68%',
    setup: 'Bullish reversal candle pattern at daily 50EMA in uptrend.',
    filters: [
      'Daily close > 50EMA (uptrend)',
      'Within 3% of daily 50EMA (rejection zone)',
      '4H EMA21 > EMA50 (structure)',
      'Bull engulfing / hammer / morning star / piercing / big green',
    ],
    tone: 'emerald' as const,
  },
  {
    name: '5. REV_SHORT (bear reversal)', direction: 'short only', volume: '~3% of trades', wr: '63-68%',
    setup: 'Bearish reversal candle pattern at daily 50EMA in downtrend.',
    filters: [
      'Daily close < 50EMA (downtrend)',
      'Within 3% of daily 50EMA (rejection zone)',
      '4H EMA21 < EMA50 (structure)',
      'Bear engulfing / shooting star / evening star / dark cloud / big red',
    ],
    tone: 'rose' as const,
  },
]

const SS_MGMT = [
  { name: 'Entry order', text: 'Limit-then-market: place a limit 0.3% better than market, wait 60 minutes. If filled at limit, pay maker fee (0.02%). If not, fall through to market at the open of the 61st minute, taker fee (0.05%) plus 2 bps slippage.' },
  { name: 'Stop loss', text: 'Hard 4% from entry price (long: entry × 0.96; short: entry × 1.04). Pullback entries can override with adaptive SL below the recent swing low.' },
  { name: 'Dynamic trailing TP (the alpha)', text: 'Once MFE (max favorable excursion) hits 1.5%, arm the trail. Reprieve before tightening: 90 min at MFE 1.5%, 120 at 3%, 180 at 5%, 240 at 8%. Retrace tolerance shrinks at higher MFE: 60% giveback at 1.5% → 30% giveback at 8%. Hybrid floor: never let trail tighter than 1% off the MFE peak.' },
  { name: 'EMA21 pyramid (winning trades only)', text: 'When a winning position retraces to 4H EMA21, add 50% of base notional. Combined position rides one trail. Adds 12-15% of trades (the highest-quality subset).' },
  { name: 'BB+RSI stretched exit', text: 'When 4H close has RSI ≥ 70 AND closes above the upper Bollinger band (2σ, 20 bars), arm the stretched-exit. Position closes at the next 4H boundary at market. Catches obvious tops on long trades; mirror for shorts.' },
  { name: 'Rollover exit', text: 'When 4H RSI crosses below its 14-period EMA (long position), close at next bar boundary. Captures the moment momentum has turned, before the deeper retracement begins.' },
]

const SS_LOGIC_BLOCKS_SIGNAL = [
  { n: 1, title: 'Daily-warmup gate', code: 'if (dIdx == null || dIdx < 60) continue;', expl: 'Skip the first 60 daily bars (need warmup for daily 50/100/200 EMAs to mature).' },
  {
    n: 2, title: 'Engine 1 — Donchian breakout (LONG)',
    code: `if (close[i] > donchianHigh[20]) {
  prime = true
  if (cfg.prime === 'EMA50D') prime = (daily.close > daily.EMA50)
  if (cfg.primeRsi)            prime = prime AND (RSI <= 65)
  if (cfg.requireEmaStack)     prime = prime AND (EMA21 > EMA50 > EMA200)
  if (prime AND cfg.enableLongs)
    addSignal({dir: +1, source: 'breakout', confidence: 1})
}`,
    expl: 'If 4H close exceeds the highest high of the last 20 4H bars (5 days), and the daily 50EMA confirms uptrend, and we\'re not already overbought (RSI ≤ 65), enter long on next bar\'s open. Mirror condition for short.',
  },
  {
    n: 3, title: 'Engine 2 — MACD quality cross',
    code: `bullCross = hist[i] > 0 AND hist[i-1] <= 0
if (bullCross) {
  bullPriorOk    = (hist[i-5..i-1] all <= 0)
  bullMagOk      = (|hist[i]| / price >= 0.05%)
  bullPriceConf  = (close[i] > prev.high)
  adxOk          = (ADX[i] >= 25)
  histTrendingOk = (hist[i-3..i-1] strictly rising)
  distOk         = (|close - EMA21| <= 4%)
  volOk          = (volume[i] > 1.5 * avg(20))
  dailyAlignOk   = (daily.MACD.hist > 0)

  if (ALL gates pass)
    addSignal({dir: +1, source: 'macd', confidence: 2})
}`,
    expl: 'MACD histogram crosses from negative to positive — but ONLY if it\'s a real momentum shift (8 quality gates). 1.2 trades/year per asset survive these gates. WR 81% standalone.',
  },
  {
    n: 4, title: 'Engine 3 — EMA21 pullback in trend',
    code: `if (cfg.usePullback) {
  trendOk = (4H.EMA21 > 4H.EMA50 > 4H.EMA200)
              AND (daily.close > daily.EMA50)
              AND (daily.EMA21 > daily.EMA50)
              AND (ADX[i] >= 25)

  if (!trendOk) continue

  touched = (low <= EMA21*1.003 AND high >= EMA21*0.997)
  wasAbove = any(close[i-10..i-1] > EMA21*1.03)
  bullCont = (close > open) AND (close > (high+low)/2)
  priorTurn = (close[i-1] > open[i-1])
  brokeEma50 = any(close[i-10..i] < EMA50)

  if (touched AND wasAbove AND bullCont AND priorTurn AND !brokeEma50)
    addSignal({dir: +1, source: 'pullback', confidence: 3})
}`,
    expl: 'Highest-quality entry — only fires in confirmed strong trends pulling back to EMA21. ~3 trades/year per asset. WR 78.6% standalone, PF 1.70.',
  },
  {
    n: 5, title: 'Signal deduplication',
    code: `function addSignal(entryTs, sig) {
  existing = signals.get(entryTs)
  if (!existing OR sig.confidence > existing.confidence) {
    signals.set(entryTs, sig)
  }
}`,
    expl: 'If multiple engines fire on the same 4H bar, the highest-confidence one wins: Pullback (3) > MACD (2) > Breakout (1) = REV_LONG (1) = REV_SHORT (1). Existing signals only get overridden by HIGHER confidence.',
  },
]

const SS_LOGIC_BLOCKS_POS = [
  {
    n: 1, title: 'Pending entry → fill check',
    code: `if (pending && !pos) {
  if (pending.dir === 1 AND c.low <= pending.limitPx) {
    fillPx = pending.limitPx
    pos = createPosition(fillPx, FEE_MAKER)
  }
  else if (i >= pending.expireIdx) {
    fillPx = c.open + 2bps slippage
    pos = createPosition(fillPx, FEE_TAKER)
  }
}`,
    expl: 'Limit order placed 0.3% better than market. Each 1m bar checks if limit hit. After 60 min, fall through to market with 2 bps slippage. Maker fee 0.02% / taker 0.05%.',
  },
  {
    n: 2, title: 'MFE tracking (every 1m)',
    code: `bestPx = pos.dir === 1 ? c.high : c.low
curMfe = pos.dir * (bestPx - pos.entryPx) / pos.entryPx * 100
if (curMfe > pos.mfePct) {
  pos.mfePct = curMfe
  pos.mfePxPeak = bestPx
  pos.mfeAt1m = i
}`,
    expl: 'Tracks the best favourable move since entry. Used to arm + advance the dynamic trail.',
  },
  {
    n: 3, title: 'Stop loss check',
    code: `if (pos.dir === 1 AND c.low <= pos.slPx) OR
   (pos.dir === -1 AND c.high >= pos.slPx) {
  exit at pos.slPx + 2bps slippage, taker fee
}`,
    expl: 'Hard 4% SL, fires on touch. No filtering, no delay.',
  },
  {
    n: 4, title: 'Dynamic trail TP',
    code: `if (cfg.dynTrail AND pos.mfePct >= 1.5) {
  activeTier = findHighestTier(dynTiers, pos.mfePct)
  // Tiers: { mfe: 1.5, reprieve: 90, retraceFrac: 0.6 }
  //        { mfe: 3.0, reprieve: 120, retraceFrac: 0.5 }
  //        { mfe: 5.0, reprieve: 180, retraceFrac: 0.4 }
  //        { mfe: 8.0, reprieve: 240, retraceFrac: 0.3 }

  if (i - pos.mfeAt1m >= activeTier.reprieveMin) {
    lockedPct = pos.mfePct * (1 - activeTier.retraceFrac)
    retraceLevel = pos.entryPx * (1 + lockedPct/100)
    fixedFloor = pos.mfePxPeak * (1 - 1.0/100)
    triggerPx = max(retraceLevel, fixedFloor)
    pos.trailFloor = max(pos.trailFloor || 0, triggerPx)

    if (c.low <= pos.trailFloor) → exit at trailFloor
  }
}`,
    expl: 'Once MFE crosses 1.5%, find active tier. Wait reprieve minutes. Then trail with the LESS aggressive of: retrace fraction of MFE, or 1% from peak. Ratchets up only.',
  },
  {
    n: 5, title: 'EMA21 pyramid',
    code: `if (ENABLE_PYRAMID AND !pos.pyramidAdded AND idx4 > 0 AND !pos.armed) {
  ema21Val = ema21_4h[idx4 - 1]   // PRIOR bar (lookahead-safe)
  inProfit = (long: c.close > entryPx)
  touched = (c.low <= ema21Val AND c.high >= ema21Val)

  if (PYRAMID_MODE === 'PROFIT' AND inProfit AND touched) {
    pos.notionalUsd += pos.baseNotionalUsd * 0.50
    pos.pyramidAdded = true
  }
}`,
    expl: 'Add 50% notional when winning position retraces to prior 4H EMA21. Pyramid leg rides combined trail/SL. ~12-15% of trades pyramid; this subset has 68.6% WR / PF 3.63.',
  },
]

export function SatoshiStackerSpecPanel({ active: _active }: { active: boolean }) {
  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">STRATEGY SPEC · INTERNAL</div>
        <h1 className="bt-title">Satoshi Stacker — full <span className="bt-title-gold">breakdown.</span></h1>
        <p className="bt-blurb">v2 multi-strategy stack · 5 entry engines · dynamic trail TP · 5-asset basket · 2026-04-28</p>
      </div>

      <ToneCard tone="emerald">
        <ToneLabel tone="emerald">TL;DR — POST-AUDIT HONEST NUMBERS</ToneLabel>
        <p className="adm-p">
          Five independent entry engines feed a unified position-management layer. Donchian breakout (~95% of volume) plus quality-filtered MACD-cross, EMA21 pullback, bull-reversal candle, and bear-reversal candle. Shared exit: dynamic trailing TP with multi-tier reprieve, hard 4% SL, EMA21 pyramiding, and BB+RSI stretched-exit. Long and short symmetric. Tier-4 (Smart Sizing) DISABLED. Bold tier (1.5× equity per trade) is the dashboard default.
        </p>
        <p className="adm-p" style={{ marginTop: 10 }}>
          <strong>5-asset basket, Bold tier on $10k fixed-notional, 2020-09 → 2026-04 (5.4yr):</strong> 2,512 trades · <span className="pos-text" style={{ fontWeight: 600 }}>69.1% WR · PF 1.62 · +2,667% return ($10k → $276k) · 22.6% max DD</span>. Linear accumulation (no compounding).
        </p>
        <p className="adm-p" style={{ marginTop: 10 }}>
          <strong>BTC standalone, 2019-09 → 2026-04 (6.7yr):</strong> 559 trades · 69.1% WR · PF 1.66 · +786% return. Cross-validated: identical 68.0% WR on Binance and Bitget data over the same window.
        </p>
      </ToneCard>

      <ToneCard tone="amber">
        <ToneLabel tone="amber">LOOKAHEAD AUDIT HISTORY</ToneLabel>
        <ul className="adm-list">
          <li><strong>Bug #1 (April 27)</strong> — Inside the 1m simulation loop, indicators referenced via <Code>[idx4]</Code> (current 4H bar). At minute 1 of a 4H bar, that bar&apos;s close/RSI/BB don&apos;t exist yet. Fixed: use <Code>[idx4 − 1]</Code>. Caught by ChatGPT during V1 audit.</li>
          <li><strong>Bug #2 (April 28)</strong> — In the signal-generation loop, daily indicators referenced via <Code>[dIdx]</Code>. <Code>agg1D[dIdx].c</Code> = end-of-day close (future at 4H signal time). Fixed: use <Code>[dIdx − 1]</Code>. 16 sites fixed across all 5 entry engines + REV_LONG/REV_SHORT.</li>
          <li><strong>Verdict:</strong> Strategy file is now lookahead-clean across 4H signal generation, 1m position management, and pyramid/stretched-exit logic. Daily indicators always use prior-day completed values. Live and backtest evaluate the same numbers at any point in time.</li>
        </ul>
      </ToneCard>

      <ToneCard tone="rose">
        <ToneLabel tone="rose">WORST-MONTH RISK FOR NEW ENTRANTS</ToneLabel>
        <p className="adm-p">
          Headline 22.6% max DD measures peak-to-trough on a long-running account. Single-month drawdowns can be much deeper for users who join right before a bad month. <strong>Worst single month historically: November 2022 (FTX collapse), −60.4% of initial capital</strong>. A user depositing $10k on Nov 1 2022 would have lost $6,040 in that month alone.
        </p>
        <p className="adm-p" style={{ marginTop: 8 }}>
          Mitigations under consideration: (1) cold-start size ramp (half-size first 30 days), (2) volatility-regime filter to skip entries when 4H ATR/price &gt; 5%, (3) explicit disclosure in the wizard.
        </p>
      </ToneCard>

      <H2>Headline performance — POST DAILY-LOOKAHEAD FIX</H2>
      <p className="adm-p adm-p-muted">BTC standalone, dynamic trail, FIXED $40k notional, 6.7yr Bitget data. Numbers are AFTER the daily-lookahead bug fix; they reflect what production will actually deliver.</p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>Window</th><th style={{ textAlign: 'right' }}>Trades</th><th style={{ textAlign: 'right' }}>WR</th><th style={{ textAlign: 'right' }}>PF</th><th style={{ textAlign: 'right' }}>Return</th></tr></thead>
          <tbody>
            <tr><td style={{ fontWeight: 600 }}>BTC FULL 2019-2026 (6.7yr Bitget)</td><td className="num" style={{ textAlign: 'right' }}>559</td><td className="num pos-text" style={{ textAlign: 'right' }}>69.1%</td><td className="num" style={{ textAlign: 'right' }}>1.66</td><td className="num pos-text" style={{ textAlign: 'right' }}>+786%</td></tr>
            <tr><td>BTC 2017-2026 cross-check (Binance)</td><td className="num" style={{ textAlign: 'right' }}>660</td><td className="num pos-text" style={{ textAlign: 'right' }}>68.0%</td><td className="num" style={{ textAlign: 'right' }}>1.56</td><td className="num" style={{ textAlign: 'right' }}>+423%</td></tr>
            <tr><td style={{ color: 'var(--gold)', fontWeight: 600 }}>BASKET 2020-2026 (Bold tier, default)</td><td className="num" style={{ textAlign: 'right' }}>2,512</td><td className="num pos-text" style={{ textAlign: 'right' }}>69.1%</td><td className="num" style={{ textAlign: 'right' }}>1.62</td><td className="num pos-text" style={{ textAlign: 'right' }}>+2,667%</td></tr>
          </tbody>
        </table>
      </div>
      <p className="adm-stat-sub" style={{ marginTop: 8 }}><strong>Pre-audit numbers (now invalidated)</strong>: 73-74% WR, PF 1.96-2.18, +3,830-4,846% return. Inflated by daily-bar lookahead bias — do not use.</p>

      <H2>Multi-asset $10k unified portfolio (2022-2026)</H2>
      <p className="adm-p adm-p-muted">Single $10k account, all 5 assets share equity. Tier sets per-trade notional. Bitget 4× cross still applies in production.</p>
      <div className="card card-pad" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>Tier</th><th style={{ textAlign: 'right' }}>Per-trade $</th><th style={{ textAlign: 'right' }}>Final equity</th><th style={{ textAlign: 'right' }}>CAGR</th><th style={{ textAlign: 'right' }}>Max DD</th><th style={{ textAlign: 'right' }}>Max lev</th><th style={{ textAlign: 'right' }}>Liq</th></tr></thead>
          <tbody>
            <tr><td className="pos-text" style={{ fontWeight: 600 }}>Conservative</td><td className="num" style={{ textAlign: 'right' }}>$10,000</td><td className="num" style={{ textAlign: 'right' }}>$214,153</td><td className="num" style={{ textAlign: 'right' }}>110%</td><td className="num" style={{ textAlign: 'right' }}>20.1%</td><td className="num" style={{ textAlign: 'right' }}>4.65×</td><td className="num pos-text" style={{ textAlign: 'right' }}>0</td></tr>
            <tr><td style={{ color: 'var(--gold)', fontWeight: 600 }}>Bold</td><td className="num" style={{ textAlign: 'right' }}>$12,500</td><td className="num" style={{ textAlign: 'right' }}>$265,191</td><td className="num" style={{ textAlign: 'right' }}>121%</td><td className="num" style={{ textAlign: 'right' }}>24.6%</td><td className="num" style={{ textAlign: 'right' }}>5.71×</td><td className="num pos-text" style={{ textAlign: 'right' }}>0</td></tr>
            <tr><td className="neg-text" style={{ fontWeight: 600 }}>Aggressive</td><td className="num" style={{ textAlign: 'right' }}>$15,000</td><td className="num" style={{ textAlign: 'right' }}>$316,229</td><td className="num" style={{ textAlign: 'right' }}>131%</td><td className="num" style={{ textAlign: 'right' }}>28.9%</td><td className="num" style={{ textAlign: 'right' }}>6.74×</td><td className="num pos-text" style={{ textAlign: 'right' }}>0</td></tr>
          </tbody>
        </table>
      </div>
      <p className="adm-stat-sub" style={{ marginTop: 8 }}>1952 trades fired across 5 assets. Per-asset WR: BTC 73.2 / ETH 72.9 / SOL 75.4 / BNB 71.6 / XRP 74.7 = <strong style={{ color: 'var(--text)' }}>73.7% basket-wide.</strong></p>

      <H2>The five entry engines</H2>
      <div className="bt-twin-row">
        {SS_ENGINES.map(e => (
          <ToneCard key={e.name} tone={e.tone}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div className="adm-edge-name" style={{ color: toneStyle(e.tone).solid }}>{e.name}</div>
            </div>
            <div className="adm-stat-sub" style={{ marginBottom: 10 }}>{e.direction} · {e.volume} · {e.wr}</div>
            <p className="adm-p adm-p-sm"><strong>Trigger: </strong>{e.setup}</p>
            <div className="adm-stat-label" style={{ marginTop: 10, marginBottom: 4 }}>Quality filters</div>
            <ul className="adm-list adm-list-sm">{e.filters.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </ToneCard>
        ))}
      </div>

      <H2>Position management (shared by all 5 engines)</H2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SS_MGMT.map(m => (
          <div key={m.name} className="card card-pad">
            <div className="adm-edge-name" style={{ marginBottom: 4 }}>{m.name}</div>
            <p className="adm-p adm-p-sm" style={{ color: 'var(--muted)' }}>{m.text}</p>
          </div>
        ))}
      </div>

      <H2>Concurrency — how often multiple positions are open</H2>
      <p className="adm-p adm-p-muted">Measured from 1,952 trades across 5 assets over 4 years. Most of the time the user is in cash or holding 1 position; multi-lane peaks are rare.</p>
      <div className="card card-pad">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
          {[
            { lanes: 0, pct: 44.2, color: 'rgba(255,255,255,0.3)' },
            { lanes: 1, pct: 30.1, color: 'rgba(var(--pos-rgb),0.6)' },
            { lanes: 2, pct: 16.7, color: 'rgba(var(--pos-rgb),0.7)' },
            { lanes: 3, pct: 6.2, color: 'rgba(212,160,23,0.7)' },
            { lanes: 4, pct: 2.3, color: 'rgba(212,160,23,0.8)' },
            { lanes: 5, pct: 0.5, color: 'rgba(var(--neg-rgb),0.8)' },
          ].map(r => (
            <div key={r.lanes} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 80, fontSize: 12, color: 'var(--muted)' }}>{r.lanes} open</div>
              <div style={{ flex: 1, height: 22, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${r.pct * 2}%`, background: r.color }} />
              </div>
              <div className="num" style={{ width: 56, textAlign: 'right', fontSize: 12 }}>{r.pct}%</div>
            </div>
          ))}
        </div>
      </div>

      <H2>Liquidation analysis</H2>
      <ToneCard tone="emerald">
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--pos)', marginBottom: 6 }}>0 liquidations</div>
        <div className="adm-p adm-p-muted" style={{ marginBottom: 10 }}>across 1,952 trades, 4+ years, all 3 tiers, even WITHOUT a leverage cap</div>
        <ul className="adm-list adm-list-sm">
          <li>Hard SL fires at -4% per trade. Liquidation at 4× lev requires -25% adverse — <strong>6× safety distance</strong>.</li>
          <li>Worst-case &quot;all 5 hit SL simultaneously&quot; = -16% to -24% of equity (depending on tier). Painful but survivable.</li>
          <li>Multi-lane peak (5 simultaneous) coincided with strong strategy regimes (March 2022 short-side rally), not adverse moves.</li>
          <li>Real risk = slippage past SL during flash crashes (5-10% gaps on alts). Not modeled in backtest beyond 2 bps.</li>
        </ul>
      </ToneCard>

      <H2>Deep logic audit — every if-then in the strategy</H2>
      <p className="adm-p adm-p-muted">Two timeframes operate simultaneously: <strong style={{ color: 'var(--gold)' }}>4H bars (signal generation)</strong> and <strong style={{ color: 'var(--gold)' }}>1m bars (position management)</strong>. The strategy walks every 1m candle but only generates entry signals at 4H boundaries.</p>

      <H3>Signal generation flow (runs at every 4H bar close)</H3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SS_LOGIC_BLOCKS_SIGNAL.map(b => <LogicBlock key={b.n} {...b} />)}
      </div>

      <H3>Position management flow (runs at every 1m bar)</H3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SS_LOGIC_BLOCKS_POS.map(b => <LogicBlock key={b.n} {...b} />)}
      </div>

      <H3>Things NOT modeled in backtest</H3>
      <ToneCard tone="amber">
        <ul className="adm-list adm-list-sm">
          <li><strong>Funding fees on perpetual futures.</strong> Bitget charges every 8h. ~0.01% per cycle on BTC, higher on alts. Cumulative cost: ~$300/month on $10k Conservative. Real haircut: −3% on monthly profit.</li>
          <li><strong>Realistic slippage on fast moves.</strong> Backtest models 2 bps. Real flash-move slippage can be 5-20 bps. Real haircut: −3-5% on monthly profit.</li>
          <li><strong>Position-size limits at scale.</strong> Bitget order-size caps. The strategy hits liquidity walls past ~$5-10M notional on alts.</li>
          <li><strong>Black-swan flash crashes.</strong> 20%+ gap that exceeds SL would fill 5-10% past the trigger.</li>
          <li><strong>Combined real-world haircut: ~10-15% off backtested monthly profit.</strong></li>
        </ul>
      </ToneCard>

      <H2>How we got here</H2>
      <div className="card card-pad">
        <div className="adm-phase-list">
          {[
            ['Phase 0 — lookahead bug fix', 'Discovered backtest used `idx4` (current 4H bar) for indicator values inside the 1m loop. WR collapsed from 68% to 50.7% post-fix.'],
            ['Phase 1 — static trail TP', 'Added 1.5%/0.5% trailing stop. WR climbed back to 73% via small-win conversion. PF 1.47.'],
            ['Phase 2 — quality-filtered MACD', '6 quality gates (vol, daily-MACD align, hist trending, max-distance, close-in-range, daily-prime). Standalone WR 81%, PF 4.53.'],
            ['Phase 3 — quality-filtered Pullback', 'Strict trend stack on 4H+daily, ADX>25, prior-bar-turning, swing-low SL. Standalone WR 78.6%, PF 1.70.'],
            ['Phase 4 — REV_LONG mirror of REV_SHORT', 'Bullish reversal candle entries at daily 50EMA in uptrends. Symmetric to REV_SHORT.'],
            ['Phase 5 — Dynamic trail TP', 'Multi-tier reprieve (90/120/180/240 min) + MFE-band tightening + hybrid 1% fixed-drop floor. PF jumped 1.33 → 1.96.'],
            ['Phase 6 — Multi-asset basket', 'Same stack on ETH/SOL/BNB/XRP. WR holds 71-78% per asset. 1,952 total trades.'],
            ['Phase 7 — Walk-forward + unified portfolio sims', 'Confirmed edge holds out-of-sample. Zero liquidations.'],
          ].map(([title, desc]) => (
            <div key={title} className="adm-phase-row">
              <div style={{ color: 'var(--gold)', fontWeight: 600, fontSize: 12 }}>{title}</div>
              <div className="adm-p adm-p-sm" style={{ color: 'var(--muted)' }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <footer className="adm-footer">
        Production code: <Code>/root/.openclaw/workspace/hive-arena/strategies/beat-bh/backtest-honeybadger.js</Code>
      </footer>
    </div>
  )
}

function LogicBlock({ n, title, code, expl }: { n: number; title: string; code: string; expl: string }) {
  return (
    <div className="card adm-logic">
      <div className="adm-logic-head">
        <div className="adm-logic-num">{n}</div>
        <div className="adm-logic-title">{title}</div>
      </div>
      <pre className="adm-logic-code">{code}</pre>
      <div className="adm-logic-expl">{expl}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Signal Comparison — 3-way trade history (dynamic)
// ════════════════════════════════════════════════════════════════════════════

type Trade = {
  id?: string
  tradeNum?: number
  dir: 'long' | 'short'
  entryTs: number
  entryDate: string
  entryPrice: number | null
  exitTs: number | null
  exitDate: string | null
  exitPrice: number | null
  exitReason: string | null
  pnlUsd: number | null
  pnlPct: number | null
  notional: number
  status?: 'open' | 'closed'
  isMarker?: boolean
  markerType?: 'NOT_FIRED' | 'NOT_FILLED' | 'CANCELLED'
}

type Metrics = {
  trades: number; markers?: number
  totalPnl: number; totalPct: number
  winRate: number; profitFactor: number
  avgWin: number; avgLoss: number
  avgWinPct: number; avgLossPct: number
}

type Column = { label: string; description: string; trades: Trade[]; metrics: Metrics }

type SignalCmpResp = {
  cutoverReference: string
  alignmentStats?: { totalSignals: number; executedAllPaths: number; executionGaps: number }
  columns: { binanceEngine: Column; bitgetEngine: Column; bitgetLive: Column }
}

export function SignalComparisonPanel({ active }: { active: boolean }) {
  const [data, setData] = useState<SignalCmpResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const json = await authedFetch<SignalCmpResp>('/api/admin/signal-comparison')
      setData(json)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setErr(null)
      try {
        const json = await authedFetch<SignalCmpResp>('/api/admin/signal-comparison')
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    const id = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [active, load])

  return (
    <div className="adm-doc">
      <div className="bt-header" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="bt-eyebrow">SIGNAL COMPARISON · 3-WAY</div>
          <h1 className="bt-title">Engine vs <span className="bt-title-gold">live.</span></h1>
          <p className="bt-blurb">
            Binance engine (historical reference) · Bitget engine (what live should match) · Bitget live (what actually hit accounts).
            Auto-refreshes every 60s.
          </p>
          {data && (
            <p className="adm-stat-sub" style={{ marginTop: 6 }}>
              Showing trades since {new Date(data.cutoverReference).toUTCString()}
              {data.alignmentStats && (
                <> · <strong style={{ color: 'var(--text)' }}>{data.alignmentStats.totalSignals}</strong> signals across all 3 columns · <span className="pos-text">{data.alignmentStats.executedAllPaths} clean</span>
                  {data.alignmentStats.executionGaps > 0 && <span style={{ color: 'var(--gold)' }}> · {data.alignmentStats.executionGaps} execution gap{data.alignmentStats.executionGaps === 1 ? '' : 's'}</span>}
                </>
              )}
            </p>
          )}
        </div>
        <button type="button" className="adm-icon-btn" disabled={loading} onClick={load} title="Refresh">↻</button>
      </div>

      {err && <div className="adm-error">{err}</div>}

      {data && (
        <>
          <div className="card card-pad">
            <div className="adm-stat-label" style={{ marginBottom: 8 }}>Realized PnL — $ and % on $20k paper capital</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
              <SignalCmpPill label="Binance engine" value={data.columns.binanceEngine.metrics.totalPnl} pct={data.columns.binanceEngine.metrics.totalPct} tone="amber" />
              <SignalCmpPill label="Bitget engine" value={data.columns.bitgetEngine.metrics.totalPnl} pct={data.columns.bitgetEngine.metrics.totalPct} tone="cyan" />
              <SignalCmpPill label="Bitget live" value={data.columns.bitgetLive.metrics.totalPnl} pct={data.columns.bitgetLive.metrics.totalPct} tone="emerald" bold />
              <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div>
                  Live vs Bitget engine (drift):{' '}
                  <span className={pnlClass(data.columns.bitgetLive.metrics.totalPnl - data.columns.bitgetEngine.metrics.totalPnl)}>
                    {fmtUsd(data.columns.bitgetLive.metrics.totalPnl - data.columns.bitgetEngine.metrics.totalPnl, true)} ({fmtPct(data.columns.bitgetLive.metrics.totalPct - data.columns.bitgetEngine.metrics.totalPct)})
                  </span>
                </div>
                <div>
                  Bitget engine vs Binance engine (basis):{' '}
                  <span className={pnlClass(data.columns.bitgetEngine.metrics.totalPnl - data.columns.binanceEngine.metrics.totalPnl)}>
                    {fmtUsd(data.columns.bitgetEngine.metrics.totalPnl - data.columns.binanceEngine.metrics.totalPnl, true)} ({fmtPct(data.columns.bitgetEngine.metrics.totalPct - data.columns.binanceEngine.metrics.totalPct)})
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="adm-cmp-grid">
            <SignalCmpColumn col={data.columns.binanceEngine} tone="amber" />
            <SignalCmpColumn col={data.columns.bitgetEngine} tone="cyan" />
            <SignalCmpColumn col={data.columns.bitgetLive} tone="emerald" />
          </div>
        </>
      )}
    </div>
  )
}

function SignalCmpPill({ label, value, pct, bold, tone }: { label: string; value: number; pct?: number; bold?: boolean; tone: Tone }) {
  const t = toneStyle(tone)
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.solid, opacity: 0.85 }}>{label}</span>
      <span className={'num ' + pnlClass(value)} style={{ fontSize: bold ? 22 : 18, fontWeight: bold ? 700 : 600 }}>
        {fmtUsd(value, true)}
        {pct != null && <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 4 }}>({fmtPct(pct)})</span>}
      </span>
    </div>
  )
}

function SignalCmpColumn({ col, tone }: { col: Column; tone: Tone }) {
  const t = toneStyle(tone)
  return (
    <div className="card card-pad" style={{ borderColor: `rgba(${t.rgb}, 0.4)`, background: `rgba(${t.rgb}, 0.06)` }}>
      <div className="bt-eyebrow" style={{ color: t.solid, marginBottom: 4 }}>{col.label}</div>
      <div className="adm-stat-sub" style={{ marginBottom: 12 }}>{col.description}</div>

      <div className="adm-cmp-stats">
        <div>
          <div className="adm-stat-label">Realized PnL</div>
          <div className={'num ' + pnlClass(col.metrics.totalPnl)} style={{ fontSize: 18, fontWeight: 700 }}>{fmtUsd(col.metrics.totalPnl, true)} <span style={{ fontSize: 13 }}>({fmtPct(col.metrics.totalPct)})</span></div>
        </div>
        <div>
          <div className="adm-stat-label">Trades / WR</div>
          <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>{col.metrics.trades} <span style={{ color: 'var(--muted)' }}>/ {col.metrics.winRate.toFixed(1)}%</span></div>
        </div>
        <div>
          <div className="adm-stat-label">Profit Factor</div>
          <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>{col.metrics.profitFactor.toFixed(2)}</div>
        </div>
        <div>
          <div className="adm-stat-label">Avg W / L</div>
          <div style={{ fontSize: 12 }}>
            <span className="num pos-text">{fmtUsd(col.metrics.avgWin, true)} (+{col.metrics.avgWinPct.toFixed(2)}%)</span>{' '}
            /{' '}
            <span className="num neg-text">−${col.metrics.avgLoss.toFixed(0)} (−{col.metrics.avgLossPct.toFixed(2)}%)</span>
          </div>
        </div>
      </div>

      <div className="adm-cmp-history">
        <div className="adm-stat-label" style={{ marginBottom: 8 }}>Trade history</div>
        {col.trades.length === 0 ? (
          <div className="adm-empty">No trades yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col.trades.slice().reverse().map((tr, idx) =>
              tr.isMarker
                ? <SignalCmpMarker key={idx} t={tr} />
                : <SignalCmpTrade key={tr.id ?? tr.tradeNum ?? idx} t={tr} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SignalCmpTrade({ t }: { t: Trade }) {
  return (
    <div className="adm-cmp-row">
      <div className="adm-cmp-row-head">
        <span className={'badge ' + (t.dir === 'long' ? 'badge-long' : 'badge-short')}>{t.dir.toUpperCase()}</span>
        <span className="adm-mono-sm" style={{ color: 'var(--muted)' }}>{fmtDate(t.entryDate)}</span>
      </div>
      <div className="adm-cmp-row-grid">
        <span className="adm-muted">Entry</span><span className="num" style={{ textAlign: 'right' }}>{fmtPrice(t.entryPrice)}</span>
        <span className="adm-muted">Exit</span><span className="num" style={{ textAlign: 'right' }}>{fmtPrice(t.exitPrice)}</span>
        <span className="adm-muted">Status</span><span style={{ textAlign: 'right' }}>{t.status === 'open' ? <span style={{ color: 'var(--gold)' }}>Open</span> : (t.exitReason || 'closed')}</span>
        <span className="adm-muted">PnL</span><span className={'num ' + pnlClass(t.pnlUsd)} style={{ textAlign: 'right', fontWeight: 600 }}>{fmtUsd(t.pnlUsd, true)} <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>({fmtPct(t.pnlPct)})</span></span>
      </div>
    </div>
  )
}

function SignalCmpMarker({ t }: { t: Trade }) {
  const map = {
    NOT_FIRED:  { tone: 'rose'  as const, label: 'NOT FIRED',  note: 'signal emitted elsewhere but never reached this path' },
    NOT_FILLED: { tone: 'amber' as const, label: 'NOT FILLED', note: 'order placed but limit never filled' },
    CANCELLED:  { tone: 'rose'  as const, label: 'CANCELLED',  note: 'limit expired / user cancelled — no fill' },
  }
  const cfg = map[t.markerType ?? 'NOT_FIRED']
  return (
    <div className="adm-cmp-row" style={{ borderStyle: 'dashed' }}>
      <div className="adm-cmp-row-head">
        <span style={{ fontWeight: 600, color: t.dir === 'long' ? 'var(--pos)' : 'var(--neg)', opacity: 0.7 }}>{t.dir.toUpperCase()}</span>
        <span className="adm-mono-sm" style={{ color: 'var(--muted)' }}>{fmtDate(t.entryDate)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <ToneBadge tone={cfg.tone}>{cfg.label}</ToneBadge>
        <span className="adm-stat-sub" style={{ fontSize: 10 }}>{cfg.note}</span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Execution Architecture — pipeline diagram (native render)
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
    desc: <>Per-asset PM2 processes (<Code>live-engine-v1-{'{btc,eth,sol,xrp,sui}'}</Code>) poll Bitget REST every 10s. On each new 4H bar they evaluate the V1 entry/exit logic (VolumeProfile breakout + per-asset BB-width gate) and emit signals to the queue protocol.</>,
    tags: ['poll: 10s', 'entries at 4H bar close', 'exits anytime', 'lookahead-safe'],
  },
  {
    num: 2, name: 'Signal queue', badge: 'PROTOCOL', tone: 'amber',
    desc: <>JSON files at <Code>the-hive/signal-confirmed-bitget-{'{asset}'}.json</Code>. Engines append, executors consume via per-asset cursor at <Code>signal-consumed-bitget-{'{asset}'}.json</Code>. Append-only, idempotent.</>,
    tags: ['append-only', 'per-asset', 'idempotent'],
  },
  {
    num: 3, name: 'Risk guardian', badge: 'GATE', tone: 'cyan',
    desc: <>Pre-execution validator. Verifies expected vs actual notional, per-tier leverage, SL proximity to liquidation, and Bitget pre-flight (sufficient margin, valid symbol, position-size cap). Fails OPEN on transient errors so legit signals don&apos;t get blocked.</>,
    tags: ['margin headroom 90%', 'fail-OPEN', 'TIER_LEVERAGE clamp'],
    side: {
      title: 'Why fail-OPEN', tone: 'cyan',
      desc: 'A failed pre-flight that fails CLOSED would block real entries during transient Bitget outages. The strategy ALREADY waits for the next 4H boundary if an entry doesn\'t fill — closing it on a transient error means missing the trade entirely.',
      examples: [
        { text: 'Pre-flight ok → execute', tone: 'pos' },
        { text: 'Bitget 5xx → execute (fail-OPEN)', tone: 'muted' },
        { text: 'Margin headroom < 10% → reject', tone: 'neg' },
      ],
    },
  },
  {
    num: 4, name: 'Executor', badge: 'EXECUTION', tone: 'violet',
    desc: <>Reads consumed signals, looks up the user&apos;s API keys + bot config, computes notional from <Code>TIER_LEVERAGE × balance</Code>, recomputes SL server-side from fillPx (× 0.96 long / × 1.04 short), and routes the order via the exchange adapter. Writes audit row to Supabase <Code>trades</Code> table.</>,
    tags: ['per-user routing', 'server-side SL recalc', 'leverage clamped'],
  },
  {
    num: 5, name: 'Bitget exchange', badge: 'FUTURES', tone: 'emerald',
    desc: <>USDT-M perpetual futures. Limit orders placed 0.3% better than market with 60-min TTL; market fallback at the open of bar 61 with 2 bps slippage. Maker fee 0.02% / taker 0.05%. Cross-margin 4× by default.</>,
    tags: ['USDT-FUTURES', 'limit-then-market', '60min TTL'],
  },
  {
    num: 6, name: 'Reconciliation', badge: 'AUDIT', tone: 'gray' as any,
    desc: <>Background process compares Supabase <Code>trades</Code> rows to Bitget reality every 2 minutes. Flags ghost positions, DB-stale closures, fill-price drift. Edge-triggered Telegram alerts on healthy↔stale transitions. Audit log at <Code>/tmp/reconciliation-status.json</Code>.</>,
    tags: ['poll: 2min', 'ghost detection', 'DB ↔ exchange truth'],
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
                    background: `rgba(${toneStyle(s.tone === 'gray' as any ? 'amber' : s.tone).rgb}, 0.12)`,
                    color: toneStyle(s.tone === 'gray' as any ? 'amber' : s.tone).solid,
                  }}>{s.num}</div>
                  <div className="adm-arch-name">{s.name}</div>
                  <ToneBadge tone={s.tone === 'gray' as any ? 'amber' : s.tone}>{s.badge}</ToneBadge>
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
