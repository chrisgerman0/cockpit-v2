'use client'

/* Pixel-faithful port of Claude Design Stax Dashboard.html.
   Composes the same DOM/CSS structure as the design prototype but expressed
   as React components with TypeScript types. The visual layer is owned by
   stax-design.css (scoped under .stax-app); these components only emit the
   markup the design expects. */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import './stax-design.css'
import { Icons } from './Icons'
import { EquityChart, LeverageGauge, Spark, genSpark, type EquityPoint } from './Charts'
import { usePublicTickers, useTickerStreamHealth, type PublicTicker } from '@/lib/use-public-tickers'
import { browserClient } from '@/lib/supabase-browser'
import { useT } from '@/lib/i18n'

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$—'
  if (n < 1) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
function publicToTickerAssets(rows: PublicTicker[]): TickerAsset[] {
  return rows.map(r => ({
    sym: r.short,
    price: fmtPrice(r.price),
    delta: `${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}%`,
    pos: r.change >= 0,
  }))
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type TradeSide = 'LONG' | 'SHORT'
export type CoinSym = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'SUI'

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
  // Top bar
  btcPrice: number
  // Hero
  balanceUsd: number
  tierLabel: string                  // "Bold tier · 1.0× of balance"
  btcGoal: number                    // 0..1 (fraction of 1 BTC)
  // Equity Curve — projected from user's balance through the strategy.
  // Simulator semantics: "if you'd put $balanceUsd in N months ago, where
  // would you be now?" Each strategy trade's pnl is scaled by
  // (balanceUsd / strategyBase) to reflect proportional sizing.
  portfolioTrades?: Array<{ exitTs: number; pnl: number }>
  strategyBase?: number              // strategy account base ($10k by default)
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
  streak: { value: string; sub: string; recent: Array<'W' | 'L' | 'OW' | 'OL'>; isWin: boolean }
  // Ticker
  ticker: TickerAsset[]
  // System status (sidebar foot)
  systemsOnline: boolean
}

// ─── Sample data — used by the design preview at /design and as a fallback. ─

