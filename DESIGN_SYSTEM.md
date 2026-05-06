# Staxs v2 — Design System & Branding Guide

> **Read this BEFORE making any cosmetic edit.** This is the canonical
> reference for tokens, components, patterns, and data architecture across
> every page in the v2 dashboard. New UI must use existing tokens and
> classes — invent a new pattern only after confirming nothing already
> covers the case.

---

## 0. Pre-flight checklist (do this every time)

Before touching CSS or JSX:

- [ ] **Page wrapper.** Every route's content starts with
      `<div className="stax-page">`. No exceptions.
- [ ] **Tokens, not values.** Colors come from CSS vars (`var(--gold)`,
      `var(--text)`, …). Never hardcode `#D4A017`, `#1a1a1f`, etc.
- [ ] **Card padding.** Anything in a card uses `<div className="card card-pad">`.
      Don't reinvent `padding: 18px 22px`.
- [ ] **Hero heading.** `bt-eyebrow` → `bt-title` with `bt-title-gold` on the
      accent word. No `<h1>` with inline `fontSize: …`.
- [ ] **Pill shape.** Tier toggles, view tabs, Log/Linear, filter pills:
      8px outer radius / 6px inner button radius. Not `999px`.
- [ ] **Theme aware.** Test light AND dark. If you needed a hardcoded color
      for one mode, use a CSS var or add a `.light` override block.
- [ ] **Mobile.** `≤ 768px` behaviour must still work — at minimum the page
      should not horizontally scroll.

If any item fails, fix it before shipping.

---

## 1. File map

```
components/cockpit/stax/
  stax-design.css        ← canonical design system (tokens + components)
  StaxDashboard.tsx      ← shell (sidebar + topbar + ticker), Dashboard page content
  LiveTrading.tsx        ← Live Trading page
  BacktestingPage.tsx    ← Backtesting page (the most polished — use as visual reference)
  BrokerPage.tsx         ← Broker page
  SettingsPage.tsx       ← Settings page (has its own `.settings-wrap` for tab grid)
  Charts.tsx             ← EquityChart / Spark / LeverageGauge SVG primitives
  Icons.tsx              ← inline SVG icon set

lib/
  use-public-tickers.ts       ← WS-backed live ticker singleton + health hook
  use-stax-dashboard-data.tsx ← Dashboard data loader
  use-live-trading-data.tsx   ← Live Trading data loader
  use-portfolio-trades.tsx    ← Strategy backtest trades fetcher
  i18n.tsx                    ← translations (`useT`, `getCurrentLang`)
  api.ts                      ← `authedFetch`, Supabase browser client
```

When in doubt about how something looks, **`/v2/backtesting` is the
reference page**. Match it.

---

## 2. Color tokens

All colors are CSS variables on `.stax-app` with a `.light` override. Use
them — never hardcode hex.

### Brand
| Token            | Dark        | Light       | Use                                      |
|------------------|-------------|-------------|------------------------------------------|
| `--gold`         | `#D4A017`   | `#B8860B`   | Primary brand color. Headings accent, active state, link. |
| `--gold-hi`      | `#E8B830`   | `#d39d11`   | Lighter end of gradients. Hover tints. |
| `--gold-dim`     | `#8c6a10`   | `#a07707`   | Darker end of gradients. |
| `--gold-glow`    | `rgba(212,160,23,0.30)` | `rgba(184,134,11,0.25)` | Glow shadows (text-shadow, box-shadow). |
| `--gold-edge-a`  | `rgba(212,160,23,0.05)` | `rgba(184,134,11,0.06)` | Card top-edge gradient stop. |

