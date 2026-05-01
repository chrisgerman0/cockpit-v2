# Staxs Cockpit v2

Next-gen dashboard for [staxs.ai](https://staxs.ai) — the rebuild of `client-dashboard.html`.

Stack: **Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · Recharts · TanStack Table · Supabase · lucide-react**.

## Status

🚧 **In active development.** v1 (the existing `client-dashboard.html` at `staxs.ai`) stays live and untouched
while we build v2 in parallel. Sections are migrated one at a time. v1 only retires when v2 has full feature parity.

## Where this runs

- **Production:** `https://staxs.ai/v2/` (via nginx proxy → port 3007)
- **Dev (direct):** `http://5.189.155.200:3007/`
- Process manager: `pm2 list | grep staxs-dashboard-v2`
- Server: same VPS as `staxs-landing`

## Architecture

- **Auth:** shares Supabase project with `staxs-landing`. Sessions persisted to `localStorage` by both apps with the
  same key, so logging in on `staxs.ai` carries through to `staxs.ai/v2`.
- **APIs:** v2 has its own `app/api/*` routes; reads the same `/tmp/staxs-feed-status.json`,
  `/tmp/deadman-heartbeat.json`, `/tmp/reconciliation-status.json` files written by background processes
  (`feed-freshness-monitor`, `deadman-switch`).
- **Data files:** `/root/.openclaw/workspace/the-hive/bitget/{btc,eth,sol,xrp,sui}/hb-stats.json` (per-asset
  backtest output, live-updated every 5 min by the per-asset producers).

## Hard boundaries — what NOT to touch from this repo

This repo is **UI-only**. Anything below is owned by `staxs-landing` / `hive-arena` / `staxs-executor` and must
never be modified from here:

🚫 **Do not modify (live trading depends on this):**
- The strategy backtest code (`hive-arena/strategies/beat-bh/backtest-honeybadger.js`) — different repo, off-limits
- The signal executor (`staxs-executor/`) — different repo, off-limits
- `staxs-landing/app/api/execute-signal/*` — live trading dispatch
- `staxs-landing/app/api/bot-activate/*` — wizard config writer (executor reads this output)
- `staxs-landing/lib/tier-sizing.ts` — sizing math (executor reads it)
- The kill switch (`/tmp/staxs-kill-switch`)
- The deadman switch + reconciler (`hive-arena/agents/deadman-switch/`)
- The feed-freshness monitor (`hive-arena/agents/feed-freshness-monitor/`)

✅ **Free to modify in this repo:**
- `app/` — pages and routes
- `components/` — UI components
- `lib/ui-*`, `lib/theme.ts`, `lib/format.ts` — UI helpers, formatters, design tokens
- `tailwind.config.*`, `app/globals.css` — styling
- `package.json` — additive dependencies only (no removing what's there)
- This `README.md`, `CODEX_BRIEF.md`

## Branch + PR strategy

```
main                          ← protected, deployed at staxs.ai/v2/
  ├ design-explore             ← scratchpad for the 5-design exploration
  ├ feat/section-backtesting   ← one branch per section as we port v1 → v2
  ├ feat/section-admin
  ├ feat/section-live
  ├ feat/section-broker
  ├ feat/section-settings
  ├ feat/section-dashboard
  └ feat/wizard                ← LAST + RISKIEST — writes the activation config
```

Each PR includes:
1. A 1-2 minute screen recording (or screenshots) showing the new section in light + dark mode
2. A self-checklist (theme toggle works, mobile drawer works, no console errors, charts render, …)
3. Notes on any visual decisions worth flagging
4. A diff that's scoped to ONE section (don't sneak unrelated changes)

PRs reviewed before merging to `main`. **No merging directly to `main`.**

## Local dev

```bash
npm install
npm run dev          # → http://localhost:3000
```

## Component reference

The design system kitchen sink lives at `/design`. It renders the Obsidian Ledger primitives and
cockpit composites in both light and dark themes, plus the full dashboard composition for visual
regression checks before section ports land.

Build + run as production:
```bash
npm run build
npm run start -- -p 3007
```

## Deploying

`pm2 restart staxs-dashboard-v2` on the server pulls the latest build. CI/CD wiring TBD.

See [`CODEX_BRIEF.md`](./CODEX_BRIEF.md) for the design-system onboarding brief.
