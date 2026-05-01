'use client'

import { useEffect, useState } from 'react'

/**
 * BTC top-bar chip. Uses mock fallback and can poll Bitget when reachable.
 */
export function BtcChip() {
  const [price, setPrice] = useState(76318)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetch('https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES', { cache: 'no-store' })
        const payload = (await response.json()) as { data?: Array<{ lastPr?: string }> }
        const next = Number(payload.data?.[0]?.lastPr)
        if (!cancelled && Number.isFinite(next)) setPrice(next)
      } catch {
        setPrice(76318)
      }
    }
    load()
    const id = window.setInterval(load, 30000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return (
    <div className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-background/55 px-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">₿</span>
      <span className="num text-sm font-semibold">${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
    </div>
  )
}
