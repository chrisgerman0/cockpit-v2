import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { fmtPct, fmtUsd } from '@/lib/format'
import type { Trade } from './mock-data'

/**
 * One recent trade row; renders as a scan-friendly trade card below tablet.
 */
export function TradeRow({ trade }: { trade: Trade }) {
  const sideVariant = trade.side === 'LONG' ? 'positive' : 'negative'
  return (
    <>
      <TableRow>
        <TableCell className="font-semibold">{trade.pair}</TableCell>
        <TableCell><Badge variant={sideVariant}>{trade.side}</Badge></TableCell>
        <TableCell className="num">{trade.size}</TableCell>
        <TableCell className="num">{fmtUsd(trade.entryPrice)}</TableCell>
        <TableCell className="num">{fmtUsd(trade.exitPrice)}</TableCell>
        <TableCell className="num text-positive">{fmtUsd(trade.pnlUsd)}</TableCell>
        <TableCell className="num text-positive">{fmtPct(trade.pnlPct, { sign: true })}</TableCell>
        <TableCell className="num text-muted-foreground">{trade.time}</TableCell>
      </TableRow>
    </>
  )
}

/**
 * Mobile card presentation for one recent trade.
 */
export function TradeCard({ trade }: { trade: Trade }) {
  const sideVariant = trade.side === 'LONG' ? 'positive' : 'negative'
  return (
    <div className="cockpit-card rounded-md p-3">
      <div className="flex items-center justify-between gap-3">
        <strong>{trade.pair}</strong>
        <span className="num text-positive">{fmtUsd(trade.pnlUsd)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
        <Badge variant={sideVariant}>{trade.side}</Badge>
        <span className="num text-muted-foreground">{trade.time}</span>
      </div>
    </div>
  )
}
