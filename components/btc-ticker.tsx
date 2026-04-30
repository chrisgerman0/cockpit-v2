'use client'

import { useEffect, useState } from 'react'

/**
 * BTC price chip. Polls Bitget's public ticker endpoint every 10 seconds.
 * Mirrors the chip in the existing client-dashboard.html top bar so the
 * v2 cockpit feels familiar.
 *
 * Keeps the previous price for delta colouring (green if up, rose if down)
 * — the kind of small detail that sells "polished".
 */
export function BtcTicker() {
  const [price, setPrice] = useState<number | null>(null)
  const [delta, setDelta] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    let cancelled = false
    let prev = 0

    async function fetchPrice() {
      try {
        const r = await fetch(
          'https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES',
          { cache: 'no-store' }
        )
        const j = await r.json()
        const last = parseFloat(j?.data?.[0]?.lastPr)
        if (!Number.isFinite(last) || cancelled) return
        if (prev > 0) setDelta(last > prev ? 'up' : last < prev ? 'down' : null)
        prev = last
        setPrice(last)
      } catch {
        // Silent fail — don't blow up the top bar over a transient API blip.
      }
    }

    fetchPrice()
    const t = setInterval(fetchPrice, 10_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const colorCls =
    delta === 'up' ? 'text-emerald-500 dark:text-emerald-400' :
    delta === 'down' ? 'text-rose-500 dark:text-rose-400' :
    'text-zinc-700 dark:text-zinc-200'

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/60">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-zinc-950 text-[11px] font-bold">
        ₿
      </span>
      <span className={`text-sm font-semibold tabular-nums transition-colors ${colorCls}`}>
        {price != null ? '$' + price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
      </span>
    </div>
  )
}
