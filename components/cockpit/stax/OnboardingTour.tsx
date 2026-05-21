'use client'

/**
 * Custom on-dashboard tour engine — a sleek alternative to the legacy
 * driver.js implementation. Built from scratch so we control every pixel.
 *
 * Visual design (see onboarding-tour.css):
 *   • Full-screen dim overlay (rgba 0,0,0,0.62) with an SVG mask cutting
 *     a rounded "hole" around the target element. Targets stay fully
 *     interactable visually (text + colour are unobscured) which makes
 *     the spotlight feel intentional, not a paywall curtain.
 *   • A double pulsing ring (gold + faint gold) drawn just outside the
 *     hole, animated via CSS keyframes (no JS RAF — keeps the engine cheap).
 *   • A floating callout card auto-positioned next to the target. Side
 *     (top/bottom/left/right) chosen each frame from the target rect +
 *     viewport, so it never clips off-screen.
 *   • A solid-gold arrow drawn on the card pointing at the target — the
 *     legacy tour had no arrow, this is the "more classy" upgrade Chris
 *     asked for.
 *   • Card has: step counter (1/6 etc.), title, body, Skip + Back + Next.
 *     Final step's CTA is "Done" and on click it patches tourN_complete:true.
 *     Skip patches tourN_dismissed:true.
 *
 * Resize / scroll handling: the engine re-measures on resize, scroll
 * (both window + nearest scroll parent), and DOM mutations within the
 * page shell — covers tab switches, content load-in, and sidebar collapse.
 *
 * Step definitions (TOUR1_STEPS, TOUR2_STEPS) live at the bottom. Selectors
 * use `data-tour="..."` markers added to dashboard widgets — no fragile
 * class/id coupling.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { patchWizardState } from '@/lib/use-wizard-state'

// ─── Types ─────────────────────────────────────────────────────────────────

export type TourStep = {
  /** data-tour value to target. Falls back to scrolling the page (no spotlight) if missing. */
  selector: string
  title: string
  body: string
  /** Preferred placement; engine still flips if it would clip. */
  prefer?: 'top' | 'bottom' | 'left' | 'right'
  /** Extra padding around the spotlight hole, in px. Default 8. */
  pad?: number
  /** Optional pre-show callback (e.g. navigate to a tab) — return a Promise to await. */
  onEnter?: () => Promise<void> | void
}

type Rect = { top: number; left: number; width: number; height: number }
type Placement = 'top' | 'bottom' | 'left' | 'right'

type Props = {
  steps: TourStep[]
  /** Called when the tour reaches its last step and the user clicks Done. */
  onComplete: () => void
  /** Called when the user closes early via the × or Skip. */
  onDismiss: () => void
}

// ─── Engine ────────────────────────────────────────────────────────────────

const CALLOUT_W = 340
const CALLOUT_GAP = 16   // px between target and callout
const VIEWPORT_PAD = 16  // px from viewport edges

