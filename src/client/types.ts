/**
 * The `jev-subagent-dispatch` fields this card edits. Deeper policy
 * (profiles, probabilityMax, routeFor) intentionally stays a
 * profile-patch surface — the card links to it instead of faking it.
 *
 * `routes` is here because it is the one nested field that fails silently:
 * a route naming a model the Subagent allowlist forbids still classifies,
 * so the verdict looks healthy while nothing can be dispatched.
 */
export interface JevSettings {
  mode?: string
  provider?: string
  endpoint?: string
  apiPath?: string
  apiKeyEnv?: string
  model?: string
  timeoutMs?: number
  stateChars?: number
  triggers?: string[]
  logDir?: string
  logTurnText?: boolean
  activeProfile?: string
  routes?: Record<string, { provider?: string; model?: string }>
}

/** Minimal slice of the framework settings scope this card consumes. */
export interface JevScope {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: JevSettings | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable?: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}
