'use client'

/**
 * Tiny i18n hook — keys → ENG/PT strings. Language is owned by the topbar
 * (StaxTopBar), persisted to localStorage('stax-lang'), and broadcast via
 * `<html data-lang="...">` so any subtree can read it without prop drilling.
 *
 * Usage:
 *   const t = useT()
 *   <h1>{t('settings.title')}</h1>
 *
 * To add a new string: add ENG + PT under the same key in TRANSLATIONS.
 * Missing keys fall back to the key itself (loud failure, easy to spot).
 */

import { useEffect, useState } from 'react'

export type Lang = 'ENG' | 'PT'

const TRANSLATIONS: Record<string, { en: string; pt: string }> = {
  // Sidebar nav
  'nav.dashboard':   { en: 'Dashboard',     pt: 'Painel' },
  'nav.live':        { en: 'Live Trading',  pt: 'Trading Ao Vivo' },
  'nav.backtesting': { en: 'Backtesting',   pt: 'Backtesting' },
  'nav.broker':      { en: 'Broker',        pt: 'Parceiro' },
  'nav.admin':       { en: 'Admin',         pt: 'Admin' },
  'nav.settings':    { en: 'Settings',      pt: 'Configurações' },
  'nav.signout':     { en: 'Sign Out',      pt: 'Sair' },

  // Settings tabs
  'settings.title':         { en: 'Settings',          pt: 'Configurações' },
  'settings.profile':       { en: 'Profile',           pt: 'Perfil' },
  'settings.billing':       { en: 'Billing',           pt: 'Assinatura' },
  'settings.bot':           { en: 'Bot Settings',      pt: 'Configurações do Bot' },
  'settings.notifications': { en: 'Notifications',     pt: 'Notificações' },
  'settings.security':      { en: 'Security',          pt: 'Segurança' },
  'settings.payout':        { en: 'Payout Settings',   pt: 'Pagamentos' },

  // Profile form
  'profile.email':          { en: 'Email',                pt: 'Email' },
  'profile.displayName':    { en: 'Display Name',         pt: 'Nome de Exibição' },
  'profile.namePlaceholder':{ en: 'Your name',            pt: 'Seu nome' },
  'profile.missionTarget':  { en: 'Mission Target (BTC)', pt: 'Meta da Missão (BTC)' },
  'profile.missionHelp':    { en: 'This updates the Mission Control target on your dashboard.', pt: 'Isto atualiza a meta no Painel.' },
  'profile.save':           { en: 'Save Changes',         pt: 'Salvar Alterações' },
  'profile.saved':          { en: 'Saved',                pt: 'Salvo' },

  // Billing
  'billing.title':          { en: 'Subscription',  pt: 'Assinatura' },
  'billing.currentPlan':    { en: 'Current Plan:', pt: 'Plano Atual:' },
  'billing.free':           { en: 'Free',          pt: 'Grátis' },
  'billing.upgrade':        { en: 'Upgrade to access automated trading.', pt: 'Faça upgrade para acessar trading automatizado.' },
  'billing.managePlan':     { en: 'Manage Plan',   pt: 'Gerenciar Plano' },
  'billing.subscribe':      { en: 'Subscribe',     pt: 'Assinar' },

  // Bot settings
  'bot.title':              { en: 'Bot Settings',  pt: 'Configurações do Bot' },
  'bot.tier':               { en: 'Trading Mode',  pt: 'Modo de Trading' },
  'bot.tierConservative':   { en: 'Conservative',  pt: 'Conservador' },
  'bot.tierBold':           { en: 'Bold',          pt: 'Audacioso' },
  'bot.tierAggressive':     { en: 'Aggressive',    pt: 'Agressivo' },
  'bot.leverage':           { en: 'Leverage',      pt: 'Alavancagem' },
  'bot.notional':           { en: 'Position Size', pt: 'Tamanho da Posição' },
  'bot.status':             { en: 'Bot Status',    pt: 'Status do Bot' },
  'bot.active':             { en: 'Active',        pt: 'Ativo' },
  'bot.paused':             { en: 'Paused',        pt: 'Pausado' },
  'bot.notActivated':       { en: 'Not Activated',  pt: 'Não Ativado' },
  'bot.openWizard':         { en: 'Open Wizard to configure your bot', pt: 'Abrir Assistente para configurar' },

  // Notifications
  'notif.title':            { en: 'Notification Preferences', pt: 'Preferências de Notificações' },
  'notif.tradeAlerts':      { en: 'Trade alerts',       pt: 'Alertas de trade' },
  'notif.tradeAlertsHelp':  { en: 'Email + Telegram when a position opens or closes.', pt: 'Email + Telegram quando uma posição abre ou fecha.' },
  'notif.weeklyReport':     { en: 'Weekly performance report', pt: 'Relatório semanal' },
  'notif.weeklyHelp':       { en: 'Sunday recap of P&L, win rate, drawdown.', pt: 'Resumo semanal de P&L, win rate e drawdown.' },
  'notif.systemAlerts':     { en: 'System alerts',      pt: 'Alertas do sistema' },
  'notif.systemHelp':       { en: 'Critical issues — feed staleness, kill switch, account margin.', pt: 'Problemas críticos — dados, kill switch, margem.' },

  // Security
  'security.title':         { en: 'Security',                     pt: 'Segurança' },
  'security.changePassword':{ en: 'Change Password',              pt: 'Alterar Senha' },
  'security.currentPwd':    { en: 'Current password',             pt: 'Senha atual' },
  'security.newPwd':        { en: 'New password',                 pt: 'Nova senha' },
  'security.confirmPwd':    { en: 'Confirm new password',         pt: 'Confirmar nova senha' },
  'security.update':        { en: 'Update Password',              pt: 'Atualizar Senha' },
  'security.sessions':      { en: 'Active Sessions',              pt: 'Sessões Ativas' },
  'security.signOutAll':    { en: 'Sign out everywhere',          pt: 'Sair de todos os dispositivos' },

  // Payout
  'payout.title':           { en: 'Payout Settings',     pt: 'Configurações de Pagamento' },
  'payout.method':          { en: 'Payout Method',       pt: 'Método de Pagamento' },
  'payout.bitcoin':         { en: 'Bitcoin (on-chain)',  pt: 'Bitcoin (on-chain)' },
  'payout.usdt':            { en: 'USDT (TRC20)',        pt: 'USDT (TRC20)' },
  'payout.bank':            { en: 'Bank transfer',       pt: 'Transferência bancária' },
  'payout.address':         { en: 'Wallet address',      pt: 'Endereço da carteira' },
  'payout.minPayout':       { en: 'Minimum payout',      pt: 'Pagamento mínimo' },
  'payout.save':            { en: 'Save Payout Method',  pt: 'Salvar Método' },

  // Backtesting
  'backtest.title':         { en: 'Backtesting',         pt: 'Backtesting' },
  'backtest.subtitle':      { en: 'Verified performance.', pt: 'Performance verificada.' },
  'backtest.totalPnl':      { en: 'Total Net P&L',       pt: 'P&L Líquido Total' },
  'backtest.maxDD':         { en: 'Max Drawdown',        pt: 'Drawdown Máximo' },
  'backtest.totalTrades':   { en: 'Total Trades',        pt: 'Total de Trades' },
  'backtest.winRate':       { en: 'Win Rate',            pt: 'Taxa de Acerto' },
  'backtest.profitFactor':  { en: 'Profit Factor',       pt: 'Fator de Lucro' },
  'backtest.equityCurve':   { en: 'Equity Curve',        pt: 'Curva de Equity' },
  'backtest.metrics':       { en: 'Metrics',             pt: 'Métricas' },
  'backtest.tradeList':     { en: 'List of Trades',      pt: 'Lista de Trades' },
  'backtest.dataFresh':     { en: 'Data updated',        pt: 'Dados atualizados' },
  'backtest.tier.conservative': { en: 'Conservative tier', pt: 'Modo Conservador' },
  'backtest.tier.bold':         { en: 'Bold tier',         pt: 'Modo Audacioso' },
  'backtest.tier.aggressive':   { en: 'Aggressive tier',   pt: 'Modo Agressivo' },
  'backtest.notional':      { en: 'notional / trade',    pt: 'nocional por trade' },
  'backtest.basket':        { en: '5-asset basket',      pt: 'Cesta de 5 ativos' },

  // Broker
  'broker.title':           { en: 'Broker Program',                 pt: 'Programa de Parceiros' },
  'broker.subtitle':        { en: 'Share Staxs, earn commission.',  pt: 'Compartilhe Staxs, ganhe comissão.' },
  'broker.referralCode':    { en: 'Your Referral Code',             pt: 'Seu Código de Indicação' },
  'broker.referralLink':    { en: 'Your Referral Link',             pt: 'Seu Link de Indicação' },
  'broker.copy':            { en: 'Copy',                           pt: 'Copiar' },
  'broker.copied':          { en: 'Copied',                         pt: 'Copiado' },
  'broker.totalEarnings':   { en: 'Total Earnings',                 pt: 'Total Ganho' },
  'broker.pending':         { en: 'Pending Claim',                  pt: 'A Receber' },
  'broker.referrals':       { en: 'Referrals',                      pt: 'Indicações' },
  'broker.split':           { en: 'Commission split',               pt: 'Divisão de comissão' },
  'broker.claim':           { en: 'Claim Earnings',                 pt: 'Resgatar' },
  'broker.minClaim':        { en: 'Minimum claim: $20',             pt: 'Resgate mínimo: $20' },
  'broker.referralsList':   { en: 'Your Referrals',                 pt: 'Suas Indicações' },
  'broker.empty':           { en: 'No referrals yet.',               pt: 'Nenhuma indicação ainda.' },

  // Common
  'common.loading':         { en: 'Loading…',         pt: 'Carregando…' },
  'common.save':            { en: 'Save',             pt: 'Salvar' },
  'common.cancel':          { en: 'Cancel',           pt: 'Cancelar' },
  'common.error':           { en: 'Something went wrong.', pt: 'Algo deu errado.' },
  'common.retry':           { en: 'Retry',            pt: 'Tentar novamente' },

  // Dashboard cards
  'card.accountBalance':    { en: 'Account Balance', pt: 'Saldo da Conta' },
  'card.equityCurve':       { en: 'Equity Curve',    pt: 'Curva de Equity' },
  'card.btcGoal':           { en: 'BTC Goal',        pt: 'Meta BTC' },
  'card.botStatus':         { en: 'Bot Status',      pt: 'Status do Bot' },
  'card.unrealizedPnl':     { en: 'Unrealized PnL',  pt: 'P&L Não Realizado' },
  'card.realizedPnl':       { en: 'Realized PnL',    pt: 'P&L Realizado' },
  'card.totalReturn':       { en: 'Total Return',    pt: 'Retorno Total' },
  'card.openPositions':     { en: 'Open Positions',  pt: 'Posições Abertas' },
  'card.recentTrades':      { en: 'Recent Trades',   pt: 'Trades Recentes' },
  'card.currentLeverage':   { en: 'Current Leverage',pt: 'Alavancagem Atual' },
  'card.winRate20':         { en: 'Win Rate (Last 20)', pt: 'Taxa de Acerto (Últ. 20)' },
  'card.winRate50':         { en: 'Win Rate (Last 50)', pt: 'Taxa de Acerto (Últ. 50)' },
  'card.currentStreak':     { en: 'Current Streak',  pt: 'Sequência Atual' },

  // Status sub-text
  'status.watching':        { en: 'Watching',          pt: 'Observando' },
  'status.active':          { en: 'Active',            pt: 'Ativo' },
  'status.noOpen':          { en: 'No open position',  pt: 'Sem posição aberta' },
  'status.allTime':         { en: 'All time',          pt: 'Desde o início' },
  'status.noTrades':        { en: 'No trades yet',     pt: 'Sem trades ainda' },
  'status.closed':          { en: 'closed',            pt: 'fechados' },
  'status.openPos':         { en: 'open positions',    pt: 'posições abertas' },
  'status.openPosOne':      { en: 'open position',     pt: 'posição aberta' },
  'status.recentTradesC':   { en: 'recent trades',     pt: 'trades recentes' },
  'status.recentTradeC':    { en: 'recent trade',      pt: 'trade recente' },
  'status.seeMore':         { en: '+ See more',        pt: '+ Ver mais' },
  'status.consecutiveWin':  { en: 'consecutive win',   pt: 'vitória seguida' },
  'status.consecutiveWins': { en: 'consecutive wins',  pt: 'vitórias seguidas' },
  'status.consecutiveLoss': { en: 'consecutive loss',  pt: 'derrota seguida' },
  'status.consecutiveLosses':{ en: 'consecutive losses',pt: 'derrotas seguidas' },
  'status.wins':            { en: 'wins',              pt: 'vitórias' },
  'status.losses':          { en: 'losses',            pt: 'derrotas' },

  // Tier labels (used in subtitle)
  'tier.conservative.label':{ en: 'Conservative tier · 0.5× of balance', pt: 'Modo Conservador · 0,5× do saldo' },
  'tier.bold.label':        { en: 'Bold tier · 1.0× of balance',         pt: 'Modo Audacioso · 1,0× do saldo' },
  'tier.aggressive.label':  { en: 'Aggressive tier · 1.5× of balance',   pt: 'Modo Agressivo · 1,5× do saldo' },
  'tier.conservative':      { en: 'Conservative tier', pt: 'Modo Conservador' },
  'tier.bold':              { en: 'Bold tier',         pt: 'Modo Audacioso' },
  'tier.aggressive':        { en: 'Aggressive tier',   pt: 'Modo Agressivo' },

  // Footer
  'footer.tagline':         { en: 'Precision trading, automated.', pt: 'Trading de precisão, automatizado.' },
  'footer.terms':           { en: 'Terms',           pt: 'Termos' },
  'footer.privacy':         { en: 'Privacy',         pt: 'Privacidade' },
  'footer.risk':            { en: 'Risk Disclosure', pt: 'Aviso de Risco' },
  'footer.support':         { en: 'Support',         pt: 'Suporte' },

  // Live Trading page
  'live.title':             { en: 'Live Trading',         pt: 'Trading Ao Vivo' },
  'live.myPosition':        { en: 'MY POSITION',          pt: 'MINHA POSIÇÃO' },
  'live.activePositions':   { en: 'Your active positions.', pt: 'Suas posições ativas.' },
  'live.realtimeView':      { en: 'Real-time view of your trades and history from your connected exchange.', pt: 'Visão em tempo real dos seus trades e histórico da sua corretora conectada.' },
  'live.tradeHistory':      { en: 'Trade History', pt: 'Histórico de Trades' },

  // English-keyed entries — used by stats rows that pass raw English strings
  // through t() directly (avoids refactoring the data builder).
  'Bot Status':           { en: 'Bot Status',         pt: 'Status do Bot' },
  'Unrealized PnL':       { en: 'Unrealized PnL',     pt: 'P&L Não Realizado' },
  'Realized PnL':         { en: 'Realized PnL',       pt: 'P&L Realizado' },
  'Total Return':         { en: 'Total Return',       pt: 'Retorno Total' },
  'Watching':             { en: 'Watching',           pt: 'Observando' },
  'Active':               { en: 'Active',             pt: 'Ativo' },
  'Off':                  { en: 'Off',                pt: 'Desligado' },
  'Activate to start':    { en: 'Activate to start',  pt: 'Ative para começar' },
  'No open position':     { en: 'No open position',   pt: 'Sem posição aberta' },
  'No trades yet':        { en: 'No trades yet',      pt: 'Sem trades ainda' },
  'All time':             { en: 'All time',           pt: 'Desde o início' },
  'in market':            { en: 'in market',          pt: 'em mercado' },
}

function readLang(): Lang {
  if (typeof window === 'undefined') return 'ENG'
  return (localStorage.getItem('stax-lang') === 'PT' ? 'PT' : 'ENG')
}

export function useT(): (key: string) => string {
  const [lang, setLang] = useState<Lang>(readLang)

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'stax-lang') setLang(e.newValue === 'PT' ? 'PT' : 'ENG')
    }
    function onLangChange() { setLang(readLang()) }
    window.addEventListener('storage', onStorage)
    // Custom event so the topbar can dispatch when toggling lang in same tab
    window.addEventListener('stax-lang-change', onLangChange)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('stax-lang-change', onLangChange)
    }
  }, [])

  return (key: string) => {
    const entry = TRANSLATIONS[key]
    if (!entry) return key
    return lang === 'PT' ? entry.pt : entry.en
  }
}

/** For non-component use; returns the current lang synchronously. */
export function getCurrentLang(): Lang { return readLang() }
