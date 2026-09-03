'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

/* ═══════════════════════════════════════════════════════
   STRATEGY SIMULATOR — Interactive Terminal Experience
   ═══════════════════════════════════════════════════════ */

interface Trade {
  dir: number; entryTs: number; exitTs: number; entryPx: number; exitPx: number
  pnl: number; notional: number; returnPct: number; reason: string
  displayReason: string; pyramided?: boolean; mfePct?: number; type?: string
}

interface SimTrade {
  ts: number; entryTs: number; pnl: number; side: string; returnPct: number
  entryPx: number; exitPx: number; reason: string; equity: number
}

interface SimResult {
  initialCapital: number
  tier: string
  hbRatio: number
  mrsRatio: number
  peakLev: number
  finalCapital: number; totalReturn: number
  totalTrades: number; winners: number; losers: number; winRate: number
  maxDrawdown: number; profitFactor: number; avgWin: number; avgLoss: number
  expectancy: number; bestTrade: number; worstTrade: number
  equityCurve: { ts: number; equity: number }[]; trades: SimTrade[]
}

interface TierRuntime {
  label: string
  hbRatio: number
  mrsRatio: number
  peakLev: number
  hbNotional: number
  mrsNotional: number
}

// ─── Tier definitions (Phase H Super Stack — basket size read from the served feed) ───
// Each tier has its own published trade feed under /data/strategies/phase-h-risk/tiers/<key>/.
// Each feed assumes a $10k starting balance + the tier's lanes/leverage (Conservative
// 3 lanes/1× / Moderate 5 lanes/3× / Aggressive 7 lanes/6× Bitget cross-margin), risk-sized.
// Lane totals include the reserved Tier-S seat added at the 2026-09-02 re-lock.
// PnL scaling: userPnl = publishedPnl × (userCapital / 10000). Same scale across tiers.
type TierKey = 'conservative' | 'moderate' | 'aggressive' | 'kamikaze'
// 2026-09-02 RE-LOCK: every tier now runs a SUPER LANE — n ordinary lanes plus one seat held in
// reserve for a Tier-S signal, which is never evicted. So the totals moved 2->3, 4->5, 6->7, 7->8.
// `lanes` is the total the customer actually gets; `ordinary` is what competes normally.
const TIERS: Record<TierKey, { label: string; lanes: number; ordinary: number; peakLev: number; refStartCapital: number }> = {
  conservative: { label: 'Conservative', lanes: 3, ordinary: 2, peakLev: 1.0, refStartCapital: 10000 },
  moderate:     { label: 'Moderate',     lanes: 5, ordinary: 4, peakLev: 3.0, refStartCapital: 10000 },
  aggressive:   { label: 'Aggressive',   lanes: 7, ordinary: 6, peakLev: 6.0, refStartCapital: 10000 },
  // 2026-09-03 (EG, Chris rules): 9x, not 8.75x. These are two different quantities and the
  // simulator was showing the wrong one. 8.75x is the NOMINAL EXPOSURE (7 ordinary lanes x 125%
  // per lane); 9x is the tier's leverage, which is what the engine sets and what the wizard,
  // settings and TIER_LEVERAGE_V4 all display. For the other three tiers the two happen to be
  // identical (2x50%=1, 4x75%=3, 6x100%=6), which is why only kamikaze ever disagreed with
  // itself — and why a customer picking the riskiest tier was shown two different risk numbers.
  kamikaze:     { label: 'Kamikaze',     lanes: 8, ordinary: 7, peakLev: 9.0, refStartCapital: 10000 },  // 2026-07-04 disclosed-tail tier
}

