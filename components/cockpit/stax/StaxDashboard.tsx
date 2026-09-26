'use client'

/* Pixel-faithful port of Claude Design Stax Dashboard.html.
   Composes the same DOM/CSS structure as the design prototype but expressed
   as React components with TypeScript types. The visual layer is owned by
   stax-design.css (scoped under .stax-app); these components only emit the
   markup the design expects. */

import { coinIconUrl } from '@/lib/coinIcon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { InvoiceDueBanner } from './InvoiceDueBanner'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import './stax-design.css'
import { Icons } from './Icons'
import { NotifIcon } from './NotifIcon'
import { EquityChart, LeverageGauge, Spark, genSpark, type EquityPoint } from './Charts'
import { usePublicTickers, useTickerStreamHealth, type PublicTicker } from '@/lib/use-public-tickers'
import { browserClient } from '@/lib/supabase-browser'
import { useIsAdmin } from '@/lib/use-is-admin'
import { useT } from '@/lib/i18n'
import { useWizardState } from '@/lib/use-wizard-state'
import { OnboardingBanner } from './OnboardingBanner'
import { OnboardingTourController } from './OnboardingTour'

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$—'
  if (n < 1) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
function publicToTickerAssets(rows: PublicTicker[]): TickerAsset[] {
  // PublicTicker.short and CoinSym now both cover the full Phase H 14-asset
  // basket, so the ticker singleton can map 1:1 — no filtering needed.
  return rows.map(r => ({
    sym: r.short,
    price: fmtPrice(r.price),
    delta: `${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}%`,
    pos: r.change >= 0,
  }))
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type TradeSide = 'LONG' | 'SHORT'
// 2026-09-05: was a 19-member union against a 29-asset basket, so AAVE, ATOM, BCH, ETC, FIL, LTC,
// PEPE, RUNE, TAO, WLD and XLM could not even be TYPED here — the topbar ticker rendered them with
// an empty icon src. Widened to string: the basket is the source of truth, not a union that has to
// be edited every time Chris adds a coin.
export type CoinSym = string

export type Position = {
  pair: string
  sym: CoinSym
  side: TradeSide
  size: string
  entry: string
  mark: string
  pnl: string
  pnlPct: string
  pos: boolean   // true if pnl is positive
  fromStrategy?: boolean   // true if this is the strategy's currently-open position (bot is "watching"), not a real exchange position
  /** Pre-formatted entry timestamp ("6 May 2026, 13:14") rendered below the entry price. */
  entryTs?: string
  // Raw numeric fields — used by the page-level live ticker overlay to
  // recompute pnl on every WS tick without re-fetching. Optional for
  // back-compat with sample/loading data.
  entryNum?: number
  sizeUnits?: number
  dir?: 1 | -1
}

export type Trade = {
  pair: string
  sym: CoinSym
  side: TradeSide
  size: string
  entry: string
  exit: string
  pnl: string
  pnlPct: string
  pos: boolean
  time: string
  /** true when the trade is still open — the exit cell renders a pulsing OPEN
   *  label instead of the live mark price. */
  open?: boolean
  /** Pre-formatted entry/exit timestamps ("6 May 2026, 13:14") shown stacked
   *  under each price cell. Replaces the standalone Time column. */
  entryTs?: string
  exitTs?: string
  /** Strategy backtest source (vs the user's real account). Used when the
   *  user hasn't traded yet so we can show what the strategy is doing
   *  rather than an empty Recent Trades table. */
  fromStrategy?: boolean
}

export type StatCardSpec = {
  label: string
  value: React.ReactNode
  sub: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  valueClass?: 'pos' | 'neg' | ''
}

export type TickerAsset = {
  sym: CoinSym
  price: string
  delta: string
  pos: boolean
}

export type StaxDashboardData = {
  /** 2026-09-02: the live track record is pinned to the k54_bounded re-lock (07:52:04Z).
   *  Everything before it belongs to the previous book. Rendered as a caption so a zero on
   *  day one reads as a fresh start rather than a broken panel. */
  trackRecord?: {
    epoch_ms: number
    epoch_iso: string
    epoch_label: string
    basket: string
    hidden_count: number
    note: string
  }
  // Top bar
  btcPrice: number
  // Hero
  balanceUsd: number
  tierLabel: string                  // "Aggressive tier · 1.0× of balance"
  btcGoal: number                    // current BTC equivalent of equity
  btcGoalTarget?: number             // mission target in BTC (default 1)
  /** True when the dashboard is rendering a strategy preview (user hasn't
   *  connected keys or activated the bot yet). The Hero swaps in a
   *  "BACKTEST PREVIEW" badge; once false it shows a faint Staxs watermark
   *  instead. Other widgets can dim themselves off this flag too. */
  isPreview?: boolean
  // Equity Curve — projected from user's balance through the strategy.
  // Simulator semantics: "if you'd put $balanceUsd in N months ago, where
  // would you be now?" Each strategy trade's pnl is scaled by
  // (balanceUsd / strategyBase) to reflect proportional sizing.
  portfolioTrades?: Array<{ exitTs: number; pnl: number }>
  // 2026-07-06: equity-curve inputs, separate from portfolioTrades (which is the
  // frozen backtest ending at the ~2026-05-29 pin, used for headline metrics).
  //   equityTrades = the FORWARD closed set (extends to TODAY) so every range
  //     [today−N, today] ends now, not at the backtest pin.
  //   equityBase = the curve's STARTING balance — the connected user's wizard
  //     initial capital (activation_balance) or $10k for a new/preview user —
  //     NOT the current account balance (which made the curve start at "now").
  equityTrades?: Array<{ exitTs: number; pnl: number }>
  /** true when equityTrades are the AUTHENTICATED USER'S own realised trades. */
  equityIsReal?: boolean
  equityRealTradeCount?: number
  degraded?: boolean
  degradedWarning?: string
  balanceSource?: string
  balanceAgeSeconds?: number
  equityBase?: number
  strategyBase?: number              // strategy account base ($10k by default)
  /** 2026-09-26 — EXPLICIT EQUITY STATE. Without this the card could only distinguish "I have a
   *  series" from "I have nothing", and "nothing" was drawn as a generated curve. 'loading' and
   *  'error' are now first-class: a failed read renders as a failed read, never as a flat or
   *  invented line. Omitted => derived from the data (series present ? 'ok' : 'empty'). */
  equityStatus?: 'ok' | 'loading' | 'error' | 'empty'
  equityError?: string
  /** The moment the CURRENT wizard configuration became effective — the curve's left edge. */
  equityEffectiveFrom?: string | null
  equityEffectiveFromSource?: string | null
  equityBaseSource?: string | null
  /** Opened before the settings change and closed after it — excluded from the curve, counted. */
  equityCarriedCount?: number
  equityCarriedPnl?: number
  equityUnattributableCount?: number
  equityExcludedBeforeEffective?: number
  /** Design-preview ONLY. The /design route renders SAMPLE_STAX_DATA, which carries no trades; this
   *  is the single explicit opt-in that lets the chart draw a generated series. Never set on any
   *  path that shows a real user real numbers. */
  allowSyntheticEquity?: boolean
  equityCurve?: EquityPoint[]        // legacy fallback when portfolioTrades not provided
  equityMonthLabels?: string[]       // legacy fallback
  equityRangeLabel: string           // "6M Performance (...)"
  // Stat row
  stats: StatCardSpec[]
  // Tables
  positions: Position[]
  trades: Trade[]
  // Bottom row
  leverage: number
  leverageMax?: number               // gauge upper bound; defaults to max(10, leverage*1.2)
  winRate20: { pct: number; wins: number; losses: number }
  winRate50: { pct: number; wins: number; losses: number }
  streak: { value: string; sub: string; recent: Array<'W' | 'L' | 'OW' | 'OL'>; recentLabels?: string[]; isWin: boolean }
  // Ticker
  ticker: TickerAsset[]
  // System status (sidebar foot)
  systemsOnline: boolean
}

// ─── Sample data — used by the design preview at /design and as a fallback. ─

export const SAMPLE_STAX_DATA: StaxDashboardData = {
  // The /design preview has no trade history by construction, so it is the one caller allowed to
  // draw a generated series. Production data paths never set this.
  allowSyntheticEquity: true,
  btcPrice: 76318,
  balanceUsd: 10247.83,
  tierLabel: 'Aggressive tier · 1.0× of balance',
  btcGoal: 0.0621,
  equityRangeLabel: "6M Performance (Nov 18, 2023 - May 18, 2024)",
  stats: [
    { label: 'Bot Status', value: <span className="pos-text"><span className="dot-live" />Active</span>, sub: 'Watching', icon: Icons.Robot },
    { label: 'Unrealized PnL', value: '$0', sub: 'No open position', icon: Icons.TrendUp },
    { label: 'Realized PnL', value: '$0', sub: 'No trades yet', icon: Icons.Check },
    { label: 'Total Return', value: '—', sub: 'All time', icon: Icons.TrendUp, valueClass: 'pos' },
  ],
  positions: [
    { pair: 'BTCUSDT', sym: 'BTC', side: 'LONG', size: '0.2500', entry: '$65,432.10', mark: '$76,318.00', pnl: '+$2,722.98', pnlPct: '+16.88%', pos: true },
  ],
  trades: [
    { sym: 'BTC', pair: 'BTCUSDT', side: 'LONG',  size: '0.1500',  entry: '$71,245.30', exit: '$75,960.40', pnl: '+$710.27', pnlPct: '+6.65%',  pos: true, time: 'May 18, 14:32' },
    { sym: 'ETH', pair: 'ETHUSDT', side: 'LONG',  size: '2.0000',  entry: '$3,182.45',  exit: '$3,515.80',  pnl: '+$666.70', pnlPct: '+10.48%', pos: true, time: 'May 18, 12:11' },
    { sym: 'SOL', pair: 'SOLUSDT', side: 'LONG',  size: '10.0000', entry: '$155.42',    exit: '$170.88',    pnl: '+$154.60', pnlPct: '+9.95%',  pos: true, time: 'May 17, 21:47' },
    { sym: 'XRP', pair: 'XRPUSDT', side: 'SHORT', size: '5,000.0', entry: '$0.5332',    exit: '$0.5198',    pnl: '+$67.00',  pnlPct: '+2.51%',  pos: true, time: 'May 18, 18:03' },
    { sym: 'SUI', pair: 'SUIUSDT', side: 'LONG',  size: '500.0',   entry: '$1.8450',    exit: '$1.9480',    pnl: '+$51.50',  pnlPct: '+5.58%',  pos: true, time: 'May 17, 15:22' },
  ],
  leverage: 7.5,
  winRate20: { pct: 65, wins: 13, losses: 7 },
  winRate50: { pct: 68, wins: 34, losses: 16 },
  streak: { value: '+1W', sub: '1 consecutive win', recent: 'WWLLLWWWLW'.split('') as Array<'W' | 'L' | 'OW' | 'OL'>, isWin: true },
  ticker: [
    { sym: 'BTC', price: '$76,318',   delta: '-2.18%', pos: false },
    { sym: 'ETH', price: '$3,535.80', delta: '+1.42%', pos: true  },
    { sym: 'SOL', price: '$170.88',   delta: '+3.06%', pos: true  },
    { sym: 'XRP', price: '$0.5198',   delta: '-9.84%', pos: false },
    { sym: 'SUI', price: '$1.9480',   delta: '+5.58%', pos: true  },
  ],
  systemsOnline: true,
}

// ─── Loading state ─ same shape as SAMPLE but no fake numbers visible to users.
// Used by DashboardLive while the real-data hook resolves so the page renders
// the structure instantly without flashing dummy figures like $10,247.83 or
// "BTCUSDT LONG 0.2500 @ $65,432.10" that confuse users.
export const LOADING_STAX_DATA: StaxDashboardData = {
  btcPrice: 0,
  balanceUsd: 0,
  tierLabel: '—',
  btcGoal: 0,
  equityRangeLabel: 'Loading…',
  equityStatus: 'loading',
  portfolioTrades: [],
  strategyBase: 10000,
  stats: [
    { label: 'Bot Status',     value: <span style={{ color: 'var(--muted)' }}>—</span>, sub: 'Loading',  icon: Icons.Robot   },
    { label: 'Unrealized PnL', value: <span style={{ color: 'var(--muted)' }}>—</span>, sub: '',         icon: Icons.TrendUp },
    { label: 'Realized PnL',   value: <span style={{ color: 'var(--muted)' }}>—</span>, sub: '',         icon: Icons.Check   },
    { label: 'Total Return',   value: <span style={{ color: 'var(--muted)' }}>—</span>, sub: '',         icon: Icons.TrendUp },
  ],
  positions: [],
  trades: [],
  leverage: 0,
  winRate20: { pct: 0, wins: 0, losses: 0 },
  winRate50: { pct: 0, wins: 0, losses: 0 },
  streak: { value: '—', sub: 'Loading', recent: [], isWin: true },
  ticker: [
    { sym: 'BTC', price: '—', delta: '—', pos: true },
    { sym: 'ETH', price: '—', delta: '—', pos: true },
    { sym: 'SOL', price: '—', delta: '—', pos: true },
    { sym: 'XRP', price: '—', delta: '—', pos: true },
    { sym: 'SUI', price: '—', delta: '—', pos: true },
  ],
  systemsOnline: true,
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'dashboard', tKey: 'nav.dashboard',   icon: Icons.Grid,      href: '/' },
  { id: 'live',      tKey: 'nav.live',        icon: Icons.TrendUp,   href: '/live' },
  { id: 'backtest',  tKey: 'nav.backtesting', icon: Icons.Bars,      href: '/backtesting' },
  // BROKER PARKED 2026-09-02 (Chris: prefer organic growth, value into the token). Not deleted —
  // see app/(app)/broker/page.tsx for what it did and how to restore it. The Simulator takes
  // its slot (Chris, DL). It lives on the marketing site, hence the absolute URL.
  // { id: 'broker',    tKey: 'nav.broker',      icon: Icons.Briefcase, href: '/broker' },
  // 2026-09-03: was an absolute staxs.ai link, which took the user OUT of the app and lost the
  // sidebar. The simulator is now a page in the app like any other.
  { id: 'simulator', tKey: 'nav.simulator',   icon: Icons.Play,      href: '/simulator' },
  // 2026-09-03 (Chris): Billing stays INSIDE Settings, where he already built it — not a
  // top-level nav item. The /billing route remains for the invoice email to link to.
  // { id: 'billing',   tKey: 'nav.billing',     icon: Icons.Bars,      href: '/billing' },
  { id: 'admin',     tKey: 'nav.admin',       icon: Icons.Shield,    href: '/admin' },
] as const

