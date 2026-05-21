'use client'

/**
 * Dashboard home — client wrapper.
 *
 * Reads two query params for legacy-compatible deep links:
 *   ?setup=bot     — empty-state CenterMessages link here when the user
 *                    hasn't activated the bot. We forward to the wizard.
 *                    If the user has no API keys yet, send them to the
 *                    full /onboarding flow first; if they have keys but
 *                    haven't activated, send them to /settings?tab=bot
 *                    where the BotSettingsWizard lives.
 *   ?replayTour=tour1|tour2  — Settings → Tour panel sets this when the
 *                    user clicks "Replay". The dashboard mounts the
 *                    OnboardingTourController with forceTour=<which>.
 *
 * Both params are cleared from the URL after handling so back/refresh
 * doesn't replay them.
 */

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DashboardLive } from '@/components/cockpit/DashboardLive'
import { OnboardingTourController } from '@/components/cockpit/stax/OnboardingTour'
import { refreshWizardState, useWizardState } from '@/lib/use-wizard-state'

export function DashboardHomeClient() {
  const router = useRouter()
  const search = useSearchParams()
  const { state, loaded } = useWizardState()
  const [forceTour, setForceTour] = useState<'tour1' | 'tour2' | null>(null)

  // Handle ?setup=bot — route to the right next step in the funnel.
  useEffect(() => {
    if (!loaded) return
    if (search?.get('setup') !== 'bot') return
    if (!state.step1_complete) {
      router.replace('/onboarding')
    } else {
      router.replace('/settings?tab=bot')
    }
  }, [search, loaded, state.step1_complete, router])

  // Handle ?replayTour=tour1|tour2 — fire the requested tour on the live
  // dashboard, then strip the query param so reload doesn't re-fire.
  useEffect(() => {
    const which = search?.get('replayTour')
    if (which !== 'tour1' && which !== 'tour2') return
    setForceTour(which)
    // Strip ?replayTour while preserving any other params.
    const params = new URLSearchParams(Array.from(search?.entries() || []))
    params.delete('replayTour')
    const next = params.toString()
    router.replace('/' + (next ? '?' + next : ''))
  }, [search, router])

  // Whenever the page is shown after navigation, ensure wizard state is
  // current — useful when coming back from a wizard step that just
  // patched server state in another tab.
  useEffect(() => { refreshWizardState() }, [])

  return (
    <>
      <DashboardLive />
      {forceTour && loaded && (
        <OnboardingTourController
          step1Complete={state.step1_complete}
          step3Complete={state.step3_complete}
          tour1Complete={state.tour1_complete}
          tour1Dismissed={state.tour1_dismissed}
          tour2Complete={state.tour2_complete}
          tour2Dismissed={state.tour2_dismissed}
          forceTour={forceTour}
          onClose={() => setForceTour(null)}
        />
      )}
    </>
  )
}
