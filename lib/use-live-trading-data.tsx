'use client'

import { useEffect, useState } from 'react'
import { authedFetch, browserClient } from './api'
import { usePublicTickers, type PublicTicker } from './use-public-tickers'

const V1_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'SUIUSDT'] as const
type V1Symbol = typeof V1_SYMBOLS[number]
type CoinShort = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'SUI'

const SHORT: Record<V1Symbol, CoinShort> = {
  BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', XRPUSDT: 'XRP', SUIUSDT: 'SUI',
}

export type LiveTrade = {
  id: string
  sym: CoinShort
  pair: string
  side: 'LONG' | 'SHORT'
  entry: number
  exit: number | null
  sizeUsd: number
  sizeUnits: number
  pnlUsd: number
  pnlPct: number
  status: 'open' | 'closed' | 'pending_fill' | 'cancelled'
  openedAt: number | null
  closedAt: number | null
  reason: string | null
  pyramided: boolean
  pos: boolean        // true if pnlUsd >= 0
}

export type ActivePosition = LiveTrade & {
  markPrice: number
  unrealizedUsd: number
  unrealizedPct: number
  durationMs: number
  slPrice?: number
}

export type AssetState = {
  sym: CoinShort
  symbol: V1Symbol
  side: 'LONG' | 'SHORT' | 'FLAT'
  entry?: number
  entryTs?: number
  sl?: number
  pyramided?: boolean
  staleMs?: number
  /** Live mark price from the public ticker (only set for non-FLAT rows). */
  markPrice?: number
  /** Per-leg USD notional (activation_balance × tier mult, ×2 if pyramided). */
  notionalUsd?: number
  /** Estimated unrealised USD pnl using the user's per-leg notional from
   *  bot_config (activation_balance × tier multiplier, doubled if pyramided). */
  unrealizedUsd?: number
  /** Unrealised pct return on entry (independent of size). */
  unrealizedPct?: number
}

export type LiveTradingData = {
  active: ActivePosition | null
  closed: LiveTrade[]
  open: LiveTrade[]
  totals: {
    realizedPnl: number
    realizedPct: number
    closedCount: number
    winRate: number
    wins: number
    losses: number
    bestTrade: number
    worstTrade: number
    avgWin: number
    avgLoss: number
  }
  assetStates: AssetState[]
  startCapital: number
  currentEquity: number
  unrealizedPnl: number
  lastUpdatedMs: number
}

export type LiveLoadState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'no-keys' }
  | { status: 'no-bot' }
  | { status: 'ready'; data: LiveTradingData }
  | { status: 'error'; message: string }

type RawTrade = {
  id: string
  symbol: string
  side: 'long' | 'short'
  entry_price: number | string | null
  exit_price: number | string | null
  size_usd: number | string | null
  pnl_usd: number | string | null
  pnl_pct: number | string | null
  status: string
  opened_at: string | null
  closed_at: string | null
  metadata?: { slPx?: number; pyramided?: boolean; reason?: string }
}

type StrategyStateResp = {
  positions: Array<{
    symbol: string
    side: 'long' | 'short'
    entry: number
    sl?: number
    entryTs: number
    pyramided?: boolean
    updatedAt: number
  }>
}

function symToShort(symbol: string): CoinShort {
  const s = symbol.replace('USDT', '') as CoinShort
  return (['BTC', 'ETH', 'SOL', 'XRP', 'SUI'] as const).includes(s) ? s : 'BTC'
}