export function OnboardingTour({ steps, onComplete, onDismiss }: Props) {
  const [idx, setIdx] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [calloutPos, setCalloutPos] = useState<{ top: number; left: number; placement: Placement } | null>(null)
  const [missing, setMissing] = useState(false)

  const step = steps[idx]
  const total = steps.length
  const isLast = idx === total - 1

  // ── Measure + place ──────────────────────────────────────────────────────
  const measure = useCallback(() => {
    if (!step) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.selector}"]`)
    if (!el) {
      setTargetRect(null)
      setCalloutPos(null)
      setMissing(true)
      return
    }
    setMissing(false)
    const r = el.getBoundingClientRect()
    const pad = step.pad ?? 8
    const tr: Rect = {
      top: Math.max(0, r.top - pad),
      left: Math.max(0, r.left - pad),
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    }
    setTargetRect(tr)

    // Pick a placement that fits.
    const vw = window.innerWidth
    const vh = window.innerHeight
    const placements: Placement[] = step.prefer
      ? [step.prefer, 'bottom', 'top', 'right', 'left']
      : ['bottom', 'top', 'right', 'left']

    const calloutEstHeight = 200 // tall enough for title + 2-3 lines + buttons
    let chosen: Placement = 'bottom'
    for (const p of placements) {
      if (p === 'bottom' && tr.top + tr.height + CALLOUT_GAP + calloutEstHeight < vh - VIEWPORT_PAD) { chosen = p; break }
      if (p === 'top' && tr.top - CALLOUT_GAP - calloutEstHeight > VIEWPORT_PAD) { chosen = p; break }
      if (p === 'right' && tr.left + tr.width + CALLOUT_GAP + CALLOUT_W < vw - VIEWPORT_PAD) { chosen = p; break }
      if (p === 'left' && tr.left - CALLOUT_GAP - CALLOUT_W > VIEWPORT_PAD) { chosen = p; break }
    }

    let top = 0, left = 0
    if (chosen === 'bottom') {
      top = tr.top + tr.height + CALLOUT_GAP
      left = clamp(tr.left + tr.width / 2 - CALLOUT_W / 2, VIEWPORT_PAD, vw - CALLOUT_W - VIEWPORT_PAD)
    } else if (chosen === 'top') {
      top = tr.top - CALLOUT_GAP - calloutEstHeight
      left = clamp(tr.left + tr.width / 2 - CALLOUT_W / 2, VIEWPORT_PAD, vw - CALLOUT_W - VIEWPORT_PAD)
    } else if (chosen === 'right') {
      top = clamp(tr.top + tr.height / 2 - calloutEstHeight / 2, VIEWPORT_PAD, vh - calloutEstHeight - VIEWPORT_PAD)
      left = tr.left + tr.width + CALLOUT_GAP
    } else {
      top = clamp(tr.top + tr.height / 2 - calloutEstHeight / 2, VIEWPORT_PAD, vh - calloutEstHeight - VIEWPORT_PAD)
      left = tr.left - CALLOUT_GAP - CALLOUT_W
    }
    setCalloutPos({ top, left, placement: chosen })
  }, [step])

  // Run onEnter side-effects (e.g. navigate to a tab) before measuring.
  useEffect(() => {
    let cancelled = false
    async function enter() {
      if (step?.onEnter) {
        try { await step.onEnter() } catch {}
      }
      if (cancelled) return
      // Give layout a tick before first measure (in case onEnter caused mounts).
      requestAnimationFrame(measure)
    }
    enter()
    return () => { cancelled = true }
  }, [idx, step, measure])

  // Re-measure on resize / scroll / DOM changes.
  useLayoutEffect(() => {
    function onResize() { measure() }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    const mo = new MutationObserver(() => { measure() })
    mo.observe(document.body, { childList: true, subtree: true, attributes: false })
    // Auto-scroll target into view on step change.
    const el = step ? document.querySelector<HTMLElement>(`[data-tour="${step.selector}"]`) : null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
      mo.disconnect()
    }
  }, [idx, step, measure])

  // ── Keyboard nav ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onDismiss() }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); advance() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, isLast])

  function advance() {
    if (isLast) onComplete()
    else setIdx(i => Math.min(total - 1, i + 1))
  }
  function back() {
    setIdx(i => Math.max(0, i - 1))
  }

  if (!step) return null

  // Build the SVG mask. If no target found, we still show the overlay but
  // center the callout on-screen — keeps the user from losing the tour.
  const fallbackCallout = {
    top: Math.max(VIEWPORT_PAD, (typeof window !== 'undefined' ? window.innerHeight : 800) / 2 - 110),
    left: Math.max(VIEWPORT_PAD, (typeof window !== 'undefined' ? window.innerWidth : 1200) / 2 - CALLOUT_W / 2),
    placement: 'bottom' as Placement,
  }
  const pos = calloutPos || fallbackCallout

  return (
    <div className="otr-root" role="dialog" aria-modal="true" aria-label="Onboarding tour">
      {/* Mask layer: a full-screen dimmed surface with a rounded "hole" cut
          out around the target rect. Renders crisply at any zoom level. */}
      <svg className="otr-mask" aria-hidden="true">
        <defs>
          <mask id="otr-spot-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx="10"
                ry="10"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.62)" mask="url(#otr-spot-mask)" />
      </svg>

      {/* Pulsing ring drawn just outside the spotlight. Two layered divs
          give a "double pulse" — the inner crisp gold edge plus a slower
          outer ripple. CSS handles all the animation. */}
      {targetRect && (
        <>
          <div
            className="otr-ring otr-ring-edge"
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
            aria-hidden="true"
          />
          <div
            className="otr-ring otr-ring-pulse"
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
            aria-hidden="true"
          />
        </>
      )}

      {/* The callout. position:fixed, placed each frame by measure(). */}
      <div
        className={`otr-callout otr-place-${pos.placement}`}
        style={{ top: pos.top, left: pos.left, width: CALLOUT_W }}
      >
        {/* Arrow pointing toward the target. Renders on the side closest
            to the target — flipped via placement class. */}
        {targetRect && <span className="otr-arrow" aria-hidden="true" />}

        <button
          type="button"
          className="otr-close"
          onClick={onDismiss}
          aria-label="Close tour"
        >×</button>

        <div className="otr-eyebrow">
          <span className="otr-eyebrow-dot" /> Step {idx + 1} of {total}
        </div>
        <div className="otr-title">{step.title}</div>
        <div className="otr-body">{step.body}</div>
        {missing && (
          <div className="otr-note">
            Tip: this widget will appear here once your bot has activity. The tour will keep working — just click Next.
          </div>
        )}

        <div className="otr-actions">
          {idx > 0 ? (
            <button type="button" className="otr-btn otr-btn-ghost" onClick={back}>Back</button>
          ) : (
            <button type="button" className="otr-btn otr-btn-ghost" onClick={onDismiss}>Skip</button>
          )}
          <button type="button" className="otr-btn otr-btn-primary" onClick={advance}>
            {isLast ? 'Done' : 'Next →'}
          </button>
        </div>

        <div className="otr-progress">
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={'otr-progress-dot' + (i <= idx ? ' otr-progress-dot-on' : '')} />
          ))}
        </div>
      </div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }

