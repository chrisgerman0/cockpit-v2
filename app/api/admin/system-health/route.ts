import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'

/**
 * /api/admin/system-health — temporarily UNGATED (no auth check) so the
 * cockpit v2 preview pages can render without going through full auth.
 * Will be re-gated once client-side auth is wired in v2.
 *
 * Reads three /tmp/*.json status files written by background processes.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function readStatusFile(filePath: string) {
  try {
    const stat = await fs.stat(filePath)
    const raw = await fs.readFile(filePath, 'utf8')
    return {
      data: JSON.parse(raw),
      monitorAgeMs: Date.now() - stat.mtimeMs,
      missing: false,
    }
  } catch {
    return { data: null, monitorAgeMs: null, missing: true }
  }
}

export async function GET() {
  const [feed, deadman, recon] = await Promise.all([
    readStatusFile('/tmp/staxs-feed-status.json'),
    readStatusFile('/tmp/deadman-heartbeat.json'),
    readStatusFile('/tmp/reconciliation-status.json'),
  ])
  return NextResponse.json({ ts: Date.now(), feed, deadman, recon })
}
