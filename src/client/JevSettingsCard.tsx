/**
 * Settings card for the `jev-subagent-dispatch` namespace, rendered on the
 * Plugins settings tab through the keyed `settings.plugin.item` slot.
 *
 * Reads ride the framework describe-mirror via the bound settings scope; writes
 * go through the scope's revision-fenced `set`/`unset`, so this card and the
 * profile patch can never clobber each other. Deeper policy (profiles,
 * probabilityMax, routeFor) is deliberately NOT editable here — the card says so
 * and points at the profile patch. `routes` is the exception, because it is the
 * one that fails silently: a route naming a model the Subagent allowlist
 * forbids still classifies, so the verdict reads as healthy while there is
 * nowhere to dispatch. Built from plain React + design tokens to respect DSH's
 * client bundle-purity rule.
 */
import * as React from 'react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { PACKAGE_NAME } from '../shared/config.mjs'
import { localeRevision, subscribeLocale, tr } from './i18n.js'
import type { JevScope, JevSettings, SubagentAllowlist } from './types.js'

const MODES = [
  { id: 'off', labelKey: 'modeOff' as const },
  { id: 'once', labelKey: 'modeOnce' as const },
  { id: 'auto', labelKey: 'modeAuto' as const },
]
const PROVIDERS = ['bai', 'openrouter', 'typesafe']
const PROFILES = ['auto', 'careful']

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-default, #444)',
  background: 'var(--dsw-alias-bg-input, transparent)',
  color: 'inherit', font: 'inherit',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 2 }
const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--dsw-alias-text-tertiary, #888)', marginTop: 3 }
const resetStyle: React.CSSProperties = {
  marginLeft: 6, font: 'inherit', fontSize: 10, background: 'none', border: 'none',
  color: 'inherit', cursor: 'pointer', textDecoration: 'underline',
}
const segWrap: React.CSSProperties = { display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--dsw-alias-border-default, #444)', width: 'fit-content' }
const segBtn = (active: boolean): React.CSSProperties => ({
  font: 'inherit', fontSize: 12, padding: '5px 14px', border: 'none', cursor: 'pointer',
  background: active ? 'var(--dsw-alias-bg-accent, #35506b)' : 'transparent',
  color: active ? '#fff' : 'inherit',
})
const errorStyle: React.CSSProperties = { fontSize: 11, color: 'var(--dsw-alias-text-danger, #e66)', marginTop: 4 }
const versionStyle: React.CSSProperties = {
  fontSize: 10, margin: '14px 0 0', opacity: 0.55, letterSpacing: 0.2,
  fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
}
const warningStyle: React.CSSProperties = {
  fontSize: 11, margin: '0 0 12px', padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-danger, #a33)',
  background: 'var(--dsw-alias-bg-danger-subtle, rgba(200, 60, 60, 0.12))',
  color: 'var(--dsw-alias-text-danger, #e66)',
}
const groupStyle: React.CSSProperties = { borderTop: '1px solid var(--dsw-alias-border-default, #333)', marginTop: 16, paddingTop: 10 }
const headStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-text-secondary, #aaa)' }

/** Observe the bound settings scope as a React snapshot. */
function useScopeSnapshot(scope: JevScope) {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const get = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, get, get)
}

/** Re-render when the active language changes. */
function useLocaleRevision(): number {
  return useSyncExternalStore(subscribeLocale, localeRevision, localeRevision)
}

/**
 * A scope that never changes and carries nothing, used when the deployment has
 * no Subagent allowlist to read. `useSyncExternalStore` compares snapshots by
 * reference, so this is one module constant: a fresh object per read would
 * re-render forever.
 */
const NO_ALLOWLIST: ReturnType<JevScope['getSnapshot']> = {
  status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined,
}
const NO_ALLOWLIST_SCOPE: JevScope = {
  getSnapshot: () => NO_ALLOWLIST,
  subscribe: () => () => {},
  set: async () => {},
  unset: async () => {},
}

/** The allowlist as `provider/model` keys the route selects offer. */
function allowlistKeys(value: unknown): string[] {
  const entries = (value as SubagentAllowlist | undefined)?.allowedModels
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => entry?.provider && entry?.model)
    .map((entry) => `${entry.provider}/${entry.model}`)
}