const FOOTER_NAV_ITEMS = [
  { id: 'settings', tKey: 'nav.settings', icon: Icons.Gear, href: '/settings' },
] as const

function signOutAndRedirect() {
  // Same shape as v1 dashboard signOut: clear supabase token, staxs cookies,
  // then bounce to /login. We don't await the Supabase call — the local key
  // wipe is what actually invalidates the session for our browser client.
  try {
    const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
      .replace(/^https?:\/\//, '')
      .split('.')[0]
    if (projectRef) {
      const key = `sb-${projectRef}-auth-token`
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    }
    localStorage.removeItem('staxs-api-connected')
    document.cookie = 'staxs_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'
    void browserClient().auth.signOut()
  } catch {}
  // /login lives on staxs-landing (not v2). Use absolute path so we leave /v2.
  window.location.href = 'https://staxs.ai/login'
}

function StaxSidebar({ active, collapsed = false, onToggleCollapsed }: {
  active?: string
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const t = useT()
  // Robust active detection: usePathname() returns null on the server, so we
  // also read window.location after mount as a hard fallback. This guarantees
  // the highlight updates as soon as the client hydrates, regardless of
  // whether SSR populated a sensible value. Strips the /v2 basePath so the
  // path matches NAV_ITEMS hrefs (which are stored without the prefix).
  const pathname = usePathname()
  const [clientPath, setClientPath] = useState<string | null>(null)
  useEffect(() => {
    const raw = window.location.pathname
    const stripped = raw.startsWith('/v2') ? (raw.slice(3) || '/') : raw
    setClientPath(stripped)
  }, [pathname])

  const effectivePath = clientPath ?? pathname ?? '/'
  const derived = NAV_ITEMS.find(it => {
    if (it.href === '/') return effectivePath === '/' || effectivePath === ''
    return effectivePath === it.href || effectivePath.startsWith(it.href + '/')
  })?.id
  const activeId = active ?? derived ?? 'dashboard'

  // Hide Admin from the sidebar for non-admins. Defaults to hidden until the
  // probe confirms admin role to avoid flashing the icon for regular users.
  const { isAdmin } = useIsAdmin()
  const visibleNavItems = useMemo(
    () => isAdmin === true ? NAV_ITEMS : NAV_ITEMS.filter(it => it.id !== 'admin'),
    [isAdmin]
  )
  return (
    <aside className="side">
      <div className="brand">
        {/* Dark mode logo: gold S on dark/full-colour bg.
            Light mode logo: transparent gold-only S (no dark backing). */}
        <img
          className="brand-mark-dark"
          src="/brand/staxs-icon-full-color-2048px.png"
          alt="Staxs"
          width={30}
          height={30}
        />
        <img
          className="brand-mark-light"
          src="/brand/staxs-icon-gold-transparent-2048px.png"
          alt="Staxs"
          width={30}
          height={30}
        />
        {!collapsed ? <div className="brand-name">staxs</div> : null}
      </div>
      {/* Collapse toggle — icon-only, sits below brand. Always visible. */}
      <div
        className="sb-collapse"
        onClick={onToggleCollapsed}
        role="button"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span style={{ display: 'inline-flex', transform: collapsed ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
          <Icons.ChevronLeft size={16} />
        </span>
      </div>
      {visibleNavItems.map(it => {
        const Ico = it.icon
        const label = t(it.tKey)
        return (
          <Link
            key={it.id}
            href={it.href}
            prefetch
            className={'nav-item' + (activeId === it.id ? ' active' : '')}
            title={collapsed ? label : undefined}
          >
            <Ico size={17} className="ico" />
            <span>{label}</span>
          </Link>
        )
      })}
      <div className="side-foot">
        {/* Settings + Sign Out — same pattern as v1 dashboard bottom nav. */}
        {FOOTER_NAV_ITEMS.map(it => {
          const Ico = it.icon
          const label = t(it.tKey)
          return (
            <Link
              key={it.id}
              href={it.href}
              prefetch
              className={'nav-item' + (activeId === it.id ? ' active' : '')}
              title={collapsed ? label : undefined}
            >
              <Ico size={17} className="ico" />
              <span>{label}</span>
            </Link>
          )
        })}
        <button
          type="button"
          className="nav-item nav-signout"
          onClick={signOutAndRedirect}
          title={collapsed ? t('nav.signout') : undefined}
        >
          <Icons.LogOut size={17} className="ico" />
          <span>{t('nav.signout')}</span>
        </button>
      </div>
    </aside>
  )
}

// ─── TopBar ─────────────────────────────────────────────────────────────────

const SETTINGS_TABS = [
  { id: 'profile',       labelEn: 'Profile',          labelPt: 'Perfil' },
  { id: 'billing',       labelEn: 'Billing',          labelPt: 'Assinatura' },
  { id: 'bot',           labelEn: 'Bot Settings',     labelPt: 'Configurações do Bot' },
  { id: 'notifications', labelEn: 'Notifications',    labelPt: 'Notificações' },
  { id: 'security',      labelEn: 'Security',         labelPt: 'Segurança' },
  { id: 'payout',        labelEn: 'Payout Settings',  labelPt: 'Pagamentos' },
] as const

/**
 * Auto-scrolling marquee for the topbar coin ticker. Items are rendered TWICE
 * back-to-back so the rAF loop can wrap seamlessly when scrollLeft passes the
 * halfway mark (visually identical content beyond it). User interaction —
 * pointer-down for click-drag, native wheel/touch scroll, hover — pauses the
 * auto-scroll until 2.5s of idle time. If everything fits without overflow
 * the auto-scroll silently no-ops, so on wide screens it behaves like a
 * static list.
 */
function ScrollingTicker({ items }: { items: TickerAsset[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const pausedUntilRef = useRef(0)
  const dragRef = useRef<{ startX: number; startScroll: number; active: boolean }>({ startX: 0, startScroll: 0, active: false })
  // Float accumulator. Browsers round Element.scrollLeft to an integer on
  // read in many engines (Chrome included with some zoom levels / DPRs), so
  // tiny per-frame deltas (≪1px) get truncated and the marquee freezes.
  // We track sub-pixel position ourselves and write the rounded value to
  // scrollLeft each frame.
  const posRef = useRef(0)

  // Render items twice for seamless wrap-around. Wrap point = scrollWidth / 2.
  const doubled = useMemo(() => [...items, ...items], [items])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    let last = performance.now()
    const SPEED_PX_PER_SEC = 9 // very slow, per spec
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const overflows = el.scrollWidth > el.clientWidth + 2
      const paused = now < pausedUntilRef.current || dragRef.current.active
      if (overflows && !paused) {
        const half = el.scrollWidth / 2
        // If the user dragged manually since our last write, sync our
        // accumulator to where the DOM actually is so we don't snap them
        // back to a stale position when auto-resumes.
        if (Math.abs(el.scrollLeft - Math.round(posRef.current)) > 2) {
          posRef.current = el.scrollLeft
        }
        posRef.current += SPEED_PX_PER_SEC * dt
        if (posRef.current >= half) posRef.current -= half
        el.scrollLeft = posRef.current
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [doubled.length])

  const pauseFor = (ms: number) => {
    pausedUntilRef.current = performance.now() + ms
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    dragRef.current = { startX: e.clientX, startScroll: el.scrollLeft, active: true }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !dragRef.current.active) return
    const dx = e.clientX - dragRef.current.startX
    let next = dragRef.current.startScroll - dx
    const half = el.scrollWidth / 2
    if (half > 0) {
      // Wrap into [0, half) so dragging past either edge keeps scrolling.
      next = ((next % half) + half) % half
    }
    el.scrollLeft = next
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    dragRef.current.active = false
    if (el) {
      try { el.releasePointerCapture(e.pointerId) } catch {}
    }
    pauseFor(2500)
  }

  return (
    <div
      ref={ref}
      className="topbar-ticker"
      onMouseEnter={() => pauseFor(60000)}
      onMouseLeave={() => pauseFor(0)}
      onWheel={() => pauseFor(2500)}
      onTouchStart={() => pauseFor(60000)}
      onTouchEnd={() => pauseFor(2500)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="topbar-ticker-track">
        {doubled.map((it, i) => {
          const sparkData = genSpark((i % items.length) + 3, 18, it.pos ? 1 : -1)
          return (
            <div key={`${it.sym}-${i}`} className="tk-item" aria-hidden={i >= items.length}>
              <span className="tk-sym">
                <CoinDot sym={it.sym} size={16} />
                {it.sym}
              </span>
              <span className="num" style={{ color: 'var(--text)' }}>{it.price}</span>
              <span className={'num ' + (it.pos ? 'pos-text' : 'neg-text')} style={{ fontSize: 12 }}>{it.delta}</span>
              <span className="tk-spark">
                <Spark data={sparkData} color={it.pos ? 'var(--pos)' : 'var(--neg)'} w={42} h={16} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StaxTopBar({ btcPrice, tickerItems = [] }: { btcPrice: number; tickerItems?: TickerAsset[] }) {
  const { latencyMs, connected } = useTickerStreamHealth()
  const tone = !connected ? 'stale' : latencyMs > 1000 ? 'high' : latencyMs > 500 ? 'mid' : 'good'
  const latencyTitle = connected
    ? `WebSocket round-trip: ${latencyMs}ms (sampled every 5s)`
    : 'Reconnecting to Bitget WebSocket — values fall back to a 5s REST poll'
  // Theme persists in localStorage; fall back to user's OS preference on
  // first visit. Without this, every nav/refresh forces dark and overrides
  // whatever the user picked last.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      const saved = localStorage.getItem('stax-theme')
      if (saved === 'light' || saved === 'dark') return saved
      // First visit: respect OS preference.
      if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
    } catch {}
    return 'dark'
  })
  const [lang, setLang] = useState<'ENG' | 'PT'>(() => {
    if (typeof window === 'undefined') return 'ENG'
    return (localStorage.getItem('stax-lang') === 'PT' ? 'PT' : 'ENG')
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const langRef = useRef<HTMLDivElement | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement | null>(null)
  // Notifications + last-seen-at (24h auto-dismiss). Mirrors v1
  // staxs_last_seen_notification_at logic in client-dashboard.html.
  const [notifications, setNotifications] = useState<Array<{ id: string; type: string; icon: string; timestamp: string; message: string; isWin?: boolean }>>([])
  const [seenAt, setSeenAt] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    const raw = localStorage.getItem('staxs_last_seen_notification_at')
    return raw ? new Date(raw).getTime() || 0 : 0
  })

  useEffect(() => {
    const html = document.documentElement
    if (theme === 'light') { html.classList.add('light'); html.classList.remove('dark') }
    else { html.classList.add('dark'); html.classList.remove('light') }
    try { localStorage.setItem('stax-theme', theme) } catch {}
    // Mirror to cookie so the SERVER can read it at SSR time and bake the
    // right html class into the initial response — eliminates FOUC entirely.
    // localStorage stays as a fallback for first-time visitors who have it
    // set but no cookie yet (the inline pre-paint script handles that case).
    try {
      document.cookie = `stax-theme=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
    } catch {}
  }, [theme])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('stax-lang', lang)
      document.documentElement.setAttribute('data-lang', lang.toLowerCase())
      // Notify subscribers (useT hook) — same-tab language change.
      window.dispatchEvent(new CustomEvent('stax-lang-change'))
    }
  }, [lang])

  // Close menu on outside click + Esc
  useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Same close-on-outside / Esc for the language dropdown.
  useEffect(() => {
    if (!langOpen) return
    function onClick(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLangOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [langOpen])

  // Close notif dropdown on outside / Esc — and mark all read on close.
  useEffect(() => {
    if (!notifOpen) return
    function onClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setNotifOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [notifOpen])

  // Fetch notifications on mount + every 60s. Source: /api/trades.
  // Uses a session-cached access token via supabase-browser; if unauth'd
  // (e.g. login screen) we silently skip rather than crash the topbar.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    async function load() {
      try {
        const { getAccessToken } = await import('@/lib/supabase-browser')
        const token = await getAccessToken()
        if (!token) return
        const res = await fetch('/api/trades?limit=20', {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json().catch(() => ({} as any))
        if (cancelled) return
        const list = (data?.notifications || []) as Array<any>
        setNotifications(list)
      } catch { /* silent */ }
    }
    load()
    timer = setInterval(load, 60_000)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [])

  // Unread count = items newer than max(seenAt, now-24h). Auto-dismiss old
  // items so the badge doesn't stick after multi-day-old trades.
  const AUTO_DISMISS_MS = 24 * 3600 * 1000
  const effectiveSeenAt = Math.max(seenAt, Date.now() - AUTO_DISMISS_MS)
  const unreadCount = notifications.filter(n => {
    const t = n.timestamp ? new Date(n.timestamp).getTime() : 0
    return t > effectiveSeenAt
  }).length

  // When the user opens the bell, persist the seenAt so unread badge clears.
  function handleNotifToggle() {
    if (!notifOpen && unreadCount > 0) {
      const iso = new Date().toISOString()
      try { localStorage.setItem('staxs_last_seen_notification_at', iso) } catch {}
      setSeenAt(Date.now())
    }
    setNotifOpen(o => !o)
  }

  const isPt = lang === 'PT'

  return (
    <div className="topbar">
      {/* Mobile-only brand on the left — desktop already shows the brand in
          the sidebar, so we hide this via CSS at >768px. */}
      <div className="topbar-brand">
        <img
          className="brand-mark-dark"
          src="/brand/staxs-icon-full-color-2048px.png"
          alt="Staxs"
          width={26}
          height={26}
        />
        <img
          className="brand-mark-light"
          src="/brand/staxs-icon-gold-transparent-2048px.png"
          alt="Staxs"
          width={26}
          height={26}
        />
        <span className="topbar-brand-name">staxs</span>
      </div>
      {/* Embedded ticker — fills the centre of the topbar on desktop. Drops
          to display:none at ≤768px (the .topbar-btc-pill below takes over).
          Auto-scrolls horizontally when content overflows; user can drag /
          wheel-scroll manually, which pauses the auto-scroll until idle.
          Live + latency badge sits OUTSIDE the scroll container so it stays
          pinned to the right edge. */}
      {tickerItems.length > 0 && (
        <>
          <ScrollingTicker items={tickerItems} />
          <div className="tk-end topbar-tk-end">
            <span>
              {connected
                ? <><span className="dot-live" /><span className="live">Live</span></>
                : <><span className="dot-stale" /><span style={{ color: 'var(--muted)' }}>Reconnecting</span></>}
            </span>
            <span
              className={`tk-latency tk-latency-${tone}`}
              title={latencyTitle}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icons.Signal size={13} />
              <span className="num" style={{ fontSize: 12 }}>{connected ? `${latencyMs}ms` : '—'}</span>
            </span>
          </div>
        </>
      )}
      <div className="topbar-spacer" />
      {/* BTC pill — mobile-only on desktop the top ticker carries all five
          coins, so this standalone chip is redundant. Below 768px the ticker
          is hidden (too noisy in a small viewport) and this pill takes over. */}
      <div className="pill topbar-btc-pill">
        <img
          src={COIN_ICON_SRC.BTC}
          alt="BTC"
          style={{ width: 18, height: 18, display: 'block', flex: '0 0 18px' }}
        />
        <span className="num" style={{ fontSize: 13 }}>${btcPrice.toLocaleString()}</span>
      </div>
      <div ref={notifRef} className="notif-wrap">
        <button
          type="button"
          className="icon-btn"
          aria-label={isPt ? 'Notificações' : 'Notifications'}
          aria-expanded={notifOpen}
          onClick={handleNotifToggle}
        >
          <Icons.Bell size={16} />
          {unreadCount > 0 ? <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
        </button>
        {notifOpen ? (
          <div className="notif-dropdown" role="menu">
            <div className="notif-dropdown-head">{isPt ? 'NOTIFICAÇÕES' : 'NOTIFICATIONS'}</div>
            <div className="notif-dropdown-list">
              {notifications.filter(n => {
                const t = n.timestamp ? new Date(n.timestamp).getTime() : 0
                return t > Date.now() - AUTO_DISMISS_MS
              }).slice(0, 5).map(n => (
                <div key={n.id} className="notif-dropdown-row">
                  <span className="notif-dropdown-icon"><NotifIcon n={n} /></span>
                  <div className="notif-dropdown-body">
                    <div className="notif-dropdown-msg">{n.message}</div>
                    <div className="notif-dropdown-ts">
                      {n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}
                    </div>
                  </div>
                </div>
              ))}
              {notifications.filter(n => {
                const t = n.timestamp ? new Date(n.timestamp).getTime() : 0
                return t > Date.now() - AUTO_DISMISS_MS
              }).length === 0 ? (
                <div className="notif-dropdown-empty">
                  <div className="ttl">{isPt ? 'Sem notificações novas' : 'No new notifications'}</div>
                  <div className="sub">{isPt ? 'Você está em dia.' : "You're all caught up."}</div>
                </div>
              ) : null}
            </div>
            <div className="notif-dropdown-divider" />
            <Link
              href="/settings?tab=notifications"
              prefetch
              className="notif-dropdown-settings"
              onClick={() => setNotifOpen(false)}
              role="menuitem"
            >
              <Icons.Gear size={14} />
              <span>{isPt ? 'Configurações de notificações' : 'Notification Settings'}</span>
            </Link>
          </div>
        ) : null}
      </div>
      {/* Language dropdown — Globe icon → menu with English / Português options.
          Ported verbatim from v1 client-dashboard.html (#langToggle / #langDropdown). */}
      <div ref={langRef} className="lang-wrap">
        <button
          className="icon-btn"
          aria-label={isPt ? 'Idioma' : 'Language'}
          title={lang}
          aria-expanded={langOpen}
          onClick={() => setLangOpen(o => !o)}
        >
          <Icons.Globe size={16} />
        </button>
        {langOpen ? (
          <div className="lang-menu" role="menu">
            <button
              type="button"
              className={'lang-option' + (lang === 'ENG' ? ' is-active' : '')}
              onClick={() => { setLang('ENG'); setLangOpen(false) }}
            >
              <span className="lang-option-label">
                <span>English</span>
                <span className="lang-option-meta">Default</span>
              </span>
              <span className="lang-option-code">EN</span>
            </button>
            <button
              type="button"
              className={'lang-option' + (lang === 'PT' ? ' is-active' : '')}
              onClick={() => { setLang('PT'); setLangOpen(false) }}
            >
              <span className="lang-option-label">
                <span>Português (Brasil)</span>
                <span className="lang-option-meta">Brasil</span>
              </span>
              <span className="lang-option-code">PT</span>
            </button>
          </div>
        ) : null}
      </div>
      {/* Theme: single icon button showing the CURRENT mode. Sun = light,
          Moon = dark. Click toggles. Matches v1 chrome. type="button"
          prevents implicit form-submit behaviour some browsers default to
          for a stray <button>; the .icon-btn class now includes
          appearance:none so Safari can no longer strip the pill background. */}
      <button
        type="button"
        className="icon-btn"
        aria-label={isPt ? (theme === 'light' ? 'Tema claro' : 'Tema escuro') : (theme === 'light' ? 'Light theme' : 'Dark theme')}
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      >
        {theme === 'light' ? <Icons.Sun size={16} /> : <Icons.Moon size={16} />}
      </button>
      {/* Hamburger menu — replaces the JD avatar. Opens a dropdown with the
          Settings sub-pages + Sign Out, mirroring v1's topMenuDropdown. */}
      <div ref={menuRef} className="menu-wrap">
        <button
          className="icon-btn menu-trigger"
          aria-label={isPt ? 'Menu' : 'Menu'}
          onClick={() => setMenuOpen(o => !o)}
          aria-expanded={menuOpen}
        >
          <Icons.Menu size={18} />
        </button>
        {menuOpen ? (
          <div className="menu-dropdown" role="menu">
            {SETTINGS_TABS.map(t => (
              <Link
                key={t.id}
                href={`/settings?tab=${t.id}`}
                prefetch
                className="menu-item"
                onClick={() => setMenuOpen(false)}
                role="menuitem"
              >
                {isPt ? t.labelPt : t.labelEn}
              </Link>
            ))}
            <div className="menu-divider" />
            <button
              type="button"
              className="menu-item menu-signout"
              onClick={() => { setMenuOpen(false); signOutAndRedirect() }}
              role="menuitem"
            >
              <Icons.LogOut size={14} /> {isPt ? 'Sair' : 'Sign Out'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ─── Mobile bottom nav (5 items, replaces sidebar at ≤768px) ────────────────

// Mobile labels are intentionally short (single word) to fit the bottom-nav
// width on phones. Backtest/Live use shorter labels than the full sidebar.
const MOBILE_NAV_ITEMS = [
  { id: 'dashboard', tKey: 'nav.dashboard',  shortEn: 'Dashboard', shortPt: 'Painel',     icon: Icons.Grid,      href: '/' },
  { id: 'live',      tKey: 'nav.live',       shortEn: 'Live',      shortPt: 'Ao Vivo',    icon: Icons.TrendUp,   href: '/live' },
  { id: 'backtest',  tKey: 'nav.backtesting',shortEn: 'Backtest',  shortPt: 'Backtest',   icon: Icons.Bars,      href: '/backtesting' },
  // BROKER PARKED 2026-09-02 — replaced by the Simulator, same slot.
  // { id: 'broker',    tKey: 'nav.broker',     shortEn: 'Broker',    shortPt: 'Parceiro',   icon: Icons.Briefcase, href: '/broker' },
  { id: 'simulator', tKey: 'nav.simulator',  shortEn: 'Simulator', shortPt: 'Simulador',  icon: Icons.Play,      href: '/simulator' },
  { id: 'settings',  tKey: 'nav.settings',   shortEn: 'Settings',  shortPt: 'Ajustes',    icon: Icons.Gear,      href: '/settings' },
] as const

// 2026-08-09: the bottom nav is the ONLY navigation at <=768px (the sidebar is replaced), and
// it had no Admin entry — so /admin was unreachable on a phone even for an admin. The route and
// its guard were always fine; nothing linked to it. Admins swap Broker for Admin rather than
// growing to a 6th item, which would break the fixed 5-column bottom-nav layout.
const MOBILE_ADMIN_ITEM = {
  id: 'admin', tKey: 'nav.admin', shortEn: 'Admin', shortPt: 'Admin',
  icon: Icons.Shield, href: '/admin',
} as const

function MobileBottomNav() {
  const pathname = usePathname()
  const t = useT()
  const { isAdmin } = useIsAdmin()
  // Admins: Simulator -> Admin (was Broker, parked 2026-09-02). Non-admins see the stock five.
  const navItems = useMemo(
    () => (isAdmin === true
      ? MOBILE_NAV_ITEMS.map(it => (it.id === 'simulator' ? MOBILE_ADMIN_ITEM : it))
      : MOBILE_NAV_ITEMS) as readonly (typeof MOBILE_NAV_ITEMS[number] | typeof MOBILE_ADMIN_ITEM)[],
    [isAdmin])
  // Read lang directly so we can pick the short label variant (different
  // from the full nav label, which is what t() returns).
  const lang = typeof window !== 'undefined' && localStorage.getItem('stax-lang') === 'PT' ? 'PT' : 'ENG'
  const [clientPath, setClientPath] = useState<string | null>(null)
  useEffect(() => {
    const raw = window.location.pathname
    const stripped = raw.startsWith('/v2') ? (raw.slice(3) || '/') : raw
    setClientPath(stripped)
  }, [pathname])
  const effectivePath = clientPath ?? pathname ?? '/'
  const activeId = navItems.find(it => {
    if (it.href === '/') return effectivePath === '/' || effectivePath === ''
    return effectivePath === it.href || effectivePath.startsWith(it.href + '/')
  })?.id ?? 'dashboard'

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {navItems.map(it => {
        const Ico = it.icon
        return (
          <Link
            key={it.id}
            href={it.href}
            prefetch
            className={'mb-item' + (activeId === it.id ? ' active' : '')}
          >
            <Ico size={20} />
            <span>{lang === 'PT' ? it.shortPt : it.shortEn}</span>
          </Link>
        )
      })}
    </nav>
  )
}

// ─── Footer (logo + tagline + links — desktop AND mobile) ───────────────────

function StaxFooter() {
  const t = useT()
  return (
    <footer className="stax-footer">
      <div className="stax-footer-brand">
        <img
          className="brand-mark-dark stax-footer-mark"
          src="/brand/staxs-icon-full-color-2048px.png"
          alt="Staxs"
          width={24}
          height={24}
        />
        <img
          className="brand-mark-light stax-footer-mark"
          src="/brand/staxs-icon-gold-transparent-2048px.png"
          alt="Staxs"
          width={24}
          height={24}
        />
        <span className="stax-footer-name">staxs</span>
      </div>
      <div className="stax-footer-tag">{t('footer.tagline')}</div>
      <div className="stax-footer-links">
        <a href="/terms">{t('footer.terms')}</a>
        <a href="/privacy">{t('footer.privacy')}</a>
        <a href="/risk">{t('footer.risk')}</a>
        <a href="mailto:support@staxs.ai">{t('footer.support')}</a>
      </div>
    </footer>
  )
}

// ─── Hero (Account Balance + Equity Curve) ──────────────────────────────────

type Range = '1M' | '3M' | '6M' | '1Y' | 'ALL'

const RANGE_DAYS: Record<Range, number | null> = {
  '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': null,
}

function simulateRange(
  trades: Array<{ exitTs: number; pnl: number }> | undefined,
  userCapital: number,
  strategyBase: number,
  range: Range,
  /** The curve's hard left edge: the moment the current settings became effective. */
  effectiveFromMs?: number | null,
): { points: EquityPoint[]; labels: string[]; summary: string; startTs?: number } {
  if (!trades || trades.length === 0 || userCapital <= 0) {
    return { points: [], labels: [], summary: 'No data' }
  }
  const days = RANGE_DAYS[range]
  // THE RANGE CAN SHORTEN THE WINDOW BUT NEVER EXTEND IT PAST THE EFFECTIVE DATE. Picking ALL or
  // 1Y on an account configured last month must not imply a year of history under these settings;
  // it shows everything there is, which starts at the effective moment.
  const rangeCutoff = days != null ? Date.now() - days * 86400_000 : 0
  const cutoff = effectiveFromMs != null && Number.isFinite(effectiveFromMs)
    ? Math.max(rangeCutoff, effectiveFromMs)
    : rangeCutoff
  const filtered = trades.filter(t => t.exitTs >= cutoff)
  if (filtered.length === 0) {
    return { points: [], labels: [], summary: `No trades in ${range}` }
  }

  const scale = strategyBase > 0 ? userCapital / strategyBase : 1
  // Anchor the curve's first point AT the effective moment when we know it, so the left edge is
  // the configuration change itself rather than a day before the first close that happened to
  // follow it.
  const startTs = (effectiveFromMs != null && Number.isFinite(effectiveFromMs)
                   && effectiveFromMs <= filtered[0].exitTs)
    ? effectiveFromMs
    : filtered[0].exitTs - 86400_000
  let eq = userCapital
  const points: EquityPoint[] = [{ ts: startTs, value: userCapital, month: '' }]

  // Walk all filtered trades but sample down to ~150 chart points so the SVG
  // path stays smooth. Equity is updated on every trade for accuracy; only
  // the displayed point density is reduced.
  const SAMPLE_TARGET = 150
  const step = Math.max(1, Math.floor(filtered.length / SAMPLE_TARGET))
  for (let i = 0; i < filtered.length; i++) {
    eq += filtered[i].pnl * scale
    if (i % step === 0 || i === filtered.length - 1) {
      points.push({ ts: filtered[i].exitTs, value: Math.round(eq * 100) / 100, month: '' })
    }
  }

  // X-axis labels — pick 5–7 evenly spaced ticks. Format "DD MMM YY" matches
  // the design reference (e.g. "02 Apr 26"). For ALL-time view we also drop
  // the year suffix on the second line if needed.
  // LABEL THE AXIS THE CURVE ACTUALLY SPANS. These were sampled from `filtered` (the trades),
  // while the first PLOTTED point is anchored at the effective-settings moment — so with an
  // effective date in March and the first close in September the curve began in March and the
  // leftmost label read 03 Sep. Deriving the labels from the point timestamps keeps the two in
  // step by construction.
  const labelCount = range === '1M' ? 5 : range === '3M' ? 5 : range === '6M' ? 6 : 7
  const labels: string[] = []
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((i / (labelCount - 1)) * (points.length - 1))
    // EquityPoint.ts is optional in the type; every point built above carries one, and the
    // fallback keeps the axis honest rather than throwing if a caller ever supplies one without.
    const pts = points[idx]?.ts
    if (pts == null) continue
    const d = new Date(pts)
    const day = String(d.getDate()).padStart(2, '0')
    const mon = d.toLocaleString('en-US', { month: 'short' })
    const yr = String(d.getFullYear()).slice(2)
    labels.push(`${day} ${mon} ${yr}`)
  }

  return { points, labels, summary: '' /* Hero builds the footer string per design */, startTs }
}

/**
 * MEASURE THE CONTAINER, don't assume 780px.
 *
 * The equity chart was rendered with a hardcoded `width={780}` viewBox and
 * `preserveAspectRatio="none"`, so on a 360px phone the SVG was squeezed to 46% of its authored
 * width: the y-axis labels and the date row were horizontally compressed into unreadable slivers
 * and the 38px axis gutter ate a tenth of the screen. Passing the MEASURED width makes the viewBox
 * match the rendered box, so nothing is distorted at any size.
 */
function useMeasuredWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW(Math.max(220, Math.round(el.getBoundingClientRect().width)))
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width: w }
}

function Hero({ data }: { data: StaxDashboardData }) {
  const t = useT()
  const [range, setRange] = useState<Range>('6M')
  const ranges: Range[] = ['1M', '3M', '6M', '1Y', 'ALL']
  // Scale progress against the user's mission target (default 1 BTC). A user
  // with a 5 BTC target shouldn't see a full bar at 1 BTC.
  const target = data.btcGoalTarget && data.btcGoalTarget > 0 ? data.btcGoalTarget : 1
  const pct = Math.min(1, Math.max(0, data.btcGoal / target))

  const eq = useMeasuredWidth(780)
  const sim = useMemo(() => {
    // 2026-07-06: curve = FORWARD closed trades (equityTrades, → today) starting from
    // equityBase (wizard initial-capital for connected / $10k for new) — NOT the frozen
    // backtest set and NOT the current balance. Falls back to the old inputs if a caller
    // (mock) doesn't supply the new ones.
    // REAL ACCOUNT ONLY when the user has traded. The old code fell back to
    // `portfolioTrades` — the STRATEGY's backtest — whenever equityTrades was empty, while the
    // caption below still read "Your $X balance". That presented strategy performance as the
    // user's own. A real account NEVER silently borrows the strategy's curve.
    const isReal = !!data.equityIsReal && !!data.equityTrades && data.equityTrades.length > 0
    const curveBase = (data.equityBase && data.equityBase > 0) ? data.equityBase : data.balanceUsd
    const effMs = data.equityEffectiveFrom ? Date.parse(data.equityEffectiveFrom) : null
    if (isReal) {
      // strategyBase === curveBase for a real account: the user's own realised P&L is already in
      // their own dollars and must not be rescaled by the strategy's $10k notional base.
      return { ...simulateRange(data.equityTrades!, curveBase, curveBase, range,
                                Number.isFinite(effMs as number) ? effMs : null), isReal: true }
    }
    // No real trades yet → the illustrative strategy curve, LABELLED as illustrative.
    if (data.portfolioTrades && data.portfolioTrades.length > 0) {
      return { ...simulateRange(data.portfolioTrades, data.strategyBase || 10000, data.strategyBase || 10000, range), isReal: false }
    }
    // Fallback: use precomputed equityCurve if a caller (mock data) provides it.
    return {
      points: data.equityCurve || [],
      labels: data.equityMonthLabels || [],
      summary: data.equityRangeLabel,
      isReal: false,
    }
  }, [data.equityTrades, data.equityIsReal, data.equityBase, data.portfolioTrades, data.balanceUsd, data.strategyBase, data.equityCurve, data.equityMonthLabels, data.equityRangeLabel, data.equityEffectiveFrom, range])

  // EXPLICIT, in this order: an author-declared state wins; then a genuine empty; then ok.
  // 'empty' and 'error' are different facts and are never collapsed into one another.
  const equityState: 'ok' | 'loading' | 'error' | 'empty' =
    data.equityStatus && data.equityStatus !== 'ok'
      ? data.equityStatus
      : (sim.points && sim.points.length > 1) || data.allowSyntheticEquity === true
        ? 'ok'
        : 'empty'
  const endingEquity = sim.points && sim.points.length
    ? sim.points[sim.points.length - 1].value
    : null

  return (
    <div className="row row-hero">
      {data.degraded && (
        <div style={{
          gridColumn: '1 / -1', marginBottom: 12, padding: '10px 14px',
          background: '#422006', color: '#fde68a', border: '1px solid #ca8a04',
          borderRadius: 8, fontSize: 13, fontWeight: 600,
        }}>
          ⚠ UPSTREAM DEGRADED — {data.degradedWarning || 'some data is served from local sources.'}
          {data.balanceSource ? ` Balance source: ${data.balanceSource}` : ''}
          {typeof data.balanceAgeSeconds === 'number' ? ` (${data.balanceAgeSeconds}s old).` : ''}
          {' '}Figures shown are real; nothing here is a fabricated zero.
        </div>
      )}
      {/* Balance + BTC Goal */}
      <div className={'card balance-card card-pad' + (data.isPreview ? ' is-preview' : '')} data-tour="balance" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* Subtle Staxs icon watermark — only shown for connected users so it
            doesn't muddy the "preview" badge. Sits in the empty space between
            the tier pill and BTC goal. Pointer-events:none so clicks pass
            through to the surrounding text. */}
        {!data.isPreview && (
          <img
            src="/brand/staxs-icon-gold-transparent-2048px.png"
            alt=""
            aria-hidden="true"
            className="balance-watermark"
          />
        )}
        {/* Preview indicator — pill in the top-right corner of the card. The
            watermark above and this pill are mutually exclusive: preview state
            gets the pill, connected state gets the icon. */}
        {data.isPreview && (
          <div className="balance-preview-pill" title="The strategy's backtest is shown here. Connect your account to see your real balance.">
            <span className="balance-preview-dot" />
            BACKTEST PREVIEW
          </div>
        )}
        <div className="label">{t('card.accountBalance')}</div>
        <div className="hero-balance">${data.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        {/* Tier pill only shows once the user has actually activated a bot and
            chosen a tier. In preview mode (no keys / no activation) the hook
            falls back to a default 'conservative' label which would mislead
            a brand-new user into thinking they've already picked a tier. */}
        {!data.isPreview && (
          <span
            className="tier-pill"
            style={{ alignSelf: 'flex-start', height: 35, padding: '7px 12px', fontWeight: 500, borderRadius: 999, lineHeight: 1.4, fontSize: 12.5, gap: 8 }}
          >
            <Icons.Star size={13} className="star" /> {data.tierLabel}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div className="btc-goal" data-tour="mission">
          <div className="btc-row">
            <span className="label">{t('card.btcGoal')}</span>
            <span className="btc-amt num">{data.btcGoal.toFixed(4)} BTC</span>
          </div>
          <div className="slider">
            <div className="slider-fill" style={{ width: pct * 100 + '%' }} />
            <div className="slider-thumb" style={{ left: pct * 100 + '%' }}>
              <img
                src={COIN_ICON_SRC.BTC}
                alt=""
                style={{ width: '100%', height: '100%', display: 'block', borderRadius: '50%' }}
              />
            </div>
          </div>
          <div className="slider-ends">
            <span>0 BTC</span>
            <span>{target} BTC</span>
          </div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className="card equity-card card-pad" data-tour="equity-curve">
        <div className="equity-head">
          <div className="label">{t('card.equityCurve')}</div>
          <div className="seg">
            {ranges.map(r => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div ref={eq.ref} style={{ flex: 1, minHeight: 0 }}>
          <EquityChart
            data={sim.points}
            range={range}
            width={eq.width}
            height={190}
            monthLabels={sim.labels}
            allowSynthetic={data.allowSyntheticEquity === true}
            state={equityState}
            stateMessage={data.equityError}
          />
        </div>
        {/* THE BASIS IS ON THE SAME LINE AS THE FIGURE (§BASIS). A curve without its period and
            accounting basis is not a reportable number — the reader cannot tell a real account from
            a strategy illustration, nor a compounding curve from a fixed-stake one. */}
        <div className="equity-foot" style={{ color: equityState !== 'ok' ? 'var(--muted)' : (sim.isReal ? 'var(--muted)' : '#d9a441') }}>
          {equityState === 'loading' ? (
            <>LOADING — no figure is shown until your trades are read</>
          ) : equityState === 'error' ? (
            <>COULD NOT LOAD YOUR EQUITY — this is a read failure, not a zero balance</>
          ) : equityState === 'empty' ? (
            <>NO CLOSED TRADES YET · your curve starts at your first close</>
          ) : sim.isReal ? (
            <>
              {/* NAME THE QUANTITY AND ITS PERIOD. This curve is the equity recorded when the
                  current bot settings became effective, plus the REALISED closes of trades OPENED
                  under those settings. The balance card above is live exchange equity: it also
                  carries open-position P&L, trades from earlier configurations, and any deposits
                  or withdrawals. They are different quantities and they will not match — saying so
                  is the difference between a reconciliation and a contradiction. */}
              STRATEGY EQUITY, CURRENT SETTINGS · ${endingEquity != null ? endingEquity.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
              {' '}= ${(data.equityBase || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} at activation + realised closes
              {data.equityEffectiveFrom ? (
                <> {' · '}since {new Date(data.equityEffectiveFrom).toISOString().slice(0, 10)}</>
              ) : null}
              {' · '}{range === 'ALL' ? 'all of it' : `last ${range.toLowerCase()}`}
              {!data.isPreview && (<>{' · '}{data.tierLabel.split('·')[0]?.trim() || data.tierLabel}</>)}
              {' · '}non-compounding
              <div style={{ marginTop: 2, fontSize: 10, opacity: 0.75 }}>
                Account balance ${data.balanceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} differs:
                it includes open-position P&amp;L and any deposits or withdrawals, and is not bounded
                to these settings.
                {(data.equityExcludedBeforeEffective ?? 0) > 0
                  ? ` ${data.equityExcludedBeforeEffective} earlier close${data.equityExcludedBeforeEffective === 1 ? '' : 's'} from a previous configuration excluded.`
                  : ''}
                {(data.equityCarriedCount ?? 0) > 0
                  ? ` ${data.equityCarriedCount} position${data.equityCarriedCount === 1 ? '' : 's'} carried across the change (${(data.equityCarriedPnl ?? 0) >= 0 ? '+' : ''}$${Math.abs(data.equityCarriedPnl ?? 0).toLocaleString()}) counted separately, not in the curve.`
                  : ''}
                {(data.equityUnattributableCount ?? 0) > 0
                  ? ` ${data.equityUnattributableCount} close${data.equityUnattributableCount === 1 ? '' : 's'} carry no open timestamp and cannot be attributed to a configuration.`
                  : ''}
              </div>
            </>
          ) : (
            <>ILLUSTRATIVE BACKTEST — NO LIVE TRADES YET · not your account history · $
              {(data.strategyBase || 10000).toLocaleString()} non-compounding basis</>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── StatsRow ───────────────────────────────────────────────────────────────

// Map stat labels to data-tour ids so the OnboardingTour can spotlight
// the right card. Labels come from use-stax-dashboard-data and stay in
// English — translations don't affect the selector.
const STAT_TOUR_ID: Record<string, string> = {
  'Bot Status':     'bot-status',
  'Unrealized PnL': 'unrealized-pnl',
  'Realized PnL':   'realized-pnl',
  'Total Return':   'total-return',
}

function StatsRow({ stats }: { stats: StatCardSpec[] }) {
  const t = useT()
  // Translate the sub which is sometimes templated (e.g. "9656 closed", "1 leg open")
  function tSub(sub: string): string {
    const direct = t(sub)
    if (direct !== sub) return direct
    return sub
      .replace(/\bclosed\b/g, t('status.closed'))
      .replace(/\blegs open\b/g, t('status.openPos'))
      .replace(/\bleg open\b/g, t('status.openPosOne'))
  }
  return (
    <div className="row row-stats">
      {stats.map((s, i) => {
        const Ico = s.icon
        const tourId = STAT_TOUR_ID[s.label]
        return (
          <div key={i} className="card stat-card" {...(tourId ? { 'data-tour': tourId } : {})}>
            <div className="stat-head">
              <div className="stat-ico"><Ico size={16} /></div>
              <div className="label">{t(s.label)}</div>
            </div>
            <div className={'stat-val num' + (s.valueClass ? ' ' + s.valueClass : '')}>{s.value}</div>
            <div className="stat-sub">{tSub(s.sub)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tables ─────────────────────────────────────────────────────────────────

// Coin logos — RESOLVED by the ONE shared resolver (lib/coinIcon), 2026-09-05.
// This was a hand-kept map, one of FOUR, which is why AAVE/ATOM/BCH/ETC/FIL/LTC/XLM were blank on
// every page. All 29 basket assets are now vendored under /coin-icons; the resolver falls back to
// the CDN for anything new. basePath '/v2' is still applied by Next to the relative URLs.
const COIN_ICON_SRC: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_t, k: string) => coinIconUrl(String(k)) ?? '',
  has: (_t, k: string) => !!coinIconUrl(String(k)),
})


function CoinDot({ sym, size = 22 }: { sym: CoinSym; size?: number }) {
  // Wrapper enforces the size — the inner <img> can't break out because the
  // box has fixed dimensions + overflow:hidden + flex-shrink:0. Without this,
  // table-cell rules + Tailwind preflight would let the SVG stretch.
  return (
    <span
      aria-label={sym}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        display: 'inline-block',
        borderRadius: '50%',
        overflow: 'hidden',
        background: '#0e0e13',
        verticalAlign: 'middle',
      }}
    >
      <img
        src={COIN_ICON_SRC[sym]}
        alt=""
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
      />
    </span>
  )
}

// Open Positions and Recent Trades share identical columns (Pair · Side ·
// Size · Entry · Exit · P&L · %). For Open Positions the Exit cell shows
// a pulsing OPEN label; for Recent Trades it shows the actual exit price
// stacked over its timestamp. The standalone Time column was removed —
// timestamps live below entry/exit prices via `.bt-price-cell`.
function OpenPositions({ rows }: { rows: Position[] }) {
  const t = useT()
  return (
    <div className="card" data-tour="open-positions" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-pad" style={{ paddingBottom: 6 }}>
        <div className="label">{t('card.openPositions')}</div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Side</th>
              <th className="hide-mobile">Size</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&amp;L</th>
              <th className="hide-mobile">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>{t('status.noOpen')}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="bt-trade-open">
                <td>
                  <div className="pair-cell" title={r.pair}>
                    <CoinDot sym={r.sym} size={16} />
                  </div>
                </td>
                <td><span className={'badge ' + (r.side === 'LONG' ? 'badge-long' : 'badge-short')}>{r.side}</span></td>
                <td className="num hide-mobile">{r.size}</td>
                <td className="num bt-price-cell">
                  {r.entry}
                  {r.entryTs ? <span className="ts">{r.entryTs}</span> : null}
                </td>
                <td className="num bt-price-cell">
                  <span className="bt-open-label"><span className="dot" />OPEN</span>
                </td>
                <td className={'num ' + (r.pos ? 'pos-text' : 'neg-text')}>
                  <div>{r.pnl}</div>
                  <div className="pnl-pct-stacked">{r.pnlPct}</div>
                </td>
                <td className={'num hide-mobile ' + (r.pos ? 'pos-text' : 'neg-text')}>{r.pnlPct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ flex: 1 }} />
      <div className="table-foot">
        {rows.length} {rows.length === 1 ? t('status.openPosOne') : t('status.openPos')}
      </div>
    </div>
  )
}

function RecentTrades({ rows }: { rows: Trade[] }) {
  const t = useT()
  return (
    <div className="card" data-tour="recent-trades" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-pad" style={{ paddingBottom: 6 }}>
        <div className="label">{t('card.recentTrades')}</div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Side</th>
              <th className="hide-mobile">Size</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&amp;L</th>
              <th className="hide-mobile">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>{t('status.noTrades')}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className={r.pos ? 'bt-trade-win' : 'bt-trade-loss'}>
                <td><div className="pair-cell" title={r.pair}><CoinDot sym={r.sym} size={16} /></div></td>
                <td><span className={'badge ' + (r.side === 'LONG' ? 'badge-long' : 'badge-short')}>{r.side}</span></td>
                <td className="num hide-mobile">{r.size}</td>
                <td className="num bt-price-cell">
                  {r.entry}
                  {r.entryTs ? <span className="ts">{r.entryTs}</span> : null}
                </td>
                <td className="num bt-price-cell">
                  {r.exit}
                  {r.exitTs ? <span className="ts">{r.exitTs}</span> : null}
                </td>
                <td className={'num ' + (r.pos ? 'pos-text' : 'neg-text')}>
                  <div>{r.pnl}</div>
                  <div className="pnl-pct-stacked">{r.pnlPct}</div>
                </td>
                <td className={'num hide-mobile ' + (r.pos ? 'pos-text' : 'neg-text')}>{r.pnlPct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-foot" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>
        <span>{rows.length} {rows.length === 1 ? t('status.recentTradeC') : t('status.recentTradesC')}</span>
        <Link
          href="/live"
          style={{
            color: 'var(--gold)',
            fontWeight: 600,
            fontSize: 12,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >{t('status.seeMore')}</Link>
      </div>
    </div>
  )
}

function TablesRow({ positions, trades }: { positions: Position[]; trades: Trade[] }) {
  return (
    <div className="row row-tables">
      <OpenPositions rows={positions} />
      <RecentTrades rows={trades} />
    </div>
  )
}

// ─── Bottom row ─────────────────────────────────────────────────────────────

// All three bottom cards anchor their big number to the SAME top offset so
// the digits ("0.00x", "65%", "68%", "+1W") sit on a perfect horizontal line.
// The trick: every card's bottom-body uses flex-column + justify-content:
// flex-start with a fixed paddingTop. Secondary content (sub-line / gauge /
// dots) renders below or — for the gauge — absolutely positioned on the right.
const NUMBER_ROW_PADDING_TOP = 12

function LeverageCard({ value, max }: { value: number; max?: number }) {
  const t = useT()
  const upper = max ?? Math.max(4, Math.ceil(value * 1.3))
  return (
    <div className="card card-pad bottom-card">
      <div className="label">{t('card.currentLeverage')}</div>
      <div className="bottom-body lev-body" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: NUMBER_ROW_PADDING_TOP }}>
        <div className="bottom-val num" style={{ color: value > 0 ? 'var(--gold)' : 'var(--muted)' }}>
          {value.toFixed(2)}x
        </div>
        <div className="lev-gauge">
          <LeverageGauge value={value} max={upper} scale={0.9} />
        </div>
      </div>
    </div>
  )
}

function WinRateCard({ label, pct, wins, losses }: { label: string; pct: number; wins: number; losses: number }) {
  const t = useT()
  return (
    <div className="card card-pad bottom-card">
      <div className="label">{label}</div>
      <div className="bottom-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: NUMBER_ROW_PADDING_TOP }}>
        <div className="bottom-val num" style={{ color: 'var(--gold)' }}>{pct}%</div>
        <div className="stat-sub num" style={{ color: 'var(--muted)', marginTop: 6 }}>{wins} {t('status.wins')}, {losses} {t('status.losses')}</div>
      </div>
    </div>
  )
}

function StreakCard({ value, sub, recent, recentLabels, isWin }: { value: string; sub: string; recent: Array<'W' | 'L' | 'OW' | 'OL'>; recentLabels?: string[]; isWin: boolean }) {
  const t = useT()
  return (
    <div className="card card-pad bottom-card">
      <div className="label">{t('card.currentStreak')}</div>
      <div className="bottom-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: NUMBER_ROW_PADDING_TOP }}>
        <div className="bottom-val num" style={{ color: isWin ? 'var(--pos)' : 'var(--neg)' }}>{value}</div>
        <div className="stat-sub" style={{ color: 'var(--muted)', marginTop: 6 }}>{sub}</div>
      </div>
      <div className="streak-dots">
        {recent.map((c, i) => {
          const isOpen = c === 'OW' || c === 'OL'
          const isW = c === 'W' || c === 'OW'
          const label = recentLabels?.[i] || ''
          // data-tip drives the CSS-only tooltip in stax-design.css (instant
          // on hover, unlike the native title attribute which has a 1-2s
          // delay). aria-label keeps it accessible.
          return <span key={i} className={'sd ' + (isW ? 'w' : 'l') + (isOpen ? ' open' : '')} data-tip={label || undefined} aria-label={label} />
        })}
      </div>
    </div>
  )
}

function BottomRow({ data }: { data: StaxDashboardData }) {
  const t = useT()
  return (
    <div className="row row-bottom" data-tour="win-rate">
      <LeverageCard value={data.leverage} max={data.leverageMax} />
      <WinRateCard label={t('card.winRate20')} {...data.winRate20} />
      <WinRateCard label={t('card.winRate50')} {...data.winRate50} />
      <StreakCard {...data.streak} />
    </div>
  )
}

// ─── Ticker ─────────────────────────────────────────────────────────────────

function Ticker({ items, className }: { items: TickerAsset[]; className?: string }) {
  // Live state from the shared WS stream singleton. `connected` flips the
  // dot/label between "Live" and "Reconnecting" so the indicator is honest
  // about whether prices are flowing right now. `latencyMs` is real WS
  // ping/pong RTT (was hardcoded "28" before) — colour-codes the signal
  // icon so a quick glance tells you whether the feed is healthy.
  const { latencyMs, connected } = useTickerStreamHealth()
  const tone = !connected ? 'stale' : latencyMs > 1000 ? 'high' : latencyMs > 500 ? 'mid' : 'good'
  const latencyTitle = connected
    ? `WebSocket round-trip: ${latencyMs}ms (sampled every 5s)`
    : 'Reconnecting to Bitget WebSocket — values fall back to a 5s REST poll'
  return (
    <div className={'ticker' + (className ? ' ' + className : '')}>
      {items.map((it, i) => {
        const sparkData = genSpark(i + 3, 18, it.pos ? 1 : -1)
        return (
          <div key={i} className="tk-item">
            <span className="tk-sym">
              <CoinDot sym={it.sym} size={18} />
              {it.sym}
            </span>
            <span className="num" style={{ color: 'var(--text)' }}>{it.price}</span>
            <span className={'num ' + (it.pos ? 'pos-text' : 'neg-text')} style={{ fontSize: 12 }}>{it.delta}</span>
            <span className="tk-spark">
              <Spark data={sparkData} color={it.pos ? 'var(--pos)' : 'var(--neg)'} w={42} h={16} />
            </span>
          </div>
        )
      })}
      <div className="tk-end">
        <span>
          {connected
            ? <><span className="dot-live" /><span className="live">Live</span></>
            : <><span className="dot-stale" /><span style={{ color: 'var(--muted)' }}>Reconnecting</span></>}
        </span>
        <span
          className={`tk-latency tk-latency-${tone}`}
          title={latencyTitle}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icons.Signal size={13} />
          <span className="num" style={{ fontSize: 12 }}>{connected ? `${latencyMs}ms` : '—'}</span>
        </span>
      </div>
    </div>
  )
}

// ─── App shell + composition ────────────────────────────────────────────────

/**
 * App shell — sidebar + topbar + ticker. Use as a layout wrapper around
 * route content. The `.stax-app` class scopes the design system away from
 * the rest of v2's styling.
 */
export function StaxAppShell({
  children,
  btcPrice,
  ticker,
  activeNav,
}: {
  children: React.ReactNode
  btcPrice?: number
  ticker?: TickerAsset[]
  activeNav?: string
}) {
  const polled = usePublicTickers(30000)
  const resolvedBtcPrice = typeof btcPrice === 'number' && btcPrice > 0
    ? btcPrice
    : polled.find(t => t.short === 'BTC')?.price ?? 0
  const resolvedTicker = ticker ?? publicToTickerAssets(polled)

  // Hide the price ticker on Settings — user prefers a quieter chrome there.
  // Strip the basePath /v2 prefix so the suffix-match works against the route's
  // actual path (NAV_ITEMS hrefs are stored prefix-less for the same reason).
  const shellPath = usePathname() || ''
  const cleanShellPath = shellPath.startsWith('/v2') ? shellPath.slice(3) || '/' : shellPath
  const showTicker = !cleanShellPath.startsWith('/settings')

  // Sidebar collapsed/expanded — persisted in localStorage so it survives nav.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem('stax-sidebar-collapsed') === '1') setCollapsed(true)
    } catch {}
  }, [])

  // Cursor-tracking spotlight on .card hover. One delegated mousemove handler
  // walks up to the nearest .card and writes --mx/--my CSS vars, which the
  // .card::after radial-gradient reads for its center point. rAF-throttled
  // so we never write twice in the same frame; pointer event listeners are
  // also passive so they don't block scrolling.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(hover: hover)').matches) return
    let raf = 0
    let lastEvent: MouseEvent | null = null
    function flush() {
      raf = 0
      const e = lastEvent
      if (!e) return
      const card = (e.target as HTMLElement)?.closest?.('.stax-app .card') as HTMLElement | null
      if (!card) return
      const rect = card.getBoundingClientRect()
      card.style.setProperty('--mx', `${e.clientX - rect.left}px`)
      card.style.setProperty('--my', `${e.clientY - rect.top}px`)
    }
    function onMove(e: MouseEvent) {
      lastEvent = e
      if (raf === 0) raf = requestAnimationFrame(flush)
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('stax-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }

  return (
    <div className={'stax-app' + (collapsed ? ' collapsed' : '')}>
      <div className="app-grid">
        <StaxSidebar
          active={activeNav}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
        <div className="main">
          <StaxTopBar
            btcPrice={resolvedBtcPrice}
            tickerItems={showTicker ? resolvedTicker : []}
          />
          <div className="content">{children}</div>
          <StaxFooter />
        </div>
      </div>
      <MobileBottomNav />
    </div>
  )
}

/**
 * Just the dashboard page content — Hero + StatsRow + TablesRow + BottomRow.
 * Use this inside StaxAppShell when rendering the dashboard route.
 *
 * Live ticker overlay: positions arrive from the data hook with an entry
 * snapshot (entryNum/sizeUnits/dir). Here we re-derive PnL on every
 * ticker tick using the current public ticker price, so the open
 * positions table updates in real time without re-fetching anything.
 */
export function StaxDashboardContent({ data }: { data: StaxDashboardData }) {
  const tickers = usePublicTickers(30000)
  const { state: wiz, loaded: wizLoaded } = useWizardState()
  const tickerByPair = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tickers) m[t.symbol] = t.price
    return m
  }, [tickers])

  const livePositions = useMemo<Position[]>(() => {
    return data.positions.map(p => {
      const tickerPx = tickerByPair[p.pair] || 0
      // If the data hook didn't surface raw fields (loading state, sample
      // data, or strategy-fallback positions), pass the existing formatted
      // values through unchanged.
      if (!tickerPx || !p.entryNum || !p.sizeUnits || !p.dir) return p
      const pnlUsd = (tickerPx - p.entryNum) * p.sizeUnits * p.dir
      const pnlPct = ((tickerPx - p.entryNum) / p.entryNum) * 100 * p.dir
      const fmtUsd = (v: number) => {
        const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        return v >= 0 ? `+$${abs}` : `−$${abs}`
      }
      const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
      const fmtMark = (n: number) => {
        if (!Number.isFinite(n) || n === 0) return '$—'
        if (n < 1) return `$${n.toFixed(4)}`
        if (n < 100) return `$${n.toFixed(2)}`
        return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      }
      return {
        ...p,
        mark: fmtMark(tickerPx),
        pnl: fmtUsd(pnlUsd),
        pnlPct: fmtPct(pnlPct),
        pos: pnlUsd >= 0,
      }
    })
  }, [data.positions, tickerByPair])

  // 2026-05-26 Live Unrealized PnL: sum live-recomputed PnL across open
  // positions (livePositions already merged ticker prices in the useMemo
  // above). Override the static value baked into data.stats by the hook
  // so the card moves with every ticker tick, in sync with the position
  // rows. Mirrors the same fix applied to LiveTrading page's StatsRow.
  const liveStats = useMemo(() => {
    if (!data.stats) return data.stats
    const liveUnrealized = livePositions.reduce((sum, p) => {
      // Extract numeric pnl from the formatted string (e.g., "−$25.91" → -25.91).
      const raw = (p.pnl || '').replace(/[^0-9.\-−]/g, '').replace('−', '-')
      const n = parseFloat(raw)
      return sum + (Number.isFinite(n) ? n : 0)
    }, 0)
    return data.stats.map(s => {
      if (s.label !== 'Unrealized PnL') return s
      // Don't override the "$0 / No open position" empty state.
      if (livePositions.length === 0) return s
      const abs = Math.abs(liveUnrealized).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const value = liveUnrealized >= 0 ? `+$${abs}` : `−$${abs}`
      const valueClass: 'pos' | 'neg' = liveUnrealized >= 0 ? 'pos' : 'neg'
      return { ...s, value, valueClass }
    })
  }, [data.stats, livePositions])

  return (
    <div className="stax-page">
      <OnboardingBanner />
      {/* Ported 2026-09-03: hidden unless something is actually owed. */}
      <InvoiceDueBanner />
      <Hero data={data} />
      <StatsRow stats={liveStats} />
      <TablesRow positions={livePositions} trades={data.trades} />
      <BottomRow data={data} />
      {wizLoaded && (
        <OnboardingTourController
          step1Complete={wiz.step1_complete}
          step3Complete={wiz.step3_complete}
          tour1Complete={wiz.tour1_complete}
          tour1Dismissed={wiz.tour1_dismissed}
          tour2Complete={wiz.tour2_complete}
          tour2Dismissed={wiz.tour2_dismissed}
        />
      )}
    </div>
  )
}

/**
 * Full Stax dashboard — convenience composition (shell + dashboard content).
 * For most routes prefer using StaxAppShell as a layout and a route-specific
 * content component.
 */
export function StaxDashboard({ data = SAMPLE_STAX_DATA, activeNav = 'dashboard' }: { data?: StaxDashboardData; activeNav?: string }) {
  return (
    <StaxAppShell btcPrice={data.btcPrice} ticker={data.ticker} activeNav={activeNav}>
      <StaxDashboardContent data={data} />
    </StaxAppShell>
  )
}
