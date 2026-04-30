# Codex onboarding — Cockpit v2 design system

Welcome. You're picking up a Next.js app that's the visual rebuild of an existing crypto trading
dashboard. **Read [`README.md`](./README.md) first** — it has the architecture, the boundaries, and
the workflow.

This file is your starting brief. Everything you need to make your first PR is below.

## Project context

- **What this app is:** the next-gen UI for `staxs.ai`, replacing a 16,000-line vanilla-HTML
  monolith (`client-dashboard.html`). The CONTENT is fine; the visual design is what we're upgrading.
- **What it isn't:** a green-field design exercise. We have an existing app users know — keep the
  information architecture, polish the look.
- **Brand vibe:** crypto-native, Bloomberg-grade serious, Linear/Stripe/Vercel polish. Numbers are
  king. Money on the line. Never cutesy. No bubble gradients on text. No emoji-as-decoration.
- **Theme:** must support BOTH light and dark, persisted to `localStorage`. Toggle is in the top bar.

## Stack — already installed

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- `lucide-react`, `@supabase/supabase-js`, `@supabase/ssr`

You should ADD (additive only, don't remove anything):
- `shadcn/ui` (run `npx shadcn@latest init` then add primitives as needed)
- `recharts` for charts
- `@tanstack/react-table` for tables
- `next-themes` for theme management (already partially handled by `components/theme-provider.tsx` —
  feel free to refactor to use `next-themes` if cleaner)

## Hard boundaries (cannot stress this enough)

🚫 **Anything outside this repo.** Especially the strategy code, the executor, the kill switch.
🚫 **The live-trading API contracts** — `app/api/execute-signal`, `app/api/bot-activate`. Even
   though they live in a different repo (`staxs-landing`), you might be tempted to mirror them
   here. **Don't.** Read-only screens only. The wizard that writes to these contracts will be
   the LAST thing we port, and only with parity tests.
🚫 **`/tmp/staxs-*` files** — these are produced by background processes you have no access to.
   Read via the existing `app/api/admin/system-health/route.ts` pattern; never write.
🚫 **Don't merge to `main`.** All work goes through PRs to feature branches, reviewed by the
   integration agent or Chris.

## Your first task — FIVE Dashboard designs

Before we commit to a design language, generate **five distinct directions** for the Dashboard
home page only. Chris picks one, then you expand that direction to the full design system.

### Reference

Look at the existing app to see what content the Dashboard surfaces:
1. Open `https://staxs.ai/client-dashboard.html` (you can fetch it; it's public).
2. Section: the home / dashboard view (NOT the Backtesting tab, NOT Admin Cockpit).
3. Note the elements: account balance + tier, equity curve, open positions widget, recent trades,
   key stats (WR / PF / DD / total return), maybe a CTA or empty state.

If you can't reach the live URL, ask Chris to attach screenshots in the PR thread.

### Deliverable

Create branch `design-explore` off `main`. On that branch, add **five page files**:

```
app/(app)/design-1-<your-name-for-it>/page.tsx
app/(app)/design-2-<your-name-for-it>/page.tsx
app/(app)/design-3-<your-name-for-it>/page.tsx
app/(app)/design-4-<your-name-for-it>/page.tsx
app/(app)/design-5-<your-name-for-it>/page.tsx
```

Each design must:
- Be a single self-contained React page (`'use client'` is fine)
- Use Tailwind utility classes + shadcn/ui primitives + lucide icons + Recharts
- Render the same content (mock data is fine — hard-code reasonable numbers)
- Support both light and dark mode
- Be visually distinct from the other 4 — different layouts, density, colour palettes,
  typographic personality, hierarchy choices
- Have a NAME and a one-line personality description in a comment at the top of the file

Example names (don't copy these — invent your own):
1. "Bloomberg Terminal" — high density, monospace-heavy, info-rich
2. "Linear Glass"       — translucent cards, generous whitespace, subtle gradients
3. "Stripe Minimal"     — typography-first, restrained palette, sharp
4. "Hyperliquid Native" — dark cockpit, neon accents, monospace numbers, tactical
5. "Apple Finance"      — large numbers, soft pastel cards, friendly

Brand constraints (apply to all 5):
- Primary accent: gold (`#D4A017` or your sleeker variant) — adjust hue, not the brand
- Number font: JetBrains Mono (`font-mono`)
- Body font: Geist (already loaded)
- Tabular nums for ALL numeric values (`tabular-nums` Tailwind class)

### PR

Open ONE PR titled `design-explore: five Dashboard directions for review`. Body:
- A list of the 5 designs with their names and personality lines
- A 30-second screen recording per design, showing light AND dark mode
- A note on any decisions or trade-offs you made

After Chris picks a winner, the **next** brief will be: "expand the chosen direction to a full
design system + kitchen-sink page", at which point you'll start porting sections from v1.

## Workflow recap

1. Branch off `main` for everything (never commit to `main` directly)
2. One PR per logical change (don't bundle 5 sections into one)
3. Self-review checklist on every PR (light + dark, mobile + desktop, no console errors, no
   broken charts, no `any` types, lint clean)
4. Wait for review before merging

## Communication

- Questions go in PR description threads, not in code comments
- If something is genuinely ambiguous, make a defensible call and FLAG IT in the PR description
  — don't block on confirmation
- Read [`README.md`](./README.md) and this file BEFORE asking anything you could have answered yourself

## Final reminder

You're building UI. You're not touching the bot, the executor, the strategy logic, or any
contract that affects real money. Stay in your lane and this collaboration will go great.