/** One labeled control: local draft while editing, parse-on-commit, reset-to-base. */
function Field(props: {
  id: string
  label: string
  hint?: string
  value: string
  overridden: boolean
  disabled: boolean
  parse: (text: string) => unknown
  onCommit: (parsed: unknown) => void
  onReset: () => void
  monospace?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? props.value
  const commit = () => {
    if (draft === null) return
    setDraft(null)
    try {
      const parsed = props.parse(shown)
      setError(null)
      props.onCommit(parsed)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={props.id} style={labelStyle}>
        {props.label}
        {props.overridden && (
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: 'var(--dsw-alias-text-accent, #69f)' }}>
            {tr('overridden')}
            <button type="button" style={resetStyle} onClick={props.onReset} disabled={props.disabled}>{tr('reset')}</button>
          </span>
        )}
      </label>
      <input
        id={props.id}
        type="text"
        style={{ ...inputStyle, ...(props.monospace ? { fontFamily: 'var(--dsw-alias-font-mono, monospace)' } : {}) }}
        value={shown}
        disabled={props.disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      />
      {error !== null && <p style={errorStyle}>{error}</p>}
      {props.hint && <p style={hintStyle}>{props.hint}</p>}
    </div>
  )
}

/** A select rendered as the native control — the scope parses strings itself. */
function Choice(props: {
  id: string
  label: string
  hint?: string
  options: Array<{ id: string; label: string }>
  value: string
  overridden: boolean
  disabled: boolean
  onCommit: (value: string) => void
  onReset: () => void
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={props.id} style={labelStyle}>
        {props.label}
        {props.overridden && (
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: 'var(--dsw-alias-text-accent, #69f)' }}>
            {tr('overridden')}
            <button type="button" style={resetStyle} onClick={props.onReset} disabled={props.disabled}>{tr('reset')}</button>
          </span>
        )}
      </label>
      <select
        id={props.id}
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onCommit(e.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      {props.hint && <p style={hintStyle}>{props.hint}</p>}
    </div>
  )
}

/** The checkbox row for opt-in observability. */
function Toggle(props: {
  id: string
  label: string
  hint?: string
  checked: boolean
  overridden: boolean
  disabled: boolean
  onCommit: (value: boolean) => void
  onReset: () => void
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={props.id} style={{ ...labelStyle, fontWeight: 400 }}>
        <input
          id={props.id}
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onCommit(e.target.checked)}
          style={{ marginRight: 6, verticalAlign: 'middle' }}
        />
        {props.label}
        {props.overridden && (
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--dsw-alias-text-accent, #69f)' }}>
            {tr('overridden')}
            <button type="button" style={resetStyle} onClick={props.onReset} disabled={props.disabled}>{tr('reset')}</button>
          </span>
        )}
      </label>
      {props.hint && <p style={{ ...hintStyle, marginLeft: 20 }}>{props.hint}</p>}
    </div>
  )
}

/**
 * Top-level card.
 *
 * `heading` draws the card's own title and subtitle; the DSH 0.1.7+ plugin
 * manager row page supplies both itself around the row's form, so the
 * registration there passes `heading: false` rather than printing the title
 * twice.
 */
