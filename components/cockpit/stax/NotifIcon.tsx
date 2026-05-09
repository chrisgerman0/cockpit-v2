/**
 * Notification icon — single source of truth for both the bell dropdown
 * (StaxDashboard.tsx topbar) and the settings notification log
 * (SettingsPage.tsx). Ports v1 client-dashboard.html getNotifIconMarkup
 * verbatim into a React component, theme-aware via CSS vars.
 *
 * Maps notification.type → SVG (or coloured dot for trade closes).
 *   trade_entry        — gold lightning bolt (filled)
 *   trade_close        — 10px glowing dot (green for win, red for loss)
 *   invoice_*          — document SVG, colour by status
 *   commission_*       — coins-down SVG (gold or blue if processing)
 *   anything else      — fallback dot tinted by isWin
 */

export type NotifIconShape = {
  type?: string
  isWin?: boolean
}

export function NotifIcon({ n }: { n: NotifIconShape }) {
  if (n.type === 'trade_entry') {
    return (
      <span className="notif-log-svg" style={{ color: 'var(--gold)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M13 3L4 14h7v7l9-11h-7V3z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (n.type === 'trade_close') {
    return <span className={n.isWin ? 'notif-log-dot win' : 'notif-log-dot loss'} />
  }
  if ((n.type || '').indexOf('invoice_') === 0) {
    const color = n.type === 'invoice_paid' ? 'var(--pos)' : n.type === 'invoice_overdue' ? 'var(--neg)' : 'var(--gold)'
    return (
      <span className="notif-log-svg" style={{ color }}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path d="M5 1.75h4.2L12.25 4.8V13a1.25 1.25 0 0 1-1.25 1.25h-6A1.25 1.25 0 0 1 3.75 13V3A1.25 1.25 0 0 1 5 1.75Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          <path d="M9 1.75V4.5h2.75" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          <path d="M5.75 7h4.5M5.75 9.5h4.5M5.75 12h3.25" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
        </svg>
      </span>
    )
  }
  if ((n.type || '').indexOf('commission_') === 0) {
    const color = n.type === 'commission_processing' ? '#60a5fa' : 'var(--gold)'
    return (
      <span className="notif-log-svg" style={{ color }}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <circle cx="8" cy="10.25" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M8 2.5v5.1M5.9 5.55 8 7.8l2.1-2.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6.45 10.25h3.1" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round"/>
        </svg>
      </span>
    )
  }
  return <span className={n.isWin ? 'notif-log-dot win' : 'notif-log-dot loss'} />
}
