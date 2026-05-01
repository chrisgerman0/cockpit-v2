import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { fmtPct, fmtUsd } from '@/lib/format'
import type { Position } from './mock-data'

/**
 * One open position row; switches to a compact card on mobile.
 */
export function PositionRow({ position }: { position: Position }) {
  return (
    <>
      <TableRow>
        <TableCell className="font-semibold">{position.pair}</TableCell>
        <TableCell><Badge variant="positive">{position.side}</Badge></TableCell>
        <TableCell className="num">{position.size}</TableCell>
        <TableCell className="num">{fmtUsd(position.entryPrice)}</TableCell>
        <TableCell className="num">{fmtUsd(position.markPrice)}</TableCell>
        <TableCell className="num text-positive">{fmtUsd(position.pnlUsd)}</TableCell>
        <TableCell className="num text-positive">{fmtPct(position.pnlPct, { sign: true })}</TableCell>
      </TableRow>
    </>
  )
}

/**
 * Mobile card presentation for one open position.
 */
export function PositionCard({ position }: { position: Position }) {
  return (
    <div className="cockpit-card rounded-md p-3">
      <div className="flex items-center justify-between">
        <strong>{position.pair}</strong>
        <Badge variant="positive">{position.side}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Metric label="Size" value={position.size} />
        <Metric label="Mark" value={fmtUsd(position.markPrice)} />
        <Metric label="Entry" value={fmtUsd(position.entryPrice)} />
        <Metric label="PNL" value={fmtPct(position.pnlPct, { sign: true })} positive />
      </div>
    </div>
  )
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`num ${positive ? 'text-positive' : ''}`}>{value}</div>
    </div>
  )
}
