import { BarChart3, Bot, Clock3, ShieldCheck, TrendingUp } from 'lucide-react'

export type TradeSide = 'LONG' | 'SHORT'

export type Position = {
  pair: string
  side: TradeSide
  size: string
  entryPrice: number
  markPrice: number
  pnlUsd: number
  pnlPct: number
}

export type Trade = Position & {
  exitPrice: number
  time: string
}

export type TickerAsset = {
  symbol: string
  price: number
  change: number
}

export const equityData = [
  { month: "Nov '23", value: 4920 },
  { month: '', value: 5320 },
  { month: '', value: 5480 },
  { month: '', value: 5750 },
  { month: "Dec '23", value: 6110 },
  { month: '', value: 6820 },
  { month: '', value: 7520 },
  { month: '', value: 6960 },
  { month: "Jan '24", value: 7080 },
  { month: '', value: 7600 },
  { month: '', value: 7180 },
  { month: '', value: 7480 },
  { month: "Feb '24", value: 8120 },
  { month: '', value: 9060 },
  { month: '', value: 9820 },
  { month: '', value: 9480 },
  { month: "Mar '24", value: 10880 },
  { month: '', value: 11620 },
  { month: '', value: 11240 },
  { month: '', value: 12140 },
  { month: "Apr '24", value: 12640 },
  { month: '', value: 13340 },
  { month: '', value: 12920 },
  { month: '', value: 13680 },
  { month: '', value: 13100 },
  { month: '', value: 11860 },
  { month: '', value: 11240 },
  { month: "May '24", value: 9800 },
  { month: '', value: 10360 },
  { month: '', value: 9680 },
  { month: '', value: 10580 },
  { month: '', value: 11220 },
]

export const statCards = [
  { label: 'Bot Status', value: 'Active', caption: 'Watching', icon: Bot, variant: 'positive' as const },
  { label: 'Unrealized PNL', value: '$0', caption: 'No open position', icon: TrendingUp, variant: 'positive' as const },
  { label: 'Realized PNL', value: '$0', caption: 'No trades yet', icon: ShieldCheck, variant: 'default' as const },
  { label: 'Total Return', value: '+4,438%', caption: 'All time', icon: Clock3, variant: 'accent' as const },
]

export const positions: Position[] = [
  { pair: 'BTCUSDT', side: 'LONG', size: '0.2500', entryPrice: 65432.1, markPrice: 76318, pnlUsd: 2722.98, pnlPct: 16.88 },
]

export const trades: Trade[] = [
  { pair: 'BTCUSDT', side: 'LONG', size: '0.1500', entryPrice: 71245.3, markPrice: 75980.4, exitPrice: 75980.4, pnlUsd: 710.27, pnlPct: 6.65, time: 'May 18, 14:32' },
  { pair: 'ETHUSDT', side: 'LONG', size: '2.0000', entryPrice: 3182.45, markPrice: 3515.8, exitPrice: 3515.8, pnlUsd: 666.7, pnlPct: 10.48, time: 'May 18, 12:11' },
  { pair: 'SOLUSDT', side: 'LONG', size: '10.0000', entryPrice: 155.42, markPrice: 170.88, exitPrice: 170.88, pnlUsd: 154.6, pnlPct: 9.95, time: 'May 17, 21:47' },
  { pair: 'XRPUSDT', side: 'SHORT', size: '5,000.0', entryPrice: 0.5332, markPrice: 0.5198, exitPrice: 0.5198, pnlUsd: 67, pnlPct: 2.51, time: 'May 17, 18:03' },
  { pair: 'SUIUSDT', side: 'LONG', size: '500.0', entryPrice: 1.845, markPrice: 1.948, exitPrice: 1.948, pnlUsd: 51.5, pnlPct: 5.58, time: 'May 17, 15:22' },
]

export const tickerAssets: TickerAsset[] = [
  { symbol: 'BTC', price: 76318, change: 2.18 },
  { symbol: 'ETH', price: 3515.8, change: 1.42 },
  { symbol: 'SOL', price: 170.88, change: 3.06 },
  { symbol: 'XRP', price: 0.5198, change: -0.84 },
  { symbol: 'SUI', price: 1.948, change: 5.58 },
]

export const navItems = [
  { href: '/', label: 'Dashboard', icon: BarChart3 },
  { href: '/live', label: 'Live Trading', icon: TrendingUp },
  { href: '/backtesting', label: 'Backtesting', icon: BarChart3 },
  { href: '/broker', label: 'Broker', icon: ShieldCheck },
  { href: '/admin', label: 'Admin', icon: ShieldCheck },
  { href: '/settings', label: 'Settings', icon: Clock3 },
]