// ─── Translations ───
const T = {
  en: {
    init: 'Initializing SwingMate Super Stack Simulator...',
    loaded: (n: number, a: number) => `Loaded ${n.toLocaleString()} historical trades · ${a}-asset Phase H super stack · Bitget funding-corrected`,
    noCompound: 'Each tier = max concurrent positions × Bitget cross-margin (1×/3×/6×/9×). One of those positions is a seat held in reserve for a top-ranked signal and is never evicted. You choose fixed or compounding position sizing below — compounding scales sub-linearly with your balance (k=0.75), capped at 2× your deposit per lane. Refreshes live every minute.',
    langQ: '> Choose your language:',
    themeQ: '> Select your preferred theme:',
    dark: 'Dark', light: 'Light',
    capitalQ: '> How much capital are you putting to work?',
    capitalCustom: 'custom $...',
    capitalSel: (v: string) => `▸ ${v} selected`,
    tierQ: '> Choose your trading tier:',
    tierLabels: {
      conservative: 'Conservative · 3 lanes (2 + 1 reserved) / 1× lev · safest',
      moderate:     'Moderate · 5 lanes (4 + 1 reserved) / 3× lev · balanced (recommended)',
      aggressive:   'Aggressive · 7 lanes (6 + 1 reserved) / 6× lev · max signal capture',
      kamikaze:     'Kamikaze · 8 lanes (7 + 1 reserved) / 9× lev · DISCLOSED TAIL RISK — a beyond-record ≥2× gap event is fatal at any account size; ~61-68% drawdown weeks occur on volatility events',
    } as Record<TierKey, string>,
    tierSel: (label: string, perLane: string, lanes: string) => `▸ ${label} — up to ${lanes} concurrent positions on ${perLane}`,
    sizingQ: '> Fixed or compounding position size?',
    sizingFixed: 'Fixed', sizingCompound: 'Compound',
    sizingFixedSub: 'each position stays at your deposit size',
    sizingCompoundSub: 'positions grow with your balance · capped at 2× your deposit',
    sizingSel: (m: string) => `▸ ${m} position sizing selected`,
    periodQ: '> How far back should we simulate?',
    periods: ['6 Months', '1 Year', '2 Years', '5 Years', 'All Time'],
    running: '▸ Running backtest...',
    executing: 'executing...',
    complete: (n: number) => `─── ${n} trades executed. Simulation complete. ───`,
    heroLabel: (v: string) => `YOUR ${v} WOULD NOW BE WORTH`,
    returnLabel: 'return on initial capital',
    tradesOver: (n: number, p: string) => `${n} trades over ${p}`,
    winRate: 'Win Rate', profitFactor: 'Profit Factor', maxDD: 'Max Drawdown',
    expectancy: 'Expectancy', avgWin: 'Avg Win', avgLoss: 'Avg Loss',
    bestTrade: 'Best Trade', wl: 'Winners / Losers', equityCurve: 'Equity Curve',
    disclaimer: 'Past performance is not indicative of future results. This is a simulation using historical signal data.',
    cta: 'Start Trading with SwingMate Super Stack', again: 'Run Again',
    periodText: (m: number, yrs?: number | null) => m === 0 ? (yrs ? `${yrs.toFixed(1)} years` : 'the full record') : m >= 24 ? Math.floor(m/12) + ' years' : m === 12 ? '1 year' : m + ' months',
  },
  pt: {
    init: 'Inicializando Simulador SwingMate Super Stack...',
    loaded: (n: number, a: number) => `${n.toLocaleString()} trades históricos carregados · super stack Fase H de ${a} ativos · corrigido por funding Bitget`,
    noCompound: 'Cada tier = posições simultâneas × alavancagem Bitget (1×/3×/6×/9×). Você escolhe tamanho de posição fixo ou composto abaixo — composto escala de forma sublinear com seu saldo (k=0.75), limitado a 2× seu depósito por lane. Atualizado ao vivo a cada minuto.',
    langQ: '> Escolha seu idioma:',
    themeQ: '> Selecione seu tema preferido:',
    dark: 'Escuro', light: 'Claro',
    capitalQ: '> Quanto capital você quer colocar para trabalhar?',
    capitalCustom: 'valor personalizado...',
    capitalSel: (v: string) => `▸ ${v} selecionado`,
    tierQ: '> Escolha seu tier de operação:',
    tierLabels: {
      conservative: 'Conservador · 3 lanes (2 + 1 reservada) / 1× lev · mais seguro',
      moderate:     'Moderado · 5 lanes (4 + 1 reservada) / 3× lev · equilibrado (recomendado)',
      aggressive:   'Agressivo · 7 lanes (6 + 1 reservada) / 6× lev · captura máxima de sinais',
      kamikaze:     'Kamikaze · 8 lanes (7 + 1 reservada) / 9× lev · RISCO DE CAUDA DIVULGADO — um evento de gap ≥2× além do histórico é fatal em qualquer tamanho de conta; semanas de drawdown de ~61-68% ocorrem em eventos de volatilidade',
    } as Record<TierKey, string>,
    tierSel: (label: string, perLane: string, lanes: string) => `▸ ${label} — até ${lanes} posições simultâneas em ${perLane}`,
    sizingQ: '> Tamanho de posição fixo ou composto?',
    sizingFixed: 'Fixo', sizingCompound: 'Composto',
    sizingFixedSub: 'cada posição mantém o tamanho do seu depósito',
    sizingCompoundSub: 'posições crescem com seu saldo · limitado a 2× seu depósito',
    sizingSel: (m: string) => `▸ tamanho de posição ${m} selecionado`,
    periodQ: '> Qual período simular?',
    periods: ['6 Meses', '1 Ano', '2 Anos', '5 Anos', 'Todo Período'],
    running: '▸ Executando backtest...',
    executing: 'executando...',
    complete: (n: number) => `─── ${n} trades executados. Simulação completa. ───`,
    heroLabel: (v: string) => `SEUS ${v} AGORA VALERIAM`,
    returnLabel: 'retorno sobre capital inicial',
    tradesOver: (n: number, p: string) => `${n} trades em ${p}`,
    winRate: 'Taxa de Acerto', profitFactor: 'Fator de Lucro', maxDD: 'Drawdown Máx',
    expectancy: 'Expectativa', avgWin: 'Média Ganho', avgLoss: 'Média Perda',
    bestTrade: 'Melhor Trade', wl: 'Ganhos / Perdas', equityCurve: 'Curva de Capital',
    disclaimer: 'Rentabilidade passada não garante resultados futuros. Esta é uma simulação usando dados históricos de sinais.',
    cta: 'Comece a Operar com SwingMate Super Stack', again: 'Simular Novamente',
    periodText: (m: number, yrs?: number | null) => m === 0 ? (yrs ? `${yrs.toFixed(1)} anos` : 'o histórico completo') : m >= 24 ? Math.floor(m/12) + ' anos' : m === 12 ? '1 ano' : m + ' meses',
  },
}
type Lang = keyof typeof T