// ─── Step definitions ──────────────────────────────────────────────────────

/**
 * TOUR 1 — fires after API keys are connected, before bot activation.
 * Mirrors legacy client-dashboard.html line 14175-14182 but rewritten
 * for v2 widget anatomy and slightly tighter copy.
 */
export const TOUR1_STEPS: TourStep[] = [
  {
    selector: 'mission',
    title: 'Your Mission',
    body: 'Track your progress toward your target. Every closed trade nudges this bar — it compounds over time.',
    prefer: 'bottom',
  },
  {
    selector: 'balance',
    title: 'Live Balance',
    body: "Your Bitget USDT-Futures balance. Updates in real time once your keys are connected.",
    prefer: 'bottom',
  },
  {
    selector: 'unrealized-pnl',
    title: 'Unrealized PnL',
    body: 'Open-position profit and loss, marked to live price. It moves as the market moves.',
    prefer: 'bottom',
  },
  {
    selector: 'realized-pnl',
    title: 'Realized PnL',
    body: 'Closed-trade profit and loss — your actual locked-in performance. Reset never; lifetime number.',
    prefer: 'bottom',
  },
  {
    selector: 'bot-status',
    title: 'Bot Status',
    body: "Your bot is currently inactive. Finish setup and it'll start trading the strategy automatically.",
    prefer: 'left',
  },
  {
    selector: 'setup-cta',
    title: 'One Step Left',
    body: "Pick a tier and activate the bot. After that, you're hands-off — the strategy runs itself.",
    prefer: 'top',
  },
]

/**
 * TOUR 2 — fires 2.5s after bot activation. Walks the user through the
 * widgets that only have content once the bot is live.
 */
export const TOUR2_STEPS: TourStep[] = [
  {
    selector: 'bot-status',
    title: "You're Live!",
    body: "Your bot is active and trading automatically. You don't need to do anything — just watch it work.",
    prefer: 'left',
  },
  {
    selector: 'open-positions',
    title: 'Active Positions',
    body: 'Open trades show here with entry, side, mark price, and live PnL — refreshed on every tick.',
    prefer: 'top',
  },
  {
    selector: 'equity-curve',
    title: 'Equity Curve',
    body: 'Your portfolio value over time, including open-trade marks. The line you want going up.',
    prefer: 'top',
  },
  {
    selector: 'recent-trades',
    title: 'Recent Trades',
    body: 'Most recent closed trades — entry, exit, side, PnL. The full ledger lives under Live Trading.',
    prefer: 'top',
  },
  {
    selector: 'win-rate',
    title: 'Performance Stats',
    body: 'Win rate and streak across closed trades. Wide streak panel below it tracks your recent outcomes.',
    prefer: 'top',
  },
  {
    selector: 'mission',
    title: 'Mission Progress',
    body: "Watch this bar fill as the bot compounds your account. Set a bigger target any time in Settings.",
    prefer: 'bottom',
  },
]

// ─── Auto-fire controller ──────────────────────────────────────────────────

/**
 * Drop this into the dashboard once. It reads wizard state and decides
 * which (if any) tour to fire, then handles complete/dismiss writes so
 * a finished tour never re-fires.
 *
 * NOTE: a `forceTour` prop is supported so the Settings → Tour replay
 * buttons can override the dismissed/completed flags. Replays do NOT
 * patch the dismissed flag back to false on close — they just run.
 */
export function OnboardingTourController({
  step1Complete,
  step3Complete,
  tour1Complete,
  tour1Dismissed,
  tour2Complete,
  tour2Dismissed,
  forceTour = null,
  onClose,
}: {
  step1Complete: boolean
  step3Complete: boolean
  tour1Complete: boolean
  tour1Dismissed: boolean
  tour2Complete: boolean
  tour2Dismissed: boolean
  forceTour?: 'tour1' | 'tour2' | null
  onClose?: () => void
}) {
  const active: 'tour1' | 'tour2' | null = useMemo(() => {
    if (forceTour) return forceTour
    if (step3Complete && !tour2Complete && !tour2Dismissed) return 'tour2'
    if (step1Complete && !step3Complete && !tour1Complete && !tour1Dismissed) return 'tour1'
    return null
  }, [step1Complete, step3Complete, tour1Complete, tour1Dismissed, tour2Complete, tour2Dismissed, forceTour])

  if (!active) return null

  const steps = active === 'tour1' ? TOUR1_STEPS : TOUR2_STEPS
  const isReplay = !!forceTour

  function handleComplete() {
    if (!isReplay) {
      const patch = active === 'tour1' ? { tour1_complete: true } : { tour2_complete: true }
      patchWizardState(patch as any)
    }
    onClose?.()
  }
  function handleDismiss() {
    if (!isReplay) {
      const patch = active === 'tour1' ? { tour1_dismissed: true } : { tour2_dismissed: true }
      patchWizardState(patch as any)
    }
    onClose?.()
  }

  return <OnboardingTour key={active} steps={steps} onComplete={handleComplete} onDismiss={handleDismiss} />
}