export const SAMPLE_STAX_DATA: StaxDashboardData = {
  btcPrice: 76318,
  balanceUsd: 10247.83,
  tierLabel: 'Bold tier · 1.0× of balance',
  btcGoal: 0.0621,
  equityRangeLabel: "6M Performance (Nov 18, 2023 - May 18, 2024)",
  stats: [
    { label: 'Bot Status', value: <span className="pos-text"><span className="dot-live" />Active</span>, sub: 'Watching', icon: Icons.Robot },
    { label: 'Unrealized PnL', value: '$0', sub: 'No open position', icon: Icons.TrendUp },
    { label: 'Realized PnL', value: '$0', sub: 'No trades yet', icon: Icons.Check },
    { label: 'Total Return', value: '+4,438%', sub: 'All time', icon: Icons.TrendUp, valueClass: 'pos' },
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
  { id: 'broker',    tKey: 'nav.broker',      icon: Icons.Briefcase, href: '/broker' },
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
  window.location.href = '/login'
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
  return (
    <aside className="side">
      <div className="brand">
        {/* Dark mode logo: gold S on dark/full-colour bg.
            Light mode logo: transparent gold-only S (no dark backing). */}
        <img
          className="brand-mark-dark"
          src="/v2/brand/staxs-icon-full-color-2048px.png"
          alt="Staxs"
          width={30}
          height={30}
        />
        <img
          className="brand-mark-light"
          src="/v2/brand/staxs-icon-gold-transparent-2048px.png"
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
      {NAV_ITEMS.map(it => {
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

function StaxTopBar({ btcPrice, tickerItems = [] }: { btcPrice: number; tickerItems?: TickerAsset[] }) {
  const { latencyMs, connected } = useTickerStreamHealth()
  const tone = !connected ? 'stale' : latencyMs > 400 ? 'high' : latencyMs > 200 ? 'mid' : 'good'
  const latencyTitle = connected
    ? `WebSocket round-trip: ${latencyMs}ms (sampled every 5s)`
    : 'Reconnecting to Bitget WebSocket — values fall back to a 5s REST poll'
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [lang, setLang] = useState<'ENG' | 'PT'>(() => {
    if (typeof window === 'undefined') return 'ENG'
    return (localStorage.getItem('stax-lang') === 'PT' ? 'PT' : 'ENG')
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const langRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const html = document.documentElement
    if (theme === 'light') { html.classList.add('light'); html.classList.remove('dark') }
    else { html.classList.add('dark'); html.classList.remove('light') }
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

  const isPt = lang === 'PT'

  return (
    <div className="topbar">
      {/* Mobile-only brand on the left — desktop already shows the brand in
          the sidebar, so we hide this via CSS at >768px. */}
      <div className="topbar-brand">
        <img
          className="brand-mark-dark"
          src="/v2/brand/staxs-icon-full-color-2048px.png"
          alt="Staxs"
          width={26}
          height={26}
        />
        <img
          className="brand-mark-light"
          src="/v2/brand/staxs-icon-gold-transparent-2048px.png"
          alt="Staxs"
          width={26}
          height={26}
        />
        <span className="topbar-brand-name">staxs</span>
      </div>
      {/* Embedded ticker — fills the centre of the topbar on desktop. Drops
          to display:none at ≤768px (the .topbar-btc-pill below takes over). */}
      {tickerItems.length > 0 && (
        <div className="topbar-ticker">
          {tickerItems.map((it, i) => {
            const sparkData = genSpark(i + 3, 18, it.pos ? 1 : -1)
            return (
              <div key={it.sym} className="tk-item">
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
      <button className="icon-btn" aria-label="Notifications">
        <Icons.Bell size={16} />
      </button>
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
          Moon = dark. Click toggles. Matches v1 chrome. */}
      <button
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
  { id: 'broker',    tKey: 'nav.broker',     shortEn: 'Broker',    shortPt: 'Parceiro',   icon: Icons.Briefcase, href: '/broker' },
  { id: 'settings',  tKey: 'nav.settings',   shortEn: 'Settings',  shortPt: 'Ajustes',    icon: Icons.Gear,      href: '/settings' },
] as const

function MobileBottomNav() {
  const pathname = usePathname()
  const t = useT()
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
  const activeId = MOBILE_NAV_ITEMS.find(it => {
    if (it.href === '/') return effectivePath === '/' || effectivePath === ''
    return effectivePath === it.href || effectivePath.startsWith(it.href + '/')
  })?.id ?? 'dashboard'

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {MOBILE_NAV_ITEMS.map(it => {
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
          src="/v2/brand/staxs-icon-full-color-2048px.png"
          alt="Staxs"
          width={24}
          height={24}
        />
        <img
          className="brand-mark-light stax-footer-mark"
          src="/v2/brand/staxs-icon-gold-transparent-2048px.png"
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
): { points: EquityPoint[]; labels: string[]; summary: string } {
  if (!trades || trades.length === 0 || userCapital <= 0) {
    return { points: [], labels: [], summary: 'No data' }
  }
  const days = RANGE_DAYS[range]
  const cutoff = days != null ? Date.now() - days * 86400_000 : 0
  const filtered = trades.filter(t => t.exitTs >= cutoff)
  if (filtered.length === 0) {
    return { points: [], labels: [], summary: `No trades in ${range}` }
  }

  const scale = strategyBase > 0 ? userCapital / strategyBase : 1
  const startTs = filtered[0].exitTs - 86400_000
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
  const labelCount = range === '1M' ? 5 : range === '3M' ? 5 : range === '6M' ? 6 : 7
  const labels: string[] = []
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((i / (labelCount - 1)) * (filtered.length - 1))
    const d = new Date(filtered[idx].exitTs)
    const day = String(d.getDate()).padStart(2, '0')
    const mon = d.toLocaleString('en-US', { month: 'short' })
    const yr = String(d.getFullYear()).slice(2)
    labels.push(`${day} ${mon} ${yr}`)
  }

  return { points, labels, summary: '' /* Hero builds the footer string per design */ }
}

function Hero({ data }: { data: StaxDashboardData }) {
  const t = useT()
  const [range, setRange] = useState<Range>('6M')
  const ranges: Range[] = ['1M', '3M', '6M', '1Y', 'ALL']
  const pct = Math.min(1, Math.max(0, data.btcGoal))

  const sim = useMemo(() => {
    if (data.portfolioTrades && data.portfolioTrades.length > 0) {
      return simulateRange(data.portfolioTrades, data.balanceUsd, data.strategyBase || 10000, range)
    }
    // Fallback: use precomputed equityCurve if a caller (mock data) provides it.
    return {
      points: data.equityCurve || [],
      labels: data.equityMonthLabels || [],
      summary: data.equityRangeLabel,
    }
  }, [data.portfolioTrades, data.balanceUsd, data.strategyBase, data.equityCurve, data.equityMonthLabels, data.equityRangeLabel, range])

  return (
    <div className="row row-hero">
      {/* Balance + BTC Goal */}
      <div className="card balance-card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="label">{t('card.accountBalance')}</div>
        <div className="hero-balance">${data.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <span
          className="tier-pill"
          style={{ alignSelf: 'flex-start', height: 35, padding: '7px 12px', fontWeight: 500, borderRadius: 999, lineHeight: 1.4, fontSize: 12.5, gap: 8 }}
        >
          <Icons.Star size={13} className="star" /> {data.tierLabel}
        </span>
        <div style={{ flex: 1 }} />
        <div className="btc-goal">
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
            <span>1 BTC</span>
          </div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className="card equity-card card-pad">
        <div className="equity-head">
          <div className="label">{t('card.equityCurve')}</div>
          <div className="seg">
            {ranges.map(r => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <EquityChart data={sim.points} range={range} width={780} height={190} monthLabels={sim.labels} />
        </div>
        <div className="equity-foot" style={{ color: 'var(--muted)' }}>
          Your ${data.balanceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} balance
          {' · '}{data.tierLabel.split('·')[0]?.trim() || data.tierLabel}
          {' · '}last {range.toLowerCase()}
        </div>
      </div>
    </div>
  )
}

// ─── StatsRow ───────────────────────────────────────────────────────────────

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
        return (
          <div key={i} className="card stat-card">
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

// Real coin logos. BTC/ETH/XRP via the cryptocurrency-icons CDN (same set the
// v1 dashboard uses); SOL/SUI fall back to local PNGs (CDN package doesn't
// ship SUI). basePath '/v2' is automatically prefixed by Next on relative
// /coin-icons/ URLs because they're served as plain <img>.
const COIN_ICON_SRC: Record<CoinSym, string> = {
  BTC: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
  ETH: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg',
  XRP: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/xrp.svg',
  SOL: '/v2/coin-icons/sol.png',
  SUI: '/v2/coin-icons/sui.png',
}

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
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
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
                  <div className="pair-cell">
                    <CoinDot sym={r.sym} size={16} />
                    <span className="num">{r.pair}</span>
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
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
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
                <td><div className="pair-cell"><CoinDot sym={r.sym} size={16} /><span className="num">{r.pair}</span></div></td>
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
          <LeverageGauge value={value} max={upper} scale={0.72} />
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

function StreakCard({ value, sub, recent, isWin }: { value: string; sub: string; recent: Array<'W' | 'L' | 'OW' | 'OL'>; isWin: boolean }) {
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
          return <span key={i} className={'sd ' + (isW ? 'w' : 'l') + (isOpen ? ' open' : '')} />
        })}
      </div>
    </div>
  )
}

function BottomRow({ data }: { data: StaxDashboardData }) {
  const t = useT()
  return (
    <div className="row row-bottom">
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
  const tone = !connected ? 'stale' : latencyMs > 400 ? 'high' : latencyMs > 200 ? 'mid' : 'good'
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
 */
export function StaxDashboardContent({ data }: { data: StaxDashboardData }) {
  return (
    <div className="stax-page">
      <Hero data={data} />
      <StatsRow stats={data.stats} />
      <TablesRow positions={data.positions} trades={data.trades} />
      <BottomRow data={data} />
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