// ─── Engine ───
// Simulate the user's account through historical trades with SMART SIZING (the
// live engine's per-lane model). Each leg's pnl is rescaled from the backtest's
// per-lane notional to the user's DYNAMIC notional:
//   notional = min( capital × (currentEquity/capital)^0.75 , 2 × capital )
//   userPnl  = trade.pnl × (notional / backtestBase)
// keyed to the user's CHOSEN capital, capped at 2× that capital per lane
// (conservative; scales with the user's value, not the live absolute $25k),
// compounded forward as each trade realizes. Pyramid scaling is automatic —
// trade.pnl already encodes pyramid size, so the notional ratio applies cleanly.
function simulate(
  allTrades: Trade[],
  capital: number,
  tier: TierRuntime,
  startDate: Date,
  endDate: Date,
  baseHbNotional: number = 20000,
  baseMrsNotional: number = 20000,
  sizingMode: 'fixed' | 'compound' = 'compound',
): SimResult {
  const trades = allTrades.filter(t => t.entryTs >= startDate.getTime() && t.exitTs <= endDate.getTime())
    .sort((a, b) => a.exitTs - b.exitTs)   // realization order — REQUIRED for forward-compounding
  // SMART SIZING (Option C, 2026-06-01): per-lane notional scales SUB-LINEARLY
  // with the account's CURRENT equity, keyed to the user's CHOSEN capital, and
  // CAPPED at 2× that capital per lane (conservative). Mirrors the live engine's
  // tier_s.per_lane_notional SHAPE (sub-linear k=0.75 + a per-lane cap), but the
  // cap scales with the user's value (2× capital) rather than the live absolute
  // $25k — so the % return is identical at any capital and never runs to fantasy:
  //     notional = min( capital × (equity/capital)^0.75 , 2 × capital )
  // equity < capital → de-risks; > capital → grows sub-linearly up to the 2× cap.
  // Compounds forward as each trade realizes. Replaces the old flat/linear model.
  const SMART_K = 0.75, CAP_MULT = 2.0
  let equity = capital, peak = capital, maxDD = 0, gW = 0, gL = 0, wC = 0, lC = 0, best = -Infinity, worst = Infinity
  const curve: { ts: number; equity: number }[] = [{ ts: startDate.getTime(), equity: capital }]
  const simTrades: SimTrade[] = []

  for (const t of trades) {
    const isMrs = (t as Trade & { type?: string }).type === 'mrs'
    const backtestBase = isMrs ? baseMrsNotional : baseHbNotional
    // Position sizing per the user's chosen mode (Fixed vs Compound step):
    //  • fixed    → every position stays at the user's deposit-size notional.
    //  • compound → scales sub-linearly with current equity (the live bot's
    //               k=0.75 shape, NOT linear — matches the real engine so the
    //               projection never overstates), capped at CAP_MULT× the
    //               user's deposit per lane.
    const notional = sizingMode === 'fixed'
      ? capital
      : Math.min(capital * Math.pow(Math.max(equity, 0.01) / capital, SMART_K), CAP_MULT * capital)
    const pnl = (t.pnl || 0) * (notional / backtestBase)
    const move = t.dir === 1 ? ((t.exitPx - t.entryPx) / t.entryPx) * 100 : ((t.entryPx - t.exitPx) / t.entryPx) * 100
    equity += pnl
    if (equity > peak) peak = equity
    const dd = ((peak - equity) / peak) * 100
    if (dd > maxDD) maxDD = dd
    if (pnl > 0) { wC++; gW += pnl; if (pnl > best) best = pnl }
    else { lC++; gL += Math.abs(pnl); if (pnl < worst) worst = pnl }
    curve.push({ ts: t.exitTs, equity })
    simTrades.push({ ts: t.exitTs, entryTs: t.entryTs, pnl, side: t.dir === 1 ? 'LONG' : 'SHORT', returnPct: move, entryPx: t.entryPx, exitPx: t.exitPx, reason: t.displayReason || t.reason, equity })
  }

  const n = trades.length, aW = wC > 0 ? gW / wC : 0, aL = lC > 0 ? gL / lC : 0
  const pf = gL > 0 ? gW / gL : gW > 0 ? Infinity : 0
  return {
    initialCapital: capital,
    tier: '',
    hbRatio: tier.hbRatio,
    mrsRatio: tier.mrsRatio,
    peakLev: 0,
    finalCapital: equity,
    totalReturn: ((equity - capital) / capital) * 100,
    totalTrades: n, winners: wC, losers: lC, winRate: n > 0 ? (wC / n) * 100 : 0, maxDrawdown: maxDD,
    profitFactor: isFinite(pf) ? pf : 0, avgWin: aW, avgLoss: aL, expectancy: n > 0 ? (equity - capital) / n : 0,
    bestTrade: best === -Infinity ? 0 : best, worstTrade: worst === Infinity ? 0 : worst, equityCurve: curve, trades: simTrades,
  }
}

// ─── Character A: Round blob creature (inspired by cute round mascot) ───
function BlobStacker({ size = 80, dark = true }: { size?: number; dark?: boolean }) {
  const [bob, setBob] = useState(false)
  useEffect(() => {
    const iv = setInterval(() => setBob(b => !b), 800)
    return () => clearInterval(iv)
  }, [])

  const g1 = '#D4A017'
  const g2 = '#8B6914'
  const g3 = '#FFD700'

  return (
    <div style={{ width: size, height: size + 20, position: 'relative', transition: 'transform 0.4s ease', transform: bob ? 'translateY(-3px)' : 'translateY(0)' }}>
      <svg width={size} height={size + 20} viewBox="0 0 100 120">
        <ellipse cx="50" cy="112" rx="28" ry="6" fill={dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)'} />
        <path d="M38 28 Q36 14 32 8" stroke={g1} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M62 28 Q64 14 68 8" stroke={g1} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="32" cy="7" r="2.5" fill={g3} />
        <circle cx="68" cy="7" r="2.5" fill={g3} />
        <circle cx="50" cy="58" r="32" fill={`url(#blobG-${dark})`} />
        <defs>
          <radialGradient id={`blobG-${dark}`} cx="40%" cy="35%">
            <stop offset="0%" stopColor={g3} />
            <stop offset="50%" stopColor={g1} />
            <stop offset="100%" stopColor={g2} />
          </radialGradient>
        </defs>
        <circle cx="40" cy="52" r="7" fill={dark ? '#111' : '#222'} />
        <circle cx="60" cy="52" r="7" fill={dark ? '#111' : '#222'} />
        <circle cx="42" cy="50" r="2.5" fill="#fff" />
        <circle cx="62" cy="50" r="2.5" fill="#fff" />
        <ellipse cx="18" cy="62" rx="8" ry="7" fill={g1} />
        <ellipse cx="82" cy="62" rx="8" ry="7" fill={g1} />
        <rect x="36" y="86" width="10" height="16" rx="5" fill={g2} />
        <rect x="54" y="86" width="10" height="16" rx="5" fill={g2} />
      </svg>
    </div>
  )
}

function SatoshiStacker({ size = 1, dark = true }: { size?: number; dark?: boolean }) {
  return <BlobStacker size={Math.round(80 * size)} dark={dark} />
}


// ─── Staxs 3-line icon (stacked coins) ───
function StackIcon({ angled = false, size = 14, color = '#D4A017' }: { angled?: boolean; size?: number; color?: string }) {
  if (angled) {
    // Angled version — coins viewed from slight perspective
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="4" y="4" width="16" height="3" rx="1.5" fill={color} transform="rotate(-8 12 5.5)" />
        <rect x="3" y="10" width="18" height="3" rx="1.5" fill={color} transform="rotate(-4 12 11.5)" />
        <rect x="2" y="16" width="20" height="3" rx="1.5" fill={color} />
      </svg>
    )
  }
  // Straight version — 3 horizontal bars stacked
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="5" y="4" width="14" height="3" rx="1.5" fill={color} />
      <rect x="4" y="10.5" width="16" height="3" rx="1.5" fill={color} />
      <rect x="3" y="17" width="18" height="3" rx="1.5" fill={color} />
    </svg>
  )
}

// ─── Typewriter ───
function Type({ text, onDone }: { text: string; delay?: number; speed?: number; onDone?: () => void }) {
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone
  useEffect(() => { onDoneRef.current?.() }, [text])
  return <>{text}</>
}

// ─── Helpers ───
const fmt$ = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const CAPITALS = [5000, 10000, 25000, 50000, 100000]
// LEVERAGES constant removed — replaced by tier selector (see TIERS).
const PERIODS = [{ m: 6 }, { m: 12 }, { m: 24 }, { m: 60 }, { m: 0 }]

type Step = 'lang' | 'theme' | 'capital' | 'tier' | 'sizing' | 'period' | 'sim' | 'results'
type SizingMode = 'fixed' | 'compound'