### Surfaces
| Token       | Dark        | Light       | Use                                       |
|-------------|-------------|-------------|-------------------------------------------|
| `--bg`      | `#050507`   | `#f6f4ee`   | Body / sidebar / topbar background.       |
| `--bg-2`    | `#0b0b0f`   | `#efece2`   | Main column background (subtly contrasts the L-frame), ticker, segmented containers. |
| `--card`    | `#0e0e13`   | `#ffffff`   | Card background base.                     |
| `--card-2`  | `#131319`   | `#faf7ec`   | Tooltip background, slightly raised surface. |
| `--line`    | `#1c1c24`   | `#e6e1cf`   | Subtle borders, table row separators.     |
| `--line-2`  | `#26262f`   | `#d8d2bd`   | Tooltip border, slightly more prominent.  |

### Text
| Token       | Dark        | Light       | Use                          |
|-------------|-------------|-------------|------------------------------|
| `--text`    | `#e7e7ea`   | `#1a1a1f`   | Primary text.                |
| `--muted`   | `#8b8b94`   | `#6b6b73`   | Labels, secondary copy.      |
| `--muted-2` | `#5c5c66`   | `#9a9aa3`   | Disabled text, faint dots.   |

### Status
| Token       | Dark        | Light       | Use                       |
|-------------|-------------|-------------|---------------------------|
| `--pos`     | `#2ecc71`   | `#1f9d55`   | Wins, positive PnL, LONG. |
| `--neg`     | `#ff4d4f`   | `#d23a3a`   | Losses, negative PnL, SHORT. |
| `--pos-rgb` | `46, 204, 113` | `31, 157, 85` | Use with `rgba(var(--pos-rgb), 0.X)` for tints. |
| `--neg-rgb` | `255, 77, 79` | `210, 58, 58` | Same for negative tints.    |

**Use class first:** `pos-text` / `neg-text` / `dot-live` etc. Only reach
for the var directly if you need a non-standard alpha (e.g. `rgba(var(--pos-rgb), 0.04)` for a row tint).

---

## 3. Typography

```css
font-family: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
font-size: 14px; /* default body */
```

| Class       | Stack         | Weight | Use                                     |
|-------------|---------------|--------|-----------------------------------------|
| (default)   | Geist/Inter   | 400    | Body copy.                              |
| `.num`      | JetBrains Mono| 600    | Numbers, prices, timestamps. Tabular.   |
| `.mono`     | JetBrains Mono| 400    | Inline mono text (rare).                |
| `.label`    | Geist/Inter   | 500    | Uppercase 10.5px label, `letter-spacing: 0.16em`, color `#a8a8b0`. |
| `.label-gold` | same        | 600    | Same as `.label` but in `var(--gold)`.   |

