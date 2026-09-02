'use client'
import React from 'react'

/**
 * PANEL ERROR BOUNDARY (2026-08-28).
 *
 * The Contenders tab has gone completely dark three times — twice from a value shaped differently
 * than the render expected, once from a hook placed after a conditional return. Each time the
 * whole admin page showed "This page couldn't load" and every OTHER panel died with it, because
 * an uncaught render error unmounts the entire React tree.
 *
 * A panel failing should cost that panel, not the page. This catches the error, names the panel,
 * shows the message so it is diagnosable without opening devtools, and leaves every sibling tab
 * working. It is deliberately NOT a silent catch: a broken panel must look broken.
 */
type P = { name: string; children: React.ReactNode }
type S = { err: Error | null }

export class PanelBoundary extends React.Component<P, S> {
  state: S = { err: null }

  static getDerivedStateFromError(err: Error): S {
    return { err }
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    if (typeof window !== 'undefined') {
      console.error(`[panel:${this.props.name}] render failed —`, err, info?.componentStack)
    }
  }

  render() {
    if (!this.state.err) return this.props.children as React.ReactElement
    return (
      <div className="card card-pad" style={{ margin: '12px 0', fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 800, color: '#b91c1c', marginBottom: 4 }}>
          The {this.props.name} panel failed to render.
        </div>
        <div style={{ color: 'var(--ink-mute)' }}>
          Every other tab still works — this boundary stops one panel taking the whole page down.
        </div>
        <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--ink-mute)' }}>
          {String(this.state.err?.message ?? this.state.err)}
        </pre>
        <button onClick={() => this.setState({ err: null })} style={{ marginTop: 6 }}>
          retry this panel
        </button>
      </div>
    )
  }
}
