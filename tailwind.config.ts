import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: 'hsl(var(--surface))',
        'surface-elevated': 'hsl(var(--surface-elevated))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        accent: 'hsl(var(--accent))',
        'accent-foreground': 'hsl(var(--accent-foreground))',
        positive: 'hsl(var(--positive))',
        negative: 'hsl(var(--negative))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        popover: 'hsl(var(--popover))',
        'popover-foreground': 'hsl(var(--popover-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        destructive: 'hsl(var(--destructive))',
        'destructive-foreground': 'hsl(var(--destructive-foreground))',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular'],
      },
      fontSize: {
        micro: ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.08em' }],
        label: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em' }],
        metric: ['1.75rem', { lineHeight: '2rem', fontWeight: '600' }],
        display: ['3.5rem', { lineHeight: '1', fontWeight: '500' }],
      },
      boxShadow: {
        cockpit: '0 18px 60px rgba(0, 0, 0, 0.36)',
        glow: '0 0 0 1px rgba(212, 160, 23, 0.22), 0 18px 48px rgba(212, 160, 23, 0.08)',
        tile: 'inset 0 1px 0 rgba(255,255,255,.04), 0 10px 30px rgba(0,0,0,.18)',
      },
      borderRadius: {
        xs: '0.25rem',
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.75rem',
      },
      transitionTimingFunction: {
        'cockpit-fast': 'cubic-bezier(.16, 1, .3, 1)',
        'cockpit-base': 'cubic-bezier(.22, .61, .36, 1)',
        'cockpit-slow': 'cubic-bezier(.19, 1, .22, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '320ms',
      },
    },
  },
  plugins: [animate],
}

export default config
