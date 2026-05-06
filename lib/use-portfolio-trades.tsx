'use client'

import { useEffect, useState } from 'react'

/**
 * Strategy backtest trades (the Satoshi Stacker ledger), sourced from the
 * static JSON the multi-asset-backtest daemon publishes every 60s. This is
 * the SAME data source the Backtesting page reads — so Recent Trades on the
 * dashboard and the Trade History on Live Trading mirror what the strategy
 * is doing, not the user's personal Bitget executions.
 *
 * Strategy: V1 Satoshi Stacker — VolumeProfile breakout + per-asset BB-width
 * filter (BTC=5 / ETH=7 / SOL=7 / XRP=4 / SUI=4) on 4H closes.
 *
 * Tier maps to the right file:
 *   Conservative → /data/strategies/satoshi-stacker/portfolio-trades.json
 *   Bold         → /data/strategies/satoshi-stacker/tiers/bold/portfolio-trades.json
 *   Aggressive   → /data/strategies/satoshi-stacker/tiers/aggressive/portfolio-trades.json
 */

export type PortfolioTrade = {
  dir: 1 | -1
  pnl: number
  entryTs: number
  exitTs: number
  reason: string
  pyramided: boolean
  pyramid21Added?: boolean
  pyramid50Added?: boolean
  entryPx: number
  exitPx: number
  notional: number
  mfePct: number
  returnPct: number
  tierMult: number
  displayReason: string
  symbol: string         // e.g. BTCUSDT
  type: string           // 'hb'
  source?: string
}

export type Tier = 'conservative' | 'bold' | 'aggressive'

function pathForTier(tier: Tier): string {
  if (tier === 'conservative') return '/data/strategies/satoshi-stacker/portfolio-trades.json'
  return `/data/strategies/satoshi-stacker/tiers/${tier}/portfolio-trades.json`
}

// Tiny in-memory cache shared across hooks — daemon refreshes every 60s, so
// 60s here is fine. Avoids re-downloading 4.5MB on every component mount.
type CacheEntry = { fetchedAt: number; trades: PortfolioTrade[] }
const cache = new Map<Tier, CacheEntry>()
const CACHE_MS = 60_000

export async function fetchPortfolioTrades(tier: Tier): Promise<PortfolioTrade[]> {
  const cached = cache.get(tier)
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.trades
  const res = await fetch(pathForTier(tier), { cache: 'no-store' })
  if (!res.ok) throw new Error(`portfolio-trades fetch failed: ${res.status}`)
  const trades: PortfolioTrade[] = await res.json()
  cache.set(tier, { fetchedAt: Date.now(), trades })
  return trades
}

export type PortfolioLoad =
  | { status: 'loading' }
  | { status: 'ready'; trades: PortfolioTrade[] }
  | { status: 'error'; message: string }

export function usePortfolioTrades(tier: Tier): PortfolioLoad {
  const [state, setState] = useState<PortfolioLoad>(() => {
    const c = cache.get(tier)
    if (c) return { status: 'ready', trades: c.trades }
    return { status: 'loading' }
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const trades = await fetchPortfolioTrades(tier)
        if (!cancelled) setState({ status: 'ready', trades })
      } catch (e: any) {
        if (!cancelled) setState({ status: 'error', message: e?.message || 'Failed to load' })
      }
    }
    load()
    const id = window.setInterval(load, 90_000) // refresh every 90s (daemon publishes every 60s)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [tier])

  return state
}
