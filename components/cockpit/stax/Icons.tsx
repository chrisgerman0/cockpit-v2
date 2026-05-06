/* Inline SVG icon set ported verbatim from Claude Design Stax/icons.jsx. */

type IconProps = {
  size?: number
  stroke?: number
  className?: string
}

const I = ({ d, size = 18, stroke = 1.6, className, children, viewBox = '0 0 24 24', fill = 'none' as 'none' | 'currentColor' }: {
  d?: string
  size?: number
  stroke?: number
  className?: string
  children?: React.ReactNode
  viewBox?: string
  fill?: string
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox={viewBox}
    fill={fill}
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d ? <path d={d} /> : children}
  </svg>
)

export const Icons = {
  Bolt: (p: IconProps) => <I {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="currentColor" stroke="none" /></I>,
  Grid: (p: IconProps) => <I {...p}><rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" /><rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" /></I>,
  Trend: (p: IconProps) => <I {...p} d="M3 17l6-6 4 4 8-8M14 7h7v7" />,
  Bars: (p: IconProps) => <I {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></I>,
  Briefcase: (p: IconProps) => <I {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></I>,
  Shield: (p: IconProps) => <I {...p} d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z" />,
  Gear: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></I>,
  Bell: (p: IconProps) => <I {...p} d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Zm4 13a2 2 0 0 0 4 0" />,
  Sun: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></I>,
  Moon: (p: IconProps) => <I {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  Bitcoin: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" fill="#f7931a" stroke="none" /><path d="M9 7v10M11 7v10M8 9h5.2a2 2 0 1 1 0 4H8M8 13h5.6a2 2 0 1 1 0 4H8" stroke="#fff" strokeWidth={1.5} /></I>,
  ChevronLeft: (p: IconProps) => <I {...p} d="m14 6-6 6 6 6" />,
  ChevronDown: (p: IconProps) => <I {...p} d="m6 9 6 6 6-6" />,
  Star: (p: IconProps) => <I {...p}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8L6.6 19.7l1-6L3.2 9.4l6.1-.9L12 3Z" fill="currentColor" /></I>,
  Robot: (p: IconProps) => <I {...p}><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /><path d="M2 14v2M22 14v2" /></I>,
  TrendUp: (p: IconProps) => <I {...p} d="M3 17l6-6 4 4 8-8M14 7h7v7" />,
  Check: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></I>,
  Maximize: (p: IconProps) => <I {...p} d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  Signal: (p: IconProps) => <I {...p}><path d="M4 20V14M9 20V10M14 20V6M19 20V2" /></I>,
  Expand: (p: IconProps) => <I {...p} d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
  LogOut: (p: IconProps) => <I {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></I>,
  Globe: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></I>,
  Menu: (p: IconProps) => <I {...p}><path d="M4 6h16M4 12h16M4 18h16" /></I>,
  Lightning: (p: IconProps) => <I {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="currentColor" stroke="none" /></I>,
  // ── v1 (client-dashboard.html) nav icons — straight squares, polyline chart, ascending bars, users group.
  // Used on the v2 sidebar so the visual language matches the live v1 site.
  GridV1: (p: IconProps) => <I {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></I>,
  ChartLineV1: (p: IconProps) => <I {...p}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></I>,
  BarsV1: (p: IconProps) => <I {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></I>,
  UsersV1: (p: IconProps) => <I {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></I>,
}
