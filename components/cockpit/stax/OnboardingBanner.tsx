'use client'

/**
 * Onboarding progress strip — three-step status above the dashboard. Mirrors
 * the legacy client-dashboard.html banner (line 13278-13328) but rendered
 * with the v2 design tokens.
 *
 * Visibility rules:
 *   - Shows only when step3_complete is false (bot not yet activated).
 *   - Auto-hides once the bot is live so the dashboard isn't cluttered.
 *
 * Step states:
 *   1) Exchange Setup  — done when step1_complete is true
 *   2) Bot Settings    — done when step2_settings_saved (and step1 done)
 *   3) Activate Bot    — done when step3_complete
 *
 * CTA next to the strip points the user to the NEXT incomplete step:
 *   - if step1 incomplete → "Connect Exchange" → /onboarding
 *   - if step1 done, step2 incomplete → "Bot Settings" → /settings?tab=bot
 *   - if step2 done, step3 incomplete → "Activate Bot" → /settings?tab=bot
 *
 * Empty (loading) state: render an invisible placeholder so the dashboard
 * doesn't reflow once state lands.
 */

import Link from 'next/link'
import { useWizardState } from '@/lib/use-wizard-state'

type StepStatus = 'complete' | 'current' | 'pending'

export function OnboardingBanner() {
  const { state, loaded } = useWizardState()

  // Hide entirely once the bot is live.
  if (loaded && state.step3_complete) return null

  // Pre-load placeholder — keep height stable to avoid layout shift.
  if (!loaded) return <div className="ob-banner ob-banner-placeholder" aria-hidden="true" />

  const s1: StepStatus = state.step1_complete ? 'complete' : 'current'
  const s2: StepStatus = state.step2_settings_saved
    ? 'complete'
    : state.step1_complete ? 'current' : 'pending'
  const s3: StepStatus = state.step3_complete
    ? 'complete'
    : (state.step2_settings_saved && state.step1_complete) ? 'current' : 'pending'

  const cta = !state.step1_complete
    ? { label: 'Connect Exchange', href: '/onboarding' }
    : !state.step2_settings_saved
      ? { label: 'Bot Settings', href: '/settings?tab=bot' }
      : { label: 'Activate Bot', href: '/settings?tab=bot' }

  return (
    <div className="ob-banner" data-tour="setup-cta">
      <div className="ob-banner-inner">
        <Step n={1} label="Exchange Setup" status={s1} />
        <Connector done={s1 === 'complete'} />
        <Step n={2} label="Bot Settings"   status={s2} />
        <Connector done={s2 === 'complete'} />
        <Step n={3} label="Activate Bot"   status={s3} />

        <div className="ob-banner-cta-wrap">
          <Link href={cta.href} prefetch className="ob-banner-cta">
            {cta.label} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

function Step({ n, label, status }: { n: number; label: string; status: StepStatus }) {
  return (
    <div className={'ob-step ob-step-' + status}>
      <div className="ob-step-dot">
        {status === 'complete' ? <Check /> : <span className="ob-step-num">{n}</span>}
      </div>
      <div className="ob-step-label">{label}</div>
    </div>
  )
}

function Connector({ done }: { done: boolean }) {
  return <div className={'ob-connector' + (done ? ' ob-connector-done' : '')} aria-hidden="true" />
}

function Check() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}
