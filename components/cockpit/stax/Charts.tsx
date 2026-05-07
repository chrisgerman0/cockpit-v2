'use client'

/* Equity curve, sparklines, leverage gauge — hand-rolled SVG ported from
   Claude Design Stax/charts.jsx. Uses the data shapes Live data prop. */

import { useEffect, useMemo, useRef, useState } from 'react'

export type EquityPoint = { ts?: number; value: number; month?: string }

/**
 * Pick close to `targetCount` nicely-rounded ticks across [min, max]. Searches
 * across step candidates {1, 2, 2.5, 5, 10} × 10^n and picks the step that
 * produces the closest count to target. Ensures consistent tick density
 * regardless of scale ($1k range → $1M range).
 */
function niceTicks(min: number, max: number, targetCount = 7): number[] {
  const range = max - min
  if (range <= 0 || !Number.isFinite(range)) return []
  const candidates = [1, 2, 2.5, 5, 10]
  const exp0 = Math.floor(Math.log10(range / targetCount))
  let best: { step: number; score: number } | null = null
  for (let dExp = -2; dExp <= 2; dExp++) {
    const exp = exp0 + dExp
    const pow = Math.pow(10, exp)
    for (const c of candidates) {
      const step = c * pow
      const start = Math.ceil(min / step) * step
      const count = Math.floor((max - start) / step) + 1
      if (count < 2) continue
      // Penalise too many ticks (visual mush) more than too few.
      const score = count > targetCount * 1.6 ? 1000 + count : Math.abs(count - targetCount)
      if (best === null || score < best.score) best = { step, score }
    }
  }
  if (!best) return []
  const start = Math.ceil(min / best.step) * best.step
  const ticks: number[] = []
  for (let v = start; v <= max + best.step * 0.0001; v += best.step) ticks.push(v)
  return ticks
}

/** Compact currency: $850k → "$850K", $1_250_000 → "$1.25M", $36 → "$36" */
function fmtAxisDollars(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000)     return `$${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return `$${v.toFixed(0)}`
}

/** Full grouped dollars for tooltip — "$8,350" / "$1,250,000" — readable, not abbreviated. */
function fmtFullDollars(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`
}

function genSyntheticEquity(seed = 7, points = 180, start = 4000, end = 14000): EquityPoint[] {
  // Same pseudo-random walk as the design preview — used when no real data yet.
  let s = seed
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  const out: EquityPoint[] = []
  let v = start
  const drift = (end - start) / points
  for (let i = 0; i < points; i++) {
    const noise = (rand() - 0.45) * 220
    v += drift + noise
    if (i % 22 === 0) v -= 350 * rand()
    if (i % 31 === 0) v += 500 * rand()
    out.push({ value: Math.max(start * 0.85, v) })
  }
  const adj = (end - out[out.length - 1].value) / out.length
  return out.map((x, i) => ({ value: x.value + adj * i }))
}

type EquityChartProps = {
  data?: EquityPoint[]
  range?: '1M' | '3M' | '6M' | '1Y' | 'ALL'
  width?: number
  height?: number
  monthLabels?: string[]
}