// BTC monthly close for the stack-sats / keep-cash toggle.
interface BtcMonth { ts: number; close: number }

// Build alternative outcomes: stack-sats (extract surplus monthly into BTC) vs
// keep-cash (extract surplus monthly into USDT @ 5% APY). Trading account holds
// fixed at the user's initialCapital; profits flow into the chosen pool.
function alternativeOutcomes(
  trades: SimTrade[], initialCapital: number, btcMonthly: BtcMonth[],
): { stackSatsValue: number; btcQty: number; keepCashValue: number; usdt: number } {
  if (!trades.length) return { stackSatsValue: initialCapital, btcQty: 0, keepCashValue: initialCapital, usdt: 0 }
  // Bucket trade PnL by month-end ts.
  const monthly = new Map<string, number>()
  for (const t of trades) {
    const d = new Date(t.ts); const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`
    monthly.set(key, (monthly.get(key) || 0) + t.pnl)
  }
  // Map BTC close by yyyy-mm.
  const btcByMonth = new Map<string, number>()
  for (const m of btcMonthly) {
    const d = new Date(m.ts); const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`
    btcByMonth.set(key, m.close)
  }
  // Walk months in order. Trading account fixed at initialCapital; extract surplus monthly.
  const sortedKeys = [...monthly.keys()].sort()
  let trading = initialCapital, btcQty = 0, usdt = 0
  const usdtMonthly = Math.pow(1.05, 1/12) - 1  // 5% APY monthly compound
  for (const key of sortedKeys) {
    trading += monthly.get(key) || 0
    usdt *= (1 + usdtMonthly)
    if (trading > initialCapital) {
      const surplus = trading - initialCapital
      trading = initialCapital
      // Stack-sats: buy BTC at month-end close (nearest, fallback to last known).
      const btcClose = btcByMonth.get(key) || [...btcByMonth.values()].pop() || 30000
      btcQty += surplus / btcClose
      // Keep-cash: deposit surplus into USDT.
      usdt += surplus
    }
    // Negative months: account drops below initialCapital. Top up from USDT if available
    // (stack-sats mode never sells BTC; keep-cash mode taps USDT).
    if (trading < initialCapital && usdt > 0) {
      const need = initialCapital - trading
      const top = Math.min(need, usdt)
      usdt -= top; trading += top
    }
  }
  const lastBtc = btcMonthly[btcMonthly.length - 1]?.close || 30000
  return {
    stackSatsValue: initialCapital + btcQty * lastBtc,
    btcQty,
    keepCashValue: initialCapital + usdt,
    usdt,
  }
}

