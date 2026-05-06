'use client'

import { useEffect, useState } from 'react'

const V1_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'SUIUSDT'] as const
type V1Symbol = typeof V1_SYMBOLS[number]

export type PublicTicker = {
  symbol: V1Symbol
  short: 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'SUI'
  price: number
  change: number   // percent (e.g. 2.18 means +2.18%)
}

const SHORT: Record<V1Symbol, PublicTicker['short']> = {
  BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', XRPUSDT: 'XRP', SUIUSDT: 'SUI',
}

// ─── Singleton WebSocket store ──────────────────────────────────────────────
//
// One WS connection shared across every consumer (Ticker, dashboard hook,
// live trading hook). React subscriber count drives lifecycle: first
// listener opens WS, last unmount stops it (with a ~1s grace so React
// Strict Mode unmount/remount doesn't churn the connection).
//
// REST polling is the fallback path — it runs only when WS is unavailable
// or disconnected. So in steady state this code makes zero HTTP requests.

type State = {
  tickers: PublicTicker[]
  latencyMs: number
  connected: boolean
}

const initialTickers: PublicTicker[] = V1_SYMBOLS.map(s => ({
  symbol: s, short: SHORT[s], price: 0, change: 0,
}))

const store: State = {
  tickers: initialTickers,
  latencyMs: 0,
  connected: false,
}

const listeners = new Set<() => void>()
let ws: WebSocket | null = null
let reconnectTimer: number | null = null
let pingTimer: number | null = null
let stopTimer: number | null = null
let pollFallbackTimer: number | null = null
let pingSentAt = 0

function notify() { listeners.forEach(l => l()) }

async function fetchOneRest(symbol: V1Symbol): Promise<{ price: number; change: number } | null> {
  try {
    const res = await fetch(
      `https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`,
      { cache: 'no-store' },
    )
    const j = await res.json() as { data?: Array<{ lastPr?: string; change24h?: string }> }
    const t = j?.data?.[0]
    if (!t) return null
    const price = Number(t.lastPr || 0)
    const change = Number(t.change24h || 0) * 100
    if (!Number.isFinite(price) || price <= 0) return null
    return { price, change }
  } catch { return null }
}

async function pollFallbackOnce() {
  const results = await Promise.all(V1_SYMBOLS.map(s => fetchOneRest(s).then(r => ({ symbol: s, r }))))
  let changed = false
  const next = store.tickers.map(t => {
    const hit = results.find(x => x.symbol === t.symbol)
    if (hit?.r && (hit.r.price !== t.price || hit.r.change !== t.change)) {
      changed = true
      return { ...t, price: hit.r.price, change: hit.r.change }
    }
    return t
  })
  if (changed) {
    store.tickers = next
    notify()
  }
}

function startPollFallback() {
  if (pollFallbackTimer != null) return
  pollFallbackOnce()
  pollFallbackTimer = window.setInterval(pollFallbackOnce, 5000)
}

function stopPollFallback() {
  if (pollFallbackTimer != null) {
    window.clearInterval(pollFallbackTimer)
    pollFallbackTimer = null
  }
}