export function EquityChart({ data, range = '6M', width = 700, height = 200, monthLabels }: EquityChartProps) {
  const series = useMemo(() => {
    if (data && data.length > 1) return data
    const seedMap = { '1M': 3, '3M': 5, '6M': 7, '1Y': 11, 'ALL': 13 } as const
    const ptsMap = { '1M': 30, '3M': 90, '6M': 180, '1Y': 240, 'ALL': 360 } as const
    return genSyntheticEquity(seedMap[range], ptsMap[range], 4000, 14000)
  }, [data, range])

  const pad = { l: 38, r: 14, t: 14, b: 28 }
  const W = width
  const H = height
  const values = series.map(p => p.value)
  const min = Math.min(...values) * 0.95
  const max = Math.max(...values) * 1.02
  const xs = (i: number) => pad.l + (i / Math.max(1, series.length - 1)) * (W - pad.l - pad.r)
  const ys = (v: number) => pad.t + (1 - (v - min) / Math.max(0.001, max - min)) * (H - pad.t - pad.b)
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ')
  const area = `${path} L ${xs(series.length - 1).toFixed(1)} ${H - pad.b} L ${xs(0).toFixed(1)} ${H - pad.b} Z`

  // y ticks — pick ~5 nice round numbers regardless of scale ($1k → $1M+).
  // Without this, ALL-time view (~$10k → $830k span) renders 400+ horizontal
  // grid lines, fusing into a barcode-like visual mush.
  const ticks = niceTicks(min, max, 5)

  const months = monthLabels && monthLabels.length > 0
    ? monthLabels
    : ["Nov '23", "Dec '23", "Jan '24", "Feb '24", "Mar '24", "Apr '24", "May '24"]

  // Hover state — index into series array. null when not hovering.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const localX = e.clientX - rect.left
    // Map screen px → viewBox x (preserveAspectRatio="none" stretches uniformly)
    const vbX = (localX / Math.max(1, rect.width)) * W
    const innerW = W - pad.l - pad.r
    const frac = Math.min(1, Math.max(0, (vbX - pad.l) / Math.max(1, innerW)))
    const idx = Math.round(frac * (series.length - 1))
    setHoverIdx(idx)
  }

  const hovered = hoverIdx != null ? series[hoverIdx] : null
  const hx = hoverIdx != null ? xs(hoverIdx) : 0
  const hy = hovered ? ys(hovered.value) : 0
  // Tooltip placement: nudge left if cursor is near right edge so it stays in-frame.
  const TIP_W = 152
  const TIP_H = 60
  const tipX = hx + TIP_W + 8 < W ? hx + 10 : hx - TIP_W - 10
  const tipY = Math.max(pad.t, Math.min(H - pad.b - TIP_H, hy - TIP_H - 8))
  const hoverDate = hovered?.ts
    ? (() => { const d = new Date(hovered.ts); const day = String(d.getDate()).padStart(2, '0'); const mon = d.toLocaleString('en-US', { month: 'short' }); return `${day} ${mon} ${d.getFullYear()}` })()
    : (hovered?.month || '')

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', cursor: 'crosshair' }}
      onPointerMove={onMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <defs>
        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.45" />
          <stop offset="60%" stopColor="var(--gold)" stopOpacity="0.10" />
          <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => {
        const y = ys(t)
        if (y < pad.t || y > H - pad.b) return null
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="JetBrains Mono">{fmtAxisDollars(t)}</text>
          </g>
        )
      })}
      <path d={area} fill="url(#eqFill)" />
      <path d={path} fill="none" stroke="var(--gold)" strokeWidth="1.6" />
      {months.map((m, i) => {
        const x = pad.l + (i / Math.max(1, months.length - 1)) * (W - pad.l - pad.r)
        // Anchor first label to start, last to end — keeps them inside the
        // chart bounds. With textAnchor="middle" the rightmost label gets
        // its right half clipped past the SVG edge.
        const anchor = i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'
        return <text key={i} x={x} y={H - 10} textAnchor={anchor} fontSize="10.5" fill="var(--muted)">{m}</text>
      })}

      {/* Crosshair + tooltip — rendered last so they sit above the line. */}
      {hovered != null && (
        <g pointerEvents="none">
          <line x1={hx} x2={hx} y1={pad.t} y2={H - pad.b} stroke="var(--gold)" strokeOpacity="0.35" strokeDasharray="3 3" />
          {/* Hollow gold ring at the data point — matches the design reference. */}
          <circle cx={hx} cy={hy} r="5" fill="var(--card)" stroke="var(--gold)" strokeWidth="1.8" />
          <g transform={`translate(${tipX}, ${tipY})`}>
            <rect width={TIP_W} height={TIP_H} rx="8" ry="8" fill="var(--card-2)" stroke="var(--line-2)" strokeWidth="1" />
            <text x={14} y={26} fontSize="13.5" fontWeight={700} fill="var(--text)">{hoverDate}</text>
            <text x={14} y={48} fontSize="15" fontWeight={700} fill="var(--gold)" fontFamily="JetBrains Mono">{fmtFullDollars(hovered.value)}</text>
          </g>
        </g>
      )}
    </svg>
  )
}

