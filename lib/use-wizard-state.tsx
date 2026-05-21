'use client'

/**
 * Wizard / onboarding state — single source of truth for "where is this user
 * in the setup flow + tour completion". Backed by `profiles.wizard_state`
 * (JSON column) on Supabase; surfaced by the v1 endpoints which we still
 * reuse end-to-end via the next.config.ts rewrite:
 *
 *   GET  /api/wizard/state         → returns the full state object
 *   POST /api/wizard/update-state  → patch-merges + returns the new state
 *
 * Why a shared hook: the dashboard, onboarding banner, tour engine, and
 * settings tabs all need to read the SAME flags. A separate fetch per
 * consumer would (a) flicker on initial render and (b) drift if one
 * writes a patch while another is showing stale data. This module keeps
 * a single in-memory snapshot + subscribers, refreshes from server on
 * mount, and re-broadcasts every successful update().
 *
 * The flags themselves match the legacy schema 1:1 so we can swap UIs
 * without touching the server contract:
 *
 *   step1_complete         — exchange/API keys connected & validated
 *   step2_settings_saved   — user picked a bot tier and confirmed
 *   step2_card_saved       — payment method on file
 *   step3_complete         — bot activated and is live
 *   tour1_complete         — tour 1 finished (pre-activation dashboard)
 *   tour1_dismissed        — tour 1 closed via skip
 *   tour2_complete         — tour 2 finished (post-activation walkthrough)
 *   tour2_dismissed        — tour 2 closed via skip
 *   trading_mode           — selected tier (conservative/bold/aggressive)
 *   api_key_connected      — same semantics as step1_complete (legacy
 *                            duplicate — kept in sync for /api/wizard
 *                            consumers that read it directly)
 *   exchange               — 'bitget' (only supported value today)
 *   payment_status         — 'current' | 'past_due' | 'paused'
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { authedFetch } from './api'

export type WizardState = {
  step1_complete: boolean
  step2_settings_saved: boolean
  step2_card_saved: boolean
  step3_complete: boolean
  tour1_complete: boolean
  tour1_dismissed: boolean
  tour2_complete: boolean
  tour2_dismissed: boolean
  api_key_connected: boolean
  trading_mode: string | null
  exchange: string | null
  payment_status: string
}

const DEFAULT_STATE: WizardState = {
  step1_complete: false,
  step2_settings_saved: false,
  step2_card_saved: false,
  step3_complete: false,
  tour1_complete: false,
  tour1_dismissed: false,
  tour2_complete: false,
  tour2_dismissed: false,
  api_key_connected: false,
  trading_mode: null,
  exchange: null,
  payment_status: 'current',
}

type Snapshot = {
  loaded: boolean
  loading: boolean
  state: WizardState
  error: string | null
}

let snapshot: Snapshot = { loaded: false, loading: false, state: DEFAULT_STATE, error: null }
const listeners = new Set<() => void>()

function setSnapshot(next: Snapshot) {
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot() { return snapshot }
function getServerSnapshot(): Snapshot {
  return { loaded: false, loading: false, state: DEFAULT_STATE, error: null }
}

/** Force a refetch from server. Safe to call from anywhere. */
export async function refreshWizardState(): Promise<WizardState | null> {
  if (snapshot.loading) return snapshot.state
  setSnapshot({ ...snapshot, loading: true, error: null })
  try {
    const s = await authedFetch<Partial<WizardState>>('/api/wizard/state')
    const merged: WizardState = { ...DEFAULT_STATE, ...s }
    setSnapshot({ loaded: true, loading: false, state: merged, error: null })
    return merged
  } catch (e: any) {
    // Unauthed users see /api/wizard/state 401 — that's fine; treat as
    // default state. Anything else is a soft error: we keep the cached
    // state and surface .error for debugging.
    const msg = String(e?.message || '')
    if (/401|Unauthorized/i.test(msg)) {
      setSnapshot({ loaded: true, loading: false, state: DEFAULT_STATE, error: null })
      return DEFAULT_STATE
    }
    setSnapshot({ ...snapshot, loading: false, error: msg })
    return null
  }
}

/**
 * Patch the server-side state. Server merges into the wizard_state JSON
 * column and returns the new full state, which we broadcast. Callers
 * usually fire-and-forget — the returned promise resolves once persistence
 * lands, useful when the caller needs to wait before triggering an
 * auto-fired tour off the new state.
 */
export async function patchWizardState(patch: Partial<WizardState>): Promise<WizardState | null> {
  // Optimistic update: reflect the patch locally so UI doesn't lag the
  // server. If the POST fails we restore the prior snapshot.
  const prior = snapshot.state
  setSnapshot({ ...snapshot, state: { ...prior, ...patch } })
  try {
    const res = await authedFetch<{ state?: Partial<WizardState> }>('/api/wizard/update-state', {
      method: 'POST',
      body: JSON.stringify(patch),
    })
    const merged: WizardState = { ...DEFAULT_STATE, ...prior, ...patch, ...(res?.state || {}) }
    setSnapshot({ loaded: true, loading: false, state: merged, error: null })
    return merged
  } catch (e: any) {
    setSnapshot({ ...snapshot, state: prior, error: String(e?.message || '') })
    return null
  }
}

/**
 * Hook surface. Components get { state, loaded, loading, error, update }.
 * On first mount across the app, kicks off a single refresh.
 */
export function useWizardState() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    if (!snap.loaded && !snap.loading) refreshWizardState()
  }, [snap.loaded, snap.loading])

  const update = useCallback((patch: Partial<WizardState>) => patchWizardState(patch), [])

  return {
    state: snap.state,
    loaded: snap.loaded,
    loading: snap.loading,
    error: snap.error,
    update,
    refresh: refreshWizardState,
  }
}