function normalize(t: RawTrade): LiveTrade {
  const entry = Number(t.entry_price || 0)
  const exit = t.exit_price != null ? Number(t.exit_price) : null
  const sizeUsd = Number(t.size_usd || 0)
  const sizeUnits = entry > 0 ? sizeUsd / entry : 0
  const pnlUsd = Number(t.pnl_usd || 0)
  const pnlPct = Number(t.pnl_pct || 0)
  return {
    id: t.id,
    sym: symToShort(t.symbol),
    pair: t.symbol,
    side: t.side === 'long' ? 'LONG' : 'SHORT',
    entry,
    exit,
    sizeUsd,
    sizeUnits,
    pnlUsd,
    pnlPct,
    status: (t.status as LiveTrade['status']) || 'closed',
    openedAt: t.opened_at ? new Date(t.opened_at).getTime() : null,
    closedAt: t.closed_at ? new Date(t.closed_at).getTime() : null,
    reason: t.metadata?.reason || null,
    pyramided: !!t.metadata?.pyramided,
    pos: pnlUsd >= 0,
  }
}

export function useLiveTradingData(): LiveLoadState {
  const [state, setState] = useState<LiveLoadState>({ status: 'loading' })
  const tickers = usePublicTickers(15000)
  const tickersKey = tickers.map(t => `${t.symbol}:${t.price.toFixed(2)}`).join(',')

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    async function load() {
      try {
        const sb = browserClient()
        const { data: { session } } = await sb.auth.getSession()
        if (!session) { if (!cancelled) setState({ status: 'unauthenticated' }); return }

        const [botRes, balanceRes, tradesRes, stateRes] = await Promise.all([
          authedFetch<{ activated?: boolean; config?: { tier?: string; preset?: string; leverage?: number; activation_balance?: number } | null }>('/api/bot-activate').catch(() => null),
          authedFetch<{ equity?: number; available?: number; unrealizedPnl?: number; error?: string }>('/api/balance').catch((e: Error) => ({ error: e.message })),
          // Bitget = single source of truth. /api/trades-live reads the user's
          // open positions + position history straight from the exchange so
          // entry, exit, size, and PnL are exact (no DB drift). See
          // DESIGN_SYSTEM.md → Data Architecture.
          authedFetch<{ trades: RawTrade[] }>('/api/trades-live?limit=500').catch(() => ({ trades: [] as RawTrade[] })),
          fetch('/api/strategy-state').then(r => r.ok ? r.json() : { positions: [] }).catch(() => ({ positions: [] })) as Promise<StrategyStateResp>,
        ])
        if (cancelled) return

        if (balanceRes && 'error' in balanceRes && /no api keys/i.test(balanceRes.error || '')) {
          setState({ status: 'no-keys' }); return
        }
        if (!botRes?.activated || !botRes?.config) { setState({ status: 'no-bot' }); return }

        const cfg = botRes.config
        const hasErr = balanceRes && 'error' in balanceRes && balanceRes.error
        const balance = hasErr ? null : (balanceRes as { equity?: number; available?: number; unrealizedPnl?: number })
        const equity = Number(balance?.equity || 0)
        const unrealizedPnl = Number(balance?.unrealizedPnl || 0)

        const all = (tradesRes?.trades || []).map(normalize)
        const open = all.filter(t => t.status === 'open')
        const closed = all.filter(t => t.status === 'closed')

        const tickerByPair: Record<string, PublicTicker | undefined> = {}
        tickers.forEach(t => { tickerByPair[t.symbol] = t })

        let active: ActivePosition | null = null
        if (open.length > 0) {
          const t = open[0]
          const mark = tickerByPair[t.pair]?.price || t.entry
          const dir = t.side === 'LONG' ? 1 : -1
          const unrealizedUsd = (mark - t.entry) * t.sizeUnits * dir
          const unrealizedPct = t.entry > 0 ? ((mark - t.entry) / t.entry) * 100 * dir : 0
          // Pull SL from raw trade row metadata via the originating row
          const raw = (tradesRes?.trades || []).find(r => r.id === t.id)
          active = {
            ...t,
            markPrice: mark,
            unrealizedUsd: Math.round(unrealizedUsd * 100) / 100,
            unrealizedPct: Math.round(unrealizedPct * 100) / 100,
            durationMs: t.openedAt ? Date.now() - t.openedAt : 0,
            slPrice: raw?.metadata?.slPx,
          }
        }

        const wins = closed.filter(t => t.pnlUsd > 0)
        const losses = closed.filter(t => t.pnlUsd <= 0)
        const realizedPnl = closed.reduce((s, t) => s + t.pnlUsd, 0)
        const startCapital = Number(cfg.activation_balance || 0)
        const realizedPct = startCapital > 0 ? (realizedPnl / startCapital) * 100 : 0
        const wsum = wins.reduce((s, t) => s + t.pnlUsd, 0)
        const lsum = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0))
        const bestTrade = wins.length ? Math.max(...wins.map(t => t.pnlUsd)) : 0
        const worstTrade = losses.length ? Math.min(...losses.map(t => t.pnlUsd)) : 0
        const avgWin = wins.length ? wsum / wins.length : 0
        const avgLoss = losses.length ? lsum / losses.length : 0

        const stateBySym: Record<string, StrategyStateResp['positions'][number]> = {}
        for (const p of (stateRes?.positions || [])) stateBySym[p.symbol] = p

        // Per-leg notional = activation balance × tier multiplier. Conservative
        // 0.5×, Bold 1.0×, Aggressive 1.5× — matches the daemon's tier-sizing
        // canonical. Pyramided positions are roughly 2× exposure.
        const TIER_MULT: Record<string, number> = { conservative: 0.5, bold: 1.0, aggressive: 1.5 }
        const tierKey = ((cfg.tier || cfg.preset || 'conservative') as string).toLowerCase()
        const tierMult = TIER_MULT[tierKey] ?? 0.5
        const baseNotional = (Number(cfg.activation_balance) || 10000) * tierMult

        const assetStates: AssetState[] = V1_SYMBOLS.map(sym => {
          const st = stateBySym[sym]
          if (!st) return { sym: SHORT[sym], symbol: sym, side: 'FLAT' }
          const mark = tickerByPair[sym]?.price ?? st.entry
          const dir = st.side === 'long' ? 1 : -1
          const unrealizedPct = st.entry > 0 ? ((mark - st.entry) / st.entry) * 100 * dir : 0
          const notional = baseNotional * (st.pyramided ? 2 : 1)
          const unrealizedUsd = st.entry > 0 ? ((mark - st.entry) / st.entry) * notional * dir : 0
          return {
            sym: SHORT[sym],
            symbol: sym,
            side: st.side === 'long' ? 'LONG' : 'SHORT',
            entry: st.entry,
            entryTs: st.entryTs,
            sl: st.sl,
            pyramided: !!st.pyramided,
            staleMs: st.updatedAt ? Date.now() - st.updatedAt : undefined,
            markPrice: mark,
            notionalUsd: notional,
            unrealizedUsd: Math.round(unrealizedUsd * 100) / 100,
            unrealizedPct: Math.round(unrealizedPct * 100) / 100,
          }
        })

        const data: LiveTradingData = {
          active,
          closed,
          open,
          totals: {
            realizedPnl,
            realizedPct,
            closedCount: closed.length,
            winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
            wins: wins.length,
            losses: losses.length,
            bestTrade,
            worstTrade,
            avgWin,
            avgLoss,
          },
          assetStates,
          startCapital,
          currentEquity: equity,
          unrealizedPnl,
          lastUpdatedMs: Date.now(),
        }
        setState({ status: 'ready', data })
      } catch (e: any) {
        if (cancelled) return
        setState({ status: 'error', message: e?.message || 'Failed to load live trading' })
      }
    }

    load()
    intervalId = window.setInterval(load, 30000)
    return () => { cancelled = true; if (intervalId !== null) window.clearInterval(intervalId) }
    // Empty deps — load() only fires on mount + every 30s via interval.
    // Re-running on tickersKey was hammering the API (3+ authed fetches
    // + a 4 MB portfolio JSON fetch) on every Bitget ticker tick — page
    // would hang for minutes under live stream. Mark prices for open
    // positions update via separate ticker overlay in render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