export function JevSettingsCard(props: { scope: JevScope; allowlist?: JevScope; subagent?: JevScope; heading?: boolean }) {
  useLocaleRevision()
  const snap = useScopeSnapshot(props.scope)
  const allowSnap = useScopeSnapshot(props.allowlist ?? NO_ALLOWLIST_SCOPE)
  const allowed = allowlistKeys(allowSnap.value)
  // Only meaningful where the deployment actually exposes the probe: without a
  // scope we say nothing rather than guess, so 0.1.5 never shows a false alarm.
  const subagentSnap = useScopeSnapshot(props.subagent ?? NO_ALLOWLIST_SCOPE)
  const subagentMissing = props.subagent !== undefined && subagentSnap.status === 'unavailable'
  const [pending, setPending] = useState(0)
  const value: JevSettings = snap.value ?? {}
  const writable = snap.writable !== false && snap.status === 'ready'
  const disabled = !writable
  const showHeading = props.heading !== false

  const commit = useCallback((field: string, parsed: unknown) => {
    setPending((n) => n + 1)
    void props.scope.set(field, parsed).catch(() => {}).finally(() => setPending((n) => n - 1))
  }, [props.scope])
  const reset = useCallback((field: string) => {
    setPending((n) => n + 1)
    void props.scope.unset(field).catch(() => {}).finally(() => setPending((n) => n - 1))
  }, [props.scope])

  // The base layer (the patch) decides whether a field shows the reset chip.
  const overridden = (field: string) => (snap.user as Record<string, unknown> | undefined)?.[field] !== undefined

  if (snap.status === 'loading') return showHeading ? <p style={hintStyle}>{tr('title')}…</p> : null
  if (snap.status === 'unavailable') return <p style={hintStyle}>{tr('unavailable')}</p>

  const number = (min: number, max: number) => (text: string) => {
    const n = Number(text)
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${min}–${max}`)
    return n
  }
  const list = (text: string) => text.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  const trimmed = (text: string) => {
    const v = text.trim()
    if (v.length === 0) throw new Error('empty')
    return v
  }
  const optionalDir = (text: string) => text.trim()

  /** Render routes as `role=provider/model` pairs, comma-separated. */
  const routesText = (routes: JevSettings['routes']): string =>
    Object.entries(routes ?? {})
      .map(([role, target]) => `${role}=${[target?.provider, target?.model].filter(Boolean).join('/')}`)
      .join(', ')
  /**
   * Parse those pairs back. An empty box returns null so the caller resets the
   * field to the shipped defaults rather than pinning an empty map; a malformed
   * entry rejects the whole commit and names its own shape in the error, which
   * is what keeps a typo from silently stranding every verdict.
   */
  const parseRoutes = (text: string): Record<string, { provider: string; model: string }> | null => {
    const entries = text.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    if (entries.length === 0) return null
    const parsed: Record<string, { provider: string; model: string }> = {}
    for (const entry of entries) {
      const eq = entry.indexOf('=')
      const slash = eq === -1 ? -1 : entry.indexOf('/', eq + 1)
      if (eq < 1 || slash < eq + 2 || slash === entry.length - 1) throw new Error('role=provider/model')
      parsed[entry.slice(0, eq).trim()] = {
        provider: entry.slice(eq + 1, slash).trim(),
        model: entry.slice(slash + 1).trim(),
      }
    }
    return parsed
  }

  return (
    <div>
      {showHeading ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{tr('title')}</div>
          <p style={{ ...hintStyle, marginTop: 0 }}>{tr('description')}{pending > 0 ? ` · ${tr('saving')}` : ''}</p>
        </>
      ) : pending > 0 ? (
        <p style={{ ...hintStyle, marginTop: 0 }}>{tr('saving')}</p>
      ) : null}

      {subagentMissing && <p style={warningStyle} role="status">{tr('subagentMissing')}</p>}

      <div style={{ marginBottom: 12 }}>
        <span style={labelStyle}>{tr('mode')}</span>
        <div style={segWrap}>
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              style={segBtn((value.mode ?? 'off') === mode.id)}
              disabled={disabled}
              onClick={() => commit('mode', mode.id)}
            >
              {tr(mode.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <Choice
        id="jev-provider" label={tr('provider')} options={PROVIDERS.map((id) => ({ id, label: id }))}
        value={value.provider ?? 'bai'} overridden={overridden('provider')} disabled={disabled}
        onCommit={(next) => commit('provider', next)} onReset={() => reset('provider')}
      />
      <Choice
        id="jev-profile" label={tr('profile')} hint={tr('profileHint')}
        options={PROFILES.map((id) => ({ id, label: id }))}
        value={value.activeProfile ?? 'auto'} overridden={overridden('activeProfile')} disabled={disabled}
        onCommit={(next) => commit('activeProfile', next)} onReset={() => reset('activeProfile')}
      />
      <Field
        id="jev-triggers" label={tr('triggers')} hint={tr('triggersHint')}
        value={(value.triggers ?? []).join(', ')} overridden={overridden('triggers')} disabled={disabled}
        parse={list} onCommit={(parsed) => commit('triggers', parsed)} onReset={() => reset('triggers')}
      />
      {allowed.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <span style={labelStyle}>
            {tr('routes')}
            {overridden('routes') && (
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: 'var(--dsw-alias-text-accent, #69f)' }}>
                {tr('overridden')}
                <button type="button" style={resetStyle} onClick={() => reset('routes')} disabled={disabled}>{tr('reset')}</button>
              </span>
            )}
          </span>
          {Object.entries(value.routes ?? {}).map(([role, target]) => {
            const current = `${target?.provider}/${target?.model}`
            // The shipped route may name a model this allowlist no longer carries;
            // keep it visible as the current option instead of silently reselecting.
            const options = allowed.includes(current) ? allowed : [current, ...allowed]
            return (
              <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <label htmlFor={`jev-route-${role}`} style={{ ...labelStyle, minWidth: 110, marginBottom: 0 }}>{role}</label>
                <select
                  id={`jev-route-${role}`}
                  style={{ ...inputStyle, width: 'auto', flex: 1 }}
                  value={current}
                  disabled={disabled}
                  onChange={(event) => {
                    const [provider, ...rest] = event.target.value.split('/')
                    commit('routes', { ...value.routes, [role]: { provider, model: rest.join('/') } })
                  }}
                >
                  {options.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>
            )
          })}
          <p style={hintStyle}>{tr('routesPickHint')}</p>
        </div>
      ) : (
        <Field
          id="jev-routes" label={tr('routes')} hint={tr('routesHint')}
          value={routesText(value.routes)} overridden={overridden('routes')} disabled={disabled}
          parse={parseRoutes} onCommit={(parsed) => {
            if (parsed === null) reset('routes')
            else commit('routes', parsed)
          }} onReset={() => reset('routes')} monospace
        />
      )}
      <Toggle
        id="jev-logturn" label={tr('logTurnText')} hint={tr('logTurnTextHint')}
        checked={value.logTurnText ?? false} overridden={overridden('logTurnText')} disabled={disabled}
        onCommit={(next) => commit('logTurnText', next)} onReset={() => reset('logTurnText')}
      />
      <Field
        id="jev-logdir" label={tr('logDir')} hint={tr('logDirHint')}
        value={value.logDir ?? ''} overridden={overridden('logDir')} disabled={disabled}
        parse={optionalDir} onCommit={(parsed) => {
          if (parsed === '') reset('logDir')
          else commit('logDir', parsed)
        }} onReset={() => reset('logDir')}
      />
      <Field
        id="jev-statechars" label={tr('stateChars')}
        value={String(value.stateChars ?? 1200)} overridden={overridden('stateChars')} disabled={disabled}
        parse={number(200, 8000)} onCommit={(parsed) => commit('stateChars', parsed)} onReset={() => reset('stateChars')}
      />

      <div style={groupStyle}>
        <p style={headStyle}>{tr('advanced')}</p>
        <p style={{ ...hintStyle, marginTop: -4, marginBottom: 8 }}>{tr('advancedHint')}</p>
        <Choice
          id="jev-apikeyenv" label={tr('apiKeyEnv')} hint={tr('apiKeyEnvHint')}
          options={PROVIDERS.map((id) => ({ id, label: id }))}
          value={value.apiKeyEnv ?? 'OPENROUTER_API_KEY'} overridden={overridden('apiKeyEnv')} disabled={disabled}
          onCommit={(next) => commit('apiKeyEnv', next)} onReset={() => reset('apiKeyEnv')}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field
            id="jev-endpoint" label={tr('endpoint')} value={value.endpoint ?? ''} overridden={overridden('endpoint')} disabled={disabled}
            parse={trimmed} onCommit={(parsed) => commit('endpoint', parsed)} onReset={() => reset('endpoint')} monospace
          />
          <Field
            id="jev-apipath" label={tr('apiPath')} value={value.apiPath ?? ''} overridden={overridden('apiPath')} disabled={disabled}
            parse={trimmed} onCommit={(parsed) => commit('apiPath', parsed)} onReset={() => reset('apiPath')} monospace
          />
          <Field
            id="jev-model" label={tr('model')} value={value.model ?? ''} overridden={overridden('model')} disabled={disabled}
            parse={trimmed} onCommit={(parsed) => commit('model', parsed)} onReset={() => reset('model')} monospace
          />
          <Field
            id="jev-timeout" label={tr('timeoutMs')} value={String(value.timeoutMs ?? 900)} overridden={overridden('timeoutMs')} disabled={disabled}
            parse={number(50, 30000)} onCommit={(parsed) => commit('timeoutMs', parsed)} onReset={() => reset('timeoutMs')}
          />
        </div>
      </div>

      {/* Which build this tab is actually running: a host restart does not reload
          an open tab, so this is the first thing to check when the card looks
          older than the release you just installed. */}
      <p style={versionStyle}>
        {PACKAGE_NAME} {'v'}
        {typeof __JEV_VERSION__ === 'string' ? __JEV_VERSION__ : 'dev'}
      </p>
    </div>
  )
}
