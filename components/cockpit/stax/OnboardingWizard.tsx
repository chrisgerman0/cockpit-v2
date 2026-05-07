'use client'

/**
 * Onboarding wizard — port of the v1 staxs-landing /onboarding flow into v2
 * design tokens. Four steps:
 *
 *   0. Bitget account creation (referral link, KYC checklist)
 *   1. API key generation (instructions + IP whitelist)
 *   2. Connect (paste API key + secret, validate via /api/validate-keys)
 *   3. Success → return to /v2
 *
 * Notes vs v1:
 *   - v1 is rendered without the v2 sidebar/topbar. v2 keeps the dashboard
 *     shell so users can see their balance and ticker while onboarding.
 *   - All Tailwind / lucide imports replaced with stax-design.css classes
 *     and inline SVG (Icons.tsx + locals).
 *   - "skip for now" → routes to /v2 (the dashboard).
 *   - Final CTA → /v2/settings?tab=bot so the user lands on Bot Settings
 *     where they can pick their tier (Conservative / Bold / Aggressive).
 */

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { authedFetch } from '@/lib/api'
import { getCurrentLang } from '@/lib/i18n'
import { Icons } from './Icons'

const STAXS_IP = '5.189.155.200'

const STEPS = [
  { titleEn: 'Account',  titlePt: 'Conta' },
  { titleEn: 'API Key',  titlePt: 'Chave API' },
  { titleEn: 'Connect',  titlePt: 'Conectar' },
  { titleEn: 'Ready',    titlePt: 'Pronto' },
] as const

// ─── Inline icons (Icons.tsx has a few but we need a wider set here) ────────