export function SimulatorContent() {
  const [trades, setTrades] = useState<Trade[]>([])
  // Basket size and the real data span come from the feed itself. Typed-in versions of both had
  // gone stale: the header said "19-asset" (PT said 16) against a 29-asset basket, "All Time"
  // started the window at Oct 2017 when the first trade is Aug 2019, and the results footer said
  // "8+ years" for a book that spans 7.
  const assetCount = useMemo(
    () => new Set(trades.map(t => (t as any).symbol).filter(Boolean)).size, [trades])
  const firstEntryTs = useMemo(
    () => (trades.length ? Math.min(...trades.map(t => t.entryTs).filter(Number.isFinite)) : null), [trades])
  const dataYears = useMemo(() => {
    if (!trades.length || !firstEntryTs) return null
    const last = Math.max(...trades.map(t => t.exitTs).filter(Number.isFinite))
    return (last - firstEntryTs) / (365.25 * 24 * 3600 * 1000)
  }, [trades, firstEntryTs])
  const [feedStartCapital, setFeedStartCapital] = useState(10000)
  const [liveTierConfig, setLiveTierConfig] = useState<{ label?: string; hbNotional?: number; mrsNotional?: number; peakLeverage?: number; startCapital?: number } | null>(null)
  const [btcMonthly, setBtcMonthly] = useState<BtcMonth[]>([])
  const [loading, setLoading] = useState(false)  // tier-aware: no mount-time fetch
  // ── 2026-09-03 (Chris) ────────────────────────────────────────────────────────────────────
  // The wizard KEEPS its language and theme questions — Chris asked for them to be PRE-ANSWERED
  // from the app, not removed. They open already set to whatever the app is using, and the user
  // can still change either for this session. (I removed them outright first; that was not the
  // ask.)
  const [step, setStep] = useState<Step>('lang')
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'en'
    try { return localStorage.getItem('stax-lang') === 'PT' ? 'pt' : 'en' } catch { return 'en' }
  })
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      if (document.documentElement.classList.contains('light')) return false
      if (document.documentElement.classList.contains('dark')) return true
      return localStorage.getItem('stax-theme') !== 'light'
    } catch { return true }
  })
  // Follow the app if the user flips theme or language while this page is open.
  useEffect(() => {
    const sync = () => {
      try {
        const html = document.documentElement
        setDark(html.classList.contains('light') ? false
                : html.classList.contains('dark') ? true
                : localStorage.getItem('stax-theme') !== 'light')
        setLang(localStorage.getItem('stax-lang') === 'PT' ? 'pt' : 'en')
      } catch {}
    }
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('stax-lang-change', sync)
    window.addEventListener('storage', sync)
    return () => { mo.disconnect(); window.removeEventListener('stax-lang-change', sync); window.removeEventListener('storage', sync) }
  }, [])
  const [capital, setCapital] = useState(0)
  const [tierKey, setTierKey] = useState<TierKey | ''>('')
  const [sizingMode, setSizingMode] = useState<SizingMode | ''>('')
  const [periodM, setPeriodM] = useState(-1)
  const [custom, setCustom] = useState('')
  const [result, setResult] = useState<SimResult | null>(null)
  const [simLines, setSimLines] = useState<string[]>([])
  const [dcaMode, setDcaMode] = useState<'standard'|'stack_sats'|'keep_cash'>('standard')
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const t = T[lang]

  // Pre-load BTC monthly close (small file, used by the DCA/Keep-cash toggle).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/data/strategies/phase-h/btc-monthly-close.json')
        if (r.ok) setBtcMonthly(await r.json())
      } catch {}
    })()
  }, [])

  // Tier-aware feed loading: fetch silently in the background so the wizard
  // stays atomic — no full-page spinner, no scroll reset. Trades update when
  // the fetch lands; the period step waits for them via the empty-state check.
  useEffect(() => {
    if (!tierKey) return
    let cancelled = false
    ;(async () => {
      try {
        // 2026-06-12: canonical phase-h-risk feed (limit-entry 0.15%/120, risk-sized,
        // 2/4/6 tiers) — the SAME source the dashboard + backtesting page + settings
        // serve. Was /phase-h (flat market) → the simulator showed the old market pool.
        // conservative publishes at the root, moderate/aggressive under tiers/<key>.
        const base = tierKey === 'conservative'
          ? '/data/strategies/phase-h-risk'
          : `/data/strategies/phase-h-risk/tiers/${tierKey}`
        const [tradesR, statsR] = await Promise.all([
          fetch(`${base}/portfolio-trades.json`),
          fetch(`${base}/portfolio-stats.json`),
        ])
        if (!cancelled && tradesR.ok) {
          const j = await tradesR.json()
          if (Array.isArray(j) && j.length) setTrades(j)
        }
        if (!cancelled && statsR.ok) {
          const s = await statsR.json()
          if (s?.startCapital) setFeedStartCapital(s.startCapital)
          if (s?.tierConfig) setLiveTierConfig({ ...s.tierConfig, startCapital: s.startCapital })
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [tierKey])
  // 2026-09-03: this scrolled on EVERY run of the effect, including the first paint, so opening
  // the page jumped it straight down past the header. Scroll only once the wizard has actually
  // moved — the first view stays at the top, like any other page.
  const hasAdvanced = useRef(false)
  useEffect(() => {
    if (!hasAdvanced.current) { hasAdvanced.current = true; return }
    if (step === 'results') { setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150) }
    else { setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 120) }
  }, [step, simLines.length])
  useEffect(() => { if (step === 'capital') setTimeout(() => inputRef.current?.focus(), 500) }, [step])

  const past = (s: Step) => ['lang','theme','capital','tier','sizing','period','sim','results'].indexOf(step) > ['lang','theme','capital','tier','sizing','period','sim','results'].indexOf(s)
  const atOrPast = (s: Step) => step === s || past(s)

  const pickLang = (l: Lang) => { setLang(l); setStep('theme') }
  const pickTheme = (d: boolean) => { setDark(d); setStep('capital') }
  const pickCapital = useCallback((v: number) => { setCapital(v); setStep('tier') }, [])
  const pickTier = useCallback((k: TierKey) => { setTierKey(k); setStep('sizing') }, [])
  const pickSizing = useCallback((m: SizingMode) => { setSizingMode(m); setStep('period') }, [])

  const pickPeriod = useCallback((months: number) => {
    setPeriodM(months)
    setStep('sim')
    setSimLines([])
    setDcaMode('standard')

    const now = new Date()
    const start = months === 0
      ? new Date(firstEntryTs ?? Date.parse('2019-08-01T00:00:00Z'))   // the book's real start
      : new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
    const fallbackTier = tierKey ? TIERS[tierKey] : TIERS.conservative
    // Tier-specific feed already loaded. Capital scales linearly from feed's $10k reference:
    //   userPnl = publishedPnl × (capital / feedStartCapital)
    // No cross-tier baseAccount math — every tier's feed assumes $10k startCapital.
    const scaleFactor = capital / feedStartCapital
    const liveHbNotional = capital  // user's entire capital is the lane sizing budget
    const runtimeTier: TierRuntime = {
      label: liveTierConfig?.label || fallbackTier.label,
      hbRatio: scaleFactor,
      mrsRatio: 0,
      peakLev: liveTierConfig?.peakLeverage ?? fallbackTier.peakLev,
      hbNotional: liveHbNotional,
      mrsNotional: 0,
    }
    // Pass feedStartCapital as the backtest base so simulate() computes pnl × (capital / 10000).
    const sim = simulate(trades, capital, runtimeTier, start, now, feedStartCapital, feedStartCapital, sizingMode || 'compound')
    sim.tier = runtimeTier.label
    sim.peakLev = runtimeTier.peakLev
    setResult(sim)

    const sample = sim.trades.length <= 8 ? sim.trades
      : [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.99].map(p => sim.trades[Math.floor(sim.trades.length * p)])

    let i = 0
    const feed = () => {
      if (i < sample.length) {
        const tr = sample[i]
        setSimLines(prev => [...prev, `[${fmtDate(tr.entryTs)}]  ${tr.side === 'LONG' ? '🟢 LONG ' : '🔴 SHORT'}  Entry $${Math.round(tr.entryPx).toLocaleString()} → Exit $${Math.round(tr.exitPx).toLocaleString()}  |  ${tr.pnl >= 0 ? '+' : ''}${fmt$(tr.pnl)}  (${tr.reason})  |  Equity: ${fmt$(tr.equity)}`])
        i++
        setTimeout(feed, 350)
      } else {
        setTimeout(() => {
          setSimLines(prev => [...prev, t.complete(sim.totalTrades)])
          setTimeout(() => setStep('results'), 800)
        }, 400)
      }
    }
    setTimeout(feed, 500)
  }, [trades, capital, tierKey, sizingMode, t, feedStartCapital, liveTierConfig])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = parseInt(custom.replace(/[^0-9]/g, ''))
    if (step === 'capital' && v >= 100) pickCapital(v)
    setCustom('')
  }

  const reset = () => { setStep('lang'); setCapital(0); setTierKey(''); setSizingMode(''); setPeriodM(-1); setResult(null); setSimLines([]); setCustom('') }

  // Theme CSS vars
  const theme = dark
    ? { '--sim-bg': '#06060A', '--sim-text': '#fff', '--sim-muted': 'rgba(255,255,255,0.35)', '--sim-gold': '#D4A017', '--sim-card': 'rgba(255,255,255,0.03)', '--sim-border': 'rgba(255,255,255,0.06)', '--sim-green': '#16a34a', '--sim-red': '#ef4444' }
    : { '--sim-bg': '#f5f3ef', '--sim-text': '#1a1a2e', '--sim-muted': 'rgba(26,26,46,0.4)', '--sim-gold': '#B8860B', '--sim-card': '#ffffff', '--sim-border': 'rgba(0,0,0,0.08)', '--sim-green': '#15803d', '--sim-red': '#c1121f' }

  const btn = (active: boolean, enabled: boolean) =>
    `px-4 py-2 rounded-lg text-xs font-mono transition-all ${active ? 'bg-[var(--sim-gold)] text-[var(--sim-bg)] font-bold' : enabled ? 'bg-[var(--sim-card)] border border-[var(--sim-border)] text-[var(--sim-muted)] hover:border-[var(--sim-gold)] hover:text-[var(--sim-gold)]' : 'bg-[var(--sim-card)] border border-[var(--sim-border)] text-[var(--sim-muted)] opacity-30 cursor-default'}`

  if (loading) return <div className="min-h-screen bg-[#06060A] flex items-center justify-center"><div className="h-6 w-6 border-2 border-[#D4A017] border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="min-h-screen selection:bg-[var(--sim-gold)]/30" style={{ ...theme as any, background: 'var(--sim-bg)', color: 'var(--sim-text)' }}>
      <div className="max-w-3xl mx-auto px-5 py-10 min-h-screen flex flex-col">

        {/* Header */}
        <div className="flex items-start gap-5 mb-10">
          <SatoshiStacker size={1.2} dark={dark} />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#D4A017] to-[#8B6914] flex items-center justify-center">
                <StackIcon size={16} color={dark ? '#06060A' : '#fff'} />
              </div>
              <span className="text-sm font-bold" style={{ color: 'var(--sim-text)' }}>staxs</span>
              <span style={{ color: 'var(--sim-muted)' }} className="text-xs font-mono">simulator</span>
            </div>
            <div style={{ color: 'var(--sim-gold)' }} className="font-mono text-xs">SwingMate Super Stack — {assetCount || ''}{assetCount ? '-asset ' : ''}Strategy Simulator</div>
          </div>
        </div>

        <div className="flex-1 space-y-5 font-mono text-sm">

          {/* LANG */}
          <div style={{ color: 'var(--sim-gold)' }}><Type text={t.init} delay={300} speed={18} /></div>
          <div style={{ color: 'var(--sim-muted)' }}><Type text={t.loaded(trades.length, assetCount)} delay={1400} speed={12} /></div>
          <div style={{ color: 'var(--sim-muted)' }}><Type text={t.noCompound} delay={2200} speed={12} onDone={() => step === 'lang' && setTimeout(() => {}, 0)} /></div>

          

          {/* THEME */}
          

          {/* CAPITAL */}
          {atOrPast('lang') && (
            <div className="pt-4 space-y-3 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-lg" style={{ color: 'var(--sim-text)' }}><Type text={t.langQ} delay={2800} speed={18} /></div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => step === 'lang' && pickLang('en')} disabled={step !== 'lang'} className={btn(lang === 'en' && past('lang'), step === 'lang')}>🇬🇧 English</button>
                <button onClick={() => step === 'lang' && pickLang('pt')} disabled={step !== 'lang'} className={btn(lang === 'pt' && past('lang'), step === 'lang')}>🇧🇷 Português</button>
              </div>
            </div>
          )}

          {atOrPast('theme') && (
            <div className="pt-2 space-y-3 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-lg" style={{ color: 'var(--sim-text)' }}><Type text={t.themeQ} delay={200} speed={18} /></div>
              <div className="flex gap-2">
                <button onClick={() => step === 'theme' && pickTheme(true)} disabled={step !== 'theme'} className={btn(dark && past('theme'), step === 'theme')}>🌙 {t.dark}</button>
                <button onClick={() => step === 'theme' && pickTheme(false)} disabled={step !== 'theme'} className={btn(!dark && past('theme'), step === 'theme')}>☀️ {t.light}</button>
              </div>
            </div>
          )}

          {atOrPast('capital') && (
            <div className="pt-2 space-y-3 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-lg" style={{ color: 'var(--sim-text)' }}><Type text={t.capitalQ} delay={200} speed={18} /></div>
              <div className="flex flex-wrap gap-2">
                {CAPITALS.map(v => <button key={v} onClick={() => step === 'capital' && pickCapital(v)} disabled={step !== 'capital'} className={btn(capital === v && past('capital'), step === 'capital')}>{fmt$(v)}</button>)}
                {step === 'capital' && (
                  <form onSubmit={submit} className="flex gap-1.5">
                    <input ref={inputRef} type="text" value={custom} onChange={e => setCustom(e.target.value)} placeholder={t.capitalCustom} className="w-32 px-3 py-2 rounded-lg text-xs outline-none font-mono" style={{ background: 'var(--sim-card)', border: '1px solid var(--sim-border)', color: 'var(--sim-text)' }} />
                    <button type="submit" className="px-2.5 py-2 rounded-lg text-xs" style={{ background: 'var(--sim-card)', color: 'var(--sim-muted)' }}>↵</button>
                  </form>
                )}
              </div>
              {capital > 0 && <div style={{ color: 'var(--sim-gold)' }} className="text-xs">{t.capitalSel(fmt$(capital))}</div>}
            </div>
          )}

          {/* TIER */}
          {atOrPast('tier') && (
            <div className="pt-2 space-y-3 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-lg" style={{ color: 'var(--sim-text)' }}><Type text={t.tierQ} delay={200} speed={18} /></div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(TIERS) as TierKey[]).map(k => (
                  <button
                    key={k}
                    onClick={() => step === 'tier' && pickTier(k)}
                    disabled={step !== 'tier'}
                    className={btn(tierKey === k && past('tier'), step === 'tier')}
                  >
                    {t.tierLabels[k]}
                  </button>
                ))}
              </div>
              {tierKey && (
                <div style={{ color: 'var(--sim-gold)' }} className="text-xs">
                  {t.tierSel(
                    // Localized short label (strip suffix after "·")
                    t.tierLabels[tierKey].split(' · ')[0],
                    fmt$(capital),
                    String(TIERS[tierKey].lanes),
                  )}
                </div>
              )}
            </div>
          )}

          {/* SIZING — Fixed vs Compound position sizing (2026-06-04) */}
          {atOrPast('sizing') && (
            <div className="pt-2 space-y-3 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-lg" style={{ color: 'var(--sim-text)' }}><Type text={t.sizingQ} delay={200} speed={18} /></div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => step === 'sizing' && pickSizing('fixed')} disabled={step !== 'sizing'} className={btn(sizingMode === 'fixed' && past('sizing'), step === 'sizing')}>{t.sizingFixed}</button>
                <button onClick={() => step === 'sizing' && pickSizing('compound')} disabled={step !== 'sizing'} className={btn(sizingMode === 'compound' && past('sizing'), step === 'sizing')}>{t.sizingCompound}</button>
              </div>
              <div style={{ color: 'var(--sim-muted)' }} className="text-[11px] space-y-0.5">
                <div><span style={{ color: 'var(--sim-text)' }}>{t.sizingFixed}</span> — {t.sizingFixedSub}</div>
                <div><span style={{ color: 'var(--sim-text)' }}>{t.sizingCompound}</span> — {t.sizingCompoundSub}</div>
              </div>
              {sizingMode && (
                <div style={{ color: 'var(--sim-gold)' }} className="text-xs">
                  {t.sizingSel(sizingMode === 'fixed' ? t.sizingFixed : t.sizingCompound)}
                </div>
              )}
            </div>
          )}

          {/* PERIOD */}
          {atOrPast('period') && (
            <div className="pt-2 space-y-3 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-lg" style={{ color: 'var(--sim-text)' }}><Type text={t.periodQ} delay={200} speed={18} /></div>
              <div className="flex flex-wrap gap-2">
                {PERIODS.map((p, i) => <button key={i} onClick={() => step === 'period' && pickPeriod(p.m)} disabled={step !== 'period'} className={btn(periodM === p.m && past('period'), step === 'period')}>{t.periods[i]}</button>)}
              </div>
            </div>
          )}

          {/* SIMULATION FEED */}
          {(step === 'sim' || step === 'results') && (
            <div className="pt-4 space-y-1">
              <div style={{ color: 'var(--sim-gold)' }} className="text-xs mb-3">{t.running}</div>
              <div className="rounded-xl p-4 max-h-72 overflow-y-auto text-[11px] leading-relaxed space-y-1" style={{ background: 'var(--sim-card)', border: '1px solid var(--sim-border)' }}>
                {simLines.map((line, i) => (
                  <div key={i} style={{ color: line.includes('───') ? 'var(--sim-gold)' : line.includes('+$') ? 'var(--sim-green)' : line.includes('-$') ? 'var(--sim-red)' : 'var(--sim-muted)' }} className={line.includes('───') ? 'font-bold mt-2' : ''}>
                    {line}
                  </div>
                ))}
                {step === 'sim' && <div style={{ color: 'var(--sim-muted)' }} className="flex items-center gap-2 mt-2 opacity-50"><span className="inline-block w-1.5 h-3 animate-pulse" style={{ background: 'var(--sim-gold)' }} /> {t.executing}</div>}
              </div>
            </div>
          )}

          {/* RESULTS */}
          {step === 'results' && result && (() => {
            // Outcome by mode. Default ("standard"): trading account compounds the trade PnL stream
            // straight into equity. Toggle modes simulate Smart Stacking: trading account stays at
            // the user's initial capital, surplus is extracted monthly into BTC or USDT.
            const alt = alternativeOutcomes(result.trades, capital, btcMonthly)
            const modeOutcome = dcaMode === 'stack_sats'
              ? { value: alt.stackSatsValue, sub: `$${Math.round(capital).toLocaleString()} trading + ${alt.btcQty.toFixed(4)} BTC ($${Math.round(alt.btcQty * (btcMonthly[btcMonthly.length-1]?.close || 0)).toLocaleString()})` }
              : dcaMode === 'keep_cash'
              ? { value: alt.keepCashValue, sub: `$${Math.round(capital).toLocaleString()} trading + $${Math.round(alt.usdt).toLocaleString()} USDT (5% APY)` }
              : { value: result.finalCapital, sub: `compounded into trading account` }
            const modeReturn = ((modeOutcome.value - capital) / capital) * 100

            // ── THE FEE (2026-09-02, DL3) ────────────────────────────────────────────────────
            // The simulator projected GROSS and never once mentioned what Staxs charges. Computed
            // here the way the customer is actually billed: 20% of EACH profitable month's net
            // profit, nothing at all on a losing month, and NO HIGH-WATER MARK — each period
            // stands alone (Chris, 2026-09-02: "I said NO water mark... IT IS DECIDED"). Summing
            // profitable months is deliberately the honest direction: it is a LARGER number than
            // 20% of the total, because losing months do not offset the winners.
            const FEE_RATE = 0.20
            const monthly = new Map<string, number>()
            for (const tr of result.trades) {
              const k = new Date(tr.ts).toISOString().slice(0, 7)
              monthly.set(k, (monthly.get(k) ?? 0) + tr.pnl)
            }
            const billedMonths = [...monthly.values()].filter(v => v > 0)
            const totalFee = billedMonths.reduce((a, v) => a + v * FEE_RATE, 0)
            const grossProfit = result.finalCapital - capital
            const netAfterFee = result.finalCapital - totalFee
            return (
            <div ref={resultsRef} className="space-y-6 animate-[fadeIn_0.6s_ease-out]">
              <div className="text-center py-8" style={{ borderTop: '1px solid var(--sim-border)', borderBottom: '1px solid var(--sim-border)' }}>
                <div style={{ color: 'var(--sim-text)' }} className="text-base md:text-lg tracking-widest mb-4 font-semibold">{t.heroLabel(fmt$(capital))}</div>
                <div className="text-5xl md:text-6xl font-black font-mono" style={{ color: modeOutcome.value >= capital ? 'var(--sim-green)' : 'var(--sim-red)' }}>
                  {fmt$(modeOutcome.value)}
                </div>
                <div className="text-lg mt-2" style={{ color: modeReturn >= 0 ? 'var(--sim-green)' : 'var(--sim-red)' }}>
                  {(modeReturn >= 0 ? '+' : '') + modeReturn.toFixed(2)}% {t.returnLabel}
                </div>
                <div style={{ color: 'var(--sim-muted)' }} className="text-[11px] mt-2 opacity-70">{modeOutcome.sub}</div>
                <div style={{ color: 'var(--sim-muted)' }} className="text-xs mt-1 opacity-60">{t.tradesOver(result.totalTrades, t.periodText(periodM, dataYears))}</div>
              </div>

              {/* What Staxs would have charged over the same run. */}
              {grossProfit > 0 && (
                <div className="rounded-xl px-4 py-3 text-center"
                     style={{ background: 'var(--sim-card)', border: '1px solid var(--sim-border)' }}>
                  <div style={{ color: 'var(--sim-muted)' }} className="text-[11px] tracking-wider mb-2">
                    {lang === 'pt' ? 'E O QUE A STAXS TERIA COBRADO' : 'AND WHAT STAXS WOULD HAVE CHARGED'}
                  </div>
                  <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-mono text-sm">
                    <span style={{ color: 'var(--sim-muted)' }}>
                      {lang === 'pt' ? 'Lucro bruto' : 'Gross profit'}{' '}
                      <b style={{ color: 'var(--sim-green)' }}>{fmt$(grossProfit)}</b>
                    </span>
                    <span style={{ color: 'var(--sim-muted)' }}>
                      {lang === 'pt' ? 'Taxa de performance (20%)' : 'Performance fee (20%)'}{' '}
                      <b style={{ color: 'var(--sim-red)' }}>−{fmt$(totalFee)}</b>
                    </span>
                    <span style={{ color: 'var(--sim-muted)' }}>
                      {lang === 'pt' ? 'Você fica com' : 'You keep'}{' '}
                      <b style={{ color: 'var(--sim-gold)' }}>{fmt$(netAfterFee)}</b>
                    </span>
                  </div>
                  <div style={{ color: 'var(--sim-muted)' }} className="text-[10px] mt-2 opacity-70 leading-relaxed">
                    {lang === 'pt'
                      ? `20% do lucro líquido de cada mês lucrativo (${billedMonths.length} de ${monthly.size} meses). Nada é cobrado em um mês de prejuízo, e não há marca d'água — cada período é independente.`
                      : `20% of the net profit of each profitable month (${billedMonths.length} of ${monthly.size} months). Nothing is charged on a losing month, and there is no high-water mark — each period stands on its own.`}
                  </div>
                </div>
              )}

              {/* DCA / Keep-cash toggle — Smart Stacking visualization */}
              <div className="flex justify-center gap-1.5 flex-wrap">
                {([
                  { k: 'standard',   label: lang === 'pt' ? 'Padrão' : 'Standard', sub: lang === 'pt' ? 'compõe na conta' : 'compounds in account' },
                  { k: 'stack_sats', label: lang === 'pt' ? 'Empilhar Sats ⟠' : 'Stack Sats ⟠', sub: lang === 'pt' ? 'lucros → BTC mensal' : 'profits → BTC monthly' },
                  { k: 'keep_cash',  label: lang === 'pt' ? 'Manter Cash 💵' : 'Keep Cash 💵', sub: lang === 'pt' ? 'lucros → USDT 5% APY' : 'profits → USDT 5% APY' },
                ] as Array<{ k: typeof dcaMode; label: string; sub: string }>).map(opt => (
                  <button
                    key={opt.k}
                    onClick={() => setDcaMode(opt.k)}
                    className={`px-3.5 py-2 rounded-lg text-[11px] font-mono transition-all border ${dcaMode === opt.k ? 'font-bold' : 'opacity-60 hover:opacity-100'}`}
                    style={{
                      background: dcaMode === opt.k ? 'var(--sim-gold)' : 'var(--sim-card)',
                      color: dcaMode === opt.k ? 'var(--sim-bg)' : 'var(--sim-text)',
                      borderColor: dcaMode === opt.k ? 'var(--sim-gold)' : 'var(--sim-border)',
                    }}
                  >
                    <div>{opt.label}</div>
                    <div className="text-[9px] opacity-70 mt-0.5">{opt.sub}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {[
                  { l: t.winRate, v: result.winRate.toFixed(1) + '%' },
                  { l: t.profitFactor, v: result.profitFactor.toFixed(2) },
                  { l: t.maxDD, v: result.maxDrawdown.toFixed(2) + '%' },
                  { l: t.expectancy, v: fmt$(result.expectancy) },
                  { l: t.avgWin, v: fmt$(result.avgWin) },
                  { l: t.avgLoss, v: fmt$(result.avgLoss) },
                  { l: t.bestTrade, v: fmt$(result.bestTrade) },
                  { l: t.wl, v: `${result.winners} / ${result.losers}` },
                ].map(s => (
                  <div key={s.l} className="rounded-xl p-3.5" style={{ background: 'var(--sim-card)', border: '1px solid var(--sim-border)' }}>
                    <div style={{ color: 'var(--sim-muted)' }} className="text-[9px] uppercase tracking-wider">{s.l}</div>
                    <div className="font-bold text-base mt-1" style={{ color: 'var(--sim-text)' }}>{s.v}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl p-5" style={{ background: 'var(--sim-card)', border: '1px solid var(--sim-border)' }}>
                <div style={{ color: 'var(--sim-muted)' }} className="text-[9px] uppercase tracking-wider mb-4">{t.equityCurve}</div>
                <div className="h-44 flex items-end gap-px">
                  {(() => {
                    const c = result.equityCurve, n = 100, s = Math.max(1, Math.floor(c.length / n))
                    const pts = c.filter((_, i) => i % s === 0 || i === c.length - 1)
                    const mn = Math.min(...pts.map(p => p.equity)), mx = Math.max(...pts.map(p => p.equity)), r = mx - mn || 1
                    return pts.map((p, i) => <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(2, ((p.equity - mn) / r) * 100)}%`, background: p.equity >= capital ? `linear-gradient(to top, color-mix(in srgb, var(--sim-green) 25%, transparent), color-mix(in srgb, var(--sim-green) 60%, transparent))` : `linear-gradient(to top, color-mix(in srgb, var(--sim-red) 25%, transparent), color-mix(in srgb, var(--sim-red) 60%, transparent))` }} />)
                  })()}
                </div>
                <div className="flex justify-between text-[10px] mt-2" style={{ color: 'var(--sim-muted)' }}>
                  <span>{fmtDate(result.equityCurve[0]?.ts)}</span>
                  <span>{fmtDate(result.equityCurve[result.equityCurve.length - 1]?.ts)}</span>
                </div>
              </div>

              <div className="text-center pt-4 space-y-4">
                <p style={{ color: 'var(--sim-muted)' }} className="text-xs opacity-60">{t.disclaimer}</p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <a href="/signup" className="px-7 py-3 font-bold rounded-xl text-sm transition-all" style={{ background: 'var(--sim-gold)', color: 'var(--sim-bg)', boxShadow: '0 0 30px rgba(212,160,23,0.25)' }}>{t.cta}</a>
                  <button onClick={reset} className="px-5 py-3 rounded-xl text-sm transition-all" style={{ border: '1px solid var(--sim-border)', color: 'var(--sim-muted)' }}>{t.again}</button>
                </div>
              </div>
            </div>
            )
          })()}

          <div ref={bottomRef} />
        </div>

        <div className="text-center pt-8 pb-4 mt-auto" style={{ borderTop: '1px solid var(--sim-border)' }}>
          <div className="flex items-center justify-center gap-2 text-xs" style={{ color: 'var(--sim-muted)' }}>
            <span style={{ color: 'var(--sim-gold)' }}>⚡</span>
            <span className="font-semibold" style={{ color: 'var(--sim-text)', opacity: 0.5 }}>staxs</span>
            <span style={{ opacity: 0.3 }}>|</span>
            <span>Precision trading, automated.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