function connectWs() {
  if (typeof window === 'undefined') return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  let nextWs: WebSocket
  try {
    nextWs = new WebSocket('wss://ws.bitget.com/v2/ws/public')
  } catch {
    startPollFallback()
    return
  }
  ws = nextWs

  nextWs.onopen = () => {
    if (ws !== nextWs) return
    stopPollFallback()
    const sub = {
      op: 'subscribe',
      args: V1_SYMBOLS.map(s => ({ instType: 'USDT-FUTURES', channel: 'ticker', instId: s })),
    }
    try { nextWs.send(JSON.stringify(sub)) } catch {}
    store.connected = true
    notify()
    // Bitget v2 keepalive: send "ping" text, server replies "pong". Use the
    // round-trip to populate the latency indicator. 5s cadence is well under
    // their 30s idle-disconnect threshold.
    pingTimer = window.setInterval(() => {
      if (nextWs.readyState === WebSocket.OPEN) {
        pingSentAt = performance.now()
        try { nextWs.send('ping') } catch {}
      }
    }, 5000)
  }

  nextWs.onmessage = (ev) => {
    if (ws !== nextWs) return
    const text = typeof ev.data === 'string' ? ev.data : ''
    if (!text) return
    if (text === 'pong') {
      const rtt = Math.max(0, Math.round(performance.now() - pingSentAt))
      if (rtt !== store.latencyMs) {
        store.latencyMs = rtt
        notify()
      }
      return
    }
    try {
      const msg = JSON.parse(text) as {
        action?: string
        arg?: { channel?: string; instId?: string }
        data?: Array<{ instId?: string; lastPr?: string; change24h?: string }>
      }
      if (msg?.arg?.channel !== 'ticker' || !msg.data?.length) return
      const tick = msg.data[0]
      const symbol = tick.instId as V1Symbol | undefined
      if (!symbol) return
      const idx = store.tickers.findIndex(t => t.symbol === symbol)
      if (idx === -1) return
      const price = Number(tick.lastPr || 0)
      const change = Number(tick.change24h || 0) * 100
      if (!Number.isFinite(price) || price <= 0) return
      const cur = store.tickers[idx]
      if (cur.price === price && cur.change === change) return
      store.tickers = [
        ...store.tickers.slice(0, idx),
        { ...cur, price, change },
        ...store.tickers.slice(idx + 1),
      ]
      notify()
    } catch {}
  }

  nextWs.onerror = () => {
    // onclose handles reconnect / fallback
  }

  nextWs.onclose = () => {
    if (pingTimer != null) { window.clearInterval(pingTimer); pingTimer = null }
    if (ws === nextWs) ws = null
    if (store.connected) { store.connected = false; notify() }
    if (listeners.size === 0) return
    // Keep prices fresh while WS is down + try to reconnect
    startPollFallback()
    if (reconnectTimer == null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        connectWs()
      }, 2000)
    }
  }
}

function start() {
  // Immediate REST hit so consumers see prices instantly while WS handshakes
  pollFallbackOnce()
  connectWs()
}

function stop() {
  if (reconnectTimer != null) { window.clearTimeout(reconnectTimer); reconnectTimer = null }
  if (pingTimer != null) { window.clearInterval(pingTimer); pingTimer = null }
  stopPollFallback()
  if (ws) {
    ws.onclose = null
    try { ws.close() } catch {}
    ws = null
  }
  if (store.connected) { store.connected = false; notify() }
}

function subscribe(listener: () => void): () => void {
  // Cancel any pending stop — handles React Strict Mode unmount/remount
  if (stopTimer != null) { window.clearTimeout(stopTimer); stopTimer = null }
  listeners.add(listener)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopTimer = window.setTimeout(() => {
        stopTimer = null
        if (listeners.size === 0) stop()
      }, 1000)
    }
  }
}

// ─── Public hooks ───────────────────────────────────────────────────────────

/**
 * Live tickers for the V1 basket. Backed by a Bitget WebSocket stream with
 * a REST poll fallback. The `intervalMs` argument is kept for backwards
 * compatibility but ignored — updates flow as the exchange ticks.
 */
export function usePublicTickers(_intervalMs?: number): PublicTicker[] {
  const [snapshot, setSnapshot] = useState<PublicTicker[]>(store.tickers)
  useEffect(() => subscribe(() => setSnapshot(store.tickers)), [])
  return snapshot
}

export type TickerStreamHealth = { latencyMs: number; connected: boolean }

/** Subscribe to the same WS stream and observe its health (RTT + connected). */
export function useTickerStreamHealth(): TickerStreamHealth {
  const [snapshot, setSnapshot] = useState<TickerStreamHealth>({
    latencyMs: store.latencyMs,
    connected: store.connected,
  })
  useEffect(() => subscribe(() => setSnapshot({
    latencyMs: store.latencyMs,
    connected: store.connected,
  })), [])
  return snapshot
}
