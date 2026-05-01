const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function fmtUsd(value: number, compact = false) {
  return (compact ? compactUsd : usd).format(value)
}

export function fmtPct(value: number, options?: { sign?: boolean; digits?: number }) {
  const digits = options?.digits ?? 2
  const sign = options?.sign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

export function fmtPx(value: number, digits = 2) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtAge(date: Date, now = new Date()) {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function fmtAsset(symbol: string) {
  return symbol.replace(/USDT$/u, '').toUpperCase()
}