export function Spark({ data, color = 'var(--gold)', w = 54, h = 18 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (!data.length) return <svg width={w} height={h} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ')
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.4" points={pts} />
    </svg>
  )
}

export function genSpark(seed: number, n = 16, trend = 1): number[] {
  let s = seed
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  const out: number[] = []
  let v = 50
  for (let i = 0; i < n; i++) {
    v += (rand() - 0.5) * 8 + trend * 0.4
    out.push(v)
  }
  return out
}

export function LeverageGauge({ value = 7.5, max = 10, scale = 0.75 }: { value: number; max?: number; scale?: number }) {
  // Internal coords still drawn at 160×100; the SVG `width`/`height` shrink
  // by `scale` (default 0.75 → 25% smaller). Keeps existing geometry math.
  const cx = 80
  const cy = 78
  const r = 60
  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const
  }
  const arcPath = (deg0: number, deg1: number) => {
    const [x0, y0] = polar(deg0)
    const [x1, y1] = polar(deg1)
    const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
  }
  const v = Math.min(Math.max(value, 0), max)
  const ang = 180 + (v / max) * 180

  // RPM-style live needle jitter — small bounded random walk around the
  // actual angle, updating ~8×/sec. Makes the needle feel alive (like a
  // car's tachometer never sitting perfectly still) without distorting
  // the reading. Disabled when leverage is 0 (gauge at zero stays put).
  const [jitter, setJitter] = useState(0)
  useEffect(() => {
    if (v === 0) { setJitter(0); return }
    const id = window.setInterval(() => {
      setJitter(prev => {
        const next = prev + (Math.random() - 0.5) * 0.6
        return Math.max(-1.2, Math.min(1.2, next))
      })
    }, 120)
    return () => window.clearInterval(id)
  }, [v])

  const displayAng = ang + jitter
  const [nx, ny] = polar(displayAng)
  const [gx0, gy0] = polar(180)
  const [gx1, gy1] = polar(ang)

  // Label intervals scale with `max` so a 20× gauge still reads cleanly.
  const labels = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    t: `${(f * max).toFixed(f === 0 || f === 1 ? 0 : 2).replace(/\.?0+$/, '')}x`,
    deg: 180 + f * 180,
  }))

  const W = 160 * scale
  const H = 100 * scale
  return (
    <svg width={W} height={H} viewBox="0 0 160 100">
      <defs>
        <linearGradient id="gaugeFill" gradientUnits="userSpaceOnUse" x1={gx0} y1={gy0} x2={gx1} y2={gy1}>
          <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.18" />
          <stop offset="60%" stopColor="var(--gold)" stopOpacity="0.65" />
          <stop offset="100%" stopColor="var(--gold)" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d={arcPath(180, 360)} stroke="var(--line-2)" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.9" />
      {v > 0 && (
        <path d={arcPath(180, ang)} stroke="url(#gaugeFill)" strokeWidth="8" fill="none" strokeLinecap="round" />
      )}
      {labels.map((l, i) => {
        const [lx, ly] = polar(l.deg)
        const dx = (lx - cx) * 0.24
        const dy = (ly - cy) * 0.24
        return (
          <text key={i} x={lx + dx} y={ly + dy + 3} fontSize="9" textAnchor="middle" fill="var(--muted)" fontFamily="JetBrains Mono">{l.t}</text>
        )
      })}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--text)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3" fill="var(--text)" />
      <circle cx={cx} cy={cy} r="1.2" fill="var(--bg)" />
    </svg>
  )
}