**Heading sizes (use these classes, don't inline):**

| Class          | Size | Weight | Notes                                 |
|----------------|------|--------|---------------------------------------|
| `.bt-title`    | 32px | 700    | Page hero. `line-height: 1.15`.       |
| `.bt-eyebrow`  | 10.5px| 600   | Gold uppercase with 18px bar before. `letter-spacing: 0.16em`. |
| `.bt-blurb`    | 13px | 400    | Muted explainer copy under hero. Max width 900px. |
| `.bt-card-title` | 13px | 600  | Card heading. Pair with `.bt-card-bar`. |

### Hero pattern (every page)

```tsx
<div className="bt-header" style={{ marginBottom: 14 }}>
  <div className="bt-eyebrow">{eyebrowText}</div>
  <h1 className="bt-title">
    {leadWords} <span className="bt-title-gold">{accentWord}</span>
  </h1>
  <p className="bt-blurb">{blurb}</p>
</div>
```

- **Only the last word** gets the gradient. `Verified <span>performance.</span>`,
  `Your active <span>positions.</span>`, `Refer and <span>earn.</span>`.
- **No italic** on `.bt-title-gold`. The gradient itself is `linear-gradient(90deg, var(--gold-dim), var(--gold), var(--gold-hi))`.
- **No `<h2>` with inline styles.** Always use `.bt-title`.

---

## 4. Spacing scale

Single source of truth lives in `.stax-page`:

```css
.stax-app .stax-page {
  display: flex; flex-direction: column;
  gap: 16px;
  padding: 4px 4px 24px;
}
```

Inside that, sections (cards, rows) are direct children — gap handles
spacing. Don't add `margin-top: 16px` on individual sections.

**Spacing values used in the system** — pick from these, don't invent:

| Px  | Use                                    |
|-----|----------------------------------------|
| 2   | Inside-pill gap (segmented control gap). |
| 4   | Tiny inner padding. Page wrapper sides. |
| 6   | Small flex gap (icon + label).          |
| 8   | Nav item / button vertical padding. Standard chip padding. |
| 10  | Card head padding-bottom. Pill outer container padding. |
| 12  | Icon button padding. Card body breathing. |
| 14  | Card padding sides (with 18–20px vertical). Blurb spacing. |
| 16  | Section gap on page (`.stax-page` gap). |
| 18  | Card vertical padding (`.bt-eq-card`).  |
| 20  | Card padding vertical (`.card-pad: 20 22`). |
| 22  | Card padding sides (`.card-pad: 20 22`). |
| 24  | Page-bottom padding. Section breathing. |

**Card padding** is always `card-pad`: `padding: 20px 22px`. Don't override.

---

## 5. Border radius

| Px  | Use                                        | Examples                              |
|-----|--------------------------------------------|---------------------------------------|
| 0   | Ticker (it's a strip).                     | `.ticker`                             |
| 6   | Inner pill button. Badge. Small buttons.   | `.bt-tier-pill`, `.bt-view-tab`, `.badge`, `.bt-scope-tag`, `.bt-scale-toggle button`. |
| 8   | Outer pill container. Action button. Tooltip. | `.bt-tier-pills`, `.bt-view-tabs`, `.bt-scale-toggle`, `.bt-eq-tooltip`, anchor CTAs. |
| 10  | Sidebar nav item. Card-like list rows.     | `.nav-item`                           |
| 12  | Mid card.                                  | (rare)                                |
| 16  | Standard card.                             | `.card`                               |
| 50% | Coin icons, dots.                          | `.coin`, `.dot-live`, `.icon-btn`     |
| 999px | Topbar BTC pill (mobile).                | `.pill`                               |

**Rule:** segmented controls use **8px outer / 6px inner**. The rest of the
site treats this as the canonical "rounded square" pill shape. Fully-round
`999px` is reserved for the BTC chip, the live dot, coin avatars, and
`.icon-btn`.

---

## 6. Shadows

Don't make these up — copy from `.card`:

```css
box-shadow:
  0 1px 2px rgba(0, 0, 0, 0.20),         /* outer drop */
  0 12px 48px rgba(0, 0, 0, 0.45),       /* float-above-bg */
  inset 0 1px 0 rgba(255, 255, 255, 0.10), /* top edge sheen */
  inset 1px 0 0 rgba(255, 255, 255, 0.04),
  inset -1px 0 0 rgba(255, 255, 255, 0.04);
```

For light mode (`html.light`):

```css
box-shadow:
  0 1px 2px rgba(28, 22, 10, 0.06),
  0 12px 48px rgba(28, 22, 10, 0.14),
  inset 0 1px 0 rgba(255, 255, 255, 0.9);
```

Tooltip:
```css
box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4); /* light: 0 4px 18px rgba(0, 0, 0, 0.10) */
```

Anything else: **don't**. Use one of the above.

---

## 7. Animation

Two keyframes own all motion in this system:

```css
@keyframes stax-pulse {
  0%, 100% { transform: scale(1);    box-shadow: 0 0 6px currentColor, 0 0 0 0 rgba(46, 204, 113, 0.45); }
  50%      { transform: scale(1.18); box-shadow: 0 0 12px currentColor, 0 0 0 6px rgba(46, 204, 113, 0); }
}
@keyframes stax-open-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
```

| Keyframe          | Use                          | Duration  |
|-------------------|------------------------------|-----------|
| `stax-pulse`      | Live status dots (`.dot-live`, `.sd.open`). Scale + glow. | 1.6–1.8s ease-in-out infinite |
| `stax-open-pulse` | Pulsing OPEN labels (`.bt-open-label`). Opacity only — no layout shift. | 1.6s ease-in-out infinite |

**Transitions** for hover / state-flip:

| Property | Duration | Easing                                |
|----------|----------|---------------------------------------|
| color, background, border | 0.12–0.15s | ease                          |
| transform (card lift)     | 0.28s | `cubic-bezier(0.2, 0.8, 0.2, 1)`  |
| opacity                   | 0.15–0.35s | ease                         |

Don't write `transition: all`. Pick the props you mean.

---

## 8. Layout primitives

### 8.1 The shell

```
<.stax-app>
  <.app-grid> (200px sidebar | main 1fr)
    <.side>          ← sidebar, var(--bg) — the ONLY surface with a distinct background
    <.main>          ← main column, var(--bg-2)
      <.topbar>      ← sticky top, var(--bg-2) — matches main (no seam against content)
      <.ticker.ticker-top>  ← live prices, sticky below topbar (desktop only), var(--bg-2)
      <.content>     ← page content area, inherits var(--bg-2)
        {children}   ← every route renders <.stax-page> as the root child
      </.content>
      <StaxFooter />
```

**Background colour rule:** the sidebar is the ONLY surface that uses
`--bg`. Everything else inside `.main` (topbar, ticker, content) uses
`--bg-2` so they read as a single content surface. The earlier "L-frame"
treatment (sidebar + topbar at `--bg`, main at `--bg-2`) was reverted —
it left an awkward seam between the topbar and the cream content area.

### 8.2 Page wrapper — `.stax-page`

Every page MUST start with this. It owns padding, gap, and the column
direction. All five pages (Dashboard, Live, Backtesting, Broker, Settings*)
use it.

```tsx
export function MyPageContent() {
  return (
    <div className="stax-page">
      <PageHeader />
      <StatsRow />
      <SomeCard />
    </div>
  )
}
```

\* Settings has its own `.settings-wrap` because the tab grid layout
differs. Still uses the same `padding: 4px 4px 24px`.

`.bt-wrap` is kept as an alias for backwards compat — same rules. Prefer
`.stax-page` for new code.

### 8.3 Row layouts

| Class                | Layout                                          | Mobile collapse              |
|----------------------|-------------------------------------------------|------------------------------|
| `.bt-metrics-row`    | 5-col grid (metric cards).                      | 2 cols ≤ 980px               |
| `.bt-twin-row`       | 2-col grid (paired cards).                      | 1 col ≤ 980px                |
| `.row.row-stats`     | Stats grid (4 cards).                           | 2 cols ≤ 768px               |
| `.row.row-tables`    | 2-col (Open Positions \| Recent Trades).        | 1 col ≤ 768px                |
| `.row.row-bottom`    | Bottom row (Leverage / WR×2 / Streak).          | 2 cols ≤ 768px               |

Use these — don't write `style={{ display: 'grid', gridTemplateColumns: ... }}`.

---

## 9. Components

### 9.1 Card

```tsx
<div className="card card-pad">
  <div className="bt-card-head">
    <div className="bt-card-title">
      <span className="bt-card-bar" />
      SECTION TITLE
    </div>
    {/* Optional right-side accessory */}
  </div>
  {/* Body */}
</div>
```

- `.card` provides bg + 16px radius + shadow + gold top-edge gradient + hover
  lift + cursor-tracking spotlight.
- `.card-pad` adds `padding: 20px 22px`.
- `.bt-card-head` is a flex row with the gold bar marker on the left.
- Don't add `border` or `background` overrides.

### 9.2 Pills & toggles

**Segmented control** (tier picker, view tabs, filter pills, OPEN/CLOSED toggle):

```tsx
<div className="bt-tier-pills">
  {options.map(opt => (
    <button
      key={opt}
      type="button"
      className={'bt-tier-pill' + (selected === opt ? ' active' : '')}
      onClick={() => setSelected(opt)}
    >
      {opt}
    </button>
  ))}
</div>
```

- Outer: `.bt-tier-pills` — translucent glass, 8px radius, 4px padding, 2px gap.
- Inner: `.bt-tier-pill` — 32px height, `padding: 8px 20px` (or 8 18 for icons), 6px radius.
- Active: gold tint bg + 1px gold border + soft glow.

**Frosted glass pill** (`.seg`) — same shape language, slightly different
chrome. Used for the older live-trading filter (now superseded by
`.bt-tier-pills`). **For new code, prefer `.bt-tier-pills`.**

**Two-state toggle** (Log/Linear): `.bt-scale-toggle` — same 8px outer / 6px
inner with smaller padding (`4px 12px`).

### 9.3 Buttons

| Class                       | Use                                                | Shape           |
|-----------------------------|----------------------------------------------------|-----------------|
| `.icon-btn`                 | 36×36 circular icon-only button.                   | 50% radius      |
| `.settings-btn-primary`     | Page primary action (gold filled).                 | 8px radius      |
| `.settings-btn-secondary`   | Pagination Prev/Next, tertiary actions.            | 8px radius      |

For one-off CTAs (anchor links inside cards), use:
```tsx
<a style={{
  display: 'inline-flex', padding: '8px 16px', borderRadius: 8,
  border: '1px solid rgba(212,160,23,0.35)', background: 'rgba(212,160,23,0.08)',
  color: 'var(--gold)', fontSize: 13, fontWeight: 600, textDecoration: 'none',
}}>...</a>
```

### 9.4 Badges

```tsx
<span className="badge badge-long">LONG</span>
<span className="badge badge-short">SHORT</span>
```

- 6px radius, JetBrains Mono, 10.5px, weight 700, `letter-spacing: 0.08em`.
- `badge-long` = green, `badge-short` = red. Direction badges, side filters,
  tier-state pills (`YES` for pyramided).

### 9.5 Status indicators

| Class             | Visual                              | Use                                     |
|-------------------|-------------------------------------|-----------------------------------------|
| `.dot-live`       | 7px green dot, pulsing.             | Active position, live ticker, watching state. |
| `.dot-stale`      | 7px red dot, no pulse.              | Disconnected / offline.                  |
| `.bt-open-label`  | Gold "● OPEN" with opacity pulse.   | Replace exit-price / mark-price for live trades. |
| `.sd.w / .sd.l`   | 9px green/red filled dot.           | Streak history (closed wins/losses).     |
| `.sd.open`        | Same dot, with `stax-pulse`.        | Streak history slot for the live trade.  |

**OPEN label markup:**
```tsx
<span className="bt-open-label">
  <span className="dot" />OPEN
</span>
```

### 9.6 Tables

Three distinct table flavours:

#### a) List of Trades (use this for any trade-log view)

The canonical pattern, defined in `BacktestingPage.tsx → TradesTable` and
mirrored in `LiveTrading.tsx → LiveTradesTable`. Columns:

```
# | Pair (logo + symbol) | Side (badge) | Size ($notional + units) | Entry (price + ts) | Exit (price + ts OR pulsing OPEN) | P&L | % | Reason
```

- **Pair filter** + **Side filter** above the table (`bt-tier-pills`).
- **Row tints**: `bt-trade-win` (green), `bt-trade-loss` (red), `bt-trade-open` (gold). All low-alpha; brighter on hover.
- **Stacked cells** (`.bt-price-cell`): primary value, `<span class="ts">` or `.sub` underneath in muted JetBrains Mono.
- **Pagination**: `.bt-pagination` with Prev / cur · total / Next.

If you need a trade list anywhere, **clone `LiveTradesTable`**, don't
reinvent. (See `LiveTrading.tsx` for the reusable shape.)

#### b) Per-asset state / breakdown table

Plain `<table>` inside a `<div className="card">` with `<div className="card-pad">` for the heading. Used for compact summaries (per-asset performance, strategy state).

#### c) Stat tables (`.bt-stat-table`)

Two-col label/value table inside a card. Used for Returns Summary,
Risk-Adjusted Performance, Run-ups & Drawdowns.

### 9.7 Inputs

| Class                | Use                                  |
|----------------------|--------------------------------------|
| `.settings-input`    | Text inputs in Settings panels.      |

For now, all form inputs live under Settings. If you add inputs elsewhere,
**reuse `.settings-input`** rather than introducing new styling.

### 9.8 Charts

- `EquityChart` (Charts.tsx) — single-series line + area + crosshair tooltip.
  Used on the Dashboard hero.
- `Spark` (Charts.tsx) — tiny inline sparkline. Use for ticker / streak.
- `LeverageGauge` (Charts.tsx) — 180° arc gauge with needle.
- **Dual equity chart** (BacktestingPage.tsx → `DualEquityChart`) — strategy
  line + BTC B&H dashed line, log/linear toggle, clickable legend, HTML
  overlay tooltip with **interpolated** values at the cursor x. Both dots
  ride the same vertical crosshair.

**Tooltip rule:** if your chart has more than one trace, use an HTML overlay
(not SVG `<text>`) — SVG text in a `preserveAspectRatio="none"` chart
stretches and overlaps. Reference: `.bt-eq-tooltip`.

---

## 10. Page heroes — exact pattern

Both Live Trading and Backtesting use this. New pages follow it too.

```tsx
<div className="bt-header" style={{ marginBottom: 14 }}>
  <div className="bt-eyebrow">{EYEBROW_TEXT}</div>
  <h1 className="bt-title">
    {leadWords} <span className="bt-title-gold">{accentWord}</span>
  </h1>
  <p className="bt-blurb">{blurbText}</p>
  {/* Optional small mono timestamp / freshness pill */}
</div>
```

| Page         | Eyebrow                        | Lead         | Accent          |
|--------------|--------------------------------|--------------|-----------------|
| Live Trading | `MY POSITION`                  | Your active  | `positions.`    |
| Backtesting  | `SATOSHI STACKER · 5-ASSET BASKET` | Verified | `performance.`  |
| Broker       | `BROKER PROGRAM`               | Refer and    | `earn.`         |
| Dashboard    | (uses Hero with balance)       | n/a          | n/a             |

**Rules:**
- Last word only gets the gradient.
- No italic.
- 32px / 700 / line-height 1.15 (the `.bt-title` class handles this).
- Lead words use default `var(--text)` color.

---

## 11. The ticker

### 11.1 Layout

- Mounted in `StaxAppShell` between topbar and content.
- Class: `.ticker.ticker-top` — sticky at `top: 56px` with `z-index: 25`,
  no border, no margin, just `--bg-2` background.
- Items (`.tk-item`) are `flex: 0 0 auto` and the row uses
  `justify-content: space-between` so each [icon | sym | price | delta |
  spark] cluster stays tight while the row fills the width.

### 11.2 Live state

- WebSocket via `wss://ws.bitget.com/v2/ws/public`. Singleton in
  `lib/use-public-tickers.ts` shared across all consumers.
- REST fallback only when WS is down or during cold start.
- `useTickerStreamHealth()` exposes `{ latencyMs, connected }`.

### 11.3 Live + latency indicators

| State        | Dot           | Label         | Latency text      |
|--------------|---------------|---------------|--------------------|
| Connected    | `.dot-live`   | `Live` (green) | `<X>ms`           |
| Disconnected | `.dot-stale`  | `Reconnecting` (muted) | `—`        |

Latency colour coding:
| RTT          | Class                   |
|--------------|-------------------------|
| < 200ms      | `.tk-latency-good` (gold) |
| 200–400ms    | `.tk-latency-mid` (gold-hi) |
| > 400ms      | `.tk-latency-high` (red) |
| Disconnected | `.tk-latency-stale` (muted-2) |

Hover tooltip: `WebSocket round-trip: <X>ms (sampled every 5s)`.

### 11.4 Mobile

- Ticker hidden at `≤ 768px` (`.ticker { display: none }`).
- Topbar BTC pill (`.topbar-btc-pill`) takes over — hidden on desktop, shown
  at `≤ 768px`.

---

## 12. Theming

Light mode is `html.light .stax-app` (or `.stax-app.light`). The token table
in §2 covers most differences. When a component has theme-specific CSS,
the override block sits **immediately below the dark rule** so they stay
in sync. Pattern:

```css
.stax-app .my-thing {
  background: rgba(14, 14, 19, 0.55);
  border-color: rgba(255, 255, 255, 0.07);
}
.stax-app.light .my-thing,
html.light .stax-app .my-thing {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(0, 0, 0, 0.06);
}
```

Use **both** selectors (`.stax-app.light` and `html.light .stax-app`) so the
class works whether the toggle lives on `<html>` or `.stax-app`.

For low-alpha tints (win/loss row, glow), light mode often needs
**~2× alpha** to read on the lighter surface. Example:
```css
.stax-app tr.bt-trade-win > td { background-color: rgba(var(--pos-rgb), 0.11); }
.stax-app.light tr.bt-trade-win > td,
html.light .stax-app tr.bt-trade-win > td { background-color: rgba(var(--pos-rgb), 0.06); }
```

(Lower alpha in light because white amplifies the tint; higher alpha in
dark because the deep bg swallows it.)

---

## 13. Brand assets

Logos live in `public/brand/`:

| File                                       | Use                                  |
|--------------------------------------------|--------------------------------------|
| `staxs-icon-full-color-2048px.png`         | Dark theme — full-color gold S on dark backing. |
| `staxs-icon-gold-transparent-2048px.png`   | Light theme — transparent gold-only. |

Render both, hide the wrong one with CSS:

```tsx
<img className="brand-mark-dark"  src="/v2/brand/staxs-icon-full-color-2048px.png" ... />
<img className="brand-mark-light" src="/v2/brand/staxs-icon-gold-transparent-2048px.png" ... />
```

The CSS rules in `.brand-mark-light` / `.brand-mark-dark` swap visibility
based on the active theme.

Coin icons:
- BTC / ETH / XRP — `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/<sym>.svg`
- SOL / SUI — `/v2/coin-icons/sol.png`, `/v2/coin-icons/sui.png` (local PNGs)

Reuse the `ASSET_LOGOS` map (defined in BacktestingPage.tsx + LiveTrading.tsx).
**Don't** introduce a new map.

---

## 14. Data architecture

### 14.1 The principle: **Bitget is the source of truth**

For anything that represents the user's actual trading state — open
positions, closed trades, fill prices, realised PnL, mark price, account
equity — **the data MUST come from Bitget**, not from the Supabase `trades`
table or any cached snapshot.

The Supabase `trades` row store is observational only (executor writes
audit rows there). Database state can drift from exchange state and we've
been bitten by it (DB-stale closures, ghost positions). The user view must
reflect what the exchange says, period.

### 14.2 Endpoints

| Endpoint              | Source                              | Use                                   |
|-----------------------|-------------------------------------|---------------------------------------|
| `/api/balance`        | Bitget `/v2/mix/account/account`    | Equity, available margin, unrealized PnL. |
| `/api/trades-live`    | **Bitget** — `getOpenPosition` + `getPositionHistory` per V1 symbol | **Use this for all trade lists.** Returns `{ trades: RawTrade[], source: 'bitget' }`. |
| `/api/trades`         | Supabase `trades` table             | **Legacy** — do not use in new code. Will be removed. |
| `/api/strategy-state` | Strategy daemon snapshot             | Per-asset strategy state (Watching / LONG / SHORT). |
| `/api/bot-activate`   | Supabase `bot_configs` + Bitget pre-flight | Wizard activation. |
| Bitget WS (`wss://ws.bitget.com/v2/ws/public`) | Bitget directly | Live ticker prices for the chrome ticker bar. |

### 14.3 What this means in practice

- New trade widget → `useLiveTradingData()` (or fetch `/api/trades-live`
  directly). Never `/api/trades`.
- New "live mark price" cell → consume `useTickerStreamHealth()` /
  `usePublicTickers()`. Never poll a custom REST endpoint.
- "Unrealised PnL" for a position → use Bitget's `unrealizedPL` field on
  the position payload. Don't compute `(mark − entry) × size × dir` if the
  exchange already gave you the answer.

### 14.4 Strategy state vs. user state

Two distinct universes — never confuse them:

| Scope               | Source                                | What it represents                         |
|---------------------|---------------------------------------|--------------------------------------------|
| **Strategy state**  | `/api/strategy-state` (daemon snapshot) | What the strategy WOULD do — its current per-asset position view. |
| **User state**      | `/api/trades-live`, `/api/balance` (Bitget) | What the user ACTUALLY has on the exchange. |

Most pages should display USER state. Strategy state is only relevant for
the per-asset "what's the bot watching" widget on Live Trading and for the
backtesting page's reference data. Mixing them is a bug.

---

## 15. Accessibility

- Use `<button type="button">` for all interactive non-link elements (so
  they don't accidentally submit forms).
- `<a>` only for actual navigation. `next/link` for in-app routes.
- Pills should set `aria-pressed` for two-state toggles, `role="tab"` /
  `role="tablist"` for tabs.
- `title` attribute for compact indicators (latency, OPEN duration) so
  hover gives the full meaning.
- Min hit target on mobile: 36×36 (matches `.icon-btn`).
- Don't kill focus rings — design has subtle ones via the gold border on
  `:focus-visible`.

---

## 16. Common mistakes (don't do these)

- ❌ `<div style={{ padding: '20px 24px' }}>` → use `card-pad`.
- ❌ `<h1 style={{ fontSize: 32, fontWeight: 700 }}>` → use `.bt-title`.
- ❌ `border-radius: 999px` on a tier toggle / view tab / filter pill → use 8/6.
- ❌ Hardcoded `#D4A017` → use `var(--gold)`.
- ❌ `transition: all` → enumerate the props.
- ❌ `<table>` without `.card` wrapper or with custom borders.
- ❌ A new full-color hex string when a CSS var would do.
- ❌ A bottom ticker on desktop. (Top, sticky, no border.)
- ❌ Querying `/api/trades` for live data. (Use `/api/trades-live`.)
- ❌ Showing Supabase `trades` rows as canonical state — they're audit only.
- ❌ Italic on `.bt-title-gold`. (Removed permanently.)
- ❌ `latencyMs={28}` hardcoded anywhere — that was a placeholder, gone now.
- ❌ Building a one-off tooltip for a chart with > 1 series in SVG `<text>` —
  use HTML overlay.

---

## 17. When you actually need to add new style

Order of operations:

1. **Look in `stax-design.css` first.** Search for the closest existing class.
2. **Check the pattern catalog above** (§9 components, §10 heroes, §11
   ticker). Almost every common case is covered.
3. **Reuse a token + an existing class** with one extra rule if needed.
4. **Only if all of the above fail**, add a new class. Place it next to the
   semantically nearest existing class in `stax-design.css`. Document why.

If it's a one-off (like "a 6px gap inside this specific row"), inline style
is fine — but only ever values from the spacing scale (§4).

---

## 18. Quick visual reference

Run `https://staxs.ai/v2/backtesting` in both light and dark mode. Every
pattern in this doc is on that page. Match it. If you're about to render
something that doesn't look like what's there, stop and re-read this doc.

---

**End of document.** Last updated when the design system was unified
(matching `.stax-page` wrapper applied to all pages, hero pattern aligned,
ticker re-architected for WS, Bitget set as the source of truth for trade
data).