const SVG = ({ children, size = 18 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const IconBuilding = ({ size = 18 }: { size?: number }) => <SVG size={size}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22V12h6v10M9 6h.01M15 6h.01M9 10h.01M15 10h.01" /></SVG>
const IconKeyRound = ({ size = 18 }: { size?: number }) => <SVG size={size}><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 7.4-7.4M16 7l3 3M21 5l-2 2" /></SVG>
const IconLink     = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" /></SVG>
const IconRocket   = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></SVG>
const IconCheck    = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="m5 12 5 5L20 7" /></SVG>
const IconCheckCirc= ({ size = 18 }: { size?: number }) => <SVG size={size}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></SVG>
const IconAlert    = ({ size = 18 }: { size?: number }) => <SVG size={size}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></SVG>
const IconShield   = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z" /></SVG>
const IconCopy     = ({ size = 18 }: { size?: number }) => <SVG size={size}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></SVG>
const IconExt      = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></SVG>
const IconArrowR   = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M5 12h14M13 5l7 7-7 7" /></SVG>
const IconArrowL   = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M19 12H5M12 19l-7-7 7-7" /></SVG>
const IconEye      = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></SVG>
const IconEyeOff   = ({ size = 18 }: { size?: number }) => <SVG size={size}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" /></SVG>

const STEP_ICONS = [IconBuilding, IconKeyRound, IconLink, IconRocket]

// ─── Component ──────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const router = useRouter()
  const isPt = getCurrentLang() === 'PT'
  const tt = (en: string, pt: string) => (isPt ? pt : en)

  const [step, setStep] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const exchange = 'bitget' as const

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  async function validateAndSave() {
    if (!apiKey.trim() || !apiSecret.trim()) {
      setError(tt('API Key and Secret are required', 'Chave API e Secret são obrigatórias'))
      return
    }
    setValidating(true); setError('')
    try {
      // /api/validate-keys returns { valid, error? } — authedFetch returns the body directly.
      const data = await authedFetch<{ valid: boolean; error?: string }>('/api/validate-keys', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          passphrase: passphrase.trim(),
          exchange,
        }),
      })
      if (!data?.valid) {
        setError(data?.error || tt('Invalid API credentials', 'Credenciais inválidas'))
        return
      }
      try { localStorage.setItem('staxs-api-connected', 'true') } catch {}
      setStep(3)
    } catch (e: any) {
      const raw = String(e?.message || '')
      let msg = tt('Network error — check your connection', 'Erro de rede — verifique a conexão')
      const m = raw.match(/\{.*\}/)
      if (m) { try { msg = JSON.parse(m[0])?.error || msg } catch {} }
      setError(msg)
    } finally { setValidating(false) }
  }

  // ─── Progress bar ──────────────────────────────────────────────────────
  const ProgressBar = () => (
    <div className="ow-progress">
      {STEPS.map((s, i) => {
        const Ico = STEP_ICONS[i]
        const state = i < step ? 'done' : i === step ? 'active' : 'idle'
        return (
          <div key={i} className="ow-step-wrap">
            <div className={'ow-step-dot ow-' + state}>
              {state === 'done' ? <IconCheck size={16} /> : <Ico size={16} />}
            </div>
            <div className={'ow-step-label ow-' + state}>{isPt ? s.titlePt : s.titleEn}</div>
            {i < STEPS.length - 1 && <div className={'ow-step-bar ow-' + (i < step ? 'done' : 'idle')} />}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="stax-page">
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">{tt('SETUP WIZARD', 'ASSISTENTE DE CONFIGURAÇÃO')}</div>
        <h1 className="bt-title">
          {tt('Connect ', 'Conecte ')}<span className="bt-title-gold">{tt('Bitget.', 'a Bitget.')}</span>
        </h1>
        <p className="bt-blurb">
          {tt(
            'Four steps. Your funds stay on Bitget — Staxs never holds your money. You can revoke API access at any time.',
            'Quatro passos. Seus fundos ficam na Bitget — a Staxs nunca segura seu dinheiro. Você pode revogar o acesso da API a qualquer momento.'
          )}
        </p>
      </div>

      <div className="card card-pad ow-card">
        <ProgressBar />

        {/* ── Step 0: Create Bitget account ─────────────────────────── */}
        {step === 0 && (
          <div className="ow-step-body">
            <h2 className="ow-step-title">{tt('Create a Bitget Account', 'Crie uma conta na Bitget')}</h2>
            <p className="ow-step-sub">
              {tt('Already have a Bitget account? Skip to the next step.', 'Já tem conta na Bitget? Pule para o próximo passo.')}
            </p>

            <div className="ow-info-card">
              <div className="ow-info-ico"><IconBuilding size={20} /></div>
              <div>
                <div className="ow-info-ttl">{tt('Sign up on Bitget', 'Cadastre-se na Bitget')}</div>
                <ol className="ow-list">
                  <li><span className="ow-num">1.</span> {tt('Click the link below to create your Bitget account', 'Clique no link abaixo para criar sua conta')}</li>
                  <li><span className="ow-num">2.</span> {tt('Complete email verification', 'Confirme seu email')}</li>
                  <li><span className="ow-num">3.</span> {tt('Complete KYC — required for futures trading', 'Conclua o KYC — necessário para futuros')}</li>
                  <li><span className="ow-num">4.</span> {tt('Enable Futures in your Bitget account', 'Habilite os Futuros na sua conta Bitget')}</li>
                  <li><span className="ow-num">5.</span> {tt('Deposit USDT to your Futures wallet', 'Deposite USDT na carteira de Futuros')}</li>
                </ol>
                <a href="https://partner.bitget.com/bg/M606BQ" target="_blank" rel="noreferrer noopener" className="ow-link-cta">
                  {tt('Create Bitget Account', 'Criar conta Bitget')} <IconExt size={13} />
                </a>
              </div>
            </div>

            <div className="ow-shield-card">
              <IconShield size={18} />
              <div>
                <div className="ow-shield-ttl">{tt('Your funds stay on Bitget', 'Seus fundos ficam na Bitget')}</div>
                <div className="ow-shield-sub">{tt(
                  'Staxs never holds your money. We only use API keys to place trades. You can revoke access at any time.',
                  'A Staxs nunca segura seu dinheiro. As chaves de API são usadas apenas para abrir trades. Você pode revogar o acesso a qualquer momento.'
                )}</div>
              </div>
            </div>

            <div className="ow-actions">
              <button type="button" className="ow-btn-skip" onClick={() => router.push('/')}>
                {tt('skip for now', 'pular por enquanto')}
              </button>
              <button type="button" className="ow-btn-primary" onClick={() => setStep(1)}>
                {tt("I've Created My Account", 'Conta criada')} <IconArrowR size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: API setup guide ──────────────────────────────── */}
        {step === 1 && (
          <div className="ow-step-body">
            <h2 className="ow-step-title">{tt('Generate Your Bitget API Key', 'Gere sua chave de API na Bitget')}</h2>
            <p className="ow-step-sub">
              {tt('Follow these steps in your Bitget account.', 'Siga estes passos na sua conta Bitget.')}
            </p>

            <div className="ow-info-list">
              <ApiStep n={1} title={tt('Go to API Management', 'Acesse a Gestão de API')}>
                {tt('Log in to Bitget → click your ', 'Entre na Bitget → clique no ')}
                <strong>{tt('Profile icon', 'ícone do Perfil')}</strong>
                {' '}({tt('top right', 'topo direito')}) → <strong>API Management</strong>
                <a href="https://www.bitget.com/account/newapi" target="_blank" rel="noreferrer noopener" className="ow-link-cta-sm">
                  {tt('Open API Management', 'Abrir Gestão de API')} <IconExt size={11} />
                </a>
              </ApiStep>
              <ApiStep n={2} title={tt('Create API', 'Criar API')}>
                {tt('Click ', 'Clique em ')}<strong>Create API</strong> → {tt('select ', 'selecione ')}
                <strong>HMAC</strong> → {tt('label it ', 'rotule como ')}
                <span className="ow-mono-gold">Staxs Trading</span>
              </ApiStep>
              <ApiStep n={3} title={tt('Set permissions', 'Defina as permissões')}>
                <p>• {tt('Enable ', 'Ative ')}<strong>Futures</strong>{tt(' only', ' apenas')}</p>
                <p>• {tt('Disable ', 'Desative ')}<strong>{tt('all other permissions', 'todas as outras permissões')}</strong>, {tt('especially Withdrawals', 'especialmente Saques')}</p>
                <p>• {tt('Under "Restrict access to trusted IPs only", paste the Staxs server IP:', 'Em "Restringir acesso a IPs confiáveis", cole o IP do servidor Staxs:')}</p>
                <button type="button" onClick={() => copyText(STAXS_IP, 'ip')} className="ow-ip-pill">
                  <span className="ow-mono-gold">{STAXS_IP}</span>
                  {copied === 'ip' ? <IconCheck size={13} /> : <IconCopy size={13} />}
                </button>
              </ApiStep>
              <ApiStep n={4} title={tt('Save your keys', 'Salve suas chaves')}>
                <p>{tt('Copy your ', 'Copie sua ')}<strong>API Key</strong>{tt(' and ', ' e ')}<strong>Secret Key</strong>{tt(" — you'll paste them in the next step.", ' — você as colará no próximo passo.')}</p>
                <div className="ow-warn">
                  <IconAlert size={14} />
                  <p>{tt('The Secret Key is only shown once. Save it before closing.', 'A Secret Key é exibida apenas uma vez. Salve antes de fechar.')}</p>
                </div>
              </ApiStep>
            </div>

            <div className="ow-actions">
              <button type="button" className="ow-btn-skip" onClick={() => setStep(0)}>
                <IconArrowL size={14} /> {tt('Back', 'Voltar')}
              </button>
              <button type="button" className="ow-btn-primary" onClick={() => setStep(2)}>
                {tt("I've Generated My Key", 'Chave gerada')} <IconArrowR size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Connect API keys ─────────────────────────────── */}
        {step === 2 && (
          <div className="ow-step-body">
            <h2 className="ow-step-title">{tt('Connect Your Bitget Account', 'Conecte sua conta Bitget')}</h2>
            <p className="ow-step-sub">
              {tt("Paste your API credentials below. We'll verify them instantly.", 'Cole suas credenciais abaixo. Vamos validar imediatamente.')}
            </p>

            <div className="ow-form">
              <div>
                <label className="ow-label">API Key</label>
                <div className="ow-input-wrap">
                  <span className="ow-input-ico"><IconKeyRound size={14} /></span>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={e => { setApiKey(e.target.value); setError('') }}
                    placeholder={tt('Your Bitget API key', 'Sua chave API Bitget')}
                    className="settings-input ow-input-mono"
                  />
                </div>
              </div>

              <div>
                <label className="ow-label">{tt('Secret Key', 'Secret Key')}</label>
                <div className="ow-input-wrap">
                  <span className="ow-input-ico"><IconShield size={14} /></span>
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={apiSecret}
                    onChange={e => { setApiSecret(e.target.value); setError('') }}
                    placeholder={tt('Your secret key', 'Sua secret key')}
                    className="settings-input ow-input-mono"
                  />
                  <button
                    type="button"
                    className="ow-input-eye"
                    onClick={() => setShowSecret(s => !s)}
                    aria-label={showSecret ? tt('Hide secret', 'Esconder') : tt('Show secret', 'Mostrar')}
                  >
                    {showSecret ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="ow-label">{tt('Passphrase', 'Passphrase')} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({tt('Bitget only', 'somente Bitget')})</span></label>
                <div className="ow-input-wrap">
                  <span className="ow-input-ico"><IconKeyRound size={14} /></span>
                  <input
                    type="text"
                    value={passphrase}
                    onChange={e => { setPassphrase(e.target.value); setError('') }}
                    placeholder={tt('Your passphrase (set during API key creation)', 'Sua passphrase (definida ao criar a API)')}
                    className="settings-input ow-input-mono"
                  />
                </div>
              </div>
            </div>

            {error ? (
              <div className="ow-error">
                <IconAlert size={14} />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="ow-shield-card">
              <IconShield size={18} />
              <div className="ow-shield-sub">{tt(
                "Your keys are encrypted and stored securely. They're only used to execute trades on your behalf. No withdrawal access is possible.",
                'Suas chaves são criptografadas e armazenadas com segurança. Usadas apenas para executar trades. Sem acesso a saque.'
              )}</div>
            </div>

            <div className="ow-actions">
              <button type="button" className="ow-btn-skip" onClick={() => setStep(1)}>
                <IconArrowL size={14} /> {tt('Back', 'Voltar')}
              </button>
              <button
                type="button"
                className="ow-btn-primary"
                onClick={validateAndSave}
                disabled={validating || !apiKey || !apiSecret}
              >
                {validating
                  ? tt('Validating…', 'Validando…')
                  : <>{tt('Validate & Connect', 'Validar & Conectar')} <IconArrowR size={14} /></>}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Success ──────────────────────────────────────── */}
        {step === 3 && (
          <div className="ow-step-body ow-success">
            <div className="ow-success-ring"><IconCheckCirc size={40} /></div>
            <h2 className="ow-step-title" style={{ textAlign: 'center' }}>{tt("You're All Set", 'Tudo pronto')}</h2>
            <p className="ow-step-sub" style={{ textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
              {tt(
                'Your Bitget account is connected and verified. Satoshi Stacker is ready to trade.',
                'Sua conta Bitget está conectada e verificada. Satoshi Stacker pronto para operar.'
              )}
            </p>

            <ul className="ow-success-list">
              <li><span className="pos-text"><IconCheckCirc size={14} /></span> {tt('API keys verified', 'Chaves verificadas')}</li>
              <li><span className="pos-text"><IconCheckCirc size={14} /></span> {tt('Bitget account connected', 'Bitget conectada')}</li>
              <li><span style={{ color: 'var(--gold)' }}><IconCheckCirc size={14} /></span> {tt('Review your bot settings before going live', 'Revise as configurações do bot antes de ir ao vivo')}</li>
            </ul>

            <div className="ow-actions" style={{ justifyContent: 'center' }}>
              <Link href="/settings?tab=bot" prefetch className="ow-btn-primary" style={{ textDecoration: 'none' }}>
                {tt('Review Bot Settings', 'Revisar configurações do bot')} <IconArrowR size={14} />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ApiStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="ow-info-card">
      <div className="ow-info-num">{n}</div>
      <div>
        <div className="ow-info-ttl">{title}</div>
        <div className="ow-info-body">{children}</div>
      </div>
    </div>
  )
}
