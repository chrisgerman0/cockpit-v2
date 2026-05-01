'use client'

import { useEffect, useRef, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'

type EquityPoint = {
  month: string
  value: number
}

type EquityChartProps = {
  data: EquityPoint[]
  range?: string
  theme?: 'light' | 'dark'
}

/**
 * Gold-accent Recharts area chart for account equity over time.
 */
export function EquityChart({ data }: EquityChartProps) {
  const [mounted, setMounted] = useState(false)
  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    const node = ref.current
    if (!node) return
    const update = () => setWidth(Math.max(280, Math.floor(node.getBoundingClientRect().width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (!mounted) {
    return <div ref={ref} className="h-44 lg:h-[168px]" aria-hidden />
  }

  return (
    <div ref={ref} className="h-44 overflow-hidden lg:h-[168px]">
      {width > 0 ? (
        <AreaChart width={width} height={168} data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#D4A017" stopOpacity={0.48} />
              <stop offset="95%" stopColor="#D4A017" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical horizontal strokeDasharray="3 3" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} interval={0} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
          <YAxis axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(Number(v) / 1000)}K`} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} width={42} />
          <Tooltip
            cursor={{ stroke: '#D4A017', strokeOpacity: 0.3 }}
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              color: 'hsl(var(--popover-foreground))',
            }}
            formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Equity']}
          />
          <Area type="linear" dataKey="value" stroke="#D4A017" strokeWidth={2.2} fill="url(#equityFill)" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
        </AreaChart>
      ) : null}
    </div>
  )
}
